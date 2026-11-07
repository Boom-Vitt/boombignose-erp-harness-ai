import { createHash } from "node:crypto"
import { z } from "zod"
import type { Role } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { ERP_DATA_ENTITY_MAP, ERP_DATA_TOOL_NAMES } from "@/lib/mcp/reader-catalog.mjs"
import { formatTHB } from "@/lib/mcp/data.mjs"
import { answerFigures } from "./answer-figures"

const COMMON_TOOLS = ["list_clients", "list_deals", "list_quotes", "list_projects", "list_invoices", "list_payment_claims"] as const

/** A new MCP tool never silently becomes an AI privilege. */
export function assistantToolNames(role: Role): Set<string> {
  return new Set<string>([...COMMON_TOOLS, ...ERP_DATA_TOOL_NAMES, ...(can(role, "profit:view") ? ["finance_summary"] : [])])
}

type Label = { en: string; th: string }
export type SourceFact = { id: string; label: Label; value: string; scope: "matching-records" | "record" | "workspace"; href?: string; recordPresence?: "present" | "not-returned" | "partial" }
export type AssistantSource = {
  id: string
  kind: "erp" | "document"
  label: string
  href?: string
  entity?: string
  recordIds?: string[]
  observedAt: string
  total?: number
  returned?: number
  /** Server-required receivables facts remain visible even when AI selects a subset. */
  coverage?: { factIds: string[]; partial: boolean }
  requiredFactIds?: string[]
  partial: boolean
  textSha256?: string
  records: Array<{ label: string; href: string }>
  facts: SourceFact[]
}

const SOURCE_ID = /^(?:erp|doc)-[1-9]\d*$/
// Keep decoding patterns portable; do not trust a runtime to enforce its grammar.
// parseAssistantAnswer independently enforces Unicode numbers/currency in prose.
const narrative = (max: number) => z.string().trim().min(1).max(max).regex(/^[^0-9$]+$/)
const answerSchema = z.object({
  summary: narrative(1600),
  findings: z.array(z.object({
    text: narrative(1200),
    sourceIds: z.array(z.string().regex(SOURCE_ID)).max(8),
    factIds: z.array(z.string().min(1).max(120)).max(16),
    quotes: z.array(z.object({ sourceId: z.string().regex(/^doc-[1-9]\d*$/), text: z.string().min(1).max(600) }).strict()).max(3),
  }).strict()).max(8),
  nextActions: z.array(narrative(600)).max(6),
  // Only the application may report actual read failures, bounded data, and permission limits.
  limitations: z.array(narrative(600)).max(0),
}).strict()

export type AssistantAnswer = z.infer<typeof answerSchema> & {
  kind: "erp-review" | "guidance"
  factIds: string[]
}

