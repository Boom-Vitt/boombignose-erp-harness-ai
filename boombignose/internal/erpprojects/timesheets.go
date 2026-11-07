package erpprojects

import (
	"context"
	"encoding/json"
	"math"
	"math/big"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func truthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case json.Number:
		n, ok := numeric(v)
		return ok && n.Sign() != 0
	}
	return true
}
func logColumns(input erpwire.Row) (erpwire.Row, string) {
	if !required(input, "project_id") || !optionalStrings(input, "task_id", "work_date", "notes") {
		return nil, "Invalid input"
	}
	hours, present := input["hours"]
	h, ok := numeric(hours)
	if !present || !ok || h.Sign() < 0 {
		return nil, "Invalid input"
	}
	// Hours follow JavaScript's binary64 minute rounding; satang never uses floats.
	hourNumber, _ := h.Float64()
	if hourNumber > 2147483647.0/60 {
		return nil, "Invalid input"
	}
	minutes := int64(math.Floor(hourNumber*60 + 0.5))
	row := erpwire.Row{"project_id": text(input["project_id"]), "task_id": nullable(text(input["task_id"])), "minutes": minutes, "billable": true, "rate_satang": nil}
	if value, present := input["billable"]; present {
		row["billable"] = truthy(value)
	}
	value, ratePresent := input["rateBaht"]
	emptyRate, isRateText := value.(string)
	if ratePresent && (!isRateText || emptyRate != "") {
		rate, ok := numeric(value)
		if !ok {
			return nil, "Invalid input"
		}
		if rate.Sign() < 0 {
			return nil, "Rate must be 0 or more"
		}
		amount, err := roundedRate(rate)
		if err != nil {
			return nil, "Invalid hourly rate"
		}
		row["rate_satang"] = int64(amount)
	}
	if date := text(input["work_date"]); date != "" {
		row["work_date"] = date
	}
	if notes := trim(text(input["notes"])); notes != "" {
		row["notes"] = notes
	}
	return row, ""
}
func (s *Service) logTime(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, "record:write"); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	row, message := logColumns(input)
	if message != "" {
		return invalid(message)
	}
	row["org_id"] = a.OrgID()
	row["user_id"] = a.UserID()
	var id string
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		if task := text(row["task_id"]); task != "" {
			found, err := one(ctx, tx, erpwire.Select{Table: "project_tasks", Columns: []string{"id"}, Where: append(scoped(a, task), eq("project_id", row["project_id"]))})
			if err != nil {
				return err
			}
			if found == nil {
				return businessError("Task must belong to time entry project")
			}
		}
		rows, err := tx.Insert(ctx, erpwire.Insert{Table: "time_entries", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
		if err != nil {
			return err
		}
		if len(rows) != 1 || text(rows[0]["id"]) == "" {
			return businessError(safeFailure)
		}
		id = text(rows[0]["id"])
		return nil
	})
	if err != nil {
		return failure(err)
	}
	minutes, _ := integer(row["minutes"])
	s.audit(ctx, a, id, "time_logged", "Logged "+string(ratio(minutes, 60, 2))+"h", erpwire.Row{"projectId": row["project_id"], "billable": row["billable"]})
	return success("", "/timesheets", "/dashboard", "/projects/"+text(row["project_id"])), nil
}
func canEditTime(a erpwire.Actor, entry erpwire.Row) bool {
	return (entry["invoice_id"] == nil || text(relation(entry, "invoices")["status"]) == "cancelled") && (text(entry["user_id"]) == a.UserID() || erpwire.Can(a.Role(), "invoice:delete"))
}
func timeEntry(ctx context.Context, tx selector, a erpwire.Actor, id string) (erpwire.Row, error) {
	return one(ctx, tx, erpwire.Select{Table: "time_entries", Columns: []string{"user_id", "invoice_id", "project_id"}, Relations: []erpwire.Relation{{Name: "invoices", Table: "invoices", LocalColumn: "invoice_id", ForeignColumn: "id", Columns: []string{"status"}}}, Where: scoped(a, id)})
}
func (s *Service) deleteTimeEntry(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, "record:write"); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	if !required(input, "id") {
		return invalid("Invalid input")
	}
	id := text(input["id"])
	var projectID string
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		entry, err := timeEntry(ctx, tx, a, id)
		if err != nil {
			return err
		}
		if entry == nil || !canEditTime(a, entry) {
			return businessError(editTimeError)
		}
		projectID = text(entry["project_id"])
		rows, err := tx.Delete(ctx, "time_entries", scoped(a, id), []string{"id"})
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			return businessError("Entry could not be deleted")
		}
		return nil
	})
	if err != nil {
		return failure(err)
	}
	s.audit(ctx, a, id, "deleted", "Deleted a time entry", nil)
	return success("", "/projects/"+projectID, "/dashboard", "/timesheets"), nil
}
func updateTimeColumns(input erpwire.Row) (erpwire.Row, bool) {
	n, ok := numeric(input["minutes"])
	_, present := input["minutes"]
	billable, isBool := input["billable"].(bool)
	rate, isString := input["rateBaht"].(string)
	notes, notesOK := input["notes"].(string)
	if !required(input, "id") || !present || !ok || !n.IsInt() || n.Sign() < 0 || n.Cmp(big.NewRat(2147483647, 1)) > 0 || !isBool || !isString || !notesOK || textLength(trim(notes)) > 5000 {
		return nil, false
	}
	row := erpwire.Row{"minutes": n.Num().Int64(), "billable": billable, "rate_satang": nil, "notes": nullable(trim(notes))}
	if rate != "" {
		value, err := moneyInput(rate)
		if err != nil {
			return nil, false
		}
		row["rate_satang"] = int64(value)
	}
	return row, true
}
func (s *Service) updateTimeEntry(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, "record:write"); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	row, ok := updateTimeColumns(input)
	if !ok {
		return invalid("Invalid time entry")
	}
	id := text(input["id"])
	var projectID string
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		entry, err := timeEntry(ctx, tx, a, id)
		if err != nil {
			return err
		}
		if entry == nil || !canEditTime(a, entry) {
			return businessError(editTimeError)
		}
		projectID = text(entry["project_id"])
		rows, err := tx.Update(ctx, "time_entries", row, scoped(a, id), []string{"id"})
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			return businessError("Entry could not be updated")
		}
		return nil
	})
	if err != nil {
		return failure(err)
	}
	s.audit(ctx, a, id, "updated", "Updated unbilled time", nil)
	return success("", "/timesheets", "/dashboard", "/projects/"+projectID), nil
}
func (s *Service) billTime(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	if !erpwire.Can(a.Role(), "invoice:delete") {
		return invalid("Only staff may bill time")
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	project, key := text(input["project_id"]), text(input["key"])
	if !validID(project) || !strictUUID(key) {
		return invalid("Invalid billing request")
	}
	var id string
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		result, err := tx.Command(ctx, "bill_project_time", erpwire.Row{"p_org_id": a.OrgID(), "p_project_id": project, "p_key": key})
		if err != nil {
			return err
		}
		if erpwire.DecodeJSON(result, &id) != nil || !validID(id) {
			return businessError(safeFailure)
		}
		return nil
	})
	if err != nil {
		return failure(err)
	}
	out := success("", "/timesheets", "/finance", "/projects/"+project)
	out.Value = erpwire.Row{"invoiceId": id}
	return out, nil
}
func (s *Service) setMemberCostRate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	if !erpwire.Can(a.Role(), "settings:manage") {
		return invalid("Only staff may set cost rates")
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	rate, ok := input["rateBaht"].(string)
	if !validID(text(input["user_id"])) || !ok {
		return invalid("Invalid cost rate")
	}
	amount, err := moneyInput(rate)
	if err != nil {
		return invalid("Invalid cost rate")
	}
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Command(ctx, "set_member_cost_rate", erpwire.Row{"p_org_id": a.OrgID(), "p_user_id": text(input["user_id"]), "p_rate_satang": int64(amount)})
		return err
	})
	if err != nil {
		return failure(err)
	}
	return success("", "/timesheets", "/projects"), nil
}
