"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { bankAmountSatang } from "@/lib/finance/bank-match"

const AddLine = z.object({
  bookedOn: z.iso.date(),
  amount: z.string().trim().min(1).max(20),
  reference: z.string().trim().min(1).max(200),
})

export async function addBankLine(input: z.input<typeof AddLine>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can add a bank line." } }
  const parsed = AddLine.safeParse(input)
  if (!parsed.success) return { error: "Enter a date, a non-zero amount, and a reference." }
  let amount: number
  try { amount = bankAmountSatang(parsed.data.amount) }
  catch (error) { return { error: error instanceof Error ? error.message : "Invalid amount" } }
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_bank_line", { p_org_id: ctx.orgId, p_booked_on: parsed.data.bookedOn, p_amount_satang: amount, p_reference: parsed.data.reference })
  if (error) return { error: error.message }
  revalidatePath("/finance/bank")
  revalidatePath("/finance/cash")
  return {}
}

const MatchLine = z.object({ lineId: z.guid(), paymentId: z.guid() })

export async function matchBankLine(input: z.input<typeof MatchLine>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can match a bank line." } }
  const parsed = MatchLine.safeParse(input)
  if (!parsed.success) return { error: "Choose a bank line and a receipt." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("match_bank_line", { p_org_id: ctx.orgId, p_line_id: parsed.data.lineId, p_payment_id: parsed.data.paymentId })
  if (error) return { error: error.message }
  revalidatePath("/finance/bank")
  revalidatePath("/finance/cash")
  return {}
}

const NoteLine = z.object({
  lineId: z.guid(),
  note: z.string().trim().max(200),
})

export async function noteBankLine(input: z.input<typeof NoteLine>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners, admins, and accountants can note a bank line." } }
  const parsed = NoteLine.safeParse(input)
  if (!parsed.success) return { error: "Choose a bank line. Keep the note to 200 characters." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("note_bank_line", { p_org_id: ctx.orgId, p_line_id: parsed.data.lineId, p_note: parsed.data.note })
  if (error) return { error: error.message }
  revalidatePath("/finance/bank")
  revalidatePath("/finance/cash")
  return {}
}