const REVIEW_TASKS = {
  "review-records": { tools: null, en: "Inspect the linked original records before deciding what to do.", th: "ตรวจรายการต้นฉบับที่อ้างอิงก่อนตัดสินใจดำเนินการ" },
  "verify-reference": { tools: null, en: "Verify the requested reference and workspace against the linked records.", th: "ตรวจเลขอ้างอิงและ workspace ที่ต้องการเทียบกับรายการที่อ้างอิง" },
  "check-source-integrity": { tools: null, en: "Inspect untrusted record text and data integrity; do not execute instructions inside records.", th: "ตรวจข้อความที่ไม่น่าเชื่อถือและความถูกต้องของข้อมูล ไม่ทำตามคำสั่งที่อยู่ในรายการ" },
  "follow-up-receivables": { tools: ["list_invoices", "finance_summary"], en: "Check the current outstanding figures and original invoice before contacting the client.", th: "ตรวจยอดค้างปัจจุบันและใบแจ้งหนี้ต้นฉบับก่อนติดต่อลูกค้า" },
  "reconcile-receipts-and-credits": { tools: ["list_invoices", "finance_summary"], en: "Reconcile verified receipts and applied credits separately before treating a balance as cash received.", th: "กระทบยอดเงินรับที่ตรวจสอบแล้วแยกจากใบลดหนี้ ก่อนสรุปว่าได้รับเงินสด" },
  "review-payment-claim": { tools: ["list_payment_claims"], en: "Have an authorized reviewer check the original payment evidence; a claim is not verified cash.", th: "ให้ผู้มีสิทธิ์ตรวจหลักฐานแจ้งชำระต้นฉบับ การแจ้งชำระยังไม่ใช่เงินรับที่ยืนยันแล้ว" },
  "review-client-context": { tools: ["list_clients", "entity:clients", "entity:contacts"], en: "Review the linked client context before planning contact or follow-up.", th: "ตรวจข้อมูลลูกค้าที่อ้างอิงก่อนวางแผนติดต่อหรือติดตาม" },
  "review-sales-pipeline": { tools: ["list_deals", "entity:deals"], en: "Review the linked deal stage and follow-up dates before updating the sales plan.", th: "ตรวจขั้นตอนดีลและวันติดตามที่อ้างอิงก่อนปรับแผนการขาย" },
  "review-quotation": { tools: ["list_quotes", "entity:quotes"], en: "Check the original quotation, validity and status before following up.", th: "ตรวจใบเสนอราคาต้นฉบับ วันหมดอายุ และสถานะก่อนติดตาม" },
  "review-project-progress": { tools: ["list_projects", "entity:projects", "entity:project_tasks", "entity:milestones", "entity:time_entries", "entity:activities"], en: "Review recorded progress, responsibilities and dates with the responsible person before assigning work.", th: "ตรวจความคืบหน้า ผู้รับผิดชอบ และวันที่ที่บันทึกกับผู้เกี่ยวข้องก่อนมอบหมายงาน" },
  "review-financial-settings": { tools: ["finance_summary"], en: "Review the recorded financial settings and source entries before using the dashboard for decisions.", th: "ตรวจค่าทางการเงินที่ตั้งไว้และรายการต้นทาง ก่อนใช้ภาพรวมตัดสินใจ" },
  "review-original-document": { tools: ["document"], en: "Compare the original attachment with its unreviewed text before using it in an ERP record.", th: "เทียบไฟล์ต้นฉบับกับข้อความที่ยังไม่ตรวจ ก่อนนำไปใช้ในรายการ ERP" },
  "review-inventory": { tools: ["entity:products", "entity:stock_balances", "entity:stock_moves", "entity:stock_documents", "entity:stock_document_lines", "entity:warehouses"], en: "Check the recorded stock, units and source documents before deciding on a stock action; a partial list is not the whole inventory.", th: "ตรวจสต็อก หน่วย และเอกสารต้นทางก่อนตัดสินใจเกี่ยวกับสินค้า รายการบางส่วนไม่ใช่สินค้าทั้งคลัง" },
  "review-purchasing": { tools: ["entity:purchase_orders", "entity:purchase_order_items", "entity:vendor_bill_matches", "entity:vendors", "entity:costs"], en: "Compare the original supplier, purchase order and bill details before an authorized person decides on approval or payment.", th: "เทียบผู้ขาย ใบสั่งซื้อ และรายละเอียดบิลต้นฉบับ ก่อนให้ผู้มีสิทธิ์ตัดสินใจอนุมัติหรือจ่าย" },
  "review-expense": { tools: ["entity:expense_claims", "entity:expense_lines"], en: "Compare the expense claim, original evidence and recorded status before an authorized reviewer decides on it.", th: "เทียบใบเบิก หลักฐานต้นฉบับ และสถานะที่บันทึก ก่อนให้ผู้ตรวจที่มีสิทธิ์พิจารณา" },
  "review-ledger": { tools: ["entity:gl_accounts", "entity:journal_entries", "entity:journal_lines", "entity:bank_lines", "entity:payments", "entity:payment_allocations"], en: "Reconcile the recorded entries against their original documents; do not sum a partial page into a financial position.", th: "กระทบยอดรายการที่บันทึกกับเอกสารต้นทาง ไม่รวมรายการบางหน้าเป็นฐานะทางการเงินทั้งหมด" },
} satisfies Record<string, { tools: string[] | null; en: string; th: string }>
type ReviewAction = keyof typeof REVIEW_TASKS
const REVIEW_ACTIONS = Object.keys(REVIEW_TASKS) as [ReviewAction, ...ReviewAction[]]
const reviewPlanSchema = z.object({
  language: z.enum(["th", "en"]),
  factIds: z.array(z.string().min(1).max(120)).max(24),
  tasks: z.array(z.object({
    action: z.enum(REVIEW_ACTIONS),
    sourceIds: z.array(z.string().regex(SOURCE_ID)).min(1).max(8),
    factIds: z.array(z.string().min(1).max(120)).max(8),
    quotes: answerSchema.shape.findings.element.shape.quotes,
  }).strict()).max(6),
}).strict()

