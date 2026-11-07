package erpbilling

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (s *Service) createSubscription(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Authorize("subscription:manage", time.Now()); err != nil {
		return nil, err
	}
	input, err := objectArgument(raw)
	if err != nil {
		return invalidInput()
	}
	d, valid := parseAgreement(input, false)
	if !valid {
		return invalidInput()
	}
	if d.startDate == "" {
		d.startDate = today()
	}
	var id string
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		row := d.changes
		if productID, _ := row["product_id"].(string); productID != "" {
			selection, err := tx.Select(ctx, erpwire.Select{
				Table: "products", Columns: []string{"tax_rate_bps", "wht_rate_bps", "unit"},
				Where: []erpwire.Predicate{eq("org_id", actor.OrgID()), eq("id", productID), eq("active", true)}, Limit: 1,
			})
			if err != nil {
				return err
			}
			if len(selection.Rows) == 0 {
				return errProductUnavailable
			}
			for _, key := range []string{"tax_rate_bps", "wht_rate_bps", "unit"} {
				if _, present := row[key]; !present && selection.Rows[0][key] != nil {
					row[key] = selection.Rows[0][key]
				}
			}
		}
		if row["tax_rate_bps"] == nil || row["wht_rate_bps"] == nil || row["prices_include_vat"] == nil {
			selection, err := tx.Select(ctx, erpwire.Select{
				Table: "org_settings", Columns: []string{"vat_registered", "vat_rate_bps", "wht_rate_bps", "prices_include_vat"}, Where: scope(actor), Limit: 1,
			})
			if err != nil {
				return err
			}
			settings := erpwire.Row{}
			if len(selection.Rows) != 0 {
				settings = selection.Rows[0]
			}
			if row["tax_rate_bps"] == nil {
				row["tax_rate_bps"] = int64(0)
				if registered, _ := settings["vat_registered"].(bool); registered {
					if settings["vat_rate_bps"] == nil {
						return errors.New("Subscription tax settings unavailable")
					}
					row["tax_rate_bps"] = settings["vat_rate_bps"]
				}
			}
			if row["wht_rate_bps"] == nil {
				row["wht_rate_bps"] = int64(0)
				if settings["wht_rate_bps"] != nil {
					row["wht_rate_bps"] = settings["wht_rate_bps"]
				}
			}
			if row["prices_include_vat"] == nil {
				row["prices_include_vat"] = false
				if settings["prices_include_vat"] != nil {
					row["prices_include_vat"] = settings["prices_include_vat"]
				}
			}
		}
		if row["unit"] == nil {
			row["unit"] = "period"
		}
		if _, present := row["product_id"]; !present {
			row["product_id"] = nil
		}
		row["org_id"] = actor.OrgID()
		row["status"] = "active"
		row["start_date"] = d.startDate
		row["next_run_date"] = d.startDate
		row["auto_generate"] = true
		rows, err := tx.Insert(ctx, erpwire.Insert{Table: "subscriptions", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			return errCommandResult
		}
		id, _ = rows[0]["id"].(string)
		if !validID(id) {
			return errCommandResult
		}
		return insertAudit(ctx, tx, actor, id, "created", "Created subscription "+row["name"].(string)+" ("+formatWholeBaht(row["amount_satang"].(int64))+"/"+row["interval"].(string)+")", nil)
	})
	if err != nil {
		return actionFailure(err, "Could not create subscription. Please reload and retry.")
	}
	return success(listPath+"/"+id, listPath)
}

func (s *Service) updateSubscription(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Authorize("subscription:manage", time.Now()); err != nil {
		return nil, err
	}
	input, err := objectArgument(raw)
	if err != nil {
		return invalidInput()
	}
	d, valid := parseAgreement(input, true)
	if !valid {
		return invalidInput()
	}
	var start any
	if d.startDate != "" {
		start = d.startDate
	}
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		_, err := tx.Command(ctx, "update_subscription_schedule", erpwire.Row{
			"p_org_id": actor.OrgID(), "p_subscription_id": d.id, "p_start_date": start, "p_changes": d.changes,
		})
		if err != nil {
			return err
		}
		return insertAudit(ctx, tx, actor, d.id, "updated", "Updated subscription "+d.changes["name"].(string), nil)
	})
	if err != nil {
		return actionFailure(err, "Could not update subscription. Please reload and retry.")
	}
	return success("", listPath, listPath+"/"+d.id)
}

