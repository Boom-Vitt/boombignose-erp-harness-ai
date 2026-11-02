import { requireOrgContext } from "@/lib/auth"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { supportExportHeaders } from "@/lib/finance/export-integrity"
import { commitSupportExport } from "@/lib/finance/support-export"
import { buildVatReport, vatReportCsv } from "@/lib/finance/vat-report"

/** GET /reports/vat/export?month=YYYY-MM — ภ.พ.30-style support CSV with checksum, not a filing. */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const month = new URL(request.url).searchParams.get("month") ?? ""
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return new Response(loaded.message, { status: loaded.status })
  const body = vatReportCsv(buildVatReport(loaded.pack))
  const recorded = await commitSupportExport(ctx.orgId, "vat_support_csv", loaded.pack.month, body)
  if (!recorded.ok) return new Response(recorded.error, { status: 503 })
  return new Response(body, {
    headers: supportExportHeaders(`vat-support-${loaded.pack.month}.csv`, "text/csv; charset=utf-8", recorded.sha256, "attachment"),
  })
}