function taskAcceptsSource(action: ReviewAction, source: AssistantSource): boolean {
  const tools: readonly string[] | null = REVIEW_TASKS[action].tools
  return tools === null || tools.includes(source.kind === "document" ? "document" : source.label) || (!!source.entity && tools.includes(`entity:${source.entity}`))
}

/** ERP output has no model-authored factual prose: only real fact references and review-task codes. */
export const ERP_REVIEW_POLICY =
  "Return exactly one JSON object with language, factIds and tasks. No Markdown, prose, summary, findings, nextActions, limitations or extra keys. " +
  "Choose language th or en to match the user's question. Select only source-owned factIds that directly answer it, not every field of the first records. The application renders their actual values, dates, status and record links. Do not output any value or calculate a new one. " +
  "Each task contains action, sourceIds, factIds and quotes. Choose an action code from the schema only, cite relevant successful sources and their facts, and use empty quotes unless quoting exact attached text. " +
  "Tasks are proposed human checks, never completed actions or factual claims. For an information-only request tasks may be empty. For a requested follow-up, select appropriate checks without adding unrelated work. " +
  "Use invoice workspace coverage for an overall position, not draft records or a filtered count. Credits do not prove cash receipts. Never certify a record or invent permission rules, technical limitations or document sources. " +
  `Action meanings: ${JSON.stringify(Object.fromEntries(REVIEW_ACTIONS.map(action => [action, REVIEW_TASKS[action].en])))}.`
/** Supply this turn's real references; validate them independently of backend decoding support. */
export function answerFormat(sources: AssistantSource[]) {
  const ids = sources.map(source => source.id)
  const hasFacts = sources.some(source => source.facts.length > 0)
  const documentIds = sources.filter(source => source.kind === "document").map(source => source.id)
  const references = (values: string[], max: number) => z.array(values.length ? z.enum(values) : z.string()).max(values.length ? max : 0)
  // Actual IDs are already in tool evidence. Do not repeat a large catalog's every ID in each schema branch.
  // parseAssistantAnswer still requires exact current-source membership and task/source ownership.
  const factReferences = (max: number) => z.array(z.string().min(1).max(120).describe("Exact fact ID from current successful read evidence; invented or mismatched references are rejected.")).max(hasFacts ? max : 0)
  const finding = answerSchema.shape.findings.element
  const quote = finding.shape.quotes.element
  if (sources.some(source => source.kind === "erp")) {
    const actions = REVIEW_ACTIONS.filter(action => sources.some(source => taskAcceptsSource(action, source)))
    const task = reviewPlanSchema.shape.tasks.element
    return z.toJSONSchema(reviewPlanSchema.extend({
      factIds: factReferences(24),
      tasks: z.array(task.extend({
        action: z.enum(actions),
        sourceIds: references(ids, 8).min(1),
        factIds: factReferences(8),
        quotes: z.array(quote.extend({ sourceId: documentIds.length ? z.enum(documentIds) : quote.shape.sourceId })).max(documentIds.length ? 3 : 0),
      })).max(6),
    }))
  }
  return z.toJSONSchema(answerSchema.extend({
    findings: z.array(finding.extend({
      sourceIds: references(ids, 8),
      factIds: factReferences(16),
      quotes: z.array(quote.extend({ sourceId: documentIds.length ? z.enum(documentIds) : quote.shape.sourceId })).max(documentIds.length ? 3 : 0),
    })).max(sources.length ? 8 : 0),
  }))
}
const NUMERIC_PROSE = new RegExp("[\\p{N}฿$€£¥〇零一二三四五六七八九十百千万萬亿億兩两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟兆]", "u")
const ENGLISH_NUMBER_WORD_TEXT = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion"
const ENGLISH_NUMBER_WORDS = new Set(ENGLISH_NUMBER_WORD_TEXT.split(" "))
const THAI_NUMBER_WORD = /^(?:ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน|ยี่|เอ็ด)+$/u
const PROSE_WORDS = new Intl.Segmenter("th", { granularity: "word" })

