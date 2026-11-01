import * as THREE from "three"
import { describe, expect, it, vi } from "vitest"
import {
  advanceTokenCycle,
  BLUEPRINT_FIXTURE_DATA,
  buildBlueprintScene,
  TOKEN_ENDPOINT_HOLD,
  TOKEN_SPEED,
  tokenStepFromCurve,
} from "./scene-data"

const mockState = vi.hoisted(() => ({
  orgId: "org-1",
  role: "owner" as "owner" | "admin" | "accountant" | "member",
  counts: {} as Record<string, number>,
  failTable: null as string | null,
  queriedTables: [] as string[],
}))

vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({
    userId: "user-1",
    email: null,
    orgId: mockState.orgId,
    orgName: "Org",
    role: mockState.role,
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      mockState.queriedTables.push(table)
      const filters: string[] = [table]
      let headOption = false
      const builder = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          headOption = opts?.count === "exact" && opts?.head === true
          return builder
        },
        eq(col: string, val: unknown) {
          filters.push(`${col}=${String(val)}`)
          return builder
        },
        in(col: string, vals: unknown[]) {
          filters.push(`${col} in (${vals.join(",")})`)
          return builder
        },
        not(col: string, op: string, val: unknown) {
          filters.push(`${col} not ${op} ${String(val)}`)
          return builder
        },
        then(resolve: (res: unknown) => unknown, reject?: (err: unknown) => unknown) {
          if (mockState.failTable === table) {
            return Promise.resolve({ data: null, count: null, error: { message: "boom" } }).then(
              resolve,
              reject
            )
          }
          if (!filters.includes(`org_id=${mockState.orgId}`)) {
            return Promise.resolve({
              data: null,
              count: null,
              error: { message: `Missing tenant org_id filter on ${table}` },
            }).then(resolve, reject)
          }
          const key = filters.join("|")
          const exactCount = mockState.counts[key] ?? mockState.counts[table] ?? 0
          // Deliberately return empty data array to prove summary reads `count`, not `data.length`
          return Promise.resolve({
            data: headOption ? null : [],
            count: headOption ? exactCount : 0,
            error: null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  }),
}))

import { getBlueprintOrgSummary } from "./queries"

