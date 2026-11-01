import { requireOrgContext } from "@/lib/auth"
import { accountantPackCsv } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { supportExportHeaders } from "@/lib/finance/export-integrity"
import { commitSupportExport } from "@/lib/finance/support-export"

/** GET /reports/accountant-pack/export?month=YYYY-MM — support CSV, not a filing. */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const month = new URL(request.url).searchParams.get("month") ?? ""
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return new Response(loaded.message, { status: loaded.status })
  const body = accountantPackCsv(loaded.pack)
  const recorded = await commitSupportExport(ctx.orgId, "accountant_pack_csv", loaded.pack.month, body)
  if (!recorded.ok) return new Response(recorded.error, { status: 503 })
  return new Response(body, {
    headers: supportExportHeaders(`accountant-pack-${loaded.pack.month}.csv`, "text/csv; charset=utf-8", recorded.sha256, "attachment"),
  })
}