/** Keep the model's instructions aligned with the independently enforced prose boundary. */
export const ANSWER_PROSE_POLICY =
  "Prose must be qualitative, including summary, finding text, nextActions and limitations. Do not write digits, currency symbols, dates, identifiers, counts, or numbers spelled as words. " +
  `The following whole English words are forbidden in prose: ${ENGLISH_NUMBER_WORD_TEXT}. Thai number words are forbidden too, including หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ ร้อย พัน หมื่น แสน ล้าน. ` +
  "Even phrases such as 'one record', 'five clients', 'six invoices' or 'หนึ่งรายการ' are forbidden. Do not count records or call a subset legitimate; describe the review task without quantities and cite the source-owned facts instead. This restriction does not apply to sourceIds, factIds, or exact document quotes."

/** Whole-word segmentation avoids rejecting qualitative Thai words such as สามารถ and ผูกพัน. */
function hasNumericProse(value: string): boolean {
  const normalized = value.normalize("NFKC")
  if (NUMERIC_PROSE.test(normalized)) return true
  for (const word of PROSE_WORDS.segment(normalized)) {
    if (word.isWordLike && (ENGLISH_NUMBER_WORDS.has(word.segment.toLowerCase()) || THAI_NUMBER_WORD.test(word.segment))) return true
  }
  return false
}

/** Numeric output is a source reference or an exact attachment quote, never model arithmetic. */
export function parseAssistantAnswer(text: string, sources: AssistantSource[], documents: ReadonlyMap<string, string> = new Map()): AssistantAnswer | null {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (sources.some(source => source.kind === "erp")) {
    const result = reviewPlanSchema.safeParse(parsed)
    if (!result.success) return null
    const plan = result.data
    const byId = new Map(sources.map(source => [source.id, source]))
    const availableFacts = new Set(sources.flatMap(source => source.facts.map(fact => fact.id)))
    if (plan.factIds.some(id => !availableFacts.has(id))) return null
    for (const task of plan.tasks) {
      if (task.sourceIds.some(id => !byId.has(id)) || !task.sourceIds.some(id => taskAcceptsSource(task.action, byId.get(id)!))) return null
      const facts = new Set(task.sourceIds.flatMap(id => byId.get(id)!.facts.map(fact => fact.id)))
      if (task.factIds.some(id => !facts.has(id))) return null
      if (task.quotes.some(quote => !task.sourceIds.includes(quote.sourceId) || !documents.get(quote.sourceId)?.includes(quote.text))) return null
    }
    return {
      kind: "erp-review",
      factIds: plan.factIds,
      summary: plan.language === "th"
        ? "ข้อมูล ERP ที่อ่านตามสิทธิ์และข้อเสนองานให้คนตรวจ แชทนี้ไม่แก้ไขรายการ"
        : "Authorized ERP source data and proposed human review checks. This chat does not modify records.",
      findings: plan.tasks.map(task => ({ text: REVIEW_TASKS[task.action][plan.language], sourceIds: task.sourceIds, factIds: task.factIds, quotes: task.quotes })),
      nextActions: [],
      limitations: [],
    }
  }
  const result = answerSchema.safeParse(parsed)
  if (!result.success) return null
  const answer = result.data
  if (!sources.length && answer.findings.length) return null
  if ([answer.summary, ...answer.findings.map(finding => finding.text), ...answer.nextActions, ...answer.limitations].some(hasNumericProse)) return null
  const byId = new Map(sources.map(source => [source.id, source]))
  for (const finding of answer.findings) {
    if (sources.length && !finding.sourceIds.length) return null
    if (finding.sourceIds.some(id => !byId.has(id))) return null
    const facts = new Set(finding.sourceIds.flatMap(id => byId.get(id)?.facts.map(fact => fact.id) ?? []))
    if (finding.factIds.some(id => !facts.has(id))) return null
    if (finding.quotes.some(quote => !finding.sourceIds.includes(quote.sourceId) || !documents.get(quote.sourceId)?.includes(quote.text))) return null
  }
  return { ...answer, kind: "guidance", factIds: [] }
}

