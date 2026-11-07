package erpcrm

import (
	"encoding/json"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var decimalNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

// Number coercion and half-away rounding mirror the TS action without floating-point money.
func coerceNumber(value any) (*big.Rat, bool) {
	var input string
	switch value := value.(type) {
	case nil:
		input = "0"
	case bool:
		input = "0"
		if value {
			input = "1"
		}
	case string:
		input = trimText(value)
		if input == "" {
			input = "0"
		}
	case json.Number:
		input = value.String()
	default:
		return nil, false
	}
	if len(input) > 4096 || strings.Contains(input, "_") {
		return nil, false
	}
	if len(input) > 2 && input[0] == '0' && strings.ContainsAny(input[1:2], "xXoObB") {
		n, ok := new(big.Int).SetString(input, 0)
		if !ok {
			return nil, false
		}
		return new(big.Rat).SetInt(n), true
	}
	if !decimalNumber.MatchString(input) {
		return nil, false
	}
	if i := strings.IndexAny(input, "eE"); i >= 0 {
		exponent, err := strconv.Atoi(input[i+1:])
		if err != nil || exponent < -1000 || exponent > 1000 {
			return nil, false
		}
	}
	return new(big.Rat).SetString(input)
}

func decimalText(number *big.Rat) string {
	if number.IsInt() {
		return number.Num().String()
	}
	return strings.TrimRight(strings.TrimRight(number.FloatString(number.Denom().BitLen()), "0"), ".")
}

func dealAmount(value any) (money.Satang, string) {
	number, ok := coerceNumber(value)
	if !ok {
		return 0, "Invalid input"
	}
	if number.Sign() < 0 {
		return 0, "Value can't be negative"
	}
	number.Mul(number, big.NewRat(100, 1))
	whole, remainder := new(big.Int), new(big.Int)
	whole.QuoRem(number.Num(), number.Denom(), remainder)
	if remainder.Lsh(remainder, 1).Cmp(number.Denom()) >= 0 {
		whole.Add(whole, big.NewInt(1))
	}
	if !whole.IsInt64() || whole.Int64() > int64(money.MaxSafeSatang) {
		return 0, "Money exceeds safe satang bounds"
	}
	return money.Satang(whole.Int64()), ""
}
