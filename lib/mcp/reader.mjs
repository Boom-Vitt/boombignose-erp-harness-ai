import { createHash } from "node:crypto"
import { ERP_DATA_ENTITIES, ERP_DATA_ENTITY_MAP, ERP_DATA_TOOL_NAMES } from "./reader-catalog.mjs"
import { readerDefinition, validateReaderRequest, READER_MAX_LIMIT, READER_MAX_OFFSET } from "./reader-data.mjs"

export { ERP_DATA_ENTITIES, ERP_DATA_TOOL_NAMES } from "./reader-catalog.mjs"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTITY = { type: "string", enum: ERP_DATA_ENTITIES.map(definition => definition.key), description: "Exact entity key discovered in erp_data_catalog." }
const PAGE = { limit: { type: "integer", minimum: 1, maximum: READER_MAX_LIMIT, default: 25 }, offset: { type: "integer", minimum: 0, maximum: READER_MAX_OFFSET, default: 0 } }
const FILTERS = { type: "object", maxProperties: 8, additionalProperties: { type: ["string", "number", "boolean", "null"] }, description: "Equality filters on available catalog scalar field keys only. No SQL or filter expressions." }
const RECORD = { type: "object", minProperties: 1, additionalProperties: { type: ["string", "number", "boolean"] }, description: "Complete primaryKey object returned by the catalog or a row's _text pointer. Never an SQL expression." }
export const ERP_DATA_TOOLS = Object.freeze([
  { name: "erp_data_catalog", description: "Discover ALL 80 actual ERP tables, role/read policies, exclusions and source coverage. Default returns a small paged entity index. Pass entity to inspect its complete safe fields/types, primaryKey, text access and exact restrictions. Search matches entity keys and Thai/English labels. Internal credential/command stores are explicitly classified, not accessible. For effective invoice status/unpaid totals use list_invoices, not raw row arithmetic.", inputSchema: { type: "object", properties: { entity: ENTITY, search: { type: "string", maxLength: 500 }, ...PAGE }, additionalProperties: false } },
  { name: "erp_data_read", description: "Read current-workspace authorized business rows with exact RLS-filtered total and stable primary-key pagination. Discover entity/fields with erp_data_catalog. Fields and scalar equality filters are allowlisted; search is literal substring in one catalog field marked searchable:true (not UUIDs/enums). The reserved PostgREST '*' wildcard is rejected; use equality filters for such exact values. Long text/JSON is an explicitly marked preview plus _text full-length/hash/read pointer; use erp_data_text for full content. Never sum bounded rows into workspace totals. Raw invoices do not replace list_invoices/finance_summary settlement snapshots.", inputSchema: { type: "object", properties: { entity: ENTITY, fields: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }, filters: FILTERS, search: { type: "string", minLength: 1, maxLength: 500, pattern: "^[^*]*$" }, search_field: { type: "string" }, ...PAGE }, required: ["entity"], additionalProperties: false } },
  { name: "erp_data_text", description: "Read actual authorized record text/JSON or retained attachment content, in contiguous Unicode-code-point ranges (NOT UTF16/UTF8 offsets). Identify the record with its complete catalog primaryKey. offset starts at zero; follow next_offset until has_more=false for full coverage. Returns full-source SHA256, slice SHA256, full length, exact slice and honest extraction/partial coverage. record_attachments field=content uses private storage and rechecks parent authorization; binary documents require configured real extraction, not an invented URL or guessed text.", inputSchema: { type: "object", properties: { entity: ENTITY, record: RECORD, field: { type: "string" }, offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: 2048, default: 1500 }, expected_sha256: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Optional source hash from the previous page; rejects changed sources instead of mixing versions." } }, required: ["entity", "record", "field"], additionalProperties: false } },
])
const hash = text => createHash("sha256").update(text, "utf8").digest("hex")
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value)
function checkedArgs(args, allowed) {
  if (!isObject(args) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error("Unknown or invalid reader arguments.")
}
export function readerContextAvailable(ctx) {
  return UUID.test(ctx.erpOrgId ?? "") && Array.isArray(ctx.trustedCapabilities) && ctx.trustedCapabilities.includes("record:write")
}
export function requireReaderContext(ctx) {
  if (!readerContextAvailable(ctx)) throw new Error("Broad ERP reads require verified session capabilities and a current organization.")
}
function available(definition, capabilities) { return definition.readable !== false && (!definition.requiredCapability || capabilities.includes(definition.requiredCapability)) }
function authorize(definition, ctx) {
  if (!available(definition, ctx.trustedCapabilities)) throw new Error(definition.reason ?? `This entity requires ${definition.requiredCapability}; session RLS also applies.`)
}
function metadata(definition, fields = definition.fields) {
  return { key: definition.key, labelEn: definition.labelEn, labelTh: definition.labelTh, fields, primaryKey: definition.primaryKey, scope: definition.scope, ...(definition.route ? { route: definition.route } : {}), ...(definition.financialAuthority ? { financialAuthority: definition.financialAuthority } : {}) }
}
function catalogEntry(definition, ctx, detailed) {
  const entry = { key: definition.key, labelEn: definition.labelEn, labelTh: definition.labelTh, available: available(definition, ctx.trustedCapabilities), requiredCapability: definition.requiredCapability, scope: definition.scope, ...(definition.reason ? { reason: definition.reason } : {}) }
  if (!detailed) return { ...entry, field_count: definition.fields.length, inspect: { tool: "erp_data_catalog", entity: definition.key } }
  const result = { ...entry, ...metadata(definition), exclusions: definition.exclusions, ...(definition.excludedFields ? { excludedFields: definition.excludedFields } : {}), text_access: "erp_data_text uses complete primaryKey, field and Unicode-code-point offsets" }
  if (definition.key === "record_attachments") {
    const capability = ctx.dataLayer.businessAttachmentReader ?? { configured: false, formats: [] }
    result.attachment_content = { ...capability, field: "content", requires: "reauthorized attachment and parent record; actual storage content validation", unsupported: "No binary extraction is implied by metadata access." }
    if (capability.configured) result.fields = [...definition.fields, { key: "content", labelEn: "Retained attachment content", labelTh: "เนื้อหาไฟล์แนบ", kind: "text", textReadable: true, virtual: true, readWith: "erp_data_text", formats: capability.formats }]
  }
  return result
}
function page(args, defaultLimit = 25) {
  const limit = args.limit ?? defaultLimit, offset = args.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > READER_MAX_LIMIT || !Number.isSafeInteger(offset) || offset < 0 || offset > READER_MAX_OFFSET) throw new Error("Invalid reader page bounds.")
  return { limit, offset }
}
function safeScalar(value, field) {
  if (value === null || value === undefined) return value ?? null
  if (field.kind === "money-in-satang" || field.kind === "integer") {
    if (!(typeof value === "number" || (typeof value === "string" && /^-?\d+$/.test(value)))) throw new Error("Invalid exact integer in business source.")
    const number = Number(value)
    if (!Number.isSafeInteger(number)) throw new Error("Business integer exceeds safe exact bounds.")
    return number
  }
  if (field.kind === "number" && !Number.isFinite(Number(value))) throw new Error("Invalid business numeric source.")
  return value
}
function textValue(value) {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}
/** Code-point ranges never split a surrogate pair. Returned next_offset is the only continuation cursor. */
export function readerTextSlice(text, offset, length) {
  if (typeof text !== "string" || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 2048) throw new Error("Invalid text range.")
  let position = 0, start = text.length, end = text.length
  for (let index = 0; index < text.length;) {
    if (position === offset) start = index
    if (position === offset + length) end = index
    const code = text.codePointAt(index)
    index += code > 0xffff ? 2 : 1
    position++
  }
  if (offset > position) throw new Error("Text offset exceeds source length.")
  const next = Math.min(position, offset + length)
  const slice = text.slice(start, end)
  return { text: slice, offset_unit: "unicode-code-points", offset, length: next - offset, next_offset: next, total_length: position, has_more: next < position, partial: offset !== 0 || next < position, sha256: hash(text), text_sha256: hash(slice) }
}
function rowWithPointers(row, definition, fields) {
  const record = Object.fromEntries(definition.primaryKey.map(key => [key, row[key]]))
  if (Object.values(record).some(value => value === null || value === undefined)) throw new Error("Business record identity is incomplete.")
  const item = {}, pointers = {}
  for (const field of fields) {
    if (!Object.hasOwn(row, field.key)) throw new Error("Business source omitted an advertised field.")
    const value = safeScalar(row[field.key], field)
    const text = field.textReadable ? textValue(value) : null
    if (text !== null && (text.length > 512 || field.kind === "json" || field.kind === "text-array")) {
      const preview = readerTextSlice(text, 0, 256)
      item[field.key] = preview.text
      pointers[field.key] = { preview: true, format: field.kind === "json" || field.kind === "text-array" ? "json" : "text", total_length: preview.total_length, offset_unit: preview.offset_unit, sha256: preview.sha256, retrieved_length: preview.length, has_more: preview.has_more, read: { tool: "erp_data_text", entity: definition.key, record, field: field.key, offset: 0, expected_sha256: preview.sha256 } }
    } else item[field.key] = value
  }
  if (Object.keys(pointers).length) item._text = pointers
  return item
}

