package erpinsight

import (
	"bytes"
	"compress/flate"
	"encoding/binary"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

func parseSpreadsheet(name string, data []byte) ([][]string, error) {
	name = strings.ToLower(importTrim(name))
	switch {
	case strings.HasSuffix(name, ".xlsx"):
		return parseImportXLSX(data)
	case strings.HasSuffix(name, ".csv"), strings.HasSuffix(name, ".txt"):
		return parseImportCSV(importUTF8(data))
	default:
		return nil, errors.New("Choose a CSV or Excel .xlsx file.")
	}
}

func parseImportCSV(source string) ([][]string, error) {
	source = strings.TrimPrefix(source, "\ufeff")
	line := strings.SplitN(source, "\n", 2)[0]
	delimiter, best := byte(','), -1
	for _, candidate := range []byte{',', ';', '\t'} {
		count, quoted := 0, false
		for i := 0; i < len(line); i++ {
			if line[i] == '"' {
				quoted = !quoted
			} else if !quoted && line[i] == candidate {
				count++
			}
		}
		if count > best {
			delimiter, best = candidate, count
		}
	}
	rows, row := [][]string{}, []string{}
	var cell strings.Builder
	quoted := false
	for i := 0; i < len(source); i++ {
		c := source[i]
		if quoted {
			if c == '"' {
				if i+1 < len(source) && source[i+1] == '"' {
					cell.WriteByte('"')
					i++
				} else {
					quoted = false
				}
			} else {
				cell.WriteByte(c)
			}
			continue
		}
		switch c {
		case '"':
			quoted = true
		case delimiter:
			row = append(row, cell.String())
			cell.Reset()
		case '\r', '\n':
			if c == '\r' && i+1 < len(source) && source[i+1] == '\n' {
				i++
			}
			row = append(row, cell.String())
			rows = append(rows, row)
			row = []string{}
			cell.Reset()
		default:
			cell.WriteByte(c)
		}
	}
	if quoted {
		return nil, errors.New("A quoted cell was not closed.")
	}
	if cell.Len() > 0 || len(row) > 0 {
		rows = append(rows, append(row, cell.String()))
	}
	return importLimitGrid(importNonemptyRows(rows))
}

func importNonemptyRows(rows [][]string) [][]string {
	out := [][]string{}
	for _, row := range rows {
		for _, value := range row {
			if importTrim(value) != "" {
				out = append(out, row)
				break
			}
		}
	}
	return out
}

func importLimitGrid(rows [][]string) ([][]string, error) {
	if len(rows) > 2001 {
		return nil, errors.New("A file can have at most 2000 data rows.")
	}
	for _, row := range rows {
		if len(row) > 40 {
			return nil, errors.New("A file can have at most 40 columns.")
		}
	}
	return rows, nil
}

type importZipEntry struct {
	name string
	data []byte
}

func importUnzip(data []byte) ([]importZipEntry, error) {
	files := []importZipEntry{}
	for offset := 0; offset+30 <= len(data); {
		if binary.LittleEndian.Uint32(data[offset:]) != 0x04034b50 {
			break
		}
		flags := binary.LittleEndian.Uint16(data[offset+6:])
		method := binary.LittleEndian.Uint16(data[offset+8:])
		length := int(binary.LittleEndian.Uint32(data[offset+18:]))
		nameLength := int(binary.LittleEndian.Uint16(data[offset+26:]))
		extraLength := int(binary.LittleEndian.Uint16(data[offset+28:]))
		if flags&8 != 0 {
			return nil, errors.New("Save the workbook from Excel again. This file stores sizes after the data.")
		}
		start := offset + 30 + nameLength + extraLength
		if start > len(data) || length > len(data)-start {
			return nil, errors.New("The workbook is incomplete.")
		}
		name := importUTF8(data[offset+30 : offset+30+nameLength])
		body := data[start : start+length]
		switch method {
		case 0:
		case 8:
			r := flate.NewReader(bytes.NewReader(body))
			var err error
			body, err = io.ReadAll(r)
			_ = r.Close()
			if err != nil {
				return nil, errors.New("The workbook could not be read.")
			}
		default:
			return nil, errors.New("This workbook uses a compression the import does not read.")
		}
		files = append(files, importZipEntry{name, body})
		offset = start + length
	}
	if len(files) == 0 {
		return nil, errors.New("The workbook could not be read.")
	}
	return files, nil
}

var importSheetName = regexp.MustCompile(`^xl/worksheets/sheet\d+\.xml$`)
var importSI = regexp.MustCompile(`<si\b[^>]*>`)
var importText = regexp.MustCompile(`<t\b[^>]*>([\s\S]*?)</t>`)
var importXMLRow = regexp.MustCompile(`<row\b[^>]*>([\s\S]*?)</row>`)
var importXMLCell = regexp.MustCompile(`<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)`)
var importCellRef = regexp.MustCompile(`r="([A-Z]+)\d+"`)
var importCellType = regexp.MustCompile(`t="([^"]+)"`)
var importCellValue = regexp.MustCompile(`<v>([\s\S]*?)</v>`)
var importSharedIndex = regexp.MustCompile(`<v>(\d+)</v>`)
var importXMLHex = regexp.MustCompile(`&#x([0-9a-fA-F]+);`)
var importXMLDecimal = regexp.MustCompile(`&#(\d+);`)

func parseImportXLSX(data []byte) ([][]string, error) {
	files, err := importUnzip(data)
	if err != nil {
		return nil, err
	}
	var sheet, shared []byte
	for _, file := range files {
		if importSheetName.MatchString(file.name) && sheet == nil {
			sheet = file.data
		}
		if file.name == "xl/sharedStrings.xml" {
			shared = file.data
		}
	}
	for _, file := range files {
		if file.name == "xl/worksheets/sheet1.xml" {
			sheet = file.data
			break
		}
	}
	if sheet == nil {
		return nil, errors.New("The workbook has no worksheet.")
	}
	stringsTable := []string{}
	parts := importSI.Split(importUTF8(shared), -1)
	for _, part := range parts[1:] {
		stringsTable = append(stringsTable, importTextContent(part))
	}
	rows := [][]string{}
	for _, row := range importXMLRow.FindAllStringSubmatch(importUTF8(sheet), -1) {
		cells, maxCol, next := map[int]string{}, -1, 0
		for _, cell := range importXMLCell.FindAllStringSubmatch(row[1], -1) {
			col := next
			if ref := importCellRef.FindStringSubmatch(cell[1]); ref != nil {
				col = 0
				for _, c := range ref[1] {
					if col > 40 {
						break
					}
					col = col*26 + int(c-'A'+1)
				}
				col--
			}
			next = col + 1
			kind := ""
			if t := importCellType.FindStringSubmatch(cell[1]); t != nil {
				kind = t[1]
			}
			value := ""
			switch kind {
			case "inlineStr":
				value = importTextContent(cell[2])
			case "s":
				if match := importSharedIndex.FindStringSubmatch(cell[2]); match != nil {
					i, err := strconv.Atoi(match[1])
					if err == nil && i >= 0 && i < len(stringsTable) {
						value = stringsTable[i]
					}
				}
			case "str":
				if match := importCellValue.FindStringSubmatch(cell[2]); match != nil {
					value = importDecodeXML(match[1])
				}
			default:
				if match := importCellValue.FindStringSubmatch(cell[2]); match != nil {
					value = match[1]
				}
			}
			cells[col] = importDecodeXML(value)
			if col > maxCol {
				maxCol = col
			}
		}
		if maxCol >= 0 {
			nonempty := false
			for _, value := range cells {
				if importTrim(value) != "" {
					nonempty = true
					break
				}
			}
			if !nonempty {
				continue
			}
			line := make([]string, min(maxCol+1, 41))
			for i := range line {
				line[i] = cells[i]
			}
			rows = append(rows, line)
		}
	}
	return importLimitGrid(importNonemptyRows(rows))
}

func importTextContent(body string) string {
	var value strings.Builder
	for _, match := range importText.FindAllStringSubmatch(body, -1) {
		value.WriteString(importDecodeXML(match[1]))
	}
	return value.String()
}

func importDecodeXML(value string) string {
	for _, rule := range []struct {
		re   *regexp.Regexp
		base int
	}{{importXMLHex, 16}, {importXMLDecimal, 10}} {
		value = rule.re.ReplaceAllStringFunc(value, func(s string) string {
			digits := rule.re.FindStringSubmatch(s)[1]
			n, err := strconv.ParseUint(digits, rule.base, 32)
			if err != nil || n > utf8.MaxRune {
				return "\ufffd"
			}
			return string(rune(n))
		})
	}
	for _, pair := range [][2]string{{"&lt;", "<"}, {"&gt;", ">"}, {"&quot;", "\""}, {"&apos;", "'"}, {"&amp;", "&"}} {
		value = strings.ReplaceAll(value, pair[0], pair[1])
	}
	return value
}

func importSpace(c rune) bool {
	return c == '\t' || c == '\n' || c == '\v' || c == '\f' || c == '\r' || c == ' ' || c == 0xa0 || c == 0x1680 || c >= 0x2000 && c <= 0x200a || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff
}
func importTrim(s string) string { return strings.TrimFunc(s, importSpace) }

func importUTF8(data []byte) string {
	var out strings.Builder
	for len(data) > 0 {
		r, width := utf8.DecodeRune(data)
		if r == utf8.RuneError && width == 1 {
			expected := 1
			switch first := data[0]; {
			case first >= 0xc2 && first <= 0xdf:
				expected = 2
			case first >= 0xe0 && first <= 0xef:
				expected = 3
			case first >= 0xf0 && first <= 0xf4:
				expected = 4
			}
			for width < expected && width < len(data) {
				b := data[width]
				if b < 0x80 || b > 0xbf {
					break
				}
				if width == 1 && (data[0] == 0xe0 && b < 0xa0 || data[0] == 0xed && b > 0x9f || data[0] == 0xf0 && b < 0x90 || data[0] == 0xf4 && b > 0x8f) {
					break
				}
				width++
			}
		}
		out.WriteRune(r)
		data = data[width:]
	}
	return out.String()
}
