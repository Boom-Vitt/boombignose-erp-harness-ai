package erpinvoicing

import (
	"reflect"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestTaxExactSourceCases(t *testing.T) {
	for _, tc := range []struct {
		name      string
		lines     []TaxLine
		discount  money.Satang
		inclusive bool
		wht       int64
		want      TaxTotals
	}{
		{"exclusive discount", []TaxLine{{100000, 700}}, 10000, false, 300, TaxTotals{100000, 10000, 90000, 6300, 96300, 2700, 93600, []TaxBucket{{700, 90000, 6300}}}},
		{"inclusive mixed rates", []TaxLine{{107000, 700}, {105000, 500}, {100000, 0}}, 31200, true, 300, TaxTotals{312000, 31200, 270000, 10800, 280800, 8100, 272700, []TaxBucket{{0, 90000, 0}, {500, 90000, 4500}, {700, 90000, 6300}}}},
		{"stable discount tie", []TaxLine{{10000, 1000}, {10000, 700}, {10000, 0}}, 1, false, 0, TaxTotals{30000, 1, 29999, 1700, 31699, 0, 31699, []TaxBucket{{0, 9999, 0}, {700, 10000, 700}, {1000, 10000, 1000}}}},
		{"inclusive high rate", []TaxLine{{1999900000000001, 9999}}, 0, true, 0, TaxTotals{1999900000000001, 0, 1000000000000001, 999900000000000, 1999900000000001, 0, 1999900000000001, []TaxBucket{{9999, 1000000000000001, 999900000000000}}}},
		{"large discount floors", []TaxLine{{10000000000003, 0}, {10000000000002, 700}, {10000000000002, 1000}}, 15000000000002, false, 300, TaxTotals{30000000000007, 15000000000002, 15000000000005, 850000000000, 15850000000005, 450000000000, 15400000000005, []TaxBucket{{0, 5000000000002, 0}, {700, 5000000000001, 350000000000}, {1000, 5000000000002, 500000000000}}}},
		{"inclusive half up", []TaxLine{{1, 10000}}, 0, true, 0, TaxTotals{1, 0, 0, 1, 1, 0, 1, []TaxBucket{{10000, 0, 1}}}},
		{"WHT half up", []TaxLine{{50, 0}}, 0, false, 100, TaxTotals{50, 0, 50, 0, 50, 1, 49, []TaxBucket{{0, 50, 0}}}},
		{"maximum satang", []TaxLine{{money.MaxSafeSatang, 700}}, 0, true, 500, TaxTotals{money.MaxSafeSatang, 0, 8417943228729898, 589256026011093, money.MaxSafeSatang, 420897161436495, 8586302093304496, []TaxBucket{{700, 8417943228729898, 589256026011093}}}},
		{"near total max discount", []TaxLine{{money.MaxSafeSatang - 1, 0}, {1, 9999}}, money.MaxSafeSatang - 2, true, 300, TaxTotals{money.MaxSafeSatang, money.MaxSafeSatang - 2, 2, 0, 2, 0, 2, []TaxBucket{{0, 2, 0}, {9999, 0, 0}}}},
		{"empty", nil, 0, false, 0, TaxTotals{VATByRate: []TaxBucket{}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, e := CalculateTax(tc.lines, tc.discount, tc.inclusive, tc.wht)
			if e != nil || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %#v, %v; want %#v", got, e, tc.want)
			}
		})
	}
}

func TestTaxInvalidBoundaries(t *testing.T) {
	for _, tc := range []struct {
		lines    []TaxLine
		discount money.Satang
		wht      int64
		want     string
	}{
		{[]TaxLine{{-1, 700}}, 0, 0, "Invalid satang amount"},
		{[]TaxLine{{money.MaxSafeSatang + 1, 0}}, 0, 0, "Invalid satang amount"},
		{[]TaxLine{{1, -1}}, 0, 0, "Invalid tax rate"},
		{[]TaxLine{{1, 10001}}, 0, 0, "Invalid tax rate"},
		{[]TaxLine{{1, 700}}, 2, 0, "Discount exceeds subtotal"},
		{[]TaxLine{{1, 700}}, 0, 400, "Invalid WHT rate"},
		{[]TaxLine{{money.MaxSafeSatang, 700}}, 0, 0, "Total exceeds safe satang bounds"},
		{[]TaxLine{{money.MaxSafeSatang, 0}, {1, 0}}, 0, 0, "Total exceeds safe satang bounds"},
	} {
		_, e := CalculateTax(tc.lines, tc.discount, false, tc.wht)
		if e == nil || e.Error() != tc.want {
			t.Fatalf("%#v returned %v; want %q", tc, e, tc.want)
		}
	}
}

func TestTaxOrderAndMoneyInvariants(t *testing.T) {
	for _, inclusive := range []bool{false, true} {
		for a := money.Satang(0); a < 25; a++ {
			for b := money.Satang(0); b < 25; b++ {
				for _, wht := range []int64{0, 100, 200, 300, 500} {
					discount := (a + b) / 3
					first, e := CalculateTax([]TaxLine{{a, 700}, {b, 1000}}, discount, inclusive, wht)
					if e != nil {
						t.Fatal(e)
					}
					second, e := CalculateTax([]TaxLine{{b, 1000}, {a, 700}}, discount, inclusive, wht)
					if e != nil || !reflect.DeepEqual(first, second) {
						t.Fatalf("line ordering changed tax: %#v vs %#v %v", first, second, e)
					}
					if first.BaseSatang+first.VATSatang != first.TotalSatang || first.TotalSatang-first.WHTSatang != first.AmountDueSatang {
						t.Fatalf("unbalanced totals: %#v", first)
					}
					net := first.BaseSatang
					if inclusive {
						net += first.VATSatang
					}
					if net != a+b-discount {
						t.Fatalf("discount drift: %#v", first)
					}
				}
			}
		}
	}
}
