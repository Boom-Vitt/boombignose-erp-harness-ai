package erpprojects

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func projectColumns(input erpwire.Row, quick bool) (erpwire.Row, string) {
	name, ok := input["name"].(string)
	if !ok {
		return nil, fmt.Sprintf("Invalid input: expected string, received %s", inputType(input, "name"))
	}
	name = trim(name)
	if name == "" {
		return nil, "Project name is required"
	}
	status := text(input["status"])
	if !has(projectStatuses, status) {
		return nil, `Invalid option: expected one of "not_started"|"in_progress"|"review"|"delivered"|"support"|"paused"|"cancelled"`
	}
	row := erpwire.Row{"name": name, "status": status, "budget_satang": nil, "client_id": nil, "deadline": nil, "owner": nil, "deal_id": nil}
	if value, present := input["budgetBaht"]; present {
		switch value.(type) {
		case string, json.Number:
		default:
			return nil, "Invalid input"
		}
		amount, err := moneyInput(value)
		if err != nil {
			return nil, "Enter a safe, nonnegative THB amount with up to two decimals"
		}
		row["budget_satang"] = int64(amount)
	}
	if quick {
		return row, ""
	}
	if !optionalStrings(input, "clientId", "deadline", "owner", "dealId") {
		return nil, "Invalid input"
	}
	owner := text(input["owner"])
	if owner != "" && owner != "none" && !validID(owner) {
		return nil, "Invalid input"
	}
	row["client_id"] = selected(text(input["clientId"]))
	row["deal_id"] = selected(text(input["dealId"]))
	row["owner"] = selected(owner)
	row["deadline"] = nullable(text(input["deadline"]))
	return row, ""
}
func inputType(input erpwire.Row, key string) string {
	value, present := input[key]
	if !present {
		return "undefined"
	}
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case json.Number:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	}
	return "object"
}
func (s *Service) member(ctx context.Context, a erpwire.Actor, id string) (bool, error) {
	found := false
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		rows, err := people(ctx, tx, a)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if text(row["user_id"]) == id {
				found = true
			}
		}
		return nil
	})
	if canonical(err) {
		return false, err
	}
	return found && err == nil, nil
}
func (s *Service) createProject(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.createProjectAction(ctx, a, raw, false)
}
func (s *Service) quickCreateProject(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.createProjectAction(ctx, a, raw, true)
}
func (s *Service) createProjectAction(ctx context.Context, a erpwire.Actor, raw json.RawMessage, quick bool) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	if input == nil {
		if quick {
			args, _ := arguments(raw, 1, 1)
			var value any
			_ = args.Decode(0, &value)
			return invalid("Invalid input: expected object, received " + inputType(erpwire.Row{"value": value}, "value"))
		}
		return invalid("Invalid input")
	}
	row, message := projectColumns(input, quick)
	if message != "" {
		if !quick {
			message = "Invalid input"
		}
		return invalid(message)
	}
	if owner := text(row["owner"]); owner != "" {
		member, err := s.member(ctx, a, owner)
		if err != nil {
			return nil, err
		}
		if !member {
			return invalid(ownerError)
		}
	}
	row["org_id"] = a.OrgID()
	var id string
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, err := tx.Insert(ctx, erpwire.Insert{Table: "projects", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
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
	redirect := ""
	if !quick {
		redirect = "/projects/" + id
	}
	return success(redirect, "/projects"), nil
}
func (s *Service) updateProject(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	row, message := projectColumns(input, false)
	if message != "" || !required(input, "id") {
		return invalid("Invalid input")
	}
	id := text(input["id"])
	if owner := text(row["owner"]); owner != "" {
		var current erpwire.Row
		err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
			var err error
			current, err = one(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"owner"}, Where: scoped(a, id)})
			return err
		})
		if canonical(err) {
			return nil, err
		}
		if text(current["owner"]) != owner {
			member, err := s.member(ctx, a, owner)
			if err != nil {
				return nil, err
			}
			if !member {
				return invalid(ownerError)
			}
		}
	}
	delete(row, "deal_id")
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Update(ctx, "projects", row, scoped(a, id), nil)
		return err
	})
	if err != nil {
		return failure(err)
	}
	return success("/projects/"+id, "/projects", "/projects/"+id), nil
}
func (s *Service) updateProjectStatus(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	id, status := text(input["id"]), text(input["status"])
	if id == "" || !has(projectStatuses, status) {
		return invalid("Invalid input")
	}
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Update(ctx, "projects", erpwire.Row{"status": status}, scoped(a, id), nil)
		return err
	})
	if err != nil {
		return failure(err)
	}
	return success("", "/projects", "/projects/"+id), nil
}
func (s *Service) addTask(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.addCheckpoint(ctx, a, raw, true)
}
func (s *Service) addMilestone(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.addCheckpoint(ctx, a, raw, false)
}
func (s *Service) addCheckpoint(ctx context.Context, a erpwire.Actor, raw json.RawMessage, task bool) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	if !required(input, "projectId") || !required(input, "title") || trim(text(input["title"])) == "" || !optionalStrings(input, "dueDate") {
		return invalid("Invalid input")
	}
	table := "milestones"
	row := erpwire.Row{"org_id": a.OrgID(), "project_id": text(input["projectId"]), "title": trim(text(input["title"])), "due_date": nullable(text(input["dueDate"]))}
	if task {
		status := text(input["status"])
		if !has(taskStatuses, status) || !optionalStrings(input, "assignee") {
			return invalid("Invalid input")
		}
		table = "project_tasks"
		row["status"] = status
		row["done"] = status == "done"
		row["assignee"] = nullable(trim(text(input["assignee"])))
	}
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Insert(ctx, erpwire.Insert{Table: table, Rows: []erpwire.Row{row}})
		return err
	})
	if err != nil {
		return failure(err)
	}
	return success("", "/projects/"+text(input["projectId"])), nil
}
func (s *Service) toggleTask(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.toggleCheckpoint(ctx, a, raw, true)
}
func (s *Service) toggleMilestone(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.toggleCheckpoint(ctx, a, raw, false)
}
func (s *Service) toggleCheckpoint(ctx context.Context, a erpwire.Actor, raw json.RawMessage, task bool) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	input, err := inputArgument(raw)
	if err != nil {
		return nil, err
	}
	done, ok := input["done"].(bool)
	if !ok || !required(input, "id") || !required(input, "projectId") {
		return invalid("Invalid input")
	}
	table := "milestones"
	row := erpwire.Row{"done": done}
	if task {
		table = "project_tasks"
		row["status"] = "todo"
		if done {
			row["status"] = "done"
		}
	}
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Update(ctx, table, row, scoped(a, text(input["id"])), nil)
		return err
	})
	if err != nil {
		return failure(err)
	}
	return success("", "/projects/"+text(input["projectId"])), nil
}
