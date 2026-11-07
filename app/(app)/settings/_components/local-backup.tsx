"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

type DirectoryHandle = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{
    createWritable: () => Promise<WritableStream<Uint8Array> & { write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
  }>
}

async function chooseFolder(): Promise<DirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<DirectoryHandle> }).showDirectoryPicker
  if (!picker) return null
  return picker({ mode: "readwrite" })
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function LocalBackupCard() {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  async function exportBackup() {
    setPending(true)
    setError("")
    setMessage("")
    try {
      let folder: DirectoryHandle | null = null
      try {
        folder = await chooseFolder()
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return
        folder = null
      }
      const response = await fetch("/api/local-backup", { method: "POST" })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? "The local backup could not be written.")
        return
      }
      const name = response.headers.get("X-Backup-Name") ?? ""
      const hex = response.headers.get("X-Backup-Sha256") ?? ""
      if (!/^boombignose-[0-9]{8}T[0-9]{6}Z\.dump$/.test(name) || !/^[a-f0-9]{64}$/.test(hex)) {
        setError("The backup response was not a checksummed dump.")
        return
      }
      const sidecar = new Blob([`${hex}  ${name}\n`], { type: "text/plain" })
      if (folder) {
        const dumpFile = await folder.getFileHandle(name, { create: true })
        const dumpOut = await dumpFile.createWritable()
        if (!response.body) throw new Error("Missing backup stream.")
        await response.body.pipeTo(dumpOut)
        const sideFile = await folder.getFileHandle(`${name}.sha256`, { create: true })
        const sideOut = await sideFile.createWritable()
        await sideOut.write(sidecar)
        await sideOut.close()
        setMessage(`Wrote ${name} and ${name}.sha256 in the folder you chose.`)
      } else {
        const dump = await response.blob()
        downloadBlob(dump, name)
        downloadBlob(sidecar, `${name}.sha256`)
        setMessage("Save both files in the same folder. Restore needs the dump and the checksum.")
      }
    } catch {
      setError("The local backup could not be written.")
    } finally {
      setPending(false)
    }
  }

  async function restoreBackup(form: FormData) {
    setPending(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/local-backup/restore", { method: "POST", body: form })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? "Restore failed.")
        return
      }
      setMessage("Restored the local database. Reload before you keep working.")
    } catch {
      setError("Restore failed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Database-only backup · ทุกเวิร์กสเปซบนเครื่องนี้ รวมบัญชีผู้ใช้และข้อมูลธุรกิจ
        ใช้ได้เฉพาะ owner/admin ที่ผู้ดูแลเครื่องอนุญาตเป็น machine operator เท่านั้น
      </p>
      <p className="text-sm text-muted-foreground">
        Does not include attachment files, native server secrets/configuration, or local AI models.
        Keep those separately in a private operator-managed recovery set. Downloads contain sensitive
        data from every workspace; store both the dump and checksum securely. Maximum dump: 512 MiB.
      </p>
      <Button type="button" disabled={pending} onClick={() => void exportBackup()}>
        {pending ? "Working…" : "Export backup"}
      </Button>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void restoreBackup(new FormData(event.currentTarget))
        }}
      >
        <label className="block text-sm">
          Dump file
          <input className="mt-1 block w-full text-sm" type="file" name="dump" accept=".dump" required />
        </label>
        <label className="block text-sm">
          Checksum file
          <input className="mt-1 block w-full text-sm" type="file" name="checksum" accept=".sha256,text/plain" required />
        </label>
        <p className="text-sm text-muted-foreground">
          Restore replaces database contents across all workspaces and may invalidate current sessions.
          Attachments and native secrets are not restored. Only restore a backup from a source you trust:
          a PostgreSQL dump executes SQL as database administrator and can access server-side files/code
          under the server&apos;s OS account. A matching checksum proves file integrity, not who created it
          or that its SQL is safe. Pause other users before restoring.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" name="trustedSource" value="yes" required />
          I trust the source of this backup and understand it affects every workspace.
        </label>
        <label className="block text-sm">
          Type RESTORE ALL WORKSPACES to confirm
          <input
            className="mt-1 block w-full rounded border bg-background px-3 py-2 text-sm"
            type="text"
            name="confirmation"
            pattern="RESTORE ALL WORKSPACES"
            autoComplete="off"
            required
          />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>Restore backup</Button>
      </form>
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}
