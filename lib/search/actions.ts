"use server"

import { z } from "zod"

import { requireOrgContext, type OrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { deriveInvoiceStatus, outstandingSatang } from "@/lib/metrics/invoice-status"
import { can } from "@/lib/permissions"
import { recordHref } from "@/lib/record-history/model"
import { DEAL_FLOW, INVOICE_FLOW, PROJECT_FLOW, QUOTE_FLOW, SUBSCRIPTION_FLOW } from "@/lib/record/status"
import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/lib/types/database"
import { updateDealStage } from "@/app/(app)/deals/actions"
import { setSubscriptionStatus } from "@/app/(app)/finance/subscription-actions"
import { updateProjectStatus } from "@/app/(app)/projects/actions"
import { setQuoteStatus } from "@/app/(app)/quotes/actions"

import { searchQueries, type SearchType } from "./query"
import { paletteActions, recordFromPath, type PaletteAction, type StatusRecordRef } from "./record-actions"

export type SearchHit = { type: SearchType; id: string; title: string; detail: string | null; href: string }

/** Up to five matches per record type in the caller's org, by name or number. */
export async function searchRecords(raw: string): Promise<{ hits: SearchHit[]; error?: string }> {
  const queries = searchQueries(raw)
  if (!queries.length) return { hits: [] }
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  // The client debounce is advisory; this per-user budget bounds the fan-out below for direct callers.
  const { data: allowed, error: slotError } = await supabase.rpc("take_search_slot")
  if (slotError) throw new Error(slotError.message)
  if (!allowed) return { hits: [], error: "Too many searches. Wait a minute and try again." }
  const results = await Promise.all(
    queries.map(async ({ type, table, columns, filter, limit }) => {
      const { data, error } = await supabase
        .from(table)
        .select(`id, ${columns.join(", ")}`)
        .eq("org_id", ctx.orgId)
        .or(filter)
        .order(columns[0])
        .limit(limit)
      if (error) throw new Error(error.message)
      return (data as unknown as Record<string, string | null>[]).map((row) => ({
        type,
        id: row.id!,
        title: row[columns[0]] ?? "",
        detail: columns[1] ? row[columns[1]] : null,
        href: type === "product" ? `/products/${row.id}` : recordHref(type, row.id!),
      }))
    })
  )
  return { hits: results.flat() }
}

type RecordContext = { actions: PaletteAction[]; transition?: (to: string) => Promise<{ error?: string }> }

/** What the record's StatusBar offers this user; each case mirrors the props its detail page passes. */
async function recordContext(ctx: OrgContext, { type, id }: StatusRecordRef): Promise<RecordContext | null> {
  const supabase = await createClient()
  switch (type) {
    case "quote": {
      const { data } = await supabase
        .from("quotes")
        .select("status")
        .eq("org_id", ctx.orgId)
        .eq("id", id)
        .maybeSingle()
      if (!data) return null
      const canConvert = can(ctx.role, "quote:convert")
      const flow = { ...QUOTE_FLOW, next: { ...QUOTE_FLOW.next,
        sent: { ...QUOTE_FLOW.next.sent, primary: canConvert ? QUOTE_FLOW.next.sent.primary : undefined },
        accepted: { primary: { label: "Create draft invoice", command: "convert" as const } },
        converted: { primary: { label: "Create draft invoice", command: "convert" as const } },
      } }
      return {
        actions: paletteActions(flow, data.status, can(ctx.role, "record:write"), canConvert ? { convert: true } : {}),
        transition: (to) => setQuoteStatus({ id, status: to as Parameters<typeof setQuoteStatus>[0]["status"] }),
      }
    }
    case "deal": {
      const [{ data }, { count: projects }] = await Promise.all([
        supabase.from("deals").select("stage, client_id").eq("org_id", ctx.orgId).eq("id", id).maybeSingle(),
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("deal_id", id),
      ])
      if (!data) return null
      const createProject = `/projects/new?dealId=${id}&clientId=${data.client_id}`
      return {
        actions: paletteActions(DEAL_FLOW, data.stage, true, projects ? {} : { create_project: createProject }),
        transition: (to) => updateDealStage(id, to),
      }
    }
    case "project": {
      const { data } = await supabase.from("projects").select("status").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
      if (!data) return null
      return {
        actions: paletteActions(PROJECT_FLOW, data.status, true, {}),
        transition: (to) => updateProjectStatus({ id, status: to as Enums<"project_status"> }),
      }
    }
    case "subscription": {
      const { data } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("org_id", ctx.orgId)
        .eq("id", id)
        .maybeSingle()
      if (!data) return null
      const canManage = can(ctx.role, "subscription:manage")
      return {
        actions: paletteActions(SUBSCRIPTION_FLOW, data.status, canManage, {}),
        transition: canManage
          ? (to) => setSubscriptionStatus({ id, status: to as Enums<"subscription_status"> })
          : undefined,
      }
    }
    case "invoice": {
      const [{ data }, balance] = await Promise.all([
        supabase.from("invoices").select("status, amount_satang, due_date").eq("org_id", ctx.orgId).eq("id", id).maybeSingle(),
        supabase.from("invoice_balances").select("paid_satang, credited_satang").eq("org_id", ctx.orgId).eq("invoice_id", id).maybeSingle(),
      ])
      if (!data || balance.error) return null
      const paid = balance.data?.paid_satang ?? 0
      const credited = balance.data?.credited_satang ?? 0
      const href = recordHref("invoice", id)
      const payable = outstandingSatang(data.amount_satang, paid, credited) > 0 && !["draft", "cancelled"].includes(data.status)
      const commands =
        can(ctx.role, "payment:verify")
          ? { issue: `${href}#issue-invoice`, ...(payable ? { pay: `${href}#payment-claims` } : {}) }
          : {}
      return { actions: paletteActions(INVOICE_FLOW, deriveInvoiceStatus({ ...data, credited_satang: credited }, paid, todayISO()), false, commands) }
    }
  }
}

const Pathname = z.string().max(200)

/** The StatusBar actions for the record whose detail page is `pathname`; none on other pages. */
export async function recordActions(pathname: string): Promise<PaletteAction[]> {
  const parsed = Pathname.safeParse(pathname)
  const ref = parsed.success ? recordFromPath(parsed.data) : null
  if (!ref) return []
  const ctx = await requireOrgContext()
  return (await recordContext(ctx, ref))?.actions ?? []
}

const RunRecordAction = z.object({ pathname: Pathname, to: z.string().max(40) })

/** Runs a status change only if the record's StatusBar offers it right now. */
export async function runRecordAction(input: z.input<typeof RunRecordAction>): Promise<{ error?: string }> {
  const parsed = RunRecordAction.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const { pathname, to } = parsed.data
  const ref = recordFromPath(pathname)
  const ctx = await requireOrgContext()
  const record = ref ? await recordContext(ctx, ref) : null
  if (!record?.transition || !record.actions.some((a) => "to" in a && a.to === to)) {
    return { error: "This action is no longer available. Reload the page and try again." }
  }
  return record.transition(to)
}
