package money

import (
	"errors"
	"strings"
)

const MaxSafeSatang Satang = 9007199254740991

var ErrInput = errors.New("enter a safe nonnegative THB amount with up to two decimals")

// ParseBaht preserves lib/payments/input.ts and workflows/service.ts: decimal
// form text only, at most two decimals, no rounding and no floating-point step.
func ParseBaht(input string) (Satang, error) {
	input = strings.TrimSpace(input)
	whole, fraction, decimal := strings.Cut(input, ".")
	if whole == "" || decimal && (len(fraction) == 0 || len(fraction) > 2) {
		return 0, ErrInput
	}
	var value Satang
	for index := range len(whole) {
		digit := whole[index]
		if digit < '0' || digit > '9' || value > (MaxSafeSatang/100-Satang(digit-'0'))/10 {
			return 0, ErrInput
		}
		value = value*10 + Satang(digit-'0')
	}
	value *= 100
	for index := range len(fraction) {
		digit := fraction[index]
		if digit < '0' || digit > '9' {
			return 0, ErrInput
		}
		if index == 0 {
			value += Satang(digit-'0') * 10
		} else {
			value += Satang(digit - '0')
		}
	}
	if value > MaxSafeSatang {
		return 0, ErrInput
	}
	return value, nil
}
