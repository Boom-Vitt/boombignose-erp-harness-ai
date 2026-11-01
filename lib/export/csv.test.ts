import { describe, it, expect } from "vitest"

import { toCsv, BOM } from "./csv"

describe("toCsv", () => {
  it("renders a plain header + rows joined by CRLF", () => {
    const out = toCsv(["a", "b"], [
      ["1", "2"],
      ["3", "4"],
    ])
    // Strip the BOM to assert on the record content.
    expect(out.slice(BOM.length)).toBe("a,b\r\n1,2\r\n3,4")
  })

  it("prepends a single UTF-8 BOM so Excel reads Thai correctly", () => {
    const out = toCsv(["ชื่อ"], [["ลูกค้า"]])
    expect(out.startsWith(BOM)).toBe(true)
    expect(BOM).toBe("﻿")
    // Exactly one BOM, at the very front.
    expect(out.indexOf(BOM)).toBe(0)
    expect(out.slice(1).includes(BOM)).toBe(false)
  })

  it("quotes fields containing a comma", () => {
    const out = toCsv(["name"], [["Acme, Inc."]])
    expect(out.slice(BOM.length)).toBe('name\r\n"Acme, Inc."')
  })

  it("quotes fields containing a double quote and doubles the internal quote", () => {
    const out = toCsv(["note"], [['He said "hi"']])
    expect(out.slice(BOM.length)).toBe('note\r\n"He said ""hi"""')
  })

  it("quotes fields containing a newline (LF or CRLF)", () => {
    const lf = toCsv(["addr"], [["line1\nline2"]])
    expect(lf.slice(BOM.length)).toBe('addr\r\n"line1\nline2"')

    const crlf = toCsv(["addr"], [["line1\r\nline2"]])
    expect(crlf.slice(BOM.length)).toBe('addr\r\n"line1\r\nline2"')
  })

  it("renders null and undefined as empty fields", () => {
    const out = toCsv(["a", "b", "c"], [["x", null, "z"]])
    expect(out.slice(BOM.length)).toBe("a,b,c\r\nx,,z")
  })

  it("renders numbers without quoting or currency formatting", () => {
    // Money columns arrive pre-converted to baht numbers (e.g. 1234.56).
    const out = toCsv(["amount"], [[1234.56], [0]])
    expect(out.slice(BOM.length)).toBe("amount\r\n1234.56\r\n0")
  })

  it("does not quote an empty string", () => {
    const out = toCsv(["a", "b"], [["", "x"]])
    expect(out.slice(BOM.length)).toBe("a,b\r\n,x")
  })

  it("handles a header with no data rows", () => {
    const out = toCsv(["a", "b"], [])
    expect(out.slice(BOM.length)).toBe("a,b")
  })

  it("quotes a field that is only whitespace-adjacent special chars correctly", () => {
    // A field that contains all three trigger chars at once.
    const out = toCsv(["x"], [['a,"\nb']])
    expect(out.slice(BOM.length)).toBe('x\r\n"a,""\nb"')
  })
})

describe("toCsv — CSV injection defense", () => {
  it("prefixes a leading = with an apostrophe to force text", () => {
    expect(toCsv(["x"], [["=1+1"]]).slice(BOM.length)).toBe("x\r\n'=1+1")
  })

  it("guards leading +, -, and @", () => {
    expect(toCsv(["x"], [["+1"]]).slice(BOM.length)).toBe("x\r\n'+1")
    expect(toCsv(["x"], [["-1+2"]]).slice(BOM.length)).toBe("x\r\n'-1+2")
    expect(toCsv(["x"], [["@SUM(A1)"]]).slice(BOM.length)).toBe("x\r\n'@SUM(A1)")
  })

  it("leaves a plain negative decimal string parseable", () => {
    expect(toCsv(["amount"], [["-7.01"]]).slice(BOM.length)).toBe("amount\r\n-7.01")
    expect(toCsv(["amount"], [["-0.70"]]).slice(BOM.length)).toBe("amount\r\n-0.70")
  })

  it("guards a leading TAB", () => {
    expect(toCsv(["x"], [["\thi"]]).slice(BOM.length)).toBe("x\r\n'\thi")
  })

  it("applies the guard BEFORE quoting when the value also needs quoting", () => {
    const out = toCsv(["x"], [['=HYPERLINK("http://evil",1)']])
    expect(out.slice(BOM.length)).toBe(`x\r\n"'=HYPERLINK(""http://evil"",1)"`)
  })

  it("leaves a negative NUMBER untouched so money stays parseable", () => {
    expect(toCsv(["amount"], [[-5]]).slice(BOM.length)).toBe("amount\r\n-5")
  })

  it("does not prefix a hyphen that is inside, not leading, a string", () => {
    expect(toCsv(["x"], [["A-1"]]).slice(BOM.length)).toBe("x\r\nA-1")
  })
})