describe("buildBlueprintScene", () => {
  it("maps ERP counts to the eight assemblies", () => {
    const scene = buildBlueprintScene({
      ...BLUEPRINT_FIXTURE_DATA,
      clientsTotal: 19,
      dealsOpen: 9,
      dealsWon: 4,
      dealsTotal: 15,
      quotesTotal: 12,
      quotesOpen: 5,
      quotesAcceptedOrConverted: 7,
      projectsActive: 3,
      projectsTotal: 5,
      milestonesDone: 8,
      milestonesTotal: 10,
      timeEntriesTotal: 31,
      invoicesTotal: 14,
      invoicesIssued: 11,
      paymentClaimsPending: 3,
      paymentsVerified: 7,
      paymentAllocationsTotal: 7,
      subscriptionsActive: 4,
      outboundEventsQueued: 2,
      outboundEventsDelivered: 20,
      aiOutputsCached: 6,
      orgRole: "admin",
    })

    expect(scene.assemblies).toHaveLength(8)
    expect(scene.assemblies.map((a) => a.partNumber)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
    ])

    const crm = scene.assemblies.find((a) => a.id === "01-crm-deals")!
    expect(crm.metrics).toEqual([
      { label: "Clients", value: "19" },
      { label: "Open deals", value: "9" },
      { label: "Won deals", value: "4/15" },
    ])

    const invoices = scene.assemblies.find((a) => a.id === "04-invoices")!
    expect(invoices.codeRuleEn).toContain("satang")
    expect(invoices.codeRuleEn).toContain("bigint")
    expect(invoices.metrics.map((m) => m.label)).toEqual(["Invoices", "Issued snapshots"])
    expect(invoices.metrics.map((m) => m.label)).not.toContain("Paid")

    const payments = scene.assemblies.find((a) => a.id === "05-payments")!
    expect(payments.metrics).toContainEqual({ label: "Pending claims", value: "3" })
    expect(payments.codeRuleEn).toContain("pending-only")

    const ai = scene.assemblies.find((a) => a.id === "07-ai-unit")!
    expect(ai.codeRuleEn).toContain("Ollama on loopback")
    expect(ai.codeRuleEn).toContain("BoomBigNose")
    expect(ai.codeRuleEn).toContain("read-only")

    const housing = scene.assemblies.find((a) => a.id === "08-tenant-housing")!
    expect(housing.metrics).toContainEqual({ label: "Active role", value: "admin" })
    expect(housing.metrics).toContainEqual({ label: "Roles", value: "owner / admin / member" })
    expect(housing.codeRuleEn).toContain("org_id")
  })

  it("document token path follows quote, project, invoice, claim, verification, allocation", () => {
    const scene = buildBlueprintScene(BLUEPRINT_FIXTURE_DATA)
    expect(scene.tokenPath.map((w) => w.step)).toEqual([
      "quote",
      "project",
      "invoice",
      "claim",
      "verification",
      "allocation",
    ])
    for (const waypoint of scene.tokenPath) {
      expect(waypoint.position).toHaveLength(3)
      expect(waypoint.labelEn.length).toBeGreaterThan(0)
      expect(waypoint.labelTh.length).toBeGreaterThan(0)
    }
  })

  it("clamps negative or non-finite counts to zero", () => {
    const scene = buildBlueprintScene({
      ...BLUEPRINT_FIXTURE_DATA,
      clientsTotal: -5,
      dealsOpen: Number.NaN,
    })
    const crm = scene.assemblies.find((a) => a.id === "01-crm-deals")!
    expect(crm.metrics[0]?.value).toBe("0")
    expect(crm.metrics[1]?.value).toBe("0")
  })

  it("reads exact head counts beyond the 1000-row PostgREST cap", async () => {
    mockState.failTable = null
    mockState.role = "owner"
    mockState.queriedTables = []
    mockState.counts = {
      time_entries: 1500,
      "outbound_events|org_id=org-1|status=delivered": 2450,
      ai_outputs: 1205,
      "invoices|org_id=org-1|issued_snapshot_id not is null": 1100,
    }

    const summary = await getBlueprintOrgSummary()
    expect(summary.timeEntriesTotal).toBe(1500)
    expect(summary.outboundEventsDelivered).toBe(2450)
    expect(summary.aiOutputsCached).toBe(1205)
    expect(summary.invoicesIssued).toBe(1100)
  })

  it("skips staff-only outbound_events for members and labels metrics Owner/admin only", async () => {
    mockState.failTable = null
    mockState.role = "member"
    mockState.queriedTables = []
    mockState.counts = {
      "outbound_events|org_id=org-1|status=queued": 4,
      "outbound_events|org_id=org-1|status=delivered": 19,
    }

    const memberSummary = await getBlueprintOrgSummary()
    expect(mockState.queriedTables).not.toContain("outbound_events")
    expect(memberSummary.outboundEventsQueued).toBeNull()
    expect(memberSummary.outboundEventsDelivered).toBeNull()

    const memberScene = buildBlueprintScene(memberSummary)
    const memberSubs = memberScene.assemblies.find((a) => a.id === "06-subscriptions")!
    expect(memberSubs.metrics).toContainEqual({
      label: "Outbox queued",
      value: "Owner/admin only",
    })
    expect(memberSubs.metrics).toContainEqual({
      label: "Outbox delivered",
      value: "Owner/admin only",
    })

    mockState.role = "owner"
    mockState.queriedTables = []
    const ownerSummary = await getBlueprintOrgSummary()
    expect(mockState.queriedTables).toContain("outbound_events")
    expect(ownerSummary.outboundEventsQueued).toBe(4)
    expect(ownerSummary.outboundEventsDelivered).toBe(19)

    const ownerScene = buildBlueprintScene(ownerSummary)
    const ownerSubs = ownerScene.assemblies.find((a) => a.id === "06-subscriptions")!
    expect(ownerSubs.metrics).toContainEqual({ label: "Outbox queued", value: "4" })
    expect(ownerSubs.metrics).toContainEqual({ label: "Outbox delivered", value: "19" })
  })

  it("derives token step from curve parameter so step never runs ahead of the token", () => {
    const scene = buildBlueprintScene(BLUEPRINT_FIXTURE_DATA)
    const waypoints = scene.tokenPath.map((w) => new THREE.Vector3(...w.position))
    const curve = new THREE.CatmullRomCurve3(waypoints, false, "centripetal")
    const n = waypoints.length
    const lengths = curve.getLengths()
    const totalLength = lengths[lengths.length - 1]!

    // Using the curve's own default arcLengthDivisions lookup table:
    // waypoint i is at t = i / (n - 1), which corresponds to index Math.round(t * (lengths.length - 1))
    const waypointU: number[] = []
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const idx = Math.round(t * (lengths.length - 1))
      const u = lengths[idx]! / totalLength
      waypointU.push(u)
      expect(tokenStepFromCurve(curve, u, n)).toBe(i)
    }

    // Across the entire curve, before reaching waypoint i's arc-length position u_i,
    // the reported step must be strictly less than i (never runs ahead).
    for (let sample = 0; sample < 200; sample++) {
      const u = sample / 200
      const step = tokenStepFromCurve(curve, u, n)
      for (let i = 1; i < n; i++) {
        if (u < waypointU[i]! - 1e-4) {
          expect(step).toBeLessThan(i)
        }
      }
    }
  })

  it("visits all token steps including the final step 06 under jittered frame deltas", () => {
    const scene = buildBlueprintScene(BLUEPRINT_FIXTURE_DATA)
    const waypoints = scene.tokenPath.map((w) => new THREE.Vector3(...w.position))
    const curve = new THREE.CatmullRomCurve3(waypoints, false, "centripetal")
    const n = waypoints.length

    let cycle = 0.15
    let progress = 0.15
    let emitTimer = 0
    const seenSteps = new Set<number>()
    const totalDuration = (1 + TOKEN_ENDPOINT_HOLD + 0.1) / TOKEN_SPEED
    let elapsed = 0
    let frame = 0

    while (elapsed < totalDuration) {
      const jitter = ((frame % 7) - 3) * 0.0004
      const dt = 1 / 60 + jitter
      elapsed += dt
      frame++

      const next = advanceTokenCycle(cycle, dt)
      cycle = next.cycle
      progress = next.progress

      emitTimer += dt
      if (emitTimer >= 0.12) {
        emitTimer = 0
        seenSteps.add(tokenStepFromCurve(curve, progress, n))
      }
    }

    expect([...seenSteps].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })
})