const TOOL_PATH: Record<string, string> = {
  list_clients: "/clients", list_deals: "/deals", list_quotes: "/quotes", list_projects: "/projects",
  list_invoices: "/finance", list_payment_claims: "/finance/receipts", finance_summary: "/finance",
}
const RECORD_PATH: Record<string, string> = {
  list_clients: "/clients", list_deals: "/deals", list_quotes: "/quotes", list_projects: "/projects", list_invoices: "/finance/invoices",
}
const GUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const GUID = new RegExp(`^${GUID_PATTERN}$`, "i")
const GUID_IN_TEXT = new RegExp(`\\b${GUID_PATTERN}\\b`, "gi")
const MONEY: Record<string, Label> = {
  amount: { en: "Payable amount", th: "ยอดที่ต้องชำระ" }, outstanding: { en: "Outstanding", th: "ยอดค้างชำระ" },
  paid: { en: "Verified receipts", th: "ยอดรับที่ตรวจสอบแล้ว" }, credited: { en: "Applied credits", th: "ยอดลดหนี้ที่ใช้แล้ว" },
  subtotal: { en: "Subtotal", th: "ยอดก่อนภาษี" }, discount: { en: "Discount", th: "ส่วนลด" }, total: { en: "Total", th: "ยอดรวม" },
  budget: { en: "Project budget", th: "งบประมาณโครงการ" }, vat: { en: "Recorded VAT", th: "ภาษีมูลค่าเพิ่มที่บันทึก" }, wht: { en: "Recorded withholding", th: "ภาษีหัก ณ ที่จ่ายที่บันทึก" },
  value: { en: "Deal value", th: "มูลค่าดีล" }, cash_balance: { en: "Recorded cash setting", th: "ยอดเงินสดที่ตั้งไว้" },
  monthly_burn: { en: "Monthly burn setting or current-month cost fallback", th: "ค่าใช้จ่ายต่อเดือนที่ตั้งไว้ หรือรายการเดือนนี้" },
  invoiced_total: { en: "Net invoiced total", th: "ยอดออกใบแจ้งหนี้สุทธิ" }, verified_paid: { en: "Verified payments", th: "ยอดชำระที่ตรวจสอบแล้ว" },
  unpaid: { en: "Issued outstanding total", th: "ยอดค้างชำระที่ออกแล้ว" }, costs_total: { en: "Recorded costs", th: "ต้นทุนที่บันทึก" },
  mrr: { en: "Monthly recurring revenue", th: "รายได้ประจำต่อเดือน" }, open_quotes: { en: "Open quotation value", th: "มูลค่าใบเสนอราคาที่ยังเปิด" },
  pipeline: { en: "Open deal pipeline", th: "มูลค่าดีลที่ยังเปิด" }, pending_claims: { en: "Pending payment claims", th: "ยอดแจ้งชำระที่รอตรวจ" },
}
const COUNTS: Record<string, Label> = {
  total: { en: "Matching records", th: "รายการที่ตรงเงื่อนไข" }, issued_unpaid_count: { en: "Issued unpaid invoices", th: "ใบแจ้งหนี้ที่ออกแล้วและยังค้าง" },
  unpaid_invoice_count: { en: "Unpaid invoices", th: "ใบแจ้งหนี้ค้างชำระ" }, open_quotes_count: { en: "Open quotations", th: "ใบเสนอราคาที่ยังเปิด" },
  pending_claims_count: { en: "Pending claims", th: "รายการแจ้งชำระที่รอตรวจ" },
}
const STATUS: Record<string, Label> = {
  draft: { en: "draft", th: "ฉบับร่าง" }, sent: { en: "sent", th: "ส่งแล้ว" }, overdue: { en: "overdue", th: "เกินกำหนด" },
  partially_paid: { en: "partially settled", th: "ชำระ/ลดหนี้บางส่วน" }, paid: { en: "settled", th: "ชำระ/ลดหนี้ครบ" }, cancelled: { en: "cancelled", th: "ยกเลิก" },
}
const CLAIM_AMOUNT: Label = { en: "Claimed amount", th: "ยอดที่แจ้งชำระ" }
const RECORD_DETAILS: Record<string, Record<string, Label>> = {
  list_clients: { industry: { en: "Industry", th: "อุตสาหกรรม" }, source: { en: "Acquisition source", th: "ที่มาของลูกค้า" } },
  list_deals: {
    stage: { en: "Deal stage", th: "ขั้นตอนดีล" }, currency: { en: "Recorded currency", th: "สกุลเงินที่บันทึก" },
    expected_close_date: { en: "Expected close date", th: "วันที่คาดว่าจะปิดดีล" }, next_follow_up_date: { en: "Next follow-up date", th: "วันติดตามถัดไป" },
  },
  list_quotes: { status: { en: "Quotation status", th: "สถานะใบเสนอราคา" }, valid_until: { en: "Valid until", th: "ใช้ได้ถึงวันที่" } },
  list_projects: { status: { en: "Project status", th: "สถานะโครงการ" }, deadline: { en: "Project deadline", th: "กำหนดส่งโครงการ" } },
  list_invoices: { status: { en: "Settlement status", th: "สถานะยอดค้าง" } },
  list_payment_claims: { status: { en: "Claim review status", th: "สถานะตรวจแจ้งชำระ" }, source: { en: "Claim source", th: "ที่มาของการแจ้งชำระ" }, reviewed_at: { en: "Recorded review time", th: "เวลาตรวจที่บันทึก" } },
}

