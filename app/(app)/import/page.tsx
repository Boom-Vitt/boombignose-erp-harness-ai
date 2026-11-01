import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { ImportForm } from "./import-form"

export const dynamic = "force-dynamic"

export default async function ImportPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data } = await supabase.from("warehouses").select("id, name, code").eq("org_id", ctx.orgId).eq("active", true).order("code")
  return (
    <div className="space-y-6">
      <PageHeader title="นำเข้า / Import" description="Customers, products, and opening quantities from a CSV or Excel file." breadcrumbs={[{ label: "Clients", href: "/clients" }]} />
      <div className="max-w-3xl space-y-3 text-sm text-muted-foreground">
        <p>The first row is the header. Thai and English names both work: ชื่อ, เลขผู้เสียภาษี, ที่อยู่, โทร, อีเมล, รหัส, หน่วย, ราคา, ต้นทุน, ประเภท, ภาษี, จำนวน, ต้นทุนต่อหน่วย.</p>
        <p>A row that fails the check is not saved. If a later database check fails, rows before it stay saved. This does not create a tax invoice or a journal.</p>
        <p><Link className="underline" href="/products">Products</Link> · <Link className="underline" href="/inventory">Inventory</Link></p>
      </div>
      <ImportForm warehouses={data ?? []} />
    </div>
  )
}
