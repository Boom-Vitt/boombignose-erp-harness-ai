package erpprojects

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"github.com/google/uuid"
)

func trim(value string) string {
	return strings.Trim(value, "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
}
func has(values []string, value string) bool {
	for _, v := range values {
		if value == v {
			return true
		}
	}
	return false
}
func validID(value string) bool { return len(value) == 36 && uuid.Validate(value) == nil }
func strictUUID(value string) bool {
	if !validID(value) {
		return false
	}
	return value == "00000000-0000-0000-0000-000000000000" || strings.EqualFold(value, "ffffffff-ffff-ffff-ffff-ffffffffffff") || value[14] >= '1' && value[14] <= '8' && strings.ContainsRune("89abAB", rune(value[19]))
}
func optionalStrings(row erpwire.Row, keys ...string) bool {
	for _, key := range keys {
		if value, present := row[key]; present {
			if _, ok := value.(string); !ok {
				return false
			}
		}
	}
	return true
}
func required(row erpwire.Row, key string) bool { v, ok := row[key].(string); return ok && v != "" }
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func selected(value string) any {
	if value == "none" {
		return nil
	}
	return nullable(value)
}
func integer(value any) (int64, error) {
	switch n := value.(type) {
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	case int32:
		return int64(n), nil
	case money.Satang:
		return int64(n), nil
	case json.Number:
		return strconv.ParseInt(n.String(), 10, 64)
	case string:
		return strconv.ParseInt(n, 10, 64)
	}
	return 0, errors.New("Invalid integer")
}
func satang(value any) (money.Satang, error) {
	n, err := integer(value)
	if err != nil || n < -int64(money.MaxSafeSatang) || n > int64(money.MaxSafeSatang) {
		return 0, erpwire.ErrUnsafeAmount
	}
	return money.Satang(n), nil
}
func add(a, b money.Satang) (money.Satang, error) {
	if b > 0 && a > money.MaxSafeSatang-b || b < 0 && a < -money.MaxSafeSatang-b {
		return 0, errors.New("Unsafe integer-satang sum")
	}
	return a + b, nil
}

var decimalPattern = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)
var radixPattern = regexp.MustCompile(`^0(?:[xX][0-9a-fA-F]+|[bB][01]+|[oO][0-7]+)$`)

func numeric(value any) (*big.Rat, bool) {
	var input string
	switch n := value.(type) {
	case nil:
		return new(big.Rat), true
	case bool:
		if n {
			return big.NewRat(1, 1), true
		}
		return new(big.Rat), true
	case string:
		input = trim(n)
	case json.Number:
		input = n.String()
	case []any:
		parts := []string{}
		for _, v := range n {
			if v == nil {
				parts = append(parts, "")
			} else if s, ok := v.(string); ok {
				parts = append(parts, s)
			} else if num, ok := v.(json.Number); ok {
				parts = append(parts, num.String())
			} else {
				return nil, false
			}
		}
		input = trim(strings.Join(parts, ","))
	default:
		return nil, false
	}
	if input == "" {
		return new(big.Rat), true
	}
	radix := radixPattern.MatchString(input)
	if !decimalPattern.MatchString(input) && !radix {
		return nil, false
	}
	if !radix {
		finite, err := strconv.ParseFloat(input, 64)
		if err != nil {
			return nil, false
		}
		if finite == 0 {
			return new(big.Rat), true
		}
	}
	n, ok := new(big.Rat).SetString(input)
	if ok && radix && n.Num().BitLen() > 1024 {
		return nil, false
	}
	return n, ok
}
func moneyInput(value any) (money.Satang, error) {
	if input, ok := value.(string); ok {
		input = trim(input)
		if strings.TrimSpace(input) != input {
			return 0, money.ErrInput
		}
		return money.ParseBaht(input)
	}
	if _, ok := value.(json.Number); !ok {
		return 0, money.ErrInput
	}
	n, ok := numeric(value)
	if !ok || n.Sign() < 0 {
		return 0, money.ErrInput
	}
	n.Mul(n, big.NewRat(100, 1))
	if !n.IsInt() || !n.Num().IsInt64() || n.Num().Int64() > int64(money.MaxSafeSatang) {
		return 0, money.ErrInput
	}
	return money.Satang(n.Num().Int64()), nil
}
func roundPositive(n *big.Rat) (int64, error) {
	value := new(big.Rat).Add(n, big.NewRat(1, 2))
	whole := new(big.Int).Quo(value.Num(), value.Denom())
	if !whole.IsInt64() {
		return 0, erpwire.ErrUnsafeAmount
	}
	return whole.Int64(), nil
}
func roundedRate(n *big.Rat) (money.Satang, error) {
	value, err := roundPositive(new(big.Rat).Mul(n, big.NewRat(100, 1)))
	if err != nil || value > int64(money.MaxSafeSatang) {
		return 0, erpwire.ErrUnsafeAmount
	}
	return money.Satang(value), nil
}
func hourlyValue(minutes int64, rate money.Satang) (money.Satang, error) {
	if minutes < 0 || minutes > int64(money.MaxSafeSatang) || rate < 0 || rate > money.MaxSafeSatang {
		return 0, errors.New("Invalid minutes or hourly rate")
	}
	value := new(big.Int).Mul(big.NewInt(minutes), big.NewInt(int64(rate)))
	value.Add(value, big.NewInt(30))
	value.Quo(value, big.NewInt(60))
	if !value.IsInt64() || value.Int64() > int64(money.MaxSafeSatang) {
		return 0, errors.New("Time value exceeds safe satang bounds")
	}
	return money.Satang(value.Int64()), nil
}
func entryValue(row erpwire.Row) (money.Satang, error) {
	if !boolean(row["billable"]) || row["rate_satang"] == nil {
		return 0, nil
	}
	minutes, err := integer(row["minutes"])
	if err != nil {
		return 0, err
	}
	rate, err := satang(row["rate_satang"])
	if err != nil {
		return 0, err
	}
	return hourlyValue(minutes, rate)
}
func billableValue(rows []erpwire.Row) (money.Satang, error) {
	var total money.Satang
	for _, row := range rows {
		value, err := entryValue(row)
		if err != nil {
			return 0, err
		}
		total, err = add(total, value)
		if err != nil {
			return 0, err
		}
	}
	return total, nil
}
func ratio(n, d int64, places int) json.Number {
	if d == 0 {
		return json.Number("0")
	}
	return json.Number(big.NewRat(n, d).FloatString(places))
}
func textLength(value string) int { return len(utf16.Encode([]rune(value))) }
