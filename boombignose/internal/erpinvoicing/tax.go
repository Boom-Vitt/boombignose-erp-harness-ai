package erpinvoicing

import (
	"errors"
	"math/big"
	"sort"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type TaxLine struct {
	AmountSatang money.Satang `json:"amount_satang"`
	TaxRateBps   int64        `json:"tax_rate_bps"`
}

type TaxBucket struct {
	RateBps    int64        `json:"rateBps"`
	BaseSatang money.Satang `json:"baseSatang"`
	VATSatang  money.Satang `json:"vatSatang"`
}

type TaxTotals struct {
	SubtotalSatang  money.Satang `json:"subtotalSatang"`
	DiscountSatang  money.Satang `json:"discountSatang"`
	BaseSatang      money.Satang `json:"baseSatang"`
	VATSatang       money.Satang `json:"vatSatang"`
	TotalSatang     money.Satang `json:"totalSatang"`
	WHTSatang       money.Satang `json:"whtSatang"`
	AmountDueSatang money.Satang `json:"amountDueSatang"`
	VATByRate       []TaxBucket  `json:"vatByRate"`
}

func validWHT(rate int64) bool {
	return rate == 0 || rate == 100 || rate == 200 || rate == 300 || rate == 500
}

func safeTaxMoney(value *big.Int) (money.Satang, error) {
	if value.Sign() < 0 || value.Cmp(big.NewInt(int64(money.MaxSafeSatang))) > 0 {
		return 0, errors.New("Total exceeds safe satang bounds")
	}
	return money.Satang(value.Int64()), nil
}

func roundedRatio(numerator *big.Int, denominator int64) *big.Int {
	result := new(big.Int).Mul(numerator, big.NewInt(2))
	result.Add(result, big.NewInt(denominator))
	return result.Quo(result, big.NewInt(denominator*2))
}

// CalculateTax mirrors lib/tax/totals.ts, with one half-up rounding per rate.
func CalculateTax(lines []TaxLine, discount money.Satang, inclusive bool, whtRate int64) (TaxTotals, error) {
	if !validWHT(whtRate) {
		return TaxTotals{}, errors.New("Invalid WHT rate")
	}
	if discount < 0 || discount > money.MaxSafeSatang {
		return TaxTotals{}, errors.New("Invalid satang amount")
	}
	grouped := map[int64]*big.Int{}
	for _, line := range lines {
		if line.TaxRateBps < 0 || line.TaxRateBps > 10000 {
			return TaxTotals{}, errors.New("Invalid tax rate")
		}
		if line.AmountSatang < 0 || line.AmountSatang > money.MaxSafeSatang {
			return TaxTotals{}, errors.New("Invalid satang amount")
		}
		if grouped[line.TaxRateBps] == nil {
			grouped[line.TaxRateBps] = new(big.Int)
		}
		grouped[line.TaxRateBps].Add(grouped[line.TaxRateBps], big.NewInt(int64(line.AmountSatang)))
	}
	subtotal := new(big.Int)
	for _, value := range grouped {
		subtotal.Add(subtotal, value)
	}
	if big.NewInt(int64(discount)).Cmp(subtotal) > 0 {
		return TaxTotals{}, errors.New("Discount exceeds subtotal")
	}
	type allocation struct {
		rate                        int64
		amount, discount, remainder *big.Int
	}
	groups := make([]allocation, 0, len(grouped))
	allocated := new(big.Int)
	for rate, value := range grouped {
		share, remainder := new(big.Int), new(big.Int)
		if subtotal.Sign() > 0 {
			share.QuoRem(new(big.Int).Mul(big.NewInt(int64(discount)), value), subtotal, remainder)
		}
		allocated.Add(allocated, share)
		groups = append(groups, allocation{rate, value, share, remainder})
	}
	sort.Slice(groups, func(i, j int) bool {
		cmp := groups[i].remainder.Cmp(groups[j].remainder)
		if cmp == 0 {
			return groups[i].rate < groups[j].rate
		}
		return cmp > 0
	})
	remaining := new(big.Int).Sub(big.NewInt(int64(discount)), allocated)
	for _, group := range groups {
		if remaining.Sign() > 0 {
			group.discount.Add(group.discount, big.NewInt(1))
			remaining.Sub(remaining, big.NewInt(1))
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].rate < groups[j].rate })
	out := TaxTotals{DiscountSatang: discount, VATByRate: []TaxBucket{}}
	base, vat := new(big.Int), new(big.Int)
	for _, group := range groups {
		net := new(big.Int).Sub(group.amount, group.discount)
		denominator := int64(10000)
		if inclusive {
			denominator += group.rate
		}
		tax := roundedRatio(new(big.Int).Mul(net, big.NewInt(group.rate)), denominator)
		taxable := new(big.Int).Set(net)
		if inclusive {
			taxable.Sub(taxable, tax)
		}
		base.Add(base, taxable)
		vat.Add(vat, tax)
		b, e := safeTaxMoney(taxable)
		if e != nil {
			return TaxTotals{}, e
		}
		v, e := safeTaxMoney(tax)
		if e != nil {
			return TaxTotals{}, e
		}
		out.VATByRate = append(out.VATByRate, TaxBucket{group.rate, b, v})
	}
	total := new(big.Int).Add(base, vat)
	wht := roundedRatio(new(big.Int).Mul(base, big.NewInt(whtRate)), 10000)
	fields := []struct {
		dst   *money.Satang
		value *big.Int
	}{
		{&out.SubtotalSatang, subtotal}, {&out.BaseSatang, base}, {&out.VATSatang, vat}, {&out.TotalSatang, total}, {&out.WHTSatang, wht}, {&out.AmountDueSatang, new(big.Int).Sub(total, wht)},
	}
	for _, field := range fields {
		value, e := safeTaxMoney(field.value)
		if e != nil {
			return TaxTotals{}, e
		}
		*field.dst = value
	}
	return out, nil
}
