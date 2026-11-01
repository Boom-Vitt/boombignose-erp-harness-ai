import { exportLocalBackup } from "@/lib/install/local-backup-run"

export const dynamic = "force-dynamic"

export async function POST() {
  return exportLocalBackup()
}
