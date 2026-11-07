import "server-only"

import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { todayISO } from "@/lib/dates"
import type { OrganizationSnapshot, WorkloadModule } from "./types"

/** The browser receives aggregates and a small task preview, never an unrestricted ERP dump. */
export async function organizationSnapshot(): Promise<OrganizationSnapshot> {
  const ctx = await requireOrgContext() // Same organization + MFA boundary as the app layout.
  const db = await createClient() // Session client: RLS remains authoritative.
  const today = todayISO()
  const mine = ctx.role === "member"
  const projects = () => {
    const q = db.from("projects").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId)
    return mine ? q.eq("owner", ctx.userId) : q
  }
  const taskCount = () => {
    const q = db.from("project_tasks").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("done", false)
    return mine ? q.eq("assignee", ctx.userId) : q
  }
  const quotes = () => {
    const q = db.from("quotes").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId)
    return mine ? q.eq("owner", ctx.userId) : q
  }
  const claims = () => db.from("expense_claims").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId)
  async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
    const result = await query
    if (result.error || result.count === null) throw new Error("Organization workload unavailable. Reload to retry. / ไม่สามารถโหลดภาระงานองค์กร กรุณาลองใหม่")
    return result.count
  }
  const scope = mine ? "mine" as const : "workspace" as const
  const modules: Promise<WorkloadModule>[] = [
    (async () => {
      const [active, open, overdue] = await Promise.all([
        count(projects().in("status", ["not_started", "in_progress", "review", "support", "paused"])),
        count(taskCount()), count(taskCount().lt("due_date", today)),
      ])
      return { id: "delivery", th: "การส่งมอบ", en: "Delivery", href: "/projects?view=board", workload: open, unit: { th: "งานที่ยังไม่เสร็จ", en: "open tasks" }, scope, metrics: [
        { th: "โปรเจกต์ที่ยังไม่ปิด", en: "Open projects", count: active, href: "/projects" },
        { th: "งานที่ยังไม่เสร็จ", en: "Open tasks", count: open, href: "/projects?view=board" },
        { th: "งานเลยกำหนด", en: "Overdue tasks", count: overdue, href: "/projects", attention: overdue > 0 },
      ] }
    })(),
    (async () => {
      const [draft, sent] = await Promise.all([count(quotes().eq("status", "draft")), count(quotes().eq("status", "sent"))])
      return { id: "sales", th: "การขาย", en: "Sales", href: "/quotes", workload: draft + sent, unit: { th: "ใบเสนอราคาร่างหรือส่งแล้ว", en: "draft or sent quotes" }, scope, metrics: [
        { th: "ใบเสนอราคาร่าง", en: "Draft quotes", count: draft, href: "/quotes?status=draft" },
        { th: "ใบเสนอราคาที่ส่งแล้ว", en: "Sent quotes", count: sent, href: "/quotes?status=sent" },
      ] }
    })(),
    (async () => {
      const approve = can(ctx.role, "expense:approve")
      const [draft, submitted] = await Promise.all([
        count(claims().eq("employee", ctx.userId).eq("status", "draft")),
        count(approve ? claims().eq("status", "submitted").not("employee", "eq", ctx.userId) : claims().eq("employee", ctx.userId).eq("status", "submitted")),
      ])
      return { id: "claims", th: "ค่าใช้จ่าย", en: "Expenses", href: "/expenses", workload: draft + submitted, unit: { th: "คำขอร่างและรอดำเนินการ", en: "draft and pending claims" }, scope: approve ? "workspace" : "mine", metrics: [
        { th: "คำขอร่างของฉัน", en: "My draft claims", count: draft, href: "/expenses" },
        { th: approve ? "รอฉันอนุมัติ (ไม่รวมของตนเอง)" : "คำขอของฉันที่ส่งแล้ว", en: approve ? "Awaiting my approval (excludes own)" : "My submitted claims", count: submitted, href: approve ? "/expenses?tab=approve" : "/expenses", attention: approve && submitted > 0 },
      ] }
    })(),
  ]
  // Do not query, infer zero for, or serialize management-only workload to other roles.
  if (can(ctx.role, "purchase:manage")) modules.push((async () => {
    const orders = () => db.from("purchase_orders").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId)
    const [draft, incoming] = await Promise.all([count(orders().eq("status", "draft")), count(orders().in("status", ["sent", "confirmed"]))])
    return { id: "purchasing", th: "การจัดซื้อ", en: "Purchasing", href: "/purchases", workload: draft + incoming, unit: { th: "ใบสั่งซื้อร่าง ส่งแล้ว หรือยืนยันแล้ว", en: "draft, sent or confirmed orders" }, scope: "workspace", metrics: [
      { th: "ใบสั่งซื้อร่าง", en: "Draft orders", count: draft, href: "/purchases?status=draft" },
      { th: "ส่งแล้วหรือยืนยันแล้ว", en: "Sent or confirmed orders", count: incoming, href: "/purchases" },
    ] }
  })())
  if (can(ctx.role, "inventory:manage")) modules.push((async () => {
    const [products, warehouses] = await Promise.all([
      count(db.from("products").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("active", true).eq("is_stockable", true)),
      count(db.from("warehouses").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("active", true)),
    ])
    return { id: "stock", th: "สินค้าคงคลัง", en: "Stock", href: "/inventory", workload: products, unit: { th: "รายการสินค้าในแค็ตตาล็อก", en: "catalog items" }, scope: "workspace", metrics: [
      { th: "รายการสินค้าที่เก็บสต็อกและใช้งานอยู่", en: "Active stockable catalog items", count: products, href: "/products" },
      { th: "คลังที่ใช้งานอยู่", en: "Active warehouses", count: warehouses, href: "/inventory" },
    ] }
  })())
  if (can(ctx.role, "payment:verify")) modules.push((async () => {
    const invoices = () => db.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).in("status", ["sent", "partially_paid", "overdue"])
    const [open, overdue] = await Promise.all([count(invoices()), count(invoices().lt("due_date", today))])
    return { id: "receivables", th: "ลูกหนี้", en: "Receivables", href: "/finance", workload: open, unit: { th: "ใบแจ้งหนี้สถานะยังเปิด", en: "open-status invoices" }, scope: "workspace", metrics: [
      { th: "สถานะส่งแล้ว / ชำระบางส่วน / เกินกำหนด", en: "Sent / partially paid / overdue status", count: open, href: "/finance" },
      { th: "สถานะยังเปิดและเลยกำหนดชำระ", en: "Open-status invoices past due", count: overdue, href: "/finance", attention: overdue > 0 },
    ] }
  })())
  let preview = db.from("project_tasks").select("id,title,status,due_date,project_id").eq("org_id", ctx.orgId).eq("done", false)
  if (mine) preview = preview.eq("assignee", ctx.userId)
  const [loaded, tasks] = await Promise.all([
    Promise.all(modules), preview.order("due_date", { ascending: true, nullsFirst: false }).order("id").limit(8),
  ])
  if (tasks.error) throw new Error("Organization tasks unavailable. Reload to retry. / ไม่สามารถโหลดงาน กรุณาลองใหม่")
  return {
    orgName: ctx.orgName, role: ctx.role, capturedAt: new Date().toISOString(), modules: loaded,
    limited: !can(ctx.role, "purchase:manage") || !can(ctx.role, "payment:verify"),
    tasks: (tasks.data ?? []).map((task) => ({ id: task.id, title: task.title, status: task.status, dueDate: task.due_date, href: `/projects/${task.project_id}#tasks` })),
  }
}
