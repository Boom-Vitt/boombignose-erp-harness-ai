package erpbilling

import (
	"encoding/json"
	"math/big"
	"strings"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type agreementInput struct {
	id string
	startDate string
	changes erpwire.Row
}

func parseAgreement(input erpwire.Row, update bool) (agreementInput, bool) {
	result := agreementInput{changes: erpwire.Row{}}
	if update {
		result.id, _ = input["id"].(string)
		if !validID(result.id) {
			return result, false
		}
	}
	clientID, ok := input["client_id"].(string)
	if !ok || !validID(clientID) {
		return result, false
	}
	name, ok := input["name"].(string)
	if !ok || strings.TrimSpace(name) == "" {
		return result, false
	}
	interval, ok := input["interval"].(string)
	if !ok || (interval != "weekly" && interval != "monthly" && interval != "quarterly" && interval != "yearly") {
		return result, false
	}
	var amountText string
	switch amount := input["amountBaht"].(type) {
	case string:
		amountText = amount
	case json.Number:
		amountText = amount.String()
	default:
		return result, false
	}
	amount, err := money.ParseBaht(amountText)
	if err != nil {
		return result, false
	}
	result.changes["client_id"] = clientID
	result.changes["name"] = strings.TrimSpace(name)
	result.changes["amount_satang"] = int64(amount)
	result.changes["interval"] = interval
	// project_id intentionally normalizes missing/empty/null to null, unlike
	// product_id whose omission MUST preserve the saved product on update.
	projectID := input["project_id"]
	if projectID == nil || projectID == "" {
		result.changes["project_id"] = nil
	} else if value, ok := projectID.(string); ok && validID(value) {
		result.changes["project_id"] = value
	} else {
		return result, false
	}
	if value, present := input["product_id"]; present {
		if value == nil || value == "" {
			result.changes["product_id"] = nil
		} else if text, ok := value.(string); ok && validID(text) {
			result.changes["product_id"] = text
		} else {
			return result, false
		}
	}
	if value, present := input["start_date"]; present {
		text, ok := value.(string)
		if !ok || (text != "" && !validDate(text)) {
			return result, false
		}
		result.startDate = text
	}
	if value, present := input["notes"]; present {
		text, ok := value.(string)
		if !ok {
			return result, false
		}
		if text = strings.TrimSpace(text); text != "" {
			result.changes["notes"] = text
		}
	}
	if value, present := input["unit"]; present {
		text, ok := value.(string)
		if !ok {
			return result, false
		}
		text = strings.TrimSpace(text)
		if text == "" || utf16Length(text) > 40 {
			return result, false
		}
		result.changes["unit"] = text
	}
	for _, key := range []string{"tax_rate_bps", "wht_rate_bps"} {
		if value, present := input[key]; present {
			number, ok := value.(json.Number)
			if !ok {
				return result, false
			}
			exact, ok := new(big.Rat).SetString(number.String())
			if !ok || !exact.IsInt() || !exact.Num().IsInt64() {
				return result, false
			}
			rate := exact.Num().Int64()
			if rate < 0 || rate > 10000 || (key == "wht_rate_bps" && rate != 0 && rate != 100 && rate != 200 && rate != 300 && rate != 500) {
				return result, false
			}
			result.changes[key] = rate
		}
	}
	if value, present := input["prices_include_vat"]; present {
		flag, ok := value.(bool)
		if !ok {
			return result, false
		}
		result.changes["prices_include_vat"] = flag
	}
	return result, true
}

func utf16Length(text string) int {
	length := 0
	for _, r := range text {
		length += utf16.RuneLen(r)
	}
	return length
}
