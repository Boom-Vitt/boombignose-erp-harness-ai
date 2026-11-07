import type { AssistantAnswer, AssistantSource, SourceFact } from "./assistant-evidence"

type Figure = { source: AssistantSource; fact: SourceFact }

/** Latest workspace coverage cannot be omitted by AI; identical record facts appear once. */
export function answerFigures(answer: Pick<AssistantAnswer, "findings" | "factIds">, sources: readonly AssistantSource[]): Figure[] {
  const selected = new Set([...answer.factIds, ...answer.findings.flatMap(finding => finding.factIds), ...sources.flatMap(source => source.requiredFactIds ?? [])])
  const figures: Figure[] = []
  const seen = new Set<string>()
  let coverageSource: AssistantSource | undefined
  for (const source of sources) if (source.coverage) coverageSource = source
  function add(source: AssistantSource, fact: SourceFact) {
    const metric = fact.id.slice(fact.id.lastIndexOf(":") + 1)
    const key = fact.href ? `record:${fact.href}:${metric}:${fact.value}`
      : fact.scope === "workspace" ? `workspace:${metric}:${fact.value}` : fact.id
    if (seen.has(key)) return
    seen.add(key)
    figures.push({ source, fact })
  }
  if (coverageSource) {
    const required = new Set(coverageSource.coverage!.factIds)
    for (const fact of coverageSource.facts) if (required.has(fact.id)) add(coverageSource, fact)
  }
  for (const source of sources) for (const fact of source.facts) if (selected.has(fact.id)) add(source, fact)
  return figures
}
