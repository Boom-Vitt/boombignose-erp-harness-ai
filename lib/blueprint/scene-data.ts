/**
 * Pure data -> scene mapping for the in-app ERP 3D exploded blueprint.
 * No personal data, no client/contact names, no emails, no raw notes.
 * Counts and status totals only.
 */

export type AssemblyId =
  | "01-crm-deals"
  | "02-quotes"
  | "03-projects"
  | "04-invoices"
  | "05-payments"
  | "06-subscriptions"
  | "07-ai-unit"
  | "08-tenant-housing"

export type TokenStepId =
  | "quote"
  | "project"
  | "invoice"
  | "claim"
  | "verification"
  | "allocation"

export interface BlueprintOrgSummary {
  orgRole: "owner" | "admin" | "accountant" | "member"
  clientsTotal: number
  dealsTotal: number
  dealsWon: number
  dealsOpen: number
  quotesTotal: number
  quotesAcceptedOrConverted: number
  quotesOpen: number
  projectsTotal: number
  projectsActive: number
  milestonesTotal: number
  milestonesDone: number
  timeEntriesTotal: number
  invoicesTotal: number
  invoicesIssued: number
  paymentClaimsPending: number
  paymentClaimsVerified: number
  paymentsVerified: number
  paymentAllocationsTotal: number
  subscriptionsActive: number
  outboundEventsQueued: number | null
  outboundEventsDelivered: number | null
  aiOutputsCached: number
}

export interface BlueprintAssemblySpec {
  id: AssemblyId
  partNumber: string
  titleEn: string
  lineTh: string
  assembledPosition: [number, number, number]
  explodedOffset: [number, number, number]
  size: [number, number, number]
  metrics: { label: string; value: string }[]
  codeRuleEn: string
  codeRuleTh: string
  codeRefs: string[]
}

export interface BlueprintTokenWaypoint {
  step: TokenStepId
  labelEn: string
  labelTh: string
  assemblyId: AssemblyId
  position: [number, number, number]
}

export interface BlueprintSheetSpec {
  sheetNumber: number
  totalSheets: number
  code: string
  titleEn: string
  subtitleTh: string
  explodeFactor: number
  cameraTarget: [number, number, number]
  cameraPosition: [number, number, number]
  cameraZoom: number
}

export interface BlueprintSceneModel {
  titleBlock: {
    drawingTitle: string
    drawingCode: string
    scale: string
    projection: string
    totalSheets: number
  }
  orgRole: "owner" | "admin" | "accountant" | "member"
  assemblies: BlueprintAssemblySpec[]
  tokenPath: BlueprintTokenWaypoint[]
  sheets: BlueprintSheetSpec[]
}

export const BLUEPRINT_FIXTURE_DATA: BlueprintOrgSummary = {
  orgRole: "owner",
  clientsTotal: 8,
  dealsTotal: 14,
  dealsWon: 5,
  dealsOpen: 7,
  quotesTotal: 11,
  quotesAcceptedOrConverted: 6,
  quotesOpen: 4,
  projectsTotal: 6,
  projectsActive: 4,
  milestonesTotal: 18,
  milestonesDone: 11,
  timeEntriesTotal: 42,
  invoicesTotal: 12,
  invoicesIssued: 9,
  paymentClaimsPending: 2,
  paymentClaimsVerified: 6,
  paymentsVerified: 6,
  paymentAllocationsTotal: 6,
  subscriptionsActive: 3,
  outboundEventsQueued: 1,
  outboundEventsDelivered: 15,
  aiOutputsCached: 9,
}

