"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireOrgContext } from "@/lib/auth"
import { accountantPackMonth } from "@/lib/finance/accountant-pack"
import { createClient } from "@/lib/supabase/server"

/** Record withholding deducted on one cost. The database checks role, lock date, rate and numbering. */
export async function recordPurchaseWithholding(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext()
  const text = (key: string) => String(formData.get(key) ?? "")
  const month = accountantPackMonth(text("month"))?.month ?? ""
  const back = (query: string) => redirect(`/reports/wht?month=${month}${query}`)
  const { error } = await (await createClient()).rpc("record_purchase_withholding", {
    p_org_id: ctx.orgId,
    p_cost_id: text("cost_id"),
    p_paid_on: text("paid_on"),
    p_form: text("form"),
    p_income_type: text("income_type"),
    p_rate_bps: Number(text("rate_bps")),
  })
  if (error) back(`&error=${encodeURIComponent(error.message.slice(0, 160))}`)
  revalidatePath("/reports/wht")
  back("&saved=1")
}
