/**
 * Pure prompt builders for AI assists. Each returns `{ system, prompt }`.
 * NO I/O, NO server-only imports, NO SDK — safe to unit-test in node with no
 * API key and no network. The model id lives in `lib/ai/client.ts`, never here.
 */
import type { CloseOpenItems } from "@/lib/finance/close-summary"
import { formatTHB } from "@/lib/money"

export type PromptParts = { system: string; prompt: string }

export type ActivityLike = {
  type: string
  body: string | null
  due_date?: string | null
  done?: boolean | null
}

export type Tone = "friendly" | "formal" | "brief"

/** Render a list of activities as compact lines, or a clear placeholder when
 * there are none, so the model is never handed a dangling "Activities:" label. */
function renderActivities(activities: ActivityLike[]): string {
  if (!activities || activities.length === 0) {
    return "(no activities logged yet)"
  }
  return activities
    .map((a) => {
      const parts: string[] = [`- [${a.type}]`]
      if (a.due_date) parts.push(`(due ${a.due_date})`)
      if (a.done) parts.push("(done)")
      const body = (a.body ?? "").trim()
      parts.push(body === "" ? "—" : body)
      return parts.join(" ")
    })
    .join("\n")
}

const THAI_OUTPUT =
  "Write the output in the same language the notes/context use. If the context " +
  "is Thai, respond in natural, polite Thai (สุภาพ) suitable for Thai SME business."

// ---------------------------------------------------------------------------
// Deal summary
// ---------------------------------------------------------------------------

export function dealSummaryPrompt(input: {
  title: string
  stage: string
  valueBaht: number
  client: string | null
  activities: ActivityLike[]
}): PromptParts {
  const { title, stage, valueBaht, client, activities } = input

  const system =
    "You are a concise sales assistant for a Thai SME. Summarize the state of a " +
    "sales deal for a busy founder: where it stands, momentum, risks, and the " +
    "single most useful next step. Keep it under ~120 words. Be factual — do not " +
    "invent details not present in the context. " +
    THAI_OUTPUT

  const prompt = [
    "Summarize this deal.",
    "",
    `Deal title: ${title}`,
    `Client: ${client ?? "(unknown)"}`,
    `Stage: ${stage}`,
    `Value (THB): ${valueBaht.toLocaleString("en-US")}`,
    "",
    "Recent activities:",
    renderActivities(activities),
  ].join("\n")

  return { system, prompt }
}

// ---------------------------------------------------------------------------
// Follow-up draft
// ---------------------------------------------------------------------------

const TONE_INSTRUCTION: Record<Tone, string> = {
  friendly: "Use a warm, friendly, approachable tone.",
  formal: "Use a professional, formal tone.",
  brief: "Use a very brief, to-the-point tone — a few short sentences only.",
}

export function followupDraftPrompt(input: {
  title: string
  client: string | null
  activities: ActivityLike[]
  tone?: Tone
}): PromptParts {
  const { title, client, activities } = input
  const tone: Tone = input.tone ?? "friendly"

  const system =
    "You are a sales assistant for a Thai SME. Draft a short follow-up message " +
    "the founder can send to move this deal forward. " +
    `${TONE_INSTRUCTION[tone]} ` +
    "Reference the most recent context, propose a clear next step, and keep it " +
    "ready to send (no placeholders like [name] unless the name is unknown). " +
    THAI_OUTPUT

  const prompt = [
    `Draft a follow-up message for the deal "${title}".`,
    `Client: ${client ?? "(unknown)"}`,
    `Desired tone: ${tone}`,
    "",
    "Recent activities (most recent first):",
    renderActivities(activities),
  ].join("\n")

  return { system, prompt }
}

// ---------------------------------------------------------------------------
// Meeting intake
// ---------------------------------------------------------------------------

export function meetingIntakePrompt(rawNotes: string): PromptParts {
  const system =
    "You are an assistant that turns raw meeting notes into a clean, actionable " +
    "record for a Thai SME. Respond with exactly two parts:\n" +
    "1) A short summary (2–4 sentences).\n" +
    "2) A line 'Action items:' followed by a bulleted list (one '- ' per line) " +
    "of concrete next steps. If there are no action items, write '- (none)'.\n" +
    "Do not add other sections. " +
    THAI_OUTPUT

  const notes = rawNotes.trim()
  const prompt = [
    "Summarize the following meeting notes and extract action items.",
    "",
    "Meeting notes:",
    notes === "" ? "(no notes provided)" : notes,
  ].join("\n")

  return { system, prompt }
}

/** Month-end note from workspace counts. The model must not invent a filing. */
export function closeSummaryPrompt(counts: CloseOpenItems): PromptParts {
  const bank = counts.unmatchedBankCount === null
    ? "Unmatched bank lines: not available"
    : `Unmatched bank lines: ${counts.unmatchedBankCount}`
  const system =
    "You are a bookkeeping assistant for a Thai SME. Write a short month-end note " +
    "from the counts you are given. Start in polite Thai, then one English sentence. " +
    "Use only those figures. Do not invent invoices, journals, VAT filings, or e-Tax " +
    "steps. Keep it under 120 words. This is operational finance, not a statutory close."
  const prompt = [
    `As of ${counts.asOf}.`,
    `Overdue receivables: ${counts.overdueReceivableCount} (${formatTHB(counts.overdueReceivableSatang)}).`,
    `Unpaid vendor bills: ${counts.unpaidBillCount} (${formatTHB(counts.unpaidBillSatang)}).`,
    `${bank}.`,
    "Tell the owner what to clear before they treat the month as ready. Do not tell them to file a tax return.",
  ].join("\n")
  return { system, prompt }
}
