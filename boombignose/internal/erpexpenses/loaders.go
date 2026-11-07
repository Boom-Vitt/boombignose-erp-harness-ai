package erpexpenses

import (
	"context"
	"encoding/json"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type ListPage struct {
	ClaimLists
	DefaultTab string `json:"defaultTab"`
}

// Page loaders accept the resolved, data-only equivalent of the Next page props.
func (s *Service) listLoad(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 1)
	if err != nil { return nil, err }
	var props struct { SearchParams struct { Tab string `json:"tab"` } `json:"searchParams"` }
	if args.Decode(0, &props) != nil { return nil, erpwire.ErrBadArguments }
	out := ListPage{DefaultTab: "mine"}
	err = s.store.Read(ctx, actor, func(tx erpwire.ReadTx) (err error) {
		out.ClaimLists, err = s.readLists(ctx, tx, actor)
		return err
	})
	if err != nil { return nil, readError(err, errData) }
	if out.ToApprove != nil && props.SearchParams.Tab == "approve" { out.DefaultTab = "approve" }
	return out, nil
}

type FlowAction struct {
	Label string `json:"label"`
	To string `json:"to,omitempty"`
	Command string `json:"command,omitempty"`
}

type FlowNext struct {
	Primary *FlowAction `json:"primary,omitempty"`
	Secondary []FlowAction `json:"secondary,omitempty"`
}

type Flow struct {
	Stages []string `json:"stages"`
	Next map[string]FlowNext `json:"next"`
}

func claimFlow(claim erpwire.Row, actor erpwire.Actor) Flow {
	flow := Flow{Stages: []string{"draft", "submitted", "approved", "paid"}, Next: map[string]FlowNext{
		"draft": {Primary: &FlowAction{Label: "Submit", To: "submitted"}},
		"submitted": {Primary: &FlowAction{Label: "Approve", To: "approved"}, Secondary: []FlowAction{{Label: "Reject", Command: "reject"}, {Label: "Withdraw", To: "draft"}}},
		"approved": {Primary: &FlowAction{Label: "Mark paid", To: "paid"}, Secondary: []FlowAction{{Label: "Reject", Command: "reject"}}},
		"rejected": {Primary: &FlowAction{Label: "Reopen", To: "draft"}},
		"paid": {},
	}}
	status, _ := claim["status"].(string)
	employee, _ := claim["employee"].(string)
	allowed := func(action FlowAction) bool {
		if action.To == "draft" || action.To == "submitted" { return employee == actor.UserID() }
		return employee != actor.UserID() && erpwire.Can(actor.Role(), "expense:approve")
	}
	next := flow.Next[status]
	if next.Primary != nil && !allowed(*next.Primary) { next.Primary = nil }
	secondary := make([]FlowAction, 0, len(next.Secondary))
	for _, action := range next.Secondary { if allowed(action) { secondary = append(secondary, action) } }
	next.Secondary = secondary
	flow.Next[status] = next
	return flow
}

type RecordRef struct {
	RecordType string `json:"recordType"`
	RecordID string `json:"recordId"`
}

type DetailPage struct {
	Detail
	Editable bool `json:"editable"`
	Projects []erpwire.Row `json:"projects"`
	ProjectIDs []string `json:"projectIds"`
	OnlyProject erpwire.Row `json:"onlyProject"`
	TotalSatang int64 `json:"totalSatang"`
	Today string `json:"today"`
	Flow Flow `json:"flow"`
	// Compose lib/record-history/queries.ts::recordHistory with this ref;
	// history remains the shared record-history domain, not an expense copy.
	RecordRef RecordRef `json:"recordRef"`
}

func (s *Service) detailLoad(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 1)
	if err != nil { return nil, err }
	var props struct { Params struct { ID string `json:"id"` } `json:"params"` }
	if args.Decode(0, &props) != nil { return nil, erpwire.ErrBadArguments }
	id := props.Params.ID
	if !guid.MatchString(id) { return nil, erpwire.ErrNotFound }
	out := DetailPage{Projects: []erpwire.Row{}, ProjectIDs: []string{}, Today: time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2006-01-02"), RecordRef: RecordRef{RecordType: "expense_claim", RecordID: id}}
	err = s.store.Read(ctx, actor, func(tx erpwire.ReadTx) (err error) {
		out.Detail, err = s.readDetail(ctx, tx, actor, id)
		if err != nil { return err }
		out.Editable = out.Claim["status"] == "draft" && out.Claim["employee"] == actor.UserID()
		if out.Editable {
			out.Projects, err = readProjects(ctx, tx, actor)
			if err != nil { return err }
		}
		totals, err := totalLines(out.Lines)
		if err != nil { return err }
		if len(totals.Entries) > 1 { return errData }
		if len(totals.Entries) == 1 {
			if totals.Entries[0][0] != id { return errData }
			out.TotalSatang = totals.Entries[0][1].(int64)
		}
		seen := make(map[string]bool)
		for _, line := range out.Lines {
			project, ok := line["project_id"].(string)
			if ok && project != "" && !seen[project] { seen[project] = true; out.ProjectIDs = append(out.ProjectIDs, project) }
		}
		if len(out.ProjectIDs) == 1 {
			for _, line := range out.Lines { if line["project_id"] == out.ProjectIDs[0] { out.OnlyProject = line; break } }
		}
		out.Flow = claimFlow(out.Claim, actor)
		return nil
	})
	return out, readError(err, errData)
}

type NewPage struct { Context Context `json:"ctx"` }

func (s *Service) newLoad(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	if _, err := arguments(raw, 0); err != nil { return nil, err }
	// Reauthorize the live workspace even though this page has no domain rows.
	err := s.store.Read(ctx, actor, func(erpwire.ReadTx) error { return nil })
	return NewPage{Context: viewer(actor)}, readError(err, errData)
}