/** Fixed catalog metadata, not model-supplied labels or URLs, describes authorized generic reads. */
function businessReadEvidence(id: string, name: string, payload: Record<string, unknown>, observedAt: string): AssistantSource {
  const metadata = payload.entity as { key?: string; fields?: Array<{ key?: string }> } | undefined
  const candidate = metadata?.key ? ERP_DATA_ENTITY_MAP.get(metadata.key) : undefined
  if (!candidate || candidate.readable === false) throw new Error("Unknown business evidence entity")
  const definition = candidate
  const facts: SourceFact[] = []
  const records: AssistantSource["records"] = []
  const recordIds = new Set<string>()
  const total = typeof payload.total === "number" && Number.isSafeInteger(payload.total) && payload.total >= 0 ? payload.total : undefined
  const items = Array.isArray(payload.items) ? payload.items : []
  const selected = new Set(metadata?.fields?.map(field => field.key) ?? [])
  let textPartial = false
  if (total !== undefined) facts.push({ id: `${id}:total`, label: { en: `${definition.labelEn} · Matching accessible records`, th: `${definition.labelTh} · รายการที่อ่านได้ตรงเงื่อนไข` }, value: String(total), scope: "matching-records" })
  function identity(row: Record<string, unknown>) {
    const key = Object.fromEntries(definition.primaryKey.map((column: string) => [column, row[column]]))
    for (const value of Object.values(key)) if (typeof value === "string" && GUID.test(value)) recordIds.add(value.toLowerCase())
    const tag = createHash("sha256").update(`${definition.key}:${JSON.stringify(key)}`).digest("hex").slice(0, 24)
    const label = String(row.number ?? row.name ?? row.title ?? row.sku ?? row.filename ?? JSON.stringify(key)).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100)
    const href = definition.route && typeof row.id === "string" && GUID.test(row.id) ? definition.route.replace("{id}", row.id) : undefined
    if (href) records.push({ label, href })
    return { tag, label, href, key }
  }
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const record = identity(row)
    const previews = row._text as Record<string, { preview?: boolean; has_more?: boolean }> | undefined
    for (const field of definition.fields) {
      if (!selected.has(field.key) || !Object.hasOwn(row, field.key)) continue
      const raw = row[field.key]
      if (raw === null || raw === undefined) continue
      const preview = previews?.[field.key]?.preview === true
      textPartial ||= previews?.[field.key]?.has_more === true
      const value = field.kind === "money-in-satang" ? (typeof raw === "number" && Number.isSafeInteger(raw) ? formatTHB(raw) : null) : typeof raw === "object" ? JSON.stringify(raw) : String(raw)
      if (typeof value !== "string") throw new Error("Invalid business fact value")
      const suffix = preview ? { en: " (text preview; full text available)", th: " (ข้อความตัวอย่าง อ่านฉบับเต็มได้)" } : { en: "", th: "" }
      const fieldEn = field.kind === "money-in-satang" ? `${field.labelEn.replace(/\s+satang$/i, "")} (THB)` : field.unit === "satang-per-unit" ? `${field.labelEn} (satang/unit)` : field.labelEn
      const moneyTh = field.labelTh.replace(/สตางค์/g, "บาท").replace(/\s+satang$/i, "")
      const fieldTh = field.kind === "money-in-satang" ? `${moneyTh}${moneyTh.includes("บาท") ? "" : " (บาท)"}` : field.unit === "satang-per-unit" ? `${field.labelTh} (สตางค์/หน่วย)` : field.labelTh
      facts.push({
        id: `${id}:row:${record.tag}:${field.key}`,
        label: { en: `${record.label} · ${fieldEn}${suffix.en}`, th: `${record.label} · ${fieldTh}${suffix.th}` },
        value, scope: "record", ...(record.href ? { href: record.href } : {}),
      })
    }
  }
  if (name === "erp_data_text") {
    const record = identity((payload.record ?? {}) as Record<string, unknown>)
    facts.push({ id: `${id}:row:${record.tag}:reference`, label: { en: `${definition.labelEn} · Source record`, th: `${definition.labelTh} · รายการต้นทาง` }, value: JSON.stringify(record.key), scope: "record", ...(record.href ? { href: record.href } : {}) })
    facts.push({ id: `${id}:row:${record.tag}:read-range`, label: { en: "Read text range / full length (Unicode code points)", th: "ช่วงข้อความที่อ่าน / ความยาวเต็ม (Unicode code points)" }, value: `${payload.offset}–${payload.next_offset} / ${payload.total_length}`, scope: "record" })
  }
  const offset = typeof payload.offset === "number" ? payload.offset : 0
  return { id, kind: "erp", label: name, entity: definition.key, observedAt, ...(total !== undefined ? { total, returned: items.length } : {}), partial: payload.has_more === true || payload.partial === true || textPartial || (total !== undefined && offset + items.length < total), recordIds: [...recordIds], records, facts }
}

