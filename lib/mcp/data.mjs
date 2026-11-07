import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createBusinessReaderData } from "./reader-data.mjs"

const thbFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Format integer satang as a Thai Baht currency string (e.g. 123456 -> "฿1,234.56").
 * @param {number | bigint | null | undefined} satang
 * @returns {string | null}
 */
export function formatTHB(satang) {
  if (satang === null || satang === undefined) return null
  const num = typeof satang === "bigint" ? Number(satang) : Number(satang)
  if (!Number.isSafeInteger(num)) {
    throw new Error("Invalid integer satang")
  }
  const absolute = BigInt(Math.abs(num))
  const whole = absolute / BigInt(100)
  const fraction = String(absolute % BigInt(100)).padStart(2, "0")
  const signedWhole = num < 0 ? -whole : whole
  const value = num < 0 && whole === BigInt(0) ? -0 : signedWhole
  return thbFormatter
    .formatToParts(value)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("")
}

/**
 * Normalize a satang value to a safe integer.
 * @param {unknown} value
 * @returns {number}
 */
export function toSatang(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === "string" && !/^-?\d+$/.test(value)) {
    throw new Error("Invalid integer satang")
  }
  const n = Number(value)
  if (!Number.isSafeInteger(n)) {
    throw new Error("Money value outside safe satang bounds")
  }
  return n
}

const PROJECT_ID_RE = /^\s*project_id\s*=\s*"boombignose-erp"\s*(?:#.*)?$/m

/**
 * Verify that `<erpDir>/supabase/config.toml` exists and declares `project_id = "boombignose-erp"`.
 * @param {string} erpDir
 * @param {Pick<typeof fs, "readFileSync">} [fsImpl]
 */
export function verifyErpSupabaseConfig(erpDir, fsImpl = fs) {
  if (!erpDir || typeof erpDir !== "string") {
    throw new Error("ERP_DIR must be a non-empty path")
  }
  const configPath = path.join(erpDir, "supabase", "config.toml")
  let content = ""
  try {
    content = fsImpl.readFileSync(configPath, "utf8")
  } catch {
    throw new Error(
      `Refusing ERP_DIR without supabase/config.toml (expected project_id "boombignose-erp")`
    )
  }
  if (!PROJECT_ID_RE.test(content)) {
    throw new Error(
      `Refusing ERP_DIR whose supabase/config.toml does not have project_id "boombignose-erp"`
    )
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

/**
 * Ensure the Supabase API URL points to a loopback/local host.
 * @param {string} rawUrl
 * @returns {string}
 */
export function assertLocalSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Missing Supabase API_URL")
  }
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("Invalid Supabase API_URL")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing non-HTTP Supabase URL protocol: ${parsed.protocol}`)
  }
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing non-local Supabase URL host: ${parsed.hostname}`)
  }
  return rawUrl
}

/**
 * Parse `supabase status -o env` stdout lines into a key-value map.
 * @param {string} stdout
 * @returns {Record<string, string>}
 */
