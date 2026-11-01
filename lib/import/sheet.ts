import { inflateRawSync } from "node:zlib"

const MAX_ROWS = 2000
const MAX_COLS = 40

export function parseSpreadsheet(name: string, bytes: Buffer): string[][] {
  const lower = name.trim().toLowerCase()
  if (lower.endsWith(".xlsx")) return parseXlsx(bytes)
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(bytes.toString("utf8"))
  throw new Error("Choose a CSV or Excel .xlsx file.")
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "")
  const delimiter = detectDelimiter(source)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }
  if (quoted) throw new Error("A quoted cell was not closed.")
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return limitGrid(rows.filter((line) => line.some((value) => value.trim() !== "")))
}

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? ""
  const scores = [
    [",", countChar(line, ",")],
    [";", countChar(line, ";")],
    ["\t", countChar(line, "\t")],
  ] as const
  return scores.reduce((best, item) => (item[1] > best[1] ? item : best))[0]
}

function countChar(line: string, char: string): number {
  let count = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (!quoted && line[i] === char) count++
  }
  return count
}

export function parseXlsx(bytes: Buffer): string[][] {
  const files = unzip(bytes)
  const sheet = files.find((file) => file.name === "xl/worksheets/sheet1.xml") ?? files.find((file) => /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name))
  if (!sheet) throw new Error("The workbook has no worksheet.")
  const shared = files.find((file) => file.name === "xl/sharedStrings.xml")
  return limitGrid(sheetRows(sheet.data.toString("utf8"), shared ? sharedStrings(shared.data.toString("utf8")) : []))
}

function sharedStrings(xml: string): string[] {
  return xml.split(/<si\b[^>]*>/).slice(1).map((item) =>
    [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1] ?? "")).join("")
  )
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>()
    let max = -1
    let next = 0
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? ""
      const body = cell[2] ?? ""
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)
      const col = ref ? columnIndex(ref[1]!) : next
      next = col + 1
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? ""
      let value = ""
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1] ?? "")).join("")
      } else if (type === "s") {
        const index = Number(/<v>(\d+)<\/v>/.exec(body)?.[1])
        value = Number.isInteger(index) ? strings[index] ?? "" : ""
      } else if (type === "str") {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "")
      } else {
        value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ""
      }
      cells.set(col, decodeXml(value))
      if (col > max) max = col
    }
    if (max < 0) continue
    const line: string[] = []
    for (let i = 0; i <= max; i++) line.push(cells.get(i) ?? "")
    if (line.some((value) => value.trim() !== "")) rows.push(line)
  }
  return rows
}

function columnIndex(letters: string): number {
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function limitGrid(rows: string[][]): string[][] {
  if (rows.length > MAX_ROWS + 1) throw new Error("A file can have at most 2000 data rows.")
  if (rows.some((row) => row.length > MAX_COLS)) throw new Error("A file can have at most 40 columns.")
  return rows
}

type ZipEntry = { name: string; data: Buffer }

function unzip(bytes: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = []
  let offset = 0
  while (offset + 30 <= bytes.length) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) break
    const flags = bytes.readUInt16LE(offset + 6)
    const method = bytes.readUInt16LE(offset + 8)
    const compressedSize = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    if (flags & 0x8) throw new Error("Save the workbook from Excel again. This file stores sizes after the data.")
    const nameStart = offset + 30
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8")
    const dataStart = nameStart + nameLength + extraLength
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    if (dataStart + compressedSize > bytes.length) throw new Error("The workbook is incomplete.")
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null
    if (!data) throw new Error("This workbook uses a compression the import does not read.")
    entries.push({ name, data })
    offset = dataStart + compressedSize
  }
  if (entries.length === 0) throw new Error("The workbook could not be read.")
  return entries
}
