import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { renderAccountantPackHtml } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { supportExportHeaders } from "@/lib/finance/export-integrity"
import { commitSupportExport } from "@/lib/finance/support-export"

/** GET /reports/accountant-pack/print?month=YYYY-MM — printable HTML the browser can save as PDF. */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const month = new URL(request.url).searchParams.get("month") ?? ""
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return new Response(loaded.message, { status: loaded.status })
  const html = renderAccountantPackHtml(loaded.pack, todayISO())
  const recorded = await commitSupportExport(ctx.orgId, "accountant_pack_print", loaded.pack.month, html)
  if (!recorded.ok) return new Response(recorded.error, { status: 503 })
  return new Response(html, {
    headers: supportExportHeaders(`accountant-pack-${loaded.pack.month}.html`, "text/html; charset=utf-8", recorded.sha256, "inline"),
  })
}
