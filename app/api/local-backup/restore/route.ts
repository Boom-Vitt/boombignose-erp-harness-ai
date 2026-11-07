import { localBackupStatus, restoreLocalBackup } from "@/lib/install/local-backup-run"

export const dynamic = "force-dynamic"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return restoreLocalBackup(request)
}

export async function GET(request: Request) {
  return localBackupStatus(request)
}
