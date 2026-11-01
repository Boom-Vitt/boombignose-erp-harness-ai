import { todayISO } from "@/lib/dates"
import { renderAccountantPackHtml } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"

/** GET /reports/accountant-pack/print?month=YYYY-MM — printable HTML the browser can save as PDF. */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? ""
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return new Response(loaded.message, { status: loaded.status })
  const html = renderAccountantPackHtml(loaded.pack, todayISO())
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="accountant-pack-${loaded.pack.month}.html"`,
      "X-Robots-Tag": "noindex",
    },
  })
}