export async function runErpDataTool(name, args, ctx) {
  requireReaderContext(ctx)
  if (name === "erp_data_catalog") {
    checkedArgs(args, ["entity", "search", "limit", "offset"])
    if (args.entity !== undefined) {
      const definition = ERP_DATA_ENTITY_MAP.get(args.entity)
      if (!definition) throw new Error("Unknown catalog entity.")
      return { org_id: ctx.erpOrgId, total_entities: ERP_DATA_ENTITIES.length, items: [catalogEntry(definition, ctx, true)], total: 1, limit: 1, offset: 0, has_more: false }
    }
    if (args.search !== undefined && (typeof args.search !== "string" || args.search.length > 500)) throw new Error("Invalid catalog search.")
    const selected = ERP_DATA_ENTITIES.filter(definition => args.search === undefined || `${definition.key} ${definition.labelEn} ${definition.labelTh}`.toLowerCase().includes(args.search.toLowerCase()))
    const bounds = page(args, 10)
    return { org_id: ctx.erpOrgId, total_entities: ERP_DATA_ENTITIES.length, items: selected.slice(bounds.offset, bounds.offset + bounds.limit).map(definition => catalogEntry(definition, ctx, false)), total: selected.length, ...bounds, has_more: bounds.offset + bounds.limit < selected.length }
  }
  const definition = readerDefinition(args.entity)
  authorize(definition, ctx)
  if (name === "erp_data_read") {
    checkedArgs(args, ["entity", "fields", "filters", "search", "search_field", "limit", "offset"])
    const options = validateReaderRequest(definition, ctx.erpOrgId, args)
    const response = await ctx.dataLayer.readBusinessData(definition.key, ctx.erpOrgId, options)
    const fields = definition.fields.filter(field => options.fields.includes(field.key))
    return { org_id: ctx.erpOrgId, entity: metadata(definition, fields), items: response.rows.map(row => rowWithPointers(row, definition, fields)), total: response.total, limit: options.limit, offset: options.offset, has_more: options.offset + response.rows.length < response.total, coverage: { scope: definition.scope, retrieved: response.rows.length, full_matching_count: response.total, text_previews: "Fields listed in each row's _text are previews, not complete text. Follow their erp_data_text pointers." } }
  }
  if (name !== "erp_data_text") throw new Error("Unknown ERP reader tool.")
  checkedArgs(args, ["entity", "record", "field", "offset", "length", "expected_sha256"])
  const textOffset = args.offset ?? 0, textLength = args.length ?? 1500
  if (!Number.isSafeInteger(textOffset) || textOffset < 0 || !Number.isSafeInteger(textLength) || textLength < 1 || textLength > 2048) throw new Error("Invalid text range.")
  if (!isObject(args.record) || Object.keys(args.record).length !== definition.primaryKey.length || definition.primaryKey.some(key => !Object.hasOwn(args.record, key) || args.record[key] === null || !["string", "number", "boolean"].includes(typeof args.record[key]))) throw new Error("Text read requires the exact complete catalog primaryKey.")
  if (args.expected_sha256 !== undefined && (typeof args.expected_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(args.expected_sha256))) throw new Error("Invalid source hash.")
  const field = definition.fields.find(candidate => candidate.key === args.field)
  let text, attachment
  if (definition.key === "record_attachments" && args.field === "content") {
    attachment = await ctx.dataLayer.readBusinessAttachmentText(ctx.erpOrgId, args.record.id)
    text = attachment.text
  } else {
    if (!field?.textReadable) throw new Error("This catalog field is not available as text.")
    const result = await ctx.dataLayer.readBusinessData(definition.key, ctx.erpOrgId, { fields: [field.key], filters: args.record, limit: 1, offset: 0 })
    if (result.total !== 1 || result.rows.length !== 1) throw new Error("Authorized record text was not found.")
    text = textValue(result.rows[0][field.key])
    if (text === null) {
      if (textOffset !== 0) throw new Error("Text offset exceeds null source length.")
      if (args.expected_sha256 !== undefined) throw new Error("Source changed since the previous read; restart from offset zero.")
      return { org_id: ctx.erpOrgId, entity: metadata(definition, [field]), record: args.record, field: args.field, value: null, text: null, total_length: 0, offset_unit: "unicode-code-points", offset: 0, length: 0, next_offset: 0, has_more: false, partial: false, sha256: null, text_sha256: null }
    }
  }
  const slice = readerTextSlice(text, textOffset, textLength)
  if (args.expected_sha256 !== undefined && slice.sha256 !== args.expected_sha256) throw new Error("Source changed since the previous read; restart from offset zero.")
  const extraction = attachment?.extraction
  return { org_id: ctx.erpOrgId, entity: metadata(definition, field ? [field] : [{ key: "content", labelEn: "Retained attachment content", labelTh: "เนื้อหาไฟล์แนบ", kind: "text", textReadable: true }]), record: args.record, field: args.field, ...slice, ...(attachment ? { filename: attachment.filename, content_type: attachment.contentType, extraction: extraction ?? { method: "configured-authorized-reader", partial: false } } : {}), partial: slice.partial || extraction?.partial === true }
}
