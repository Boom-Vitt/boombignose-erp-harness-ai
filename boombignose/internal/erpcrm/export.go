package erpcrm

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// CSVResponse is package-local until erpwire defines a route response contract.
type CSVResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

var csvNumber = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$`)

func csvField(value string) string {
	if value != "" && strings.ContainsAny(value[:1], "=+-@\t\r") && !csvNumber.MatchString(value) {
		value = "'" + value
	}
	if strings.ContainsAny(value, ",\"\r\n") {
		return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
	}
	return value
}

func (s *Service) exportDeals(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	args, err := arguments(raw, 0, 1)
	if err != nil {
		return nil, err
	}
	params, err := searchParams(args)
	if err != nil {
		return nil, err
	}
	config, now := parseFacets(params, "deals"), time.Now()
	var deals []erpwire.Row
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		deals, err = all(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "title", "stage", "value_satang", "probability", "won_at", "lost_at", "owner", "expected_close_date", "next_follow_up_date"}, Relations: []erpwire.Relation{clientRelation(), reasonRelation()}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
		return err
	})
	if err != nil {
		return nil, err
	}
	lines := []string{"Title,Client,Stage,Value (THB),Probability (%),Expected revenue (THB),Expected close,Next follow-up,Won at,Lost at,Lost reason"}
	for _, deal := range deals {
		if !matches(config, deal, text(deal["title"])+" "+relationName(deal, "client"), text(deal["expected_close_date"]), a, now) {
			continue
		}
		value, err := satang(deal["value_satang"])
		if err != nil {
			return nil, err
		}
		probability, err := integer(deal["probability"])
		if err != nil {
			return nil, err
		}
		weighted, err := expected(value, probability)
		if err != nil {
			return nil, err
		}
		row := []string{text(deal["title"]), relationName(deal, "client"), text(deal["stage"]), bahtText(value), strconv.FormatInt(probability, 10), bahtText(weighted), text(deal["expected_close_date"]), text(deal["next_follow_up_date"]), text(deal["won_at"]), text(deal["lost_at"]), relationName(deal, "lost_reason")}
		for i := range row {
			row[i] = csvField(row[i])
		}
		lines = append(lines, strings.Join(row, ","))
	}
	return CSVResponse{Status: 200, Headers: map[string]string{"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="deals-` + today(now) + `.csv"`}, Body: "\ufeff" + strings.Join(lines, "\r\n")}, nil
}
