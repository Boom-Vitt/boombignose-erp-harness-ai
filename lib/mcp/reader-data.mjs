import { ERP_DATA_ENTITY_MAP } from "./reader-catalog.mjs"

export const READER_MAX_LIMIT = 100
export const READER_MAX_OFFSET = 1_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECORD_TABLES = Object.freeze({ client: "clients", deal: "deals", quote: "quotes", invoice: "invoices", project: "projects", subscription: "subscriptions", vendor: "vendors", purchase_order: "purchase_orders", expense_claim: "expense_claims" })
const ATTACHMENT_TYPES = new Set(["text/plain", "text/csv", "application/pdf", "image/png", "image/jpeg", "image/webp"])

export function readerDefinition(key) {
  const definition = ERP_DATA_ENTITY_MAP.get(key)
  if (!definition || definition.readable === false) throw new Error("Entity is not readable; inspect erp_data_catalog for its policy.")
  return definition
}
export function validateReaderRequest(definition, orgId, options) {
  if (!UUID.test(orgId ?? "")) throw new Error("A verified current organization is required.")
  const { limit = 25, offset = 0, fields = definition.fields.map(field => field.key), filters = {}, search, search_field: searchField } = options
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > READER_MAX_LIMIT || !Number.isSafeInteger(offset) || offset < 0 || offset > READER_MAX_OFFSET) throw new Error("Invalid reader page bounds.")
  const known = new Map(definition.fields.map(field => [field.key, field]))
  if (!Array.isArray(fields) || !fields.length || fields.some(field => !known.has(field)) || new Set(fields).size !== fields.length) throw new Error("Fields must be unique catalog field keys.")
  if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).length > 8) throw new Error("At most eight equality filters are supported.")
  for (const [key, value] of Object.entries(filters)) {
    if (!known.has(key) || known.get(key).kind === "json" || known.get(key).kind === "text-array" || !(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) || (typeof value === "string" && value.length > 2000)) throw new Error("Invalid equality filter.")
    if ((key === "org_id" || (definition.key === "organizations" && key === "id")) && value !== orgId) throw new Error("Reader cannot change the current organization.")
  }
  if (search !== undefined && (typeof search !== "string" || !search.length || search.length > 500 || search.includes("*") || known.get(searchField)?.searchable !== true)) throw new Error("Search requires a searchable:true catalog text field and 1..500 characters without PostgREST's reserved '*' wildcard; use equality filters for exact values.")
  if (search === undefined && searchField !== undefined) throw new Error("search_field requires search.")
  return { limit, offset, fields: [...new Set([...definition.primaryKey, ...fields])], filters, search, search_field: searchField }
}
function literalLike(value) { return value.replace(/[\\%_]/g, character => `\\${character}`) }
function project(row, fields, entityKey) {
  const result = Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]))
  if (entityKey === "saved_views" && Object.hasOwn(result, "config")) {
    const config = result.config
    result.config = config && typeof config === "object" && !Array.isArray(config)
      ? Object.fromEntries(["q", "status", "stage", "period", "mine", "groupBy", "warehouse", "product", "sourceId"].filter(key => typeof config[key] === "string").map(key => [key, config[key]]))
      : {}
  }
  return result
}

/**
 * @typedef {{ text: string, filename: string, contentType: string,
 *   extraction?: { method: string, partial: boolean, limitations?: string[] } }} BusinessAttachmentText
 * @typedef {{ readAttachmentText?: (input: { orgId: string, attachmentId: string }) => Promise<BusinessAttachmentText | null>,
 *   attachmentTextFormats?: string[] }} BusinessReaderOptions
 */

/**
 * Session-only adapter. No SQL, column, relation or storage path comes from model text.
 * @param {object} supabase
 * @param {BusinessReaderOptions} [options]
 */