func (s *Service) setSubscriptionStatus(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Authorize("subscription:manage", time.Now()); err != nil {
		return nil, err
	}
	input, err := objectArgument(raw)
	if err != nil {
		return invalidInput()
	}
	id, _ := input["id"].(string)
	status, _ := input["status"].(string)
	if !validID(id) || (status != "active" && status != "paused" && status != "cancelled") {
		return invalidInput()
	}
	billMissed := false
	if value, present := input["bill_missed_periods"]; present {
		var ok bool
		billMissed, ok = value.(bool)
		if !ok {
			return invalidInput()
		}
	}
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		_, err := tx.Command(ctx, "update_subscription_schedule", erpwire.Row{
			"p_org_id": actor.OrgID(), "p_subscription_id": id, "p_start_date": nil,
			"p_status": status, "p_bill_missed_periods": billMissed,
		})
		if err != nil {
			return err
		}
		return insertAudit(ctx, tx, actor, id, "status_changed", "Set subscription status to "+status, erpwire.Row{"status": status, "billMissedPeriods": billMissed})
	})
	if err != nil {
		return actionFailure(err, "Could not change subscription status. Please reload before retrying.")
	}
	return success("", listPath, listPath+"/"+id)
}

func (s *Service) deleteSubscription(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Authorize("subscription:manage", time.Now()); err != nil {
		return nil, err
	}
	input, err := objectArgument(raw)
	if err != nil {
		return invalidInput()
	}
	id, _ := input["id"].(string)
	if !validID(id) {
		return invalidInput()
	}
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		_, err := tx.Delete(ctx, "subscriptions", []erpwire.Predicate{eq("org_id", actor.OrgID()), eq("id", id)}, nil)
		if err != nil {
			return err
		}
		return insertAudit(ctx, tx, actor, id, "deleted", "Deleted subscription", nil)
	})
	if err != nil {
		return actionFailure(err, "Could not delete subscription. Please reload and retry.")
	}
	return success(listPath, listPath)
}

func (s *Service) generateInvoiceNow(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Authorize("subscription:manage", time.Now()); err != nil {
		return nil, err
	}
	input, err := objectArgument(raw)
	if err != nil {
		return invalidInput()
	}
	id, _ := input["id"].(string)
	occurrence, _ := input["occurrence"].(string)
	if !validID(id) || !validDate(occurrence) {
		return invalidInput()
	}
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		_, err := s.GenerateOccurrenceInTx(ctx, tx, actor.OrgID(), id, occurrence)
		return err
	})
	if err != nil {
		return actionFailure(err, "Invoice generation failed")
	}
	return success("", "/finance", listPath, listPath+"/"+id)
}

func insertAudit(ctx context.Context, tx erpwire.WriteTx, actor erpwire.Actor, id, action, summary string, meta erpwire.Row) error {
	if meta == nil {
		meta = erpwire.Row{}
	}
	_, err := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{
		"org_id": actor.OrgID(), "actor_id": actor.UserID(), "actor_email": actor.Email(),
		"entity": "subscription", "entity_id": id, "action": action, "summary": summary, "meta": meta,
	}}})
	return err
}

// Only the human audit label rounds to a whole baht, matching formatTHBWhole;
// persisted agreement and invoice amounts never pass through this formatter.
func formatWholeBaht(satang int64) string {
	digits := strconv.FormatInt((satang+50)/100, 10)
	var result strings.Builder
	result.WriteString("฿")
	for index, digit := range digits {
		if index > 0 && (len(digits)-index)%3 == 0 {
			result.WriteByte(',')
		}
		result.WriteRune(digit)
	}
	return result.String()
}
