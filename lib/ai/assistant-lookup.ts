import { z } from "zod"

type ToolFunction = { name: string; description: string; parameters: Record<string, unknown> }
const operation = z.object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()) }).strict()
const decision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), operations: z.array(operation).min(1).max(4) }).strict(),
  z.object({ kind: z.literal("complete") }).strict(),
  z.object({ kind: z.literal("unavailable"), capability: z.string().min(1), language: z.enum(["th", "en"]) }).strict(),
])

export const LOOKUP_POLICY =
  "Plan authorized reads before answering. Return exactly one JSON lookup decision, without Markdown or native tool-call markup. " +
  "For a current ERP-record question, including a follow-up, choose read operations from the authorized ERP tools. Historical replies are not current evidence. Use erp_data_catalog for domain/field discovery, then erp_data_read/erp_data_text for actual records; listing a catalog is not a business-record read. " +
  "For local documents or chat exports use search_local_documents to locate relevant original text, then read_local_document to materialize citable ranges. Listing/searching alone is not citable evidence. Long sources are readable in bounded ranges, not unavailable merely because they are long. " +
  "Choose complete only after successful reads in THIS turn supply the requested evidence. ERP access requires current business-record reads; document-only access requires actual document reads. The schema excludes complete until the required source evidence exists. Reuse current invoice coverage instead of repeating status reads. " +
  "There is no cached-answer/guidance shortcut. If the exact needed capability is server-listed unavailable, choose unavailable with that capability and the user's language; never substitute unrelated invoices for restricted profit data. " +
  "Do not answer during lookup, invent data or automatically retry a failed operation. The application executes only authorized read operations."

/** Native Ollama has no required-tool selector; make the read/finish state explicit instead. */
export function lookupFormat(specs: ReadonlyArray<Record<string, unknown>>, hasCurrentEvidence: boolean, unavailable: readonly string[] = []) {
  const functions = specs.map(spec => spec.function as ToolFunction)
  const choices: Record<string, unknown>[] = []
  if (functions.length) choices.push({
    type: "object",
    properties: {
      kind: { type: "string", const: "read" },
      operations: {
        type: "array", minItems: 1, maxItems: 4,
        items: { oneOf: functions.map(fn => ({
          type: "object",
          properties: { name: { type: "string", const: fn.name, description: fn.description }, arguments: fn.parameters },
          required: ["name", "arguments"], additionalProperties: false,
        })) },
      },
    },
    required: ["kind", "operations"], additionalProperties: false,
  })
  if (unavailable.length) choices.push({
    type: "object",
    properties: { kind: { type: "string", const: "unavailable" }, capability: { type: "string", enum: unavailable }, language: { type: "string", enum: ["th", "en"] } },
    required: ["kind", "capability", "language"], additionalProperties: false,
  })
  if (hasCurrentEvidence) choices.push({ type: "object", properties: { kind: { type: "string", const: "complete" } }, required: ["kind"], additionalProperties: false })
  return { oneOf: choices }
}

export function parseLookup(text: string, specs: ReadonlyArray<Record<string, unknown>>, hasCurrentEvidence: boolean, unavailable: readonly string[] = []): z.infer<typeof decision> | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  const parsed = decision.safeParse(value)
  if (!parsed.success) return null
  if (parsed.data.kind === "complete" && !hasCurrentEvidence) return null
  if (parsed.data.kind === "unavailable" && !unavailable.includes(parsed.data.capability)) return null
  if (parsed.data.kind === "read") {
    const names = new Set(specs.map(spec => (spec.function as ToolFunction).name))
    if (parsed.data.operations.some(item => !names.has(item.name))) return null
  }
  return parsed.data
}
