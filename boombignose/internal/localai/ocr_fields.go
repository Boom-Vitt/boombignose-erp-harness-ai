package localai

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type OCRFields struct {
	Vendor         *string `json:"vendor"`
	Date           *string `json:"date"`
	DocumentNumber *string `json:"documentNumber"`
	Description    *string `json:"description"`
	SubtotalSatang *int64  `json:"subtotalSatang"`
	VATSatang      *int64  `json:"vatSatang"`
	TotalSatang    *int64  `json:"totalSatang"`
}

var printedMoneyPattern = regexp.MustCompile(`^(?:[0-9]+|[1-9][0-9]{0,2}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$`)
var moneyPrefix = regexp.MustCompile(`(?i)^(?:฿|THB)\s*`)
var moneySuffix = regexp.MustCompile(`(?i)\s*(?:บาท|THB)$`)

func thaiDigits(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '๐' && r <= '๙' {
			return '0' + r - '๐'
		}
		return r
	}, s)
}

// PrintedMoneySatang accepts only exact nonnegative printed THB, with no float,
// rounding, arbitrary punctuation stripping, conversion or model arithmetic.
func PrintedMoneySatang(raw string) *int64 {
	if utf16Length(raw) > 40 {
		return nil
	}
	s := thaiDigits(strings.TrimSpace(raw))
	s = moneyPrefix.ReplaceAllString(s, "")
	s = moneySuffix.ReplaceAllString(s, "")
	if !printedMoneyPattern.MatchString(s) {
		return nil
	}
	s = strings.ReplaceAll(s, ",", "")
	parts := strings.Split(s, ".")
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || whole > erpwire.MaxSafeInteger/100 {
		return nil
	}
	value := whole * 100
	if len(parts) == 2 {
		dec := parts[1]
		if len(dec) == 1 {
			dec += "0"
		}
		fraction, _ := strconv.ParseInt(dec, 10, 64)
		value += fraction
	}
	if value > erpwire.MaxSafeInteger {
		return nil
	}
	return &value
}

var isoDate = regexp.MustCompile(`^([0-9]{4})-([0-9]{2})-([0-9]{2})$`)
var dmyDate = regexp.MustCompile(`^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$`)
var thaiDate = regexp.MustCompile(`^([0-9]{1,2})\s+([ก-๙]+)\s+([0-9]{4})$`)
var thaiMonths = []string{"มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"}

func PrintedDate(raw string) *string {
	s := thaiDigits(strings.TrimSpace(raw))
	year, month, day := 0, 0, 0
	atoi := func(s string) int { n, _ := strconv.Atoi(s); return n }
	if m := isoDate.FindStringSubmatch(s); m != nil {
		year, month, day = atoi(m[1]), atoi(m[2]), atoi(m[3])
	} else if m := dmyDate.FindStringSubmatch(s); m != nil {
		day, month, year = atoi(m[1]), atoi(m[2]), atoi(m[3])
		if year < 2400 && day <= 12 && month <= 12 && day != month {
			return nil
		}
	} else if m := thaiDate.FindStringSubmatch(s); m != nil {
		day, year = atoi(m[1]), atoi(m[3])
		for i, name := range thaiMonths {
			if name == m[2] {
				month = i + 1
				break
			}
		}
	} else {
		return nil
	}
	if year >= 2400 {
		year -= 543
	}
	if year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 {
		return nil
	}
	d := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if d.Year() != year || int(d.Month()) != month || d.Day() != day {
		return nil
	}
	result := d.Format("2006-01-02")
	return &result
}

var unsupportedField = regexp.MustCompile(`(?i)\[unreadable\]|^(?:unknown|n/a|null)$`)
var foreignCurrency = regexp.MustCompile(`(?i)(?:\b(?:USD|EUR|GBP|JPY|CNY|SGD|AUD|MYR|LAK|KHR|MMK)\b|[$€£¥])`)

func parseOCRFields(raw, source string) (OCRFields, []string) {
	fields := OCRFields{}
	warnings := []string{}
	var data map[string]any
	if strictJSON([]byte(raw), &data) != nil || data == nil {
		return fields, []string{"Structured fields could not be read; use the source text and enter fields manually."}
	}
	var schemaValue any
	_ = strictJSON(jsonBytes(ocrStructureSchema()), &schemaValue)
	if validateSchema(schemaValue, data) != nil {
		return fields, []string{"Structured fields did not match the review schema; enter fields manually."}
	}
	quoted := func(key string, max int) *string {
		v := data[key]
		if v == nil {
			return nil
		}
		s, ok := v.(string)
		if !ok {
			warnings = append(warnings, key+": unsupported by the extracted source; left unknown.")
			return nil
		}
		s = strings.TrimSpace(s)
		if s == "" || utf16Length(s) > max || unsupportedField.MatchString(s) || !strings.Contains(source, s) {
			warnings = append(warnings, key+": unsupported by the extracted source; left unknown.")
			return nil
		}
		return &s
	}
	fields.Vendor = quoted("vendor", 200)
	fields.DocumentNumber = quoted("documentNumber", 200)
	fields.Description = quoted("description", 1000)
	if date := quoted("date", 30); date != nil {
		fields.Date = PrintedDate(*date)
		if fields.Date == nil {
			warnings = append(warnings, "Date is invalid or day/month order is ambiguous; left unknown.")
		}
	}
	for _, pair := range []struct {
		key    string
		target **int64
	}{{"subtotal", &fields.SubtotalSatang}, {"vat", &fields.VATSatang}, {"total", &fields.TotalSatang}} {
		if s := quoted(pair.key, 40); s != nil {
			*pair.target = PrintedMoneySatang(*s)
			if *pair.target == nil {
				warnings = append(warnings, pair.key+": malformed THB amount; left unknown (no rounding).")
			}
		}
	}
	if foreignCurrency.MatchString(source) {
		fields.SubtotalSatang = nil
		fields.VATSatang = nil
		fields.TotalSatang = nil
		warnings = append(warnings, "Foreign or mixed currency found; monetary fields left unknown. THB conversion is never inferred.")
	}
	if fields.TotalSatang != nil && *fields.TotalSatang <= 0 {
		fields.TotalSatang = nil
		warnings = append(warnings, "Total must be above zero; left unknown.")
	}
	if fields.VATSatang != nil && (fields.TotalSatang == nil || *fields.VATSatang > *fields.TotalSatang) {
		fields.VATSatang = nil
		warnings = append(warnings, "VAT cannot be checked against a valid total; left unknown.")
	}
	if fields.SubtotalSatang != nil && fields.TotalSatang != nil && (*fields.SubtotalSatang > *fields.TotalSatang || (fields.VATSatang != nil && *fields.SubtotalSatang+*fields.VATSatang != *fields.TotalSatang)) {
		fields.SubtotalSatang = nil
		fields.VATSatang = nil
		warnings = append(warnings, "Subtotal + VAT does not equal total exactly in satang; subtotal/VAT left unknown. Check discounts and other charges manually.")
	}
	warnings = append(warnings, "VAT is transcribed only, not calculated or certified. Verify tax invoice eligibility, rate, discounts and totals manually.")
	return fields, warnings
}
func ocrStructureSchema() map[string]any {
	props := map[string]any{}
	keys := []string{"vendor", "date", "documentNumber", "description", "subtotal", "vat", "total"}
	for _, key := range keys {
		props[key] = map[string]any{"type": []string{"string", "null"}}
	}
	return objectSchema(props, keys...)
}
