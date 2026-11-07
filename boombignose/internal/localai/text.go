package localai

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

func hashBytes(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func hashText(s string) string  { return hashBytes([]byte(s)) }
func utf16Length(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}

// utf16ByteOffset never materializes a UTF-16 copy, and refuses split pairs.
func utf16ByteOffset(s string, offset int) (int, bool) {
	n := 0
	for at, r := range s {
		if n == offset {
			return at, true
		}
		n++
		if r > 0xffff {
			n++
		}
		if n > offset {
			return 0, false
		}
	}
	return len(s), n == offset
}
func utf16End(s string, want int) int {
	n := 0
	for _, r := range s {
		width := 1
		if r > 0xffff {
			width = 2
		}
		if n+width > want {
			break
		}
		n += width
	}
	return n
}
func clipUTF16(s string, max int) string {
	if utf16Length(s) <= max {
		return s
	}
	end := utf16End(s, max)
	at, _ := utf16ByteOffset(s, end)
	return s[:at]
}
func fold(s string) string { return strings.ToLower(norm.NFKC.String(s)) }
func safeName(s string) string {
	s = strings.ReplaceAll(s, "\\", "/")
	if at := strings.LastIndex(s, "/"); at >= 0 {
		s = s[at+1:]
	}
	s = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, s)
	s = clipUTF16(strings.TrimSpace(s), 120)
	if s == "" {
		return "file"
	}
	return s
}

//go:embed thaidict.txt
var thaiDictionary string
var thaiOnce sync.Once
var thaiWords []string
var thaiMax int

func loadThai() {
	thaiWords = make([]string, 0, 27000)
	for line := range strings.SplitSeq(thaiDictionary, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = norm.NFKC.String(line)
		thaiWords = append(thaiWords, line)
		if n := utf8.RuneCountInString(line); n > thaiMax {
			thaiMax = n
		}
	}
	sort.Strings(thaiWords)
}

func isThai(r rune) bool { return r >= 0x0e01 && r <= 0x0e4e }

// Thai uses dictionary boundaries rather than whitespace or substring bans.
// Dynamic programming minimizes unknown characters, then dictionary word count;
// equal analyses prefer a longer first word. This retains compound words while
// recognizing numeric words adjacent to ordinary Thai words. O(n*maxWord) work
// and O(n) memory are bounded by the accepted prose/query length.
func thaiSegments(s string) []string {
	thaiOnce.Do(loadThai)
	r := []rune(s)
	n := len(r)
	unknown := make([]int, n+1)
	words := make([]int, n+1)
	next := make([]int, n)
	for i := n - 1; i >= 0; i-- {
		unknown[i] = unknown[i+1] + 1
		words[i] = words[i+1] + 1
		next[i] = i + 1
		end := i + thaiMax
		if end > n {
			end = n
		}
		for j := i + 1; j <= end; j++ {
			word := string(r[i:j])
			at := sort.SearchStrings(thaiWords, word)
			if at == len(thaiWords) || thaiWords[at] != word {
				continue
			}
			u, w := unknown[j], words[j]+1
			if u < unknown[i] || (u == unknown[i] && (w < words[i] || (w == words[i] && j > next[i]))) {
				unknown[i] = u
				words[i] = w
				next[i] = j
			}
		}
	}
	out := []string{}
	for i := 0; i < n; i = next[i] {
		out = append(out, string(r[i:next[i]]))
	}
	return out
}

func lexicalWords(s string) []string {
	s = fold(s)
	result := []string{}
	start := -1
	thai := false
	flush := func(end int) {
		if start < 0 {
			return
		}
		word := s[start:end]
		if thai {
			result = append(result, thaiSegments(word)...)
		} else {
			result = append(result, word)
		}
		start = -1
	}
	for at, r := range s {
		word := unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsNumber(r)
		t := isThai(r)
		if !word {
			flush(at)
			continue
		}
		if start >= 0 && thai != t {
			flush(at)
		}
		if start < 0 {
			start = at
			thai = t
		}
	}
	flush(len(s))
	return result
}

const englishNumberWordText = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion"
const numericHan = "〇零一二三四五六七八九十百千万萬亿億兩两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟兆"

var thaiNumberAtoms = []string{"ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน", "ยี่", "เอ็ด"}

func thaiNumberWord(s string) bool {
	if s == "" {
		return false
	}
	for s != "" {
		found := false
		for _, a := range thaiNumberAtoms {
			if strings.HasPrefix(s, a) {
				s = strings.TrimPrefix(s, a)
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func hasNumericProse(s string) bool {
	s = norm.NFKC.String(s)
	// Detection only: original display, hashes and quote bytes stay untouched.
	// Default-ignorable characters must not split a visually continuous number.
	s = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Other_Default_Ignorable_Code_Point, r) || unicode.Is(unicode.Variation_Selector, r) {
			return -1
		}
		return r
	}, s)
	for _, r := range s {
		if unicode.IsNumber(r) || strings.ContainsRune("฿$€£¥"+numericHan, r) {
			return true
		}
	}
	for _, word := range lexicalWords(s) {
		if strings.Contains(" "+englishNumberWordText+" ", " "+word+" ") || thaiNumberWord(word) {
			return true
		}
	}
	return false
}

const prosePolicy = "Prose must be qualitative: no unquoted amounts, currency symbols, dates, counts or numbers spelled as words. A separator-delimited reference code with letters and digits may repeat only if its exact whole token appears in the same finding's verified verbatim source quote; summary and nextActions may use only codes already present in those verified quotes. Never invent, alter or spell out a code. Currency-shaped tokens such as THB followed by an amount are not reference exceptions. Forbidden whole English number words: " + englishNumberWordText + ". Thai numeric words (including compounds) are forbidden too: ศูนย์ หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ ร้อย พัน หมื่น แสน ล้าน ยี่ เอ็ด. These rules apply to summary, finding text and nextActions, not sourceIds/factIds or exact source quotes. Do not write links or make financial claims; put printed figures/dates in exact document quotes only."