function nonNegInt(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function nullableNonNegInt(n: number | null): number | null {
  if (n === null) return null
  return nonNegInt(n)
}

/**
 * Maps arc-length progress `u` in [0, 1] along a CatmullRom curve with
 * `waypointCount` control points to the active waypoint step index in
 * `0..waypointCount-1`. CatmullRom passes through waypoint `i` at curve
 * parameter `t = i / (waypointCount - 1)`, so converting `u -> t` via
 * `getUtoTmapping(u)` ensures the step index never runs ahead of the token.
 */
export function tokenStepFromCurve(
  curve: { getUtoTmapping(u: number, distance?: number): number },
  u: number,
  waypointCount: number
): number {
  if (waypointCount <= 1) return 0
  const clampedU = Math.min(Math.max(u, 0), 1)
  const t = curve.getUtoTmapping(clampedU)
  return Math.min(
    waypointCount - 1,
    Math.max(0, Math.floor((t + 1e-9) * (waypointCount - 1)))
  )
}

export const TOKEN_SPEED = 0.085
export const TOKEN_ENDPOINT_HOLD = 0.12

/**
 * Advances the token cycle and clamps arc-length progress `u` to [0, 1] with a
 * hold window at `u = 1` (`TOKEN_ENDPOINT_HOLD`), so the final waypoint step
 * ("06 Payment Allocation") stays lit at the endpoint before the cycle wraps.
 */
export function advanceTokenCycle(
  cycle: number,
  dt: number
): { cycle: number; progress: number } {
  const period = 1 + TOKEN_ENDPOINT_HOLD
  const nextCycle = (cycle + Math.max(0, dt) * TOKEN_SPEED) % period
  const progress = Math.min(nextCycle, 1)
  return { cycle: nextCycle, progress }
}

export function buildBlueprintScene(raw: BlueprintOrgSummary): BlueprintSceneModel {
  const d: BlueprintOrgSummary = {
    orgRole: raw.orgRole,
    clientsTotal: nonNegInt(raw.clientsTotal),
    dealsTotal: nonNegInt(raw.dealsTotal),
    dealsWon: nonNegInt(raw.dealsWon),
    dealsOpen: nonNegInt(raw.dealsOpen),
    quotesTotal: nonNegInt(raw.quotesTotal),
    quotesAcceptedOrConverted: nonNegInt(raw.quotesAcceptedOrConverted),
    quotesOpen: nonNegInt(raw.quotesOpen),
    projectsTotal: nonNegInt(raw.projectsTotal),
    projectsActive: nonNegInt(raw.projectsActive),
    milestonesTotal: nonNegInt(raw.milestonesTotal),
    milestonesDone: nonNegInt(raw.milestonesDone),
    timeEntriesTotal: nonNegInt(raw.timeEntriesTotal),
    invoicesTotal: nonNegInt(raw.invoicesTotal),
    invoicesIssued: nonNegInt(raw.invoicesIssued),
    paymentClaimsPending: nonNegInt(raw.paymentClaimsPending),
    paymentClaimsVerified: nonNegInt(raw.paymentClaimsVerified),
    paymentsVerified: nonNegInt(raw.paymentsVerified),
    paymentAllocationsTotal: nonNegInt(raw.paymentAllocationsTotal),
    subscriptionsActive: nonNegInt(raw.subscriptionsActive),
    outboundEventsQueued: nullableNonNegInt(raw.outboundEventsQueued),
    outboundEventsDelivered: nullableNonNegInt(raw.outboundEventsDelivered),
    aiOutputsCached: nonNegInt(raw.aiOutputsCached),
  }

  const assemblies: BlueprintAssemblySpec[] = [
    {
      id: "01-crm-deals",
      partNumber: "01",
      titleEn: "01 CRM & Deals",
      lineTh: "ลูกค้า ผู้ติดต่อ และไปป์ไลน์ของดีล",
      assembledPosition: [-2.4, 0.7, -1.5],
      explodedOffset: [-2.6, 1.4, -1.8],
      size: [2.0, 1.0, 1.6],
      metrics: [
        { label: "Clients", value: String(d.clientsTotal) },
        { label: "Open deals", value: String(d.dealsOpen) },
        { label: "Won deals", value: `${d.dealsWon}/${d.dealsTotal}` },
      ],
      codeRuleEn:
        "Clients, contacts, deals, and follow-up activities are scoped by org_id under Postgres Row Level Security; pipeline values are stored as integer satang.",
      codeRuleTh:
        "ข้อมูลลูกค้า ดีล และกิจกรรมแยกตาม org_id ด้วย RLS และเก็บมูลค่าเป็นหน่วยสตางค์จำนวนเต็ม",
      codeRefs: ["lib/queries/dashboard.ts", "app/(app)/deals/actions.ts"],
    },
    {
      id: "02-quotes",
      partNumber: "02",
      titleEn: "02 Quotes",
      lineTh: "ใบเสนอราคาและการแปลงเป็นใบแจ้งหนี้",
      assembledPosition: [-0.8, 0.7, -1.5],
      explodedOffset: [-0.9, 1.8, -1.8],
      size: [1.8, 1.0, 1.6],
      metrics: [
        { label: "Total quotes", value: String(d.quotesTotal) },
        { label: "Open quotes", value: String(d.quotesOpen) },
        { label: "Accepted / converted", value: String(d.quotesAcceptedOrConverted) },
      ],
      codeRuleEn:
        "Once a quote is accepted or converted, quoteIsEditable locks line items and totals; convert_accepted_quote atomically creates the project, milestones, and draft invoice.",
      codeRuleTh:
        "เมื่อใบเสนอราคาได้รับการยืนยันจะล็อกการแก้ไข และแปลงเป็นโปรเจกต์พร้อมใบแจ้งหนี้ในทรานแซกชันเดียว",
      codeRefs: ["app/(app)/quotes/actions.ts", "lib/workflows/service.ts"],
    },
    {
      id: "03-projects",
      partNumber: "03",
      titleEn: "03 Projects, Milestones & Timesheets",
      lineTh: "การส่งมอบงาน ไมล์สโตน และบันทึกเวลาทำงาน",
      assembledPosition: [1.1, 0.7, -1.5],
      explodedOffset: [1.3, 1.8, -1.8],
      size: [2.2, 1.0, 1.6],
      metrics: [
        { label: "Active projects", value: `${d.projectsActive}/${d.projectsTotal}` },
        { label: "Milestones done", value: `${d.milestonesDone}/${d.milestonesTotal}` },
        { label: "Time entries", value: String(d.timeEntriesTotal) },
      ],
      codeRuleEn:
        "Projects link back to source_quote_id and hold tenant-scoped milestones, tasks, and billable time_entries with integer minutes and satang rates.",
      codeRuleTh:
        "โปรเจกต์ผูกกับใบเสนอราคาต้นทาง พร้อมไมล์สโตน งานย่อย และบันทึกเวลาทำงานเป็นนาทีและสตางค์",
      codeRefs: ["lib/metrics/timesheets.ts", "app/(app)/projects/actions.ts"],
    },
    {
      id: "04-invoices",
      partNumber: "04",
      titleEn: "04 Invoices (Satang Bigint)",
      lineTh: "ใบแจ้งหนี้เชิงปฏิบัติการ เก็บหน่วยเงินเป็นสตางค์ (bigint)",
      assembledPosition: [-1.8, 0.7, 0.6],
      explodedOffset: [-2.2, 1.3, 1.4],
      size: [2.0, 1.1, 1.6],
      metrics: [
        { label: "Invoices", value: String(d.invoicesTotal) },
        { label: "Issued snapshots", value: String(d.invoicesIssued) },
      ],
      codeRuleEn:
        "Every monetary column is stored as integer satang (bigint, 100 satang = 1 THB, never float). Issuing an invoice calls issue_invoice to freeze an immutable invoice_snapshots record.",
      codeRuleTh:
        "จำนวนเงินทุกคอลัมน์เก็บเป็นสตางค์จำนวนเต็ม (bigint) ไม่ใช้ทศนิยมลอยตัว และบันทึกสแนปช็อตเมื่อออกเอกสาร",
      codeRefs: ["lib/money.ts", "lib/documents/invoice-snapshot.ts"],
    },
    {
      id: "05-payments",
      partNumber: "05",
      titleEn: "05 Payment Claims, Verification & Allocation",
      lineTh: "คำขอแจ้งชำระเงิน การตรวจหลักฐาน และการจัดสรรยอด",
      assembledPosition: [0.5, 0.7, 0.6],
      explodedOffset: [0.6, 1.5, 1.6],
      size: [2.4, 1.1, 1.6],
      metrics: [
        { label: "Pending claims", value: String(d.paymentClaimsPending) },
        { label: "Verified payments", value: String(d.paymentsVerified) },
        { label: "Allocations", value: String(d.paymentAllocationsTotal) },
      ],
      codeRuleEn:
        "Staff and portal submissions create pending-only payment_claims, never immediate cash. Owner/admin review_payment_claim_with_evidence verifies bank date and method, creates a verified payment, and writes payment_allocations.",
      codeRuleTh:
        "การแจ้งชำระเงินเริ่มที่สถานะรอตรวจสอบเสมอ ต้องตรวจหลักฐานวันโอนและช่องทางก่อนบันทึกรับเงินและตัดยอดใบแจ้งหนี้",
      codeRefs: ["app/(app)/finance/actions.ts", "lib/metrics/invoice-status.ts"],
    },
    {
      id: "06-subscriptions",
      partNumber: "06",
      titleEn: "06 Subscriptions, Recurrence & Outbox",
      lineTh: "สัญญารายงวดและการส่งต่อเหตุการณ์ผ่าน Outbox แบบปลอดภัยต่อการลองซ้ำ",
      assembledPosition: [2.6, 0.7, 0.6],
      explodedOffset: [3.0, 1.4, 1.5],
      size: [1.9, 1.0, 1.6],
      metrics: [
        { label: "Active subscriptions", value: String(d.subscriptionsActive) },
        {
          label: "Outbox queued",
          value: d.outboundEventsQueued === null ? "Owner/admin only" : String(d.outboundEventsQueued),
        },
        {
          label: "Outbox delivered",
          value: d.outboundEventsDelivered === null ? "Owner/admin only" : String(d.outboundEventsDelivered),
        },
      ],
      codeRuleEn:
        "generate_subscription_occurrence deduplicates recurring invoices by (org_id, subscription_id, occurrence_date). Outbound events use DB leases (claim_outbound_events / finish_outbound_event) with Idempotency-Key headers.",
      codeRuleTh:
        "ป้องกันการสร้างใบแจ้งหนี้รายงวดซ้ำด้วยคีย์งวด และคิวส่งออกใช้ระบบล็อกเวลา (lease) ที่ลองซ้ำได้อย่างปลอดภัย",
      codeRefs: ["lib/billing/generate.ts", "lib/automation/outbox.ts"],
    },
    {
      id: "07-ai-unit",
      partNumber: "07",
      titleEn: "07 AI Unit & Read-Only Assistant",
      lineTh: "ฟีเจอร์ช่วยสรุป 3 รายการใน ERP และผู้ช่วยอ่านข้อมูลในแผง BoomBigNose",
      assembledPosition: [2.6, 1.8, -1.5],
      explodedOffset: [3.2, 2.9, -1.9],
      size: [1.8, 0.9, 1.5],
      metrics: [
        { label: "ERP AI features", value: "3" },
        { label: "Cached outputs", value: String(d.aiOutputsCached) },
        { label: "Write authority", value: "None (read/draft)" },
      ],
      codeRuleEn:
        "Three ERP features (deal summary, follow-up drafts in friendly/formal/brief tones, meeting-notes intake to summary + action items) call Ollama on loopback, cache in RLS-protected ai_outputs, and degrade cleanly when Ollama is not running. The BoomBigNose desktop panel adds an ERP assistant with read-only ERP tools; nothing in the ERP writes on its own.",
      codeRuleTh:
        "ประกอบด้วยฟีเจอร์ใน ERP 3 รายการ (สรุปดีล ร่างข้อความติดตาม 3 โทน และสรุปบันทึกประชุม) เรียก Ollama บนเครื่อง เก็บแคชใน ai_outputs โดยแอปทำงานได้แม้ไม่มี Ollama พร้อมผู้ช่วยอ่านข้อมูลอย่างเดียวในแผง BoomBigNose",
      codeRefs: ["lib/ai/prompts.ts", "lib/ai/parse.ts", "lib/ai/client.ts"],
    },
    {
      id: "08-tenant-housing",
      partNumber: "08",
      titleEn: "08 Tenant-Isolation Housing (RLS & RBAC)",
      lineTh: "โครงสร้างแยกองค์กรด้วย RLS, org_id ทุกแถว และสิทธิ์ตามบทบาท",
      assembledPosition: [0.0, -0.25, -0.4],
      explodedOffset: [0.0, -1.6, -0.4],
      size: [7.6, 0.6, 4.8],
      metrics: [
        { label: "Active role", value: d.orgRole },
        { label: "Roles", value: "owner / admin / member" },
        { label: "Row isolation", value: "org_id + FORCE RLS" },
      ],
      codeRuleEn:
        "Every business table carries org_id with composite tenant foreign keys and Postgres Row Level Security. Server actions check requireOrgContext and capability gates in lib/permissions.ts (owner, admin, member).",
      codeRuleTh:
        "ทุกตารางธุรกิจมี org_id บังคับใช้ RLS ร่วมกับ composite foreign keys และตรวจสอบสิทธิ์ owner/admin/member ก่อนทำงาน",
      codeRefs: ["lib/auth.ts", "lib/permissions.ts", "lib/supabase/middleware.ts"],
    },
  ]

  const tokenPath: BlueprintTokenWaypoint[] = [
    {
      step: "quote",
      labelEn: "01 Accepted Quote",
      labelTh: "ใบเสนอราคาที่ยืนยันแล้ว",
      assemblyId: "02-quotes",
      position: [-0.8, 1.5, -1.5],
    },
    {
      step: "project",
      labelEn: "02 Project & Milestones",
      labelTh: "สร้างโปรเจกต์และไมล์สโตน",
      assemblyId: "03-projects",
      position: [1.1, 1.5, -1.5],
    },
    {
      step: "invoice",
      labelEn: "03 Issued Invoice (satang)",
      labelTh: "ออกใบแจ้งหนี้หน่วยสตางค์",
      assemblyId: "04-invoices",
      position: [-1.8, 1.5, 0.6],
    },
    {
      step: "claim",
      labelEn: "04 Pending Payment Claim",
      labelTh: "แจ้งชำระเงินสถานะรอตรวจสอบ",
      assemblyId: "05-payments",
      position: [-0.1, 1.5, 0.6],
    },
    {
      step: "verification",
      labelEn: "05 Evidence Verification",
      labelTh: "ตรวจสอบหลักฐานการโอนเงิน",
      assemblyId: "05-payments",
      position: [0.5, 1.75, 0.6],
    },
    {
      step: "allocation",
      labelEn: "06 Payment Allocation",
      labelTh: "จัดสรรยอดชำระเข้าใบแจ้งหนี้",
      assemblyId: "05-payments",
      position: [1.2, 1.5, 0.6],
    },
  ]

  const sheets: BlueprintSheetSpec[] = [
    {
      sheetNumber: 1,
      totalSheets: 4,
      code: "DWG-ERP-01",
      titleEn: "Exploded Axonometric Assembly",
      subtitleTh: "ผังแยกชิ้นส่วนระบบ ERP แบบแอกโซโนเมตริก",
      explodeFactor: 1,
      cameraTarget: [0.2, 0.5, -0.3],
      cameraPosition: [9.5, 8.2, 9.5],
      cameraZoom: 1.0,
    },
    {
      sheetNumber: 2,
      totalSheets: 4,
      code: "DWG-ERP-02",
      titleEn: "Assembled Compact Machine",
      subtitleTh: "มุมมองประกอบรวมทุกหน่วยบนฐานแยกข้อมูลองค์กร",
      explodeFactor: 0,
      cameraTarget: [0.2, 0.4, -0.3],
      cameraPosition: [8.8, 7.2, 8.8],
      cameraZoom: 1.12,
    },
    {
      sheetNumber: 3,
      totalSheets: 4,
      code: "DWG-ERP-03",
      titleEn: "Quote-to-Allocation Document Conduit",
      subtitleTh: "เส้นทางเอกสารจากใบเสนอราคาสู่การตรวจรับเงินและตัดยอด",
      explodeFactor: 0.65,
      cameraTarget: [-0.2, 1.0, -0.2],
      cameraPosition: [7.5, 9.5, 7.5],
      cameraZoom: 1.18,
    },
    {
      sheetNumber: 4,
      totalSheets: 4,
      code: "DWG-ERP-04",
      titleEn: "Tenant Housing, Outbox & AI Subsystems",
      subtitleTh: "โครงสร้าง RLS คิวส่งออกที่ปลอดภัยต่อการลองซ้ำ และหน่วย AI",
      explodeFactor: 1,
      cameraTarget: [1.1, 0.6, -0.4],
      cameraPosition: [-8.5, 7.8, 8.5],
      cameraZoom: 1.05,
    },
  ]

  return {
    titleBlock: {
      drawingTitle: "BOOMBIGNOSE ERP // OPERATIONS MACHINE",
      drawingCode: "BBN-ERP-AXO-REV-A",
      scale: "1:1 ORTHOGRAPHIC AXONOMETRIC",
      projection: "ISO-E / THIRD ANGLE",
      totalSheets: sheets.length,
    },
    orgRole: d.orgRole,
    assemblies,
    tokenPath,
    sheets,
  }
}