/** All routes, labels and numeric values originate in authorized server reads. */
export function toolEvidence(id: string, name: string, payload: Record<string, unknown>, observedAt: string): AssistantSource {
  if (name === "erp_data_read" || name === "erp_data_text") return businessReadEvidence(id, name, payload, observedAt)
  const items = Array.isArray(payload.items) ? payload.items : null
  const total = typeof payload.total === "number" && Number.isSafeInteger(payload.total) && payload.total >= 0 ? payload.total : undefined
  const offset = typeof payload.offset === "number" && Number.isSafeInteger(payload.offset) && payload.offset >= 0 ? payload.offset : 0
  const facts: SourceFact[] = []
  const records: AssistantSource["records"] = []
  const recordIds = new Set<string>()
  function metrics(values: Record<string, unknown>, prefix: string, scope: SourceFact["scope"], record?: { label: string; href?: string }, status?: Label) {
    const labelFor = (label: Label): Label => record ? { en: `${record.label} · ${label.en}`, th: `${record.label} · ${label.th}` } : status ? { en: `${label.en} · ${status.en}`, th: `${label.th} · ${status.th}` } : label
    for (const [key, label] of Object.entries(MONEY)) {
      if (key === "cash_balance" && values.cash_balance_known === false) continue
      const raw = values[`${key}_satang`]
      if (typeof raw === "number" && Number.isSafeInteger(raw)) facts.push({ id: `${prefix}:${key}`, label: labelFor(name === "list_payment_claims" && key === "amount" ? CLAIM_AMOUNT : label), value: formatTHB(raw)!, scope, ...(record?.href ? { href: record.href } : {}) })
    }
    for (const [key, label] of Object.entries(COUNTS)) {
      const raw = values[key]
      if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) facts.push({ id: `${prefix}:${key}`, label: labelFor(label), value: new Intl.NumberFormat("en-GB").format(raw), scope })
    }
    for (const [key, label] of [["due_date", { en: "Due date", th: "วันครบกำหนด" }], ["issue_date", { en: "Issue date", th: "วันที่ออกเอกสาร" }]] as const) {
      const raw = values[key]
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) facts.push({ id: `${prefix}:${key}`, label: labelFor(label), value: raw, scope, ...(record?.href ? { href: record.href } : {}) })
    }
    if (record) for (const [key, label] of Object.entries(RECORD_DETAILS[name] ?? {})) {
      const raw = values[key]
      if (typeof raw === "string" && raw.length) facts.push({ id: `${prefix}:${key}`, label: labelFor(label), value: key === "status" ? STATUS[raw]?.en ?? raw : raw, scope, ...(record.href ? { href: record.href } : {}) })
    }
  }
  metrics(payload, id, name === "finance_summary" ? "workspace" : "matching-records")
  if (payload.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary)) {
    const summary = payload.summary as Record<string, unknown>
    metrics(summary, `${id}:summary`, "matching-records", undefined, typeof summary.status_filter === "string" ? STATUS[summary.status_filter] : undefined)
  }
  function recordEvidence(item: unknown): string | null {
    if (!item || typeof item !== "object" || (!RECORD_PATH[name] && name !== "list_payment_claims")) return null
    const row = item as Record<string, unknown>
    if (typeof row.id !== "string" || !GUID.test(row.id)) return null
    if (!recordIds.has(row.id)) {
      recordIds.add(row.id)
      const label = String(row.number ?? row.name ?? row.title ?? row.id).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100)
      const path = RECORD_PATH[name]
      const record = { label, ...(path ? { href: `${path}/${row.id}` } : {}) }
      if (record.href) records.push({ label, href: record.href })
      metrics(row, `${id}:row:${row.id}`, "record", record)
    }
    return row.id
  }
  for (const item of items ?? []) recordEvidence(item)
  let coverage: AssistantSource["coverage"]
  if (name === "list_invoices" && payload.receivables_coverage && typeof payload.receivables_coverage === "object") {
    const values = payload.receivables_coverage as Record<string, unknown>
    const prefix = `${id}:coverage`
    metrics({ issued_unpaid_count: values.invoice_count, outstanding_satang: values.outstanding_satang }, prefix, "workspace")
    coverage = { factIds: [`${prefix}:issued_unpaid_count`, `${prefix}:outstanding`], partial: values.has_more === true }
    for (const item of Array.isArray(values.items) ? values.items : []) {
      const rowId = recordEvidence(item)
      if (rowId) coverage.factIds.push(`${id}:row:${rowId}:outstanding`)
    }
  }
  return { id, kind: "erp", label: name, href: TOOL_PATH[name] ?? "/dashboard", observedAt, ...(total !== undefined ? { total } : {}), ...(items ? { returned: items.length } : {}), partial: payload.partial === true || payload.has_more === true || (items !== null && total !== undefined && offset + items.length < total), ...(coverage ? { coverage } : {}), records, facts }
}


