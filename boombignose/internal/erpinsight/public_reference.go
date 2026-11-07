package erpinsight

import (
	"crypto/rand"
	"regexp"
	"strings"
)

const referenceAlphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const referenceConstant uint32 = 0x2bc830a3

var referenceGenerators = [...]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
var documentPrefixes = map[string]string{"quote": "quo", "purchase_order": "po", "receipt": "grn", "delivery": "dlv", "invoice": "inv"}
var documentLabels = map[string]string{"quote": "Customer quote", "purchase_order": "Purchase order", "receipt": "Goods receipt", "delivery": "Delivery", "invoice": "Invoice"}
var referencePrefix = regexp.MustCompile(`^[a-z][a-z0-9]{0,15}$`)

type publicReference struct {
	Kind      string
	Canonical string
	Display   string
}

func referencePolymod(values []uint32) uint32 {
	chk := uint32(1)
	for _, value := range values {
		top := chk >> 25
		chk = ((chk & 0x1ffffff) << 5) ^ value
		for i, generator := range referenceGenerators {
			if (top>>i)&1 != 0 {
				chk ^= generator
			}
		}
	}
	return chk
}
func referenceExpand(prefix string) []uint32 {
	out := make([]uint32, 0, len(prefix)*2+1)
	for _, c := range prefix {
		out = append(out, uint32(c)>>5)
	}
	out = append(out, 0)
	for _, c := range prefix {
		out = append(out, uint32(c)&31)
	}
	return out
}
func encodeReference(prefix string, words []uint32) string {
	values := append(referenceExpand(prefix), words...)
	mod := referencePolymod(append(values, 0, 0, 0, 0, 0, 0)) ^ referenceConstant
	var out strings.Builder
	out.WriteString(prefix + "1")
	for _, word := range words {
		out.WriteByte(referenceAlphabet[word])
	}
	for i := 0; i < 6; i++ {
		out.WriteByte(referenceAlphabet[(mod>>uint(5*(5-i)))&31])
	}
	return out.String()
}
func parsePublicReference(input string, canonicalOnly bool) (publicReference, string) {
	if jsLength(input) > 128 {
		return publicReference{}, "too_long"
	}
	for _, c := range input {
		if c > 127 {
			return publicReference{}, "character"
		}
	}
	trimmed := strings.Trim(input, " \t\r\n")
	lower := strings.ToLower(trimmed)
	if trimmed != lower && trimmed != strings.ToUpper(trimmed) {
		return publicReference{}, "case"
	}
	separator := strings.LastIndexByte(lower, '1')
	prefix := ""
	if separator > 0 {
		prefix = lower[:separator]
	}
	if !referencePrefix.MatchString(prefix) {
		return publicReference{}, "format"
	}
	body := lower[separator+1:]
	if strings.Contains(body, "-") {
		groups := strings.Split(body, "-")
		for i, group := range groups {
			if (i < len(groups)-1 && len(group) != 4) || (i == len(groups)-1 && (len(group) < 1 || len(group) > 4)) {
				return publicReference{}, "format"
			}
		}
		body = strings.Join(groups, "")
	}
	if body == "" {
		return publicReference{}, "character"
	}
	values := referenceExpand(prefix)
	for _, c := range body {
		index := strings.IndexRune(referenceAlphabet, c)
		if index < 0 {
			return publicReference{}, "character"
		}
		values = append(values, uint32(index))
	}
	if len(body) < 6 || referencePolymod(values) != referenceConstant {
		return publicReference{}, "checksum"
	}
	kind := ""
	for k, p := range documentPrefixes {
		if p == prefix {
			kind = k
			break
		}
	}
	if kind == "" {
		return publicReference{}, "prefix"
	}
	if len(body)-6 != 14 {
		return publicReference{}, "length"
	}
	canonical := prefix + "1" + body
	if canonicalOnly && canonical != input {
		return publicReference{}, "non_canonical"
	}
	groups := []string{}
	for len(body) > 4 {
		groups = append(groups, body[:4])
		body = body[4:]
	}
	groups = append(groups, body)
	return publicReference{Kind: kind, Canonical: canonical, Display: prefix + "1" + strings.Join(groups, "-")}, ""
}
func generatePublicReference(kind string) (publicReference, error) {
	var bytes [14]byte
	if _, e := rand.Read(bytes[:]); e != nil {
		return publicReference{}, e
	}
	words := make([]uint32, len(bytes))
	for i, b := range bytes {
		words[i] = uint32(b & 31)
	}
	canonical := encodeReference(documentPrefixes[kind], words)
	reference, _ := parsePublicReference(canonical, true)
	return reference, nil
}
func documentHref(kind, id string) string {
	switch kind {
	case "quote":
		return "/quotes/" + id
	case "purchase_order":
		return "/purchases/" + id
	case "invoice":
		return "/finance/invoices/" + id
	default:
		return "/inventory/documents/" + id + "/print"
	}
}