export function parseSupabaseStatusEnv(stdout) {
  /** @type {Record<string, string>} */
  const parsed = {}
  for (const rawLine of String(stdout ?? "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

/**
 * Load local Supabase `API_URL` and `SERVICE_ROLE_KEY` via `<ERP_DIR>/node_modules/.bin/supabase`.
 * Checks `<ERP_DIR>/supabase/config.toml` first and parses stdout only.
 * @param {{
 *   erpDir: string,
 *   execFileSyncImpl?: typeof execFileSync,
 *   fsImpl?: Pick<typeof fs, "readFileSync">,
 *   registerSecret?: (secret: string) => void
 * }} options
 * @returns {{ apiUrl: string, serviceRoleKey: string }}
 */
export function loadSupabaseStatusConfig({
  erpDir,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
  registerSecret,
}) {
  verifyErpSupabaseConfig(erpDir, fsImpl)
  const supabaseBin = path.join(erpDir, "node_modules", ".bin", "supabase")
  let stdout = ""
  try {
    const output = execFileSyncImpl(
      supabaseBin,
      ["status", "-o", "env", "--workdir", erpDir],
      {
        cwd: erpDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    stdout = typeof output === "string" ? output : Buffer.from(output).toString("utf8")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Unable to read local Supabase status: ${msg}`)
  }

  const vars = parseSupabaseStatusEnv(stdout)
  for (const [k, v] of Object.entries(vars)) {
    if (v && (k.includes("KEY") || k.includes("SECRET") || k.includes("TOKEN") || k.includes("PASSWORD"))) {
      registerSecret?.(v)
    }
  }

  const serviceRoleKey = vars.SERVICE_ROLE_KEY ?? ""
  if (serviceRoleKey) {
    registerSecret?.(serviceRoleKey)
  }
  const apiUrl = assertLocalSupabaseUrl(vars.API_URL ?? "")
  if (!serviceRoleKey) {
    throw new Error("Missing SERVICE_ROLE_KEY from local Supabase status")
  }

  return { apiUrl, serviceRoleKey }
}

export const TABLE_COLUMNS = Object.freeze({
  organizations: "id,name,slug,created_at,updated_at",
  clients: "id,org_id,name,industry,source,created_at,updated_at",
  deals:
    "id,org_id,client_id,title,stage,value_satang,currency,expected_close_date,next_follow_up_date,source,created_at,updated_at",
  quotes:
    "id,org_id,client_id,project_id,number,status,issue_date,valid_until,subtotal_satang,discount_satang,total_satang,converted_invoice_id,created_at,updated_at",
  projects:
    "id,org_id,deal_id,client_id,source_quote_id,name,status,deadline,budget_satang,created_at,updated_at",
  invoices:
    "id,org_id,client_id,project_id,source_quote_id,source_milestone_id,number,status,issue_date,due_date,amount_satang,total_satang,vat_satang,wht_satang,wht_rate_bps,discount_satang,is_recurring,recurring_interval,created_at,updated_at",
  payment_claims:
    "id,org_id,client_id,invoice_id,amount_satang,status,source,reviewed_at,payment_id,created_at,updated_at",
  org_settings: "org_id,cash_balance_satang,monthly_burn_satang",
  payments: "id,org_id,invoice_id,amount_satang,paid_at,method,verification_state",
  invoice_balances: "org_id,invoice_id,paid_satang,credited_satang,outstanding_satang",
  credit_note_revenue: "id,org_id,total_satang,base_satang",
  costs: "id,org_id,project_id,category,amount_satang,incurred_on",
  subscriptions: "id,org_id,status,amount_satang,interval",
})

/**
 * Pick only the comma-separated columns from a row object.
 * Guarantees no disallowed columns (notes, emails, phones, references, tokens) ever leak.
 * @param {Record<string, unknown>} row
 * @param {string} columnSpec
 * @returns {Record<string, unknown>}
 */
export function pickColumns(row, columnSpec) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const col of columnSpec.split(",")) {
    const key = col.trim()
    if (key && Object.hasOwn(row, key)) {
      out[key] = row[key]
    }
  }
  return out
}

const FINANCE_MONEY_FIELDS = [
  "monthly_burn_satang", "invoiced_total_satang", "verified_paid_satang",
  "unpaid_satang", "costs_total_satang", "mrr_satang", "open_quotes_satang",
  "pipeline_satang", "pending_claims_satang",
]
const FINANCE_COUNT_FIELDS = ["unpaid_invoice_count", "open_quotes_count", "pending_claims_count"]

function requiredInteger(value) {
  if (value === null || value === undefined) throw new Error("Incomplete financial snapshot")
  return toSatang(value)
}

function normalizeFinanceSnapshot(data) {
  /** @type {Record<string, any>} */
  const result = {}
  if (typeof data.cash_balance_known !== "boolean") throw new Error("Incomplete financial snapshot")
  result.cash_balance_known = data.cash_balance_known
  result.cash_balance_satang = data.cash_balance_known ? requiredInteger(data.cash_balance_satang) : null
  for (const field of [...FINANCE_MONEY_FIELDS, ...FINANCE_COUNT_FIELDS]) {
    result[field] = requiredInteger(data[field])
  }
  return result
}

/**
 * @typedef {{ invoice_count: number, outstanding_satang: number,
 *   items: Array<{ id: string, number: string, status: string, due_date: string | null, outstanding_satang: number }>,
 *   has_more: boolean }} ReceivablesCoverage
 */

function normalizeInvoiceSnapshot(data) {
  const coverage = data.receivables_coverage
  if (!Array.isArray(data.rows) || !data.summary || !coverage ||
      !Array.isArray(coverage.items) || coverage.items.length > 16 ||
      typeof coverage.has_more !== "boolean") throw new Error("Incomplete invoice snapshot")
  /** @type {ReceivablesCoverage} */
  const normalizedCoverage = {
    invoice_count: requiredInteger(coverage.invoice_count),
    outstanding_satang: requiredInteger(coverage.outstanding_satang),
    items: coverage.items.map(row => ({
      id: row.id, number: row.number, status: row.status, due_date: row.due_date,
      outstanding_satang: requiredInteger(row.outstanding_satang),
    })),
    has_more: coverage.has_more,
  }
  return {
    rows: data.rows.map(row => ({
      ...pickColumns(row, TABLE_COLUMNS.invoices),
      effective_status: row.effective_status,
      paid_satang: requiredInteger(row.paid_satang),
      credited_satang: requiredInteger(row.credited_satang),
      outstanding_satang: requiredInteger(row.outstanding_satang),
    })),
    total: requiredInteger(data.total),
    summary: {
      issued_unpaid_count: requiredInteger(data.summary.issued_unpaid_count),
      outstanding_satang: requiredInteger(data.summary.outstanding_satang),
    },
    receivables_coverage: normalizedCoverage,
  }
}

const BANGKOK_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
})

function bangkokDay(date) {
  const parts = Object.fromEntries(BANGKOK_DAY.formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function effectiveInvoiceStatus(status, amount, dueDate, settled, today) {
  if (status === "draft" || status === "cancelled") return status
  if (amount > 0 && settled >= amount) return "paid"
  if (typeof dueDate === "string" && dueDate < today) return "overdue"
  if (settled > 0) return "partially_paid"
  return "sent"
}

function compareText(a, b) {
  const x = String(a ?? "")
  const y = String(b ?? "")
  return x < y ? -1 : x > y ? 1 : 0
}

// In-memory protocol fixture only; production aggregation lives in the SQL RPCs.
function fakeInvoiceSnapshot(invoices, balances, { status, clientId, limit, offset, asOf }) {
  const byInvoice = new Map(balances.map(row => [String(row.invoice_id), row]))
  const today = bangkokDay(asOf)
  const allRows = invoices.map(inv => {
    const balance = byInvoice.get(String(inv.id))
    const paid = BigInt(toSatang(balance?.paid_satang))
    const credited = BigInt(toSatang(balance?.credited_satang))
    const amount = BigInt(toSatang(inv.amount_satang))
    const outstanding = amount - paid - credited
    return {
      ...inv,
      effective_status: effectiveInvoiceStatus(inv.status, amount, inv.due_date, paid + credited, today),
      paid_satang: paid, credited_satang: credited,
      outstanding_satang: inv.status === "draft" || inv.status === "cancelled" || outstanding < BigInt(0) ? BigInt(0) : outstanding,
    }
  }).sort((a, b) => compareText(b.created_at, a.created_at) || compareText(a.id, b.id))
  const receivables = allRows.filter(row => row.outstanding_satang > BigInt(0))
  const rows = allRows.filter(row => (!clientId || row.client_id === clientId) && (!status || row.effective_status === status))
  return normalizeInvoiceSnapshot({
    rows: rows.slice(offset, offset + limit), total: rows.length,
    summary: {
      issued_unpaid_count: rows.filter(row => row.outstanding_satang > BigInt(0)).length,
      outstanding_satang: rows.reduce((sum, row) => sum + row.outstanding_satang, BigInt(0)),
    },
    receivables_coverage: {
      invoice_count: receivables.length,
      outstanding_satang: receivables.reduce((sum, row) => sum + row.outstanding_satang, BigInt(0)),
      items: receivables.slice(0, 16).map(row => ({
        id: row.id, number: row.number ?? "", status: row.effective_status,
        due_date: row.due_date ?? null, outstanding_satang: row.outstanding_satang,
      })),
      has_more: receivables.length > 16,
    },
  })
}

function fakeFinanceSnapshot(inputs, asOf) {
  const sum = (rows, field) => rows.reduce((total, row) => total + BigInt(toSatang(row[field])), BigInt(0))
  const issued = inputs.invoices.filter(inv => inv.status !== "draft" && inv.status !== "cancelled")
  const balances = new Map(inputs.balances.map(row => [String(row.invoice_id), row]))
  const outstanding = issued.map(inv => {
    const balance = balances.get(String(inv.id))
    const remaining = BigInt(toSatang(inv.amount_satang)) - BigInt(toSatang(balance?.paid_satang)) - BigInt(toSatang(balance?.credited_satang))
    return remaining > BigInt(0) ? remaining : BigInt(0)
  })
  const quotes = inputs.quotes.filter(q => ["draft", "sent", "accepted"].includes(q.status))
  const claims = inputs.paymentClaims.filter(c => c.status === "pending")
  const twelfths = inputs.subscriptions.filter(s => s.status === "active" && toSatang(s.amount_satang) > 0)
    .reduce((total, s) => total + BigInt(toSatang(s.amount_satang)) * BigInt(({ weekly: 52, monthly: 12, quarterly: 4, yearly: 1 })[s.interval] ?? 0), BigInt(0))
  return normalizeFinanceSnapshot({
    cash_balance_known: inputs.settings?.cash_balance_satang != null,
    cash_balance_satang: inputs.settings?.cash_balance_satang ?? null,
    monthly_burn_satang: inputs.settings?.monthly_burn_satang ?? sum(inputs.costs.filter(c => c.category !== "inventory" && String(c.incurred_on).slice(0, 7) === bangkokDay(asOf).slice(0, 7)), "amount_satang"),
    invoiced_total_satang: issued.reduce((total, inv) => total + BigInt(toSatang(inv.total_satang ?? inv.amount_satang)), BigInt(0)) - sum(inputs.credits, "total_satang"),
    verified_paid_satang: sum(inputs.payments.filter(p => p.verification_state === "verified"), "amount_satang"),
    unpaid_satang: outstanding.reduce((total, value) => total + value, BigInt(0)),
    unpaid_invoice_count: outstanding.filter(value => value > BigInt(0)).length,
    costs_total_satang: sum(inputs.costs, "amount_satang"),
    mrr_satang: (twelfths + BigInt(6)) / BigInt(12),
    open_quotes_count: quotes.length, open_quotes_satang: sum(quotes, "total_satang"),
    pipeline_satang: sum(inputs.deals.filter(d => d.stage !== "won" && d.stage !== "lost"), "value_satang"),
    pending_claims_count: claims.length, pending_claims_satang: sum(claims, "amount_satang"),
  })
}

/**
 * Create a read-only Supabase data layer. Uses `.select(explicitColumns)` and `.eq("org_id", orgId)` on every tenant query.
 * @param {object} supabase
 * @param {import("./reader-data.mjs").BusinessReaderOptions} [readerOptions]
 */
export function createSupabaseDataLayer(supabase, readerOptions = {}) {
  /**
   * @param {keyof typeof TABLE_COLUMNS} table
   * @param {string} orgId
   * @param {{ filters?: Record<string, string>, limit?: number, offset?: number, orderBy?: string }} [opts]
   */
  async function selectOrgScoped(table, orgId, opts = {}) {
    if (!orgId || typeof orgId !== "string") {
      throw new Error("org_id is required")
    }
    const columns = TABLE_COLUMNS[table]
    let query = supabase
      .from(table)
      .select(columns, { count: "exact" })
      .eq("org_id", orgId)

    if (opts.filters) {
      for (const [col, val] of Object.entries(opts.filters)) {
        if (val !== undefined && val !== null && val !== "") {
          query = query.eq(col, val)
        }
      }
    }
    if (opts.orderBy) {
      query = query.order(opts.orderBy, { ascending: false })
      // Rows inserted in one transaction share created_at; a unique tie-breaker keeps pages stable.
      if (opts.orderBy === "created_at") query = query.order("id", { ascending: true })
    }
    if (typeof opts.limit === "number" && typeof opts.offset === "number") {
      query = query.range(opts.offset, opts.offset + opts.limit - 1)
    }

    const { data, error, count } = await query
    if (error) {
      throw new Error(`Database query failed on ${table}: ${error.message}`)
    }
    const rows = (data ?? []).map((row) => pickColumns(row, columns))
    return { rows, total: typeof count === "number" ? count : rows.length }
  }

  /** Each RPC is one STABLE SQL statement using the session actor's RLS. */
  async function snapshot(name, orgId, args) {
    if (!orgId || typeof orgId !== "string") throw new Error("org_id is required")
    const { data, error } = await supabase.rpc(name, { p_org_id: orgId, ...args })
    if (error) throw new Error(`Database snapshot failed: ${error.message}`)
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Financial snapshot unavailable for this workspace")
    }
    return data
  }

  return {
    ...createBusinessReaderData(supabase, readerOptions),
    async listOrganizations({ id, limit, offset } = {}) {
      const columns = TABLE_COLUMNS.organizations
      let query = supabase
        .from("organizations")
        .select(columns, { count: "exact" })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
      if (id) query = query.eq("id", id)
      if (typeof limit === "number" && typeof offset === "number") {
        query = query.range(offset, offset + limit - 1)
      }
      const { data, error, count } = await query
      if (error) {
        throw new Error(`Database query failed on organizations: ${error.message}`)
      }
      const rows = (data ?? []).map((row) => pickColumns(row, columns))
      return { rows, total: typeof count === "number" ? count : rows.length }
    },

    async listClients(orgId, opts) {
      return selectOrgScoped("clients", orgId, { orderBy: "created_at", ...opts })
    },

    async listDeals(orgId, opts) {
      return selectOrgScoped("deals", orgId, { orderBy: "created_at", ...opts })
    },

    async listQuotes(orgId, opts) {
      return selectOrgScoped("quotes", orgId, { orderBy: "created_at", ...opts })
    },

    async listProjects(orgId, opts) {
      return selectOrgScoped("projects", orgId, { orderBy: "created_at", ...opts })
    },

    async listPaymentClaims(orgId, opts) {
      return selectOrgScoped("payment_claims", orgId, { orderBy: "created_at", ...opts })
    },

    /**
     * @param {string} orgId
     * @param {{ status?: string, clientId?: string, limit: number, offset: number, asOf: Date }} options
     */
    async getInvoiceSnapshot(orgId, { status, clientId, limit, offset, asOf }) {
      return normalizeInvoiceSnapshot(await snapshot("assistant_invoice_snapshot", orgId, {
        p_status: status || null, p_client_id: clientId || null,
        p_limit: limit, p_offset: offset, p_as_of: asOf.toISOString(),
      }))
    },

    async getFinanceSnapshot(orgId, { asOf }) {
      return normalizeFinanceSnapshot(await snapshot("assistant_finance_snapshot", orgId, {
        p_as_of: asOf.toISOString(),
      }))
    },
  }
}

/**
 * Create an in-memory fake data layer for testing protocol, org scoping, and privacy rules.
 * @param {{
 *   organizations?: Array<Record<string, unknown>>,
 *   clients?: Array<Record<string, unknown>>,
 *   deals?: Array<Record<string, unknown>>,
 *   quotes?: Array<Record<string, unknown>>,
 *   projects?: Array<Record<string, unknown>>,
 *   invoices?: Array<Record<string, unknown>>,
 *   payment_claims?: Array<Record<string, unknown>>,
 *   org_settings?: Array<Record<string, unknown>>,
 *   payments?: Array<Record<string, unknown>>,
 *   invoice_balances?: Array<Record<string, unknown>>,
 *   credit_note_revenue?: Array<Record<string, unknown>>,
 *   costs?: Array<Record<string, unknown>>,
 *   subscriptions?: Array<Record<string, unknown>>,
 * }} [store]
 */
export function createFakeDataLayer(store = {}) {
  /** @type {Array<{ table: string, orgId: string | null, filters?: Record<string, string>, operation: "select" }>} */
  const queries = []

  /**
   * @param {keyof typeof TABLE_COLUMNS} table
   * @param {string} orgId
   * @param {{ filters?: Record<string, string>, limit?: number, offset?: number }} [opts]
   */
  function queryScoped(table, orgId, opts = {}) {
    if (!orgId || typeof orgId !== "string") {
      throw new Error("org_id is required")
    }
    queries.push({ table, orgId, filters: opts.filters, operation: "select" })
    const source = Array.isArray(store[table]) ? store[table] : table === "invoice_balances" ? (store.invoices ?? []).map(invoice => {
      const paid = (store.payments ?? []).filter(p => p.org_id === invoice.org_id && p.invoice_id === invoice.id && p.verification_state === "verified").reduce((sum, p) => sum + Number(p.amount_satang), 0)
      return { org_id: invoice.org_id, invoice_id: invoice.id, paid_satang: paid, credited_satang: 0, outstanding_satang: Math.max(0, Number(invoice.amount_satang) - paid) }
    }) : []
    const columns = TABLE_COLUMNS[table]
    const matched = source
      .filter((row) => row.org_id === orgId)
      .filter((row) => {
        if (!opts.filters) return true
        return Object.entries(opts.filters).every(
          ([k, v]) => v === undefined || v === "" || row[k] === v
        )
      })
      .map((row) => pickColumns(row, columns))
    const total = matched.length
    const offset = opts.offset ?? 0
    const limit = opts.limit ?? total
    const rows = matched.slice(offset, offset + limit)
    return { rows, total }
  }

  return {
    queries,

    async listOrganizations({ id, limit, offset } = {}) {
      queries.push({ table: "organizations", orgId: null, operation: "select" })
      const source = Array.isArray(store.organizations) ? store.organizations : []
      const columns = TABLE_COLUMNS.organizations
      const matched = source
        .filter((row) => !id || row.id === id)
        .map((row) => pickColumns(row, columns))
      const total = matched.length
      const start = offset ?? 0
      const count = limit ?? total
      return { rows: matched.slice(start, start + count), total }
    },

    async listClients(orgId, opts) {
      return queryScoped("clients", orgId, opts)
    },

    async listDeals(orgId, opts) {
      return queryScoped("deals", orgId, opts)
    },

    async listQuotes(orgId, opts) {
      return queryScoped("quotes", orgId, opts)
    },

    async listProjects(orgId, opts) {
      return queryScoped("projects", orgId, opts)
    },

    async listPaymentClaims(orgId, opts) {
      return queryScoped("payment_claims", orgId, opts)
    },

    async getInvoiceSnapshot(orgId, options) {
      return fakeInvoiceSnapshot(
        queryScoped("invoices", orgId).rows,
        queryScoped("invoice_balances", orgId).rows,
        options,
      )
    },

    async getFinanceSnapshot(orgId, { asOf }) {
      const settingsRes = queryScoped("org_settings", orgId)
      const invoicesRes = queryScoped("invoices", orgId)
      const paymentsRes = queryScoped("payments", orgId)
      const costsRes = queryScoped("costs", orgId)
      const subscriptionsRes = queryScoped("subscriptions", orgId)
      const quotesRes = queryScoped("quotes", orgId)
      const dealsRes = queryScoped("deals", orgId)
      const claimsRes = queryScoped("payment_claims", orgId)
      return fakeFinanceSnapshot({
        settings: settingsRes.rows[0] ?? null,
        invoices: invoicesRes.rows,
        payments: paymentsRes.rows,
        costs: costsRes.rows,
        subscriptions: subscriptionsRes.rows,
        quotes: quotesRes.rows,
        deals: dealsRes.rows,
        paymentClaims: claimsRes.rows,
        balances: queryScoped("invoice_balances", orgId).rows,
        credits: queryScoped("credit_note_revenue", orgId).rows,
      }, asOf)
    },
  }
}
