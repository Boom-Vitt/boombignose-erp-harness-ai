package erpdata

import (
	"encoding/json"
	"errors"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// Bound complete records, never strings or serialized JSON fragments. Totals
// remain the exact SQL counts; callers construct evidence only after this bound.
const maxToolBytes = 14000
const maxToolItems = 16

func boundRows(payload map[string]any, rows []erpwire.Row) ([]erpwire.Row, error) {
	original := len(rows)
	if len(rows) > maxToolItems {
		rows = rows[:maxToolItems]
	}
	payload["items"] = rows
	var coverage map[string]any
	var coverageRows []any
	if c, ok := payload["receivables_coverage"].(map[string]any); ok {
		coverage = c
		coverageRows, _ = c["items"].([]any)
	}
	for {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		if len(raw) <= maxToolBytes {
			break
		}
		if len(rows) > 0 {
			rows = rows[:len(rows)-1]
			payload["items"] = rows
			continue
		}
		if len(coverageRows) > 0 {
			coverageRows = coverageRows[:len(coverageRows)-1]
			coverage["items"] = coverageRows
			coverage["has_more"] = true
			continue
		}
		return nil, errors.New("tool metadata exceeds bounded response; request fewer fields")
	}
	if len(rows) < original {
		payload["has_more"] = true
		payload["partial"] = true
	}
	if offset, ok := payload["offset"].(int); ok {
		payload["next_offset"] = offset + len(rows)
	}
	if original > 0 && len(rows) == 0 {
		return nil, errors.New("one record exceeds bounded response; use erp_data_read with fewer fields or erp_data_text")
	}
	return rows, nil
}
