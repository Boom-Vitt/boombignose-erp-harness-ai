/** Request-time, authorized ERP workload; no simulated people, departments or telemetry. */
export type WorkloadMetric = { th: string; en: string; count: number; href: string; attention?: boolean }
export type WorkloadModule = {
  id: string
  th: string
  en: string
  href: string
  workload: number
  unit: { th: string; en: string }
  metrics: WorkloadMetric[]
  scope: "workspace" | "mine"
}
export type WorkloadTask = { id: string; title: string; status: string; dueDate: string | null; href: string }
export type OrganizationSnapshot = {
  orgName: string
  role: string
  capturedAt: string
  modules: WorkloadModule[]
  tasks: WorkloadTask[]
  limited: boolean
}
