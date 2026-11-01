import { describe, expect, it } from "vitest"

import { NAV_ITEMS } from "@/components/nav"
import { paletteCommands } from "./commands"

const titles = (commands: { title: string }[]) => commands.map((c) => c.title)

describe("palette command list", () => {
  it("offers every nav module to owners and admins, in nav order", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(paletteCommands(role).goTo.map((c) => [c.title, c.href])).toEqual(
        NAV_ITEMS.map((item) => [item.title, item.href])
      )
    }
  })

  it("hides owner/admin-only modules from members, like the sidebar", () => {
    const goTo = titles(paletteCommands("member").goTo)
    expect(goTo).not.toContain("Activity")
    expect(goTo).toEqual(NAV_ITEMS.filter((item) => !item.ownerAdminOnly).map((item) => item.title))
  })

  it("shows the audit log to an accountant and hides workspace setup creates", () => {
    expect(titles(paletteCommands("accountant").goTo)).toContain("Activity")
    expect(titles(paletteCommands("accountant").create)).toEqual([
      "New deal",
      "New quote",
      "New invoice",
      "New client",
      "New project",
    ])
  })

  it("filters create commands by what the role may create", () => {
    const all = ["New deal", "New quote", "New invoice", "New client", "New project", "New product", "New purchase order", "New vendor"]
    expect(titles(paletteCommands("owner").create)).toEqual(all)
    expect(titles(paletteCommands("admin").create)).toEqual(all)
    expect(titles(paletteCommands("member").create)).toEqual([
      "New deal",
      "New quote",
      "New client",
      "New project",
    ])
  })
})
