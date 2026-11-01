"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

type DirectoryHandle = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
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
      const dump = await response.blob()
      const sidecar = new Blob([`${hex}  ${name}\n`], { type: "text/plain" })
      if (folder) {
        const dumpFile = await folder.getFileHandle(name, { create: true })
        const dumpOut = await dumpFile.createWritable()
        await dumpOut.write(dump)
        await dumpOut.close()
        const sideFile = await folder.getFileHandle(`${name}.sha256`, { create: true })
        const sideOut = await sideFile.createWritable()
        await sideOut.write(sidecar)
        await sideOut.close()
        setMessage(`Wrote ${name} and ${name}.sha256 in the folder you chose.`)
      } else {
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
        สำรองฐานข้อมูลบนเครื่องนี้ / Export writes a Postgres dump and a checksum into a folder you choose. Restore checks the checksum before it replaces this install&apos;s database. It does not upload the file anywhere.
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
        <Button type="submit" variant="outline" disabled={pending}>Restore backup</Button>
      </form>
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}
