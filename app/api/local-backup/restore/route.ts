import { restoreLocalBackup } from "@/lib/install/local-backup-run"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const form = await request.formData()
  const dump = form.get("dump")
  const sidecar = form.get("checksum")
  if (!(dump instanceof File) || !(sidecar instanceof File)) {
    return Response.json({ error: "Choose the dump and its checksum file." }, { status: 400 })
  }
  return restoreLocalBackup(dump, sidecar)
}
