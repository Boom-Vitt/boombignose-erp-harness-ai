import { formatTHB, pickColumns, TABLE_COLUMNS, toSatang } from "./data.mjs"
import { ERP_DATA_TOOLS, ERP_DATA_TOOL_NAMES, runErpDataTool } from "./reader.mjs"

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100

const PAGINATION_PROPERTIES = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `Maximum number of items to return (1..${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
  },
  offset: {
    type: "integer",
    minimum: 0,
    description: "Zero-based item offset for pagination (default 0).",
  },
}

const ORG_ID_PROPERTY = {
  org_id: {
    type: "string",
    description:
      "Workspace (organization) UUID. Optional only when a single workspace exists or ERP_ORG_ID is set.",
  },
}

export const TOOLS = Object.freeze([
  ...ERP_DATA_TOOLS,
  {
    name: "list_workspaces",
    description:
      "List ERP workspaces (organizations) with their id, name, and slug.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_clients",
    description:
      "List clients in an ERP workspace (business fields only; excludes contact emails, phones, addresses, tax IDs, and notes).",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_deals",
    description:
      "List CRM deals in an ERP workspace with stage, satang value, THB string, and dates.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        stage: {
          type: "string",
          enum: [
            "lead",
            "contacted",
            "discovery",
            "proposal",
            "negotiation",
            "won",
            "lost",
          ],
          description: "Optional deal stage filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_quotes",
    description:
      "List quotations in an ERP workspace with status, satang amounts, and THB strings.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["draft", "sent", "accepted", "declined", "expired", "converted"],
          description: "Optional quote status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    description:
      "List delivery projects in an ERP workspace with status, deadline, budget in satang, and THB string.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: [
            "not_started",
            "in_progress",
            "review",
            "delivered",
            "support",
            "paused",
            "cancelled",
          ],
          description: "Optional project status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_invoices",
    description:
      "Read invoices plus receivables_coverage: complete workspace issued-unpaid count/total and bounded records (has_more). For an overall unpaid/collection overview, call once without status/client filters; reuse that coverage instead of separate status reads or finance_summary. Use additional filters only for requested details missing from the bounded result. paid_satang is verified receipts; credited_satang is credits, not cash.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],
          description: "Optional invoice status filter. partially_paid includes settlement by credits; cash receipts are reported separately in paid_satang.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_payment_claims",
    description:
      "List customer and staff payment claims in an ERP workspace (status and amount only; excludes bank references and payment evidence).",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["pending", "verified", "rejected"],
          description: "Optional payment claim status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        invoice_id: {
          type: "string",
          description: "Optional invoice UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "finance_summary",
    description:
      "Read the broader financial dashboard snapshot in satang and THB. For invoice-only collection/unpaid questions, use list_invoices instead; its receivables_coverage already provides the overall position.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
      },
      additionalProperties: false,
    },
  },
])

/**
 * Parse and clamp pagination parameters.
 * @param {Record<string, unknown>} args
 * @returns {{ limit: number, offset: number }}
 */
export function parsePagination(args = {}) {
  let limit = DEFAULT_LIMIT
  if (args.limit !== undefined && args.limit !== null) {
    const n = Number(args.limit)
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("limit must be a positive integer")
    }
    limit = Math.min(n, MAX_LIMIT)
  }
  let offset = 0
  if (args.offset !== undefined && args.offset !== null) {
    const n = Number(args.offset)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("offset must be a non-negative integer")
    }
    offset = n
  }
  return { limit, offset }
}

const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve and validate the target organization ID.
 * Required unless `ERP_ORG_ID` is set or the database has exactly one organization.
 * Rejects any unknown organization ID.
 * @param {Record<string, unknown>} args
 * @param {any} dataLayer
 * @param {{ erpOrgId?: string }} [options]
 * @returns {Promise<{ id: string, name: string, slug: string }>}
 */
export async function resolveOrg(args, dataLayer, options = {}) {
  const requestedOrgId =
    typeof args?.org_id === "string" && args.org_id.trim() !== ""
      ? args.org_id.trim()
      : typeof options.erpOrgId === "string" && options.erpOrgId.trim() !== ""
        ? options.erpOrgId.trim()
        : null

  if (requestedOrgId) {
    // Look the id up directly: a list page is capped, and a non-uuid would be a DB error.
    const found = ORG_ID_RE.test(requestedOrgId)
      ? (await dataLayer.listOrganizations({ id: requestedOrgId, limit: 1, offset: 0 }))
          .rows[0]
      : undefined
    if (!found) {
      throw new Error(`Unknown organization: ${requestedOrgId}`)
    }
    return {
      id: String(found.id),
      name: String(found.name ?? ""),
      slug: String(found.slug ?? ""),
    }
  }

  const { rows, total } = await dataLayer.listOrganizations({ limit: 1, offset: 0 })
  if (total === 1) {
    const sole = rows[0]
    return {
      id: String(sole.id),
      name: String(sole.name ?? ""),
      slug: String(sole.slug ?? ""),
    }
  }

  if (total === 0) {
    throw new Error("No organizations found in ERP")
  }

  throw new Error(
    "org_id is required when multiple organizations exist and ERP_ORG_ID is not set"
  )
}


/**
 * Wrap a satang amount with its formatted THB string.
 * @param {unknown} rawSatang
 * @returns {{ satang: number, thb: string }}
 */
function moneyPair(rawSatang) {
  const satang = toSatang(rawSatang)
  return { satang, thb: formatTHB(satang) ?? "฿0.00" }
}


/**
 * Format a paginated response envelope.
 * @param {string | null} orgId
 * @param {Array<Record<string, unknown>>} items
 * @param {number} total
 * @param {{ limit: number, offset: number }} page
 */
function paginatedEnvelope(orgId, items, total, { limit, offset }) {
  return {
    ...(orgId ? { org_id: orgId } : {}),
    items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  }
}

/**
 * Execute an allowlisted read-only ERP tool against the provided data layer.
 * @param {string} name
 * @param {Record<string, unknown>} rawArgs
 * @param {{ dataLayer: object, erpOrgId?: string, now?: Date, trustedCapabilities?: readonly string[] }} ctx
 */
export async function runTool(name, rawArgs, ctx) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {}
  const { dataLayer, erpOrgId, now } = ctx
  if (ERP_DATA_TOOL_NAMES.includes(name)) return runErpDataTool(name, args, ctx)

  if (name === "list_workspaces") {
    const page = parsePagination(args)
    const { rows, total } = await dataLayer.listOrganizations(page)
    const items = rows.map((row) => pickColumns(row, TABLE_COLUMNS.organizations))
    return paginatedEnvelope(null, items, total, page)
  }

  const org = await resolveOrg(args, dataLayer, { erpOrgId })
  const orgId = org.id

  switch (name) {
    case "list_clients": {
      const page = parsePagination(args)
      const { rows, total } = await dataLayer.listClients(orgId, page)
      const items = rows.map((row) => pickColumns(row, TABLE_COLUMNS.clients))
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_deals": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.stage === "string" && args.stage) filters.stage = args.stage
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listDeals(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.deals)
        const value = moneyPair(clean.value_satang)
        return {
          ...clean,
          value_satang: value.satang,
          value_thb: value.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_quotes": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listQuotes(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.quotes)
        const subtotal = moneyPair(clean.subtotal_satang)
        const discount = moneyPair(clean.discount_satang)
        const totalMoney = moneyPair(clean.total_satang)
        return {
          ...clean,
          subtotal_satang: subtotal.satang,
          subtotal_thb: subtotal.thb,
          discount_satang: discount.satang,
          discount_thb: discount.thb,
          total_satang: totalMoney.satang,
          total_thb: totalMoney.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_projects": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listProjects(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.projects)
        const hasBudget =
          clean.budget_satang !== null && clean.budget_satang !== undefined
        const budgetSatang = hasBudget ? toSatang(clean.budget_satang) : null
        return {
          ...clean,
          budget_satang: budgetSatang,
          budget_thb: budgetSatang !== null ? formatTHB(budgetSatang) : null,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_invoices": {
      const page = parsePagination(args)
      const wantedStatus = typeof args.status === "string" ? args.status : ""
      const clientId = typeof args.client_id === "string" ? args.client_id : ""

      const { rows, total, summary, receivables_coverage } = await dataLayer.getInvoiceSnapshot(orgId, {
        status: wantedStatus, clientId, ...page, asOf: now ?? new Date(),
      })
      const items = rows.map((row) => {
        const inv = pickColumns(row, TABLE_COLUMNS.invoices)
        const amount = moneyPair(inv.amount_satang)
        const discount = moneyPair(inv.discount_satang)
        const paid = moneyPair(row.paid_satang)
        const outstanding = moneyPair(row.outstanding_satang)
        return {
          ...inv,
          status: row.effective_status,
          stored_status: inv.status,
          amount_satang: amount.satang,
          amount_thb: amount.thb,
          discount_satang: discount.satang,
          discount_thb: discount.thb,
          credited_satang: row.credited_satang,
          credited_thb: formatTHB(row.credited_satang),
          paid_satang: paid.satang,
          paid_thb: paid.thb,
          outstanding_satang: outstanding.satang,
          outstanding_thb: outstanding.thb,
        }
      })
      const outstanding = moneyPair(summary.outstanding_satang)
      return {
        ...paginatedEnvelope(orgId, items, total, page),
        receivables_coverage,
        summary: {
          scope: "all_matching_records",
          status_filter: wantedStatus || null,
          issued_unpaid_count: summary.issued_unpaid_count,
          outstanding_satang: outstanding.satang,
          outstanding_thb: outstanding.thb,
        },
      }
    }

    case "list_payment_claims": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id
      if (typeof args.invoice_id === "string" && args.invoice_id)
        filters.invoice_id = args.invoice_id

      const { rows, total } = await dataLayer.listPaymentClaims(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.payment_claims)
        const amount = moneyPair(clean.amount_satang)
        return {
          ...clean,
          amount_satang: amount.satang,
          amount_thb: amount.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "finance_summary": {
      const snapshot = await dataLayer.getFinanceSnapshot(orgId, { asOf: now ?? new Date() })
      /** @type {Record<string, any>} */
      const result = { org_id: orgId, ...snapshot }
      for (const [field, value] of Object.entries(snapshot)) {
        if (field.endsWith("_satang")) {
          result[field.replace(/_satang$/, "_thb")] = value === null ? null : formatTHB(value)
        }
      }
      return result
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