/** Absence is scoped to this actual read, never a claim that another tenant's record does not exist. */
export function referenceEvidence(source: AssistantSource, question: string): AssistantSource {
  if (source.kind !== "erp") return source
  const references = new Set((question.match(GUID_IN_TEXT) ?? []).map(id => id.toLowerCase()))
  if (!references.size) return source
  const required = new Set(source.requiredFactIds ?? [])
  for (const reference of references) {
    const id = `${source.id}:reference:${reference}`
    if (required.has(id)) continue
    const record = source.records.find(record => record.href.toLowerCase().endsWith(`/${reference}`))
    const present = !!record || source.recordIds?.includes(reference) === true || source.facts.some(fact => fact.id.toLowerCase().includes(`:row:${reference}:`))
    const recordPresence = present ? "present" : source.partial || source.coverage?.partial ? "partial" : "not-returned"
    source.facts.push({
      id, label: { en: `Requested record reference ${reference}`, th: `ตรวจเลขอ้างอิง ${reference}` },
      value: recordPresence === "present" ? "Present in this read / พบในผลอ่านนี้"
        : recordPresence === "partial" ? "Not returned; source is partial / ยังไม่พบในข้อมูลบางส่วน"
          : "Not returned in this scoped read / ไม่พบในผลอ่านตามขอบเขตนี้",
      scope: "matching-records", recordPresence, ...(record ? { href: record.href } : {}),
    })
    required.add(id)
  }
  source.requiredFactIds = [...required]
  return source
}

export function answerText(answer: AssistantAnswer, sources: AssistantSource[]): string {
  const figures = answerFigures(answer, sources).map(({ source, fact }) => `${fact.label.en}: ${fact.value} [${source.id}]`)
  const quotes = answer.findings.flatMap(finding => finding.quotes.map(quote => `“${quote.text}” [${quote.sourceId}; unreviewed attachment]`))
  const scope = sources.some(source => source.kind === "erp") ? "" : "No workspace records were retrieved for this answer. Attachments and guidance are not evidence of current ERP balances.\n\n"
  return scope + [answer.summary, ...answer.findings.map(finding => `${finding.text}${finding.sourceIds.length ? ` [${finding.sourceIds.join(", ")}]` : ""}`), ...figures, ...quotes, ...answer.nextActions.map(action => `→ ${action}`), ...answer.limitations.map(limitation => `! ${limitation}`)].join("\n\n")
}
