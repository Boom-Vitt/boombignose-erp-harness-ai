import Link from "next/link"
import { PlugZap, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export function AccountingIntegrationCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Integrations</CardTitle>
        <CardDescription>
          Connect BoomBigNose to the tools you already use.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/settings/accounting"
          className="hover:bg-accent flex items-center gap-3 rounded-lg border p-3 transition-colors"
        >
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
            <PlugZap className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">ส่งออก FlowAccount / FlowAccount export</p>
            <p className="text-muted-foreground truncate text-xs">
              โหมดตัวอย่างหรือ sandbox ไม่ยื่นภาษี / Fixture demo or sandbox. This does not file tax. PEAK and Xero are not in this build.
            </p>
          </div>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </Link>
      </CardContent>
    </Card>
  )
}
