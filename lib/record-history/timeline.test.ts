import { describe, expect, it } from "vitest"
import type { Tables } from "@/lib/types/database"
import { auditText, mergeLoaded, mergeTimeline, timelineDay, type TimelineEntry } from "./timeline"

const base = { org_id: "org", record_type: "quote" as const, record_id: "record", created_at: "2026-10-22T08:00:00Z" }
const note: Tables<"record_notes"> = { ...base, id: "same", author: "author", body: "Internal note" }
const attachment: Tables<"record_attachments"> = { ...base, id: "same", path: "private/path", filename: "scope.pdf", size: 20, content_type: "application/pdf", uploaded_by: "author", created_at: "2026-10-22T09:00:00Z" }
const activity: Tables<"activities"> = { ...base, id: "same", owner: "assignee", type: "call", body: "Discuss scope", due_date: "2026-10-22", done: true, client_id: null, deal_id: null, updated_at: "2026-10-23T15:00:00Z", completed_at: "2026-10-22T10:00:00Z", completed_by: "completer" }
const audit: Tables<"audit_log"> = { org_id: "org", id: "same", created_at: "2026-10-22T11:00:00Z", actor_id: "author", actor_email: null, entity: "quote", entity_id: "record", action: "status_changed", summary: "Status changed", meta: { from: "sent", to: "accepted" }, close_chain_prev: null, close_chain_seq: null, close_chain_sha256: null }

describe("record timeline", () => {
  it("attributes completion to the completing actor rather than the assignee", () => {
    const completed = { ...activity, owner: "alice", completed_by: "bob" }
    expect(mergeTimeline({ notes: [], attachments: [], activities: [completed], audits: [] })[0].actor).toBe("bob")
    expect(mergeTimeline({ notes: [], attachments: [], activities: [{ ...completed, completed_by: null }], audits: [] })[0].actor).toBeNull()
  })
  it("merges all four sources newest first and leaves input unchanged", () => {
    const input = { notes: [note], attachments: [attachment], activities: [activity, { ...activity, id: "open", done: false }], audits: [audit] }
    const snapshot = structuredClone(input)
    const timeline = mergeTimeline(input)
    expect(timeline.map(entry => entry.kind)).toEqual(["audit", "activity", "attachment", "note"])
    expect(timeline[0].text).toBe("Status: Sent → Accepted")
    expect(timeline[1].at).toBe(activity.completed_at)
    expect(timeline[1].text).toBe("Call completed · Discuss scope")
    expect(new Set(timeline.map(entry => entry.id)).size).toBe(4)
    expect(timeline[2].attachmentId).toBe(attachment.id)
    expect(input).toEqual(snapshot)
  })
  it("handles empty history and deterministically breaks equal-time ties", () => {
    expect(mergeTimeline({ notes: [], attachments: [], activities: [], audits: [] })).toEqual([])
    const input = { notes: [note, { ...note, id: "another" }], attachments: [], activities: [], audits: [] }
    expect(mergeTimeline(input).map(entry => entry.id)).toEqual(["note:another", "note:same"])
    expect(mergeTimeline({ ...input, notes: [...input.notes].reverse() })).toEqual(mergeTimeline(input))
  })
  it("orders PostgreSQL microseconds exactly rather than breaking a millisecond tie by id", () => {
    const notes = [
      { ...note, id: "a", created_at: "2026-10-23T10:00:00.123001+00:00" },
      { ...note, id: "z", created_at: "2026-10-23T10:00:00.123999+00:00" },
    ]
    expect(mergeTimeline({ notes, attachments: [], activities: [], audits: [] }).map(entry => entry.id)).toEqual(["note:z", "note:a"])
  })
  it("uses updated_at for legacy completed activities without a completion timestamp", () => {
    const timeline = mergeTimeline({ notes: [], attachments: [], activities: [{ ...activity, completed_at: null, body: null }], audits: [] })
    expect(timeline[0].at).toBe(activity.updated_at)
    expect(timeline[0].text).toBe("Call completed")
  })
  it("formats Bangkok day headers and safe audit fallbacks", () => {
    expect(timelineDay("2026-10-22T18:00:00Z")).toBe("23 Oct 2026")
    expect(auditText({ action: "invoice_issued", summary: null, meta: [] })).toBe("Invoice Issued")
    expect(auditText({ action: "updated", summary: "Updated scope", meta: { from: 1, to: 2 } })).toBe("Updated scope")
    expect(auditText({ action: "updated", summary: null, meta: { old_status: "partially_paid", new_status: "paid" } })).toBe("Status: Partially Paid → Paid")
  })
})

describe("mergeLoaded", () => {
  const entry = (n: number): TimelineEntry => ({ id: `note:${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`, kind: "note", at: new Date(Date.UTC(2026, 9, 23, 0, 0, 0) - n * 60_000).toISOString(), actor: null, text: `Entry ${n}` })
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => entry(from + index))
  const cursorAfter = (last: TimelineEntry) => ({ at: last.at, id: last.id })
  const ids = (entries: TimelineEntry[]) => entries.map(item => item.text)

  it("shows the fresh first page alone when nothing older was loaded", () => {
    const initial = { timeline: range(1, 3), nextCursor: cursorAfter(entry(3)) }
    expect(mergeLoaded(initial, null)).toEqual({ entries: initial.timeline, cursor: initial.nextCursor })
  })
  it("keeps loaded older pages when a refresh adds new entries and pushes one off the first page", () => {
    const loaded = { entries: range(1, 6), cursor: cursorAfter(entry(6)) }
    const fresh = { timeline: [entry(0), ...range(1, 2)], nextCursor: cursorAfter(entry(2)) }
    const merged = mergeLoaded(fresh, loaded)
    expect(ids(merged.entries)).toEqual(["Entry 0", "Entry 1", "Entry 2", "Entry 3", "Entry 4", "Entry 5", "Entry 6"])
    expect(merged.cursor).toEqual(loaded.cursor)
  })
  it("drops older pages when new entries leave a gap after the fresh first page", () => {
    const loaded = { entries: range(1, 6), cursor: cursorAfter(entry(6)) }
    const fresh = { timeline: range(-3, -1), nextCursor: cursorAfter(entry(-1)) }
    expect(mergeLoaded(fresh, loaded)).toEqual({ entries: fresh.timeline, cursor: fresh.nextCursor })
  })
  it("shows the fresh page and its end when it now holds all history", () => {
    const loaded = { entries: range(1, 4), cursor: cursorAfter(entry(4)) }
    const fresh = { timeline: range(1, 3), nextCursor: null }
    expect(mergeLoaded(fresh, loaded)).toEqual({ entries: fresh.timeline, cursor: null })
  })
  it("prefers the fresh copy of an entry that is on both pages", () => {
    const loaded = { entries: range(1, 3), cursor: cursorAfter(entry(3)) }
    const fresh = { timeline: [{ ...entry(1), text: "Edited" }], nextCursor: cursorAfter(entry(1)) }
    expect(ids(mergeLoaded(fresh, loaded).entries)).toEqual(["Edited", "Entry 2", "Entry 3"])
  })
})
