import { FILING_LEAD_EN, FILING_LEAD_TH, FILING_LIMIT_EN, FILING_LIMIT_TH, FILING_PARTIES } from "@/lib/finance/filing-responsibility"

/** Names who prepares numbers, who keeps statutory books, and who files. */
export function FilingResponsibility() {
  return (
    <section className="space-y-2 rounded-lg border p-4 text-sm" aria-labelledby="filing-responsibility-title">
      <h2 id="filing-responsibility-title" className="font-medium">ใครรับผิดชอบอะไร / Who is responsible</h2>
      <p>{FILING_LEAD_TH}</p>
      <p className="text-muted-foreground">{FILING_LEAD_EN}</p>
      <ul className="list-disc space-y-1 pl-5">
        {FILING_PARTIES.map(party => (
          <li key={party.en}>
            <span>{party.th}</span>
            <span className="mt-0.5 block text-muted-foreground">{party.en}</span>
          </li>
        ))}
      </ul>
      <p>{FILING_LIMIT_TH}</p>
      <p className="text-muted-foreground">{FILING_LIMIT_EN}</p>
    </section>
  )
}
