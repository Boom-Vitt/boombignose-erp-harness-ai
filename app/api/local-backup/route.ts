import { exportLocalBackup, localBackupStatus } from "@/lib/install/local-backup-run"

export const dynamic = "force-dynamic"

export const runtime = "nodejs"

export async function GET(request: Request) {
  return localBackupStatus(request)
}

export async function POST(request: Request) {
  return exportLocalBackup(request)
}
