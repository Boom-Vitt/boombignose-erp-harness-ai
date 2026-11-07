package erpprojects

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestExactMoneyInputs(t *testing.T) {
	for _, test := range []struct {
		input any
		want  money.Satang
		valid bool
	}{
		{"0", 0, true}, {" \ufeff 0001.2 \ufeff ", 120, true}, {"0.01", 1, true}, {"90071992547409.91", money.MaxSafeSatang, true}, {json.Number("1e2"), 10000, true}, {json.Number("0.29"), 29, true},
		{"", 0, false}, {".5", 0, false}, {"1.", 0, false}, {"-1", 0, false}, {"1e2", 0, false}, {"0x10", 0, false}, {"0.001", 0, false}, {"90071992547409.92", 0, false}, {"90071992547410", 0, false}, {nil, 0, false}, {true, 0, false}, {json.Number("0.001"), 0, false}, {json.Number("90071992547409.92"), 0, false},
		{"\u00851\u0085", 0, false},
	} {
		t.Run(stringify(test.input), func(t *testing.T) {
			value, err := moneyInput(test.input)
			if (err == nil) != test.valid || test.valid && value != test.want {
				t.Fatalf("moneyInput(%#v) = %d, %v; want %d, valid %v", test.input, value, err, test.want, test.valid)
			}
		})
	}
}
func stringify(value any) string { raw, _ := json.Marshal(value); return string(raw) }
func TestHourlyValueBoundariesAndPerEntryRounding(t *testing.T) {
	for _, test := range []struct {
		name       string
		minutes    int64
		rate, want money.Satang
		message    string
	}{
		{"zero", 0, money.MaxSafeSatang, 0, ""}, {"below half", 1, 29, 0, ""}, {"half satang", 1, 30, 1, ""}, {"hour", 60, 12345, 12345, ""}, {"maximum", 60, money.MaxSafeSatang, money.MaxSafeSatang, ""}, {"wide product", 2147483647, 100, 3579139412, ""},
		{"negative minutes", -1, 100, 0, "Invalid minutes or hourly rate"}, {"negative rate", 1, -1, 0, "Invalid minutes or hourly rate"}, {"overflow", 61, money.MaxSafeSatang, 0, "Time value exceeds safe satang bounds"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := hourlyValue(test.minutes, test.rate)
			if test.message != "" {
				if err == nil || err.Error() != test.message {
					t.Fatalf("got %d, %v; want %s", got, err, test.message)
				}
			} else if err != nil || got != test.want {
				t.Fatalf("got %d, %v; want %d", got, err, test.want)
			}
		})
	}
	entries := []erpwire.Row{{"minutes": int64(30), "billable": true, "rate_satang": int64(1)}, {"minutes": int64(30), "billable": true, "rate_satang": int64(1)}, {"minutes": int64(60), "billable": false, "rate_satang": int64(999)}, {"minutes": int64(60), "billable": true, "rate_satang": nil}}
	if value, err := billableValue(entries); err != nil || value != 2 {
		t.Fatalf("per-entry total %d, %v; want 2", value, err)
	}
	_, err := billableValue([]erpwire.Row{{"minutes": int64(60), "billable": true, "rate_satang": int64(money.MaxSafeSatang)}, {"minutes": int64(60), "billable": true, "rate_satang": int64(1)}})
	if err == nil || err.Error() != "Unsafe integer-satang sum" {
		t.Fatalf("unsafe sum accepted: %v", err)
	}
}
func TestProfitUsesPreVATRevenueCreditsRecoverableVATAndLabour(t *testing.T) {
	invoices := []erpwire.Row{{"status": "sent", "total_satang": int64(10700), "vat_satang": int64(700), "amount_satang": int64(8000)}, {"status": "draft", "total_satang": int64(999999), "vat_satang": int64(0)}, {"status": "cancelled", "total_satang": int64(999999), "vat_satang": int64(0)}}
	costs := []erpwire.Row{{"amount_satang": int64(2140), "input_vat_satang": int64(140)}}
	for _, test := range []struct {
		vat          bool
		cost, profit money.Satang
		margin       string
	}{{true, 3000, 6000, "66.6666666666666667"}, {false, 3140, 5860, "65.1111111111111111"}} {
		t.Run(stringify(test.vat), func(t *testing.T) {
			out, err := projectProfit(invoices, costs, 1000, 1000, test.vat)
			if err != nil {
				t.Fatal(err)
			}
			if out.RevenueSatang != 9000 || out.CostSatang != test.cost || out.ProfitSatang != test.profit || out.MarginPct.String() != test.margin {
				t.Fatalf("profit %#v", out)
			}
		})
	}
	maximum, err := projectProfit([]erpwire.Row{{"status": "paid", "total_satang": int64(money.MaxSafeSatang), "vat_satang": int64(0)}}, nil, 0, 0, false)
	if err != nil || maximum.ProfitSatang != money.MaxSafeSatang || maximum.MarginPct != "100.0000000000000000" {
		t.Fatalf("maximum %#v, %v", maximum, err)
	}
	if _, err := projectProfit(nil, []erpwire.Row{{"amount_satang": int64(money.MaxSafeSatang), "input_vat_satang": int64(0)}}, 1, 0, false); err == nil {
		t.Fatal("unsafe total cost accepted")
	}
	negative, err := projectProfit(nil, nil, 1, 5, false)
	if err != nil || negative.RevenueSatang != -5 || negative.ProfitSatang != -6 || negative.MarginPct != "0" {
		t.Fatalf("credit-only profit %#v, %v", negative, err)
	}
}
func TestBrowserWhitespaceAndUTF16Limits(t *testing.T) {
	if trim("\ufeff title \ufeff") != "title" || trim("\u0085title\u0085") != "\u0085title\u0085" {
		t.Fatal("browser trim differs")
	}
	input := erpwire.Row{"id": "entry", "minutes": json.Number("0"), "billable": true, "rateBaht": "", "notes": strings.Repeat("😀", 2500)}
	if _, ok := updateTimeColumns(input); !ok {
		t.Fatal("5000 UTF-16 units rejected")
	}
	input["notes"] = strings.Repeat("😀", 2501)
	if _, ok := updateTimeColumns(input); ok {
		t.Fatal("5002 UTF-16 units accepted")
	}
}
