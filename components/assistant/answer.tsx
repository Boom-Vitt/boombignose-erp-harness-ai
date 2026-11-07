import Link from "next/link"
import type { AssistantAnswer, AssistantSource } from "@/lib/ai/assistant-evidence"
import { answerFigures } from "@/lib/ai/answer-figures"

export function AssistantAnswerView({ answer, sources, messageId, lang }: { answer: AssistantAnswer; sources: AssistantSource[]; messageId: number; lang: "th" | "en" }) {
  const th = lang === "th"
  const figures = answerFigures(answer, sources)
  const hasErp = sources.some(source => source.kind === "erp")
  const planned = answer.kind === "erp-review"
  const byFact = new Map(sources.flatMap(source => source.facts.map(fact => [fact.id, { source, fact }] as const)))
  const sourceAnchor = (id: string) => `#answer-${messageId}-${id}`
  let coverage: AssistantSource | undefined
  for (const source of sources) if (source.coverage) coverage = source
  const required = new Set([...sources.flatMap(source => source.requiredFactIds ?? []), ...(coverage?.coverage?.factIds ?? [])])
  const primary = coverage ? figures.filter(({ fact }) => required.has(fact.id)) : figures
  const additional = coverage ? figures.filter(({ fact }) => !required.has(fact.id)) : []
  const renderFacts = (rows: typeof figures) => <table className="w-full text-left text-xs">
    <thead><tr className="border-border border-b"><th className="p-2">{th ? "ข้อมูล" : "Metric"}</th><th className="p-2">{th ? "ค่า" : "Value"}</th><th className="p-2">{th ? "ขอบเขต" : "Scope"}</th></tr></thead>
    <tbody>{rows.map(({ source, fact }) => <tr key={fact.id} data-fact-id={fact.id} className="border-border border-b align-top">
      <td className="p-2">{fact.href ? <Link className="underline" href={fact.href}>{fact.label[lang]}</Link> : fact.label[lang]} <a className="font-mono underline" href={sourceAnchor(source.id)}>[{source.id}]</a></td>
      <td className="p-2 font-mono whitespace-nowrap">{fact.value}</td>
      <td className="text-muted-foreground p-2">{fact.scope === "record" ? (th ? "เอกสารนี้" : "This record") : fact.scope === "matching-records" ? (th ? "ทุกรายการที่ตรงเงื่อนไข" : "All matching records") : (th ? "Workspace นี้" : "This workspace")}</td>
    </tr>)}</tbody>
  </table>
  return <div className="space-y-4 text-sm" data-testid="assistant-answer">
    {!hasErp && <p className="border-border rounded-md border p-2">{th ? "ไม่ได้อ่านรายการจาก workspace ในคำตอบนี้ ไฟล์แนบและคำแนะนำไม่ใช่หลักฐานยอดเงินปัจจุบันใน ERP" : "No workspace records were retrieved for this answer. Attachments and guidance are not evidence of current ERP balances."}</p>}
    {sources.some(source => source.coverage) && <p className="border-border rounded-md border p-2">{th ? "ยอดค้างชำระทั้ง workspace ครอบคลุมทุกสถานะที่ออกแล้ว แยกจากตัวกรองที่ AI เลือก งานตรวจทานอาจอ้างอิงเพียงบางรายการ ให้ใช้ค่าจาก ERP ด้านล่างสำหรับภาพรวม" : "Workspace receivables cover all issued unpaid statuses, independently of the AI's lookup filters. Review tasks may refer to a subset; use the ERP figures below for the overall position."}</p>}
    {figures.length > 0 && <section aria-label={th ? "ค่าจากแหล่งข้อมูล" : "Source-owned figures"} data-testid="assistant-facts" className="overflow-x-auto">
      <h3 className="mb-2 font-semibold">{th ? "ข้อมูลจาก ERP · ไม่ใช่ AI สร้างค่าขึ้นเอง" : "ERP facts and figures · source-owned, not model-generated"}</h3>
      {renderFacts(primary)}
      {additional.length > 0 && <details className="border-border mt-3 rounded-md border p-2">
        <summary className="cursor-pointer">{th ? "รายละเอียดอื่นที่อ้างอิง · ขอบเขตอาจต่างจากยอดรวม" : "Other cited details · scope may differ from the overall total"}</summary>
        {renderFacts(additional)}
      </details>}
    </section>}
    <section aria-label={planned ? (th ? "แผนตรวจทาน ERP" : "ERP review plan") : (th ? "ข้อสังเกตจาก AI" : "AI interpretation")}>
      <h3 className="mb-1 font-semibold">{planned ? (th ? "แผนตรวจทาน ERP · ข้อเสนอรอคนตรวจ" : "ERP review plan · awaiting human review") : (th ? "ข้อสังเกตจาก AI · ให้คนตรวจ" : "AI interpretation · review required")}</h3>
      <p className="leading-relaxed whitespace-pre-wrap">{answer.summary}</p>
    </section>
    {answer.findings.length > 0 && <section aria-label={planned ? (th ? "งานตรวจทาน" : "Review checks") : (th ? "ข้อค้นพบ" : "Findings")}>
      <h3 className="mb-1 font-semibold">{planned ? (th ? "งานตรวจทาน · ยังไม่ดำเนินการ" : "Review checks · not executed") : (th ? "ข้อค้นพบ" : "Findings")}</h3>
      <ul className="list-disc space-y-2 pl-5">{answer.findings.map((finding, index) => <li key={index}>
        <span className="whitespace-pre-wrap">{finding.text}</span>{finding.sourceIds.map(id => <a key={id} className="ml-1 underline" href={sourceAnchor(id)}>[{id}]</a>)}
        {finding.factIds.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">{finding.factIds.map(id => {
          const entry = byFact.get(id)
          return entry ? <Link key={id} className="underline" href={entry.fact.href ?? sourceAnchor(entry.source.id)}>{entry.fact.label[lang]}</Link> : null
        })}</div>}
        {finding.quotes.map((quote, quoteIndex) => <blockquote key={quoteIndex} className="border-border mt-2 border-l-2 pl-3">
          <p className="whitespace-pre-wrap">{quote.text}</p>
          <a className="text-muted-foreground text-xs underline" href={sourceAnchor(quote.sourceId)}>{th ? "ข้อความตรงจากไฟล์แนบ · ยังไม่ผ่านการตรวจ" : "Exact attachment quote · unreviewed"} [{quote.sourceId}]</a>
        </blockquote>)}
      </li>)}</ul>
    </section>}
    {answer.nextActions.length > 0 && <section aria-label={th ? "งานถัดไปที่ให้คนตรวจ" : "Suggested next actions"}>
      <h3 className="mb-1 font-semibold">{th ? "งานถัดไป · ข้อเสนอให้คนตรวจ" : "Next actions · human review"}</h3>
      <ol className="list-decimal space-y-1 pl-5">{answer.nextActions.map((action, index) => <li key={index}>{action}</li>)}</ol>
    </section>}
    {answer.limitations.length > 0 && <section className="border-border rounded-md border p-2" aria-label={th ? "ข้อจำกัด" : "Limitations"}>
      <h3 className="font-semibold">{th ? "ข้อจำกัด" : "Limitations"}</h3>
      <ul className="list-disc pl-5">{answer.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </section>}
    <section aria-label={th ? "แหล่งข้อมูล" : "Sources"} className="border-border space-y-2 border-t pt-3" data-testid="assistant-sources">
      <h3 className="font-semibold">{th ? "แหล่งข้อมูล · อ่านอย่างเดียว" : "Sources · read-only"}</h3>
      {sources.length > 0 && <ul className="space-y-3">{sources.map(source => <li key={source.id} id={`answer-${messageId}-${source.id}`} className="space-y-1 break-words">
        <p>{source.href ? <Link href={source.href} className="font-mono underline">[{source.id}] {source.label}</Link> : <span>[{source.id}] {source.label}{source.kind === "document" ? ` · ${th ? "ไฟล์แนบที่ยังไม่ตรวจ" : "unreviewed attachment"}` : source.entity ? ` · ${source.entity}` : ""}</span>}{source.kind === "erp" && source.total !== undefined && <span> · {source.returned ?? 0}/{source.total} {th ? "รายการ" : "rows"}</span>}{source.partial && <strong className="ml-1">{th ? "ข้อมูลบางส่วนเท่านั้น" : "partial source"}</strong>}</p>
        <p className="text-muted-foreground text-xs"><time dateTime={source.observedAt}>{new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(source.observedAt))}</time> · Asia/Bangkok</p>
        {source.coverage && <p className="text-muted-foreground text-xs">{source.coverage.partial ? (th ? "ยอดรวมครอบคลุมรายการค้างทั้งหมด แต่แสดงรายละเอียดเพียงบางรายการ เปิด Finance เพื่อดูรายการทั้งหมด" : "Receivables totals cover the whole workspace; only a bounded set of record figures is shown. Open Finance for the full list.") : (th ? "รวมหลักฐานยอดค้างชำระทุกสถานะที่ออกแล้ว โดยไม่จำกัดตามตัวกรองของ AI" : "Includes workspace issued-unpaid evidence beyond the AI's selected filters.")}</p>}
        {source.textSha256 && <p className="text-muted-foreground font-mono text-xs">{th ? "SHA-256 ของข้อความส่วนที่ส่งให้โมเดล" : "Model-visible text SHA-256"}: {source.textSha256}</p>}
        {source.records.length > 0 && <ul className="flex flex-wrap gap-x-3 gap-y-1">{source.records.map(record => <li key={record.href}><Link href={record.href} className="underline">{record.label}</Link></li>)}</ul>}
      </li>)}</ul>}
      <p className="text-muted-foreground text-xs">{th ? "AI อาจผิดพลาด ต้องตรวจเอกสารต้นฉบับก่อนตัดสินใจทางการเงิน ไม่มีการบันทึก อนุมัติ จ่ายเงิน หรือยื่นภาษีจากแชทนี้" : "AI can be wrong. Review original records before financial decisions. This chat does not save, approve, pay or file tax."}</p>
    </section>
  </div>
}
