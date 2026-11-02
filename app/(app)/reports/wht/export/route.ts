import { requireOrgContext } from "@/lib/auth"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { supportExportHeaders } from "@/lib/finance/export-integrity"
import { commitSupportExport } from "@/lib/finance/support-export"
import { buildWhtReport, whtReportCsv, WHT_FORMS, type WhtForm } from "@/lib/finance/wht-report"

/** GET /reports/wht/export?month=YYYY-MM[&form=pnd3|pnd53] — purchase WHT support CSV with checksum, not a filing. */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const params = new URL(request.url).searchParams
  const month = params.get("month") ?? ""
  const form = params.get("form")
  if (form && !WHT_FORMS.includes(form as WhtForm)) return new Response("Unknown form.", { status: 400 })
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return new Response(loaded.message, { status: loaded.status })
  const body = whtReportCsv(buildWhtReport(loaded.pack, (form as WhtForm | null) ?? undefined))
  const recorded = await commitSupportExport(ctx.orgId, "wht_support_csv", loaded.pack.month, body)
  if (!recorded.ok) return new Response(recorded.error, { status: 503 })
  return new Response(body, {
    headers: supportExportHeaders(`wht-support-${loaded.pack.month}${form ? `-${form}` : ""}.csv`, "text/csv; charset=utf-8", recorded.sha256, "attachment"),
  })
}
