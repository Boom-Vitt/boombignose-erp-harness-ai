import { accountantPackCsv } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"

/** GET /reports/accountant-pack/export?month=YYYY-MM — support CSV, not a filing. */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? ""
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return new Response(loaded.message, { status: loaded.status })
  return new Response(accountantPackCsv(loaded.pack), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accountant-pack-${loaded.pack.month}.csv"`,
      "X-Robots-Tag": "noindex",
    },
  })
}