export function createBusinessReaderData(supabase, { readAttachmentText, attachmentTextFormats = ["text/plain", "text/csv"] } = {}) {
  if (!Array.isArray(attachmentTextFormats) || attachmentTextFormats.some(type => !ATTACHMENT_TYPES.has(type))) throw new Error("Invalid configured attachment text formats.")
  const configuredFormats = [...new Set(attachmentTextFormats)]
  async function readBusinessData(key, orgId, options = {}) {
    const definition = readerDefinition(key)
    const request = validateReaderRequest(definition, orgId, options)
    const { fields, filters, limit, offset, search, search_field: searchField } = request
    if (key === "finance_lock_reopen_requests") {
      const { data, error } = await supabase.rpc("list_finance_lock_reopen_requests", { p_org_id: orgId })
      if (error || !Array.isArray(data)) throw new Error("Authorized pending finance-lock requests are unavailable.")
      const all = data.map(row => ({ id: row.id, requested_by: row.requestedBy, lock_date: row.lockDate, previous_lock_date: row.previousLockDate, reason: row.reason, created_at: row.createdAt, requester_email: row.requesterEmail }))
        .filter(row => Object.entries(filters).every(([field, value]) => row[field] === value) && (search === undefined || String(row[searchField] ?? "").toLowerCase().includes(search.toLowerCase())))
        .sort((left, right) => String(left.id).localeCompare(String(right.id), "en"))
      return { rows: all.slice(offset, offset + limit).map(row => project(row, fields)), total: all.length }
    }
    let query
    if (key === "profiles") {
      // A fixed SECURITY INVOKER function joins session-visible current-org memberships;
      // a broad shares_org policy alone would also include other workspaces.
      query = supabase.rpc("assistant_workspace_profiles", { p_org_id: orgId }, { count: "exact" }).select(fields.join(","))
    } else {
      query = supabase.from(key).select(fields.join(","), { count: "exact" }).eq(key === "organizations" ? "id" : "org_id", orgId)
    }
    if (key === "saved_views") {
      const actor = await supabase.auth.getUser()
      if (actor.error || !UUID.test(actor.data?.user?.id ?? "")) throw new Error("Saved views require a verified session actor.")
      query = query.eq("user_id", actor.data.user.id)
    }
    for (const [field, value] of Object.entries(filters)) query = value === null ? query.is(field, null) : query.eq(field, value)
    if (search !== undefined) query = query.ilike(searchField, `%${literalLike(search)}%`)
    for (const field of definition.primaryKey) query = query.order(field, { ascending: true })
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw new Error(`Authorized ${key} read failed.`)
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || data.length > limit) throw new Error("Exact scoped reader count is unavailable.")
    return { rows: data.map(row => project(row, fields, key)), total: count }
  }

  async function authorizedAttachment(orgId, attachmentId) {
    if (!UUID.test(orgId ?? "") || !UUID.test(attachmentId ?? "")) return null
    const { data, error } = await supabase.from("record_attachments").select("id,org_id,record_type,record_id,path,filename,size,content_type").eq("org_id", orgId).eq("id", attachmentId).maybeSingle()
    if (error || !data || !Object.hasOwn(RECORD_TABLES, data.record_type) || !UUID.test(data.record_id ?? "") || data.path !== `${orgId}/${data.record_type}/${data.record_id}/${attachmentId}` || typeof data.filename !== "string" || !data.filename.trim() || data.filename.length > 255 || /[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(data.filename) || !Number.isSafeInteger(data.size) || data.size < 1 || data.size > 10 * 1024 * 1024 || !ATTACHMENT_TYPES.has(data.content_type)) return null
    const parent = await supabase.from(RECORD_TABLES[data.record_type]).select("id").eq("org_id", orgId).eq("id", data.record_id).maybeSingle()
    return parent.error || !parent.data ? null : data
  }

  async function readBusinessAttachmentText(orgId, attachmentId) {
    const metadata = await authorizedAttachment(orgId, attachmentId)
    if (!metadata) throw new Error("Attachment is unavailable or not authorized.")
    if (readAttachmentText) {
      if (!configuredFormats.includes(metadata.content_type)) throw new Error("This retained attachment format is not supported by the configured real text extractor.")
      const result = await readAttachmentText({ orgId, attachmentId })
      if (!result || typeof result.text !== "string" || result.filename !== metadata.filename || result.contentType !== metadata.content_type || (result.extraction !== undefined && (!result.extraction || typeof result.extraction.method !== "string" || typeof result.extraction.partial !== "boolean" || (result.extraction.limitations !== undefined && (!Array.isArray(result.extraction.limitations) || result.extraction.limitations.some(value => typeof value !== "string")))))) throw new Error("Authorized attachment text is unavailable.")
      return result
    }
    if (process.env.BOOMBIGNOSE_NATIVE === "1") throw new Error("Native attachment text reader is not configured.")
    if (metadata.content_type !== "text/plain" && metadata.content_type !== "text/csv") throw new Error("This binary attachment requires the existing document extraction/OCR reader; its content is not plain text.")
    const downloaded = await supabase.storage.from("record-attachments").download(metadata.path)
    if (downloaded.error || !downloaded.data) throw new Error("Private attachment content is unavailable.")
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
    if (bytes.byteLength !== metadata.size) throw new Error("Retained attachment size does not match metadata.")
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    const validationText = text.replace(/^\uFEFF/, "")
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || validationText.startsWith("%PDF-") || (validationText.startsWith("RIFF") && validationText.slice(8, 12) === "WEBP")) throw new Error("Retained attachment is not valid plain text.")
    return { text, filename: metadata.filename, contentType: metadata.content_type, extraction: { method: "retained-utf8-text", partial: false } }
  }
  return { readBusinessData, readBusinessAttachmentText, businessAttachmentReader: { formats: readAttachmentText ? configuredFormats : ["text/plain", "text/csv"], configured: process.env.BOOMBIGNOSE_NATIVE !== "1" || typeof readAttachmentText === "function" } }
}
