/** Which part of the app the 3D base should hint at, from the first path segment. */
export type Section = "dashboard" | "deals" | "clients" | "inventory" | "finance" | "settings" | "other"

const BY_SEGMENT: Record<string, Section> = {
  dashboard: "dashboard",
  deals: "deals",
  quotes: "deals",
  projects: "deals",
  automation: "deals",
  activities: "deals",
  clients: "clients",
  vendors: "clients",
  inventory: "inventory",
  products: "inventory",
  purchases: "inventory",
  finance: "finance",
  expenses: "finance",
  timesheets: "finance",
  reports: "finance",
  documents: "finance",
  settings: "settings",
  audit: "settings",
  import: "settings",
}

export function sectionOf(pathname: string | null): Section {
  const seg = (pathname ?? "").split("/")[1] ?? ""
  return BY_SEGMENT[seg] ?? "other"
}
