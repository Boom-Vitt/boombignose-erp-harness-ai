"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { formatBytes, sanitizePullLine, type ModelSnapshot } from "@/lib/ai/model-catalog"

export type AsrCardState = { offered: boolean; installed: boolean }

type Props = {
  initial: ModelSnapshot
  canInstall: boolean
  asr?: AsrCardState
}

export function LocalModelsCard({ initial, canInstall, asr = { offered: false, installed: false } }: Props) {
  const [snapshot, setSnapshot] = useState(initial)
  const [pending, setPending] = useState("")
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const [visionText, setVisionText] = useState("")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [picture, setPicture] = useState<{ mediaType: string; image: string } | null>(null)
  const [asrInstalled, setAsrInstalled] = useState(asr.installed)
  const [transcript, setTranscript] = useState("")
  const blocked = snapshot.blocked.filter((item) => !(item.modality === "asr" && asr.offered))

  async function refresh() {
    const response = await fetch("/api/local-models", { cache: "no-store" })
    if (!response.ok) return
    setSnapshot(await response.json())
  }

  async function install(id: string) {
    setError("")
    setPending(id)
    setProgress("กำลังดาวน์โหลด / Downloading…")
    try {
      const response = await fetch("/api/local-models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id }),
      })
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || "ดาวน์โหลดไม่สำเร็จ / The download failed.")
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pendingText = ""
      for (;;) {
        const step = await reader.read()
        if (step.done) break
        pendingText += decoder.decode(step.value, { stream: true })
        const lines = pendingText.split("\n")
        pendingText = lines.pop() ?? ""
        for (const line of lines) {
          const event = sanitizePullLine(line)
          if (!event) continue
          if (event.error) setError(event.error)
          if (event.total && event.completed !== undefined) {
            setProgress(`${Math.min(100, Math.round((event.completed / event.total) * 100))}%`)
          } else if (event.status) {
            setProgress(event.status)
          }
        }
      }
      await refresh()
    } catch {
      setError("ดาวน์โหลดไม่สำเร็จ / The download failed.")
    } finally {
      setPending("")
      setProgress("")
    }
  }

  async function remove(id: string) {
    if (!window.confirm("เอาโมเดลนี้ออกจากเครื่องนี้? / Remove this model from this computer?")) return
    setError("")
    setPending(id)
    try {
      const response = await fetch("/api/local-models", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(data?.error || "เอาออกไม่สำเร็จ / Could not remove the model.")
        return
      }
      await refresh()
    } catch {
      setError("เอาออกไม่สำเร็จ / Could not remove the model.")
    } finally {
      setPending("")
    }
  }

  async function readImage(file: File) {
    if (file.size > 1_400_000) {
      setError("รูปใหญ่เกินกว่าหน้าที่นี้รับได้ / That image is too large for this page.")
      return
    }
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error("read"))
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.readAsDataURL(file)
    }).catch(() => "")
    const match = encoded.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/)
    if (!match) {
      setError("ใช้ไฟล์ JPEG, PNG หรือ WebP / Use a JPEG, PNG, or WebP file.")
      return
    }
    setPending("vision")
    setError("")
    setVisionText("")
    try {
      const response = await fetch("/api/local-models/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: match[1], imageBase64: match[2] }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string; text?: string } | null
      if (!response.ok || !data?.text) {
        setError(data?.error || "อ่านรูปไม่สำเร็จ / The image could not be read.")
        return
      }
      setVisionText(data.text)
    } catch {
      setError("อ่านรูปไม่สำเร็จ / The image could not be read.")
    } finally {
      setPending("")
    }
  }

  async function speak(form: FormData) {
    setPending("speech")
    setError("")
    try {
      const response = await fetch("/api/local-models/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: String(form.get("text") ?? "") }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || "อ่านออกเสียงไม่สำเร็จ / Speech failed.")
        return
      }
      const blob = await response.blob()
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return URL.createObjectURL(blob)
      })
    } catch {
      setError("อ่านออกเสียงไม่สำเร็จ / Speech failed.")
    } finally {
      setPending("")
    }
  }

  async function installAsr() {
    setPending("asr")
    setError("")
    try {
      const response = await fetch("/api/local-asr/install", { method: "POST" })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(data?.error || "ดาวน์โหลดไม่สำเร็จ / The download failed.")
        return
      }
      setAsrInstalled(true)
    } catch {
      setError("ดาวน์โหลดไม่สำเร็จ / The download failed.")
    } finally {
      setPending("")
    }
  }

  async function removeAsr() {
    if (!window.confirm("เอาโปรแกรมถอดเสียงออกจากเครื่องนี้? / Remove speech to text from this computer?")) return
    setPending("asr")
    setError("")
    try {
      const response = await fetch("/api/local-asr/install", { method: "DELETE" })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(data?.error || "เอาออกไม่สำเร็จ / Could not remove speech to text.")
        return
      }
      setAsrInstalled(false)
      setTranscript("")
    } catch {
      setError("เอาออกไม่สำเร็จ / Could not remove speech to text.")
    } finally {
      setPending("")
    }
  }

  async function transcribe(file: File) {
    if (file.size > 4_000_000) {
      setError("ไฟล์เสียงใหญ่เกินกว่าหน้าที่นี้รับได้ / That recording is too large for this page.")
      return
    }
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error("read"))
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.readAsDataURL(file)
    }).catch(() => "")
    const match = encoded.match(/^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/)
    if (!match?.[1]) {
      setError("ใช้ไฟล์ WAV, MP3, FLAC หรือ Ogg / Use a WAV, MP3, FLAC, or Ogg file.")
      return
    }
    setPending("asr-try")
    setError("")
    setTranscript("")
    try {
      const response = await fetch("/api/local-asr/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: match[1] }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string; text?: string } | null
      if (!response.ok || !data?.text) {
        setError(data?.error || "ถอดเสียงไม่สำเร็จ / Speech to text failed.")
        return
      }
      setTranscript(data.text)
    } catch {
      setError("ถอดเสียงไม่สำเร็จ / Speech to text failed.")
    } finally {
      setPending("")
    }
  }

  async function draw(form: FormData) {
    setPending("image")
    setError("")
    setPicture(null)
    try {
      const response = await fetch("/api/local-models/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: String(form.get("prompt") ?? "") }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string; mediaType?: string; image?: string } | null
      if (!response.ok || !data?.image || !data.mediaType) {
        setError(data?.error || "สร้างภาพไม่สำเร็จ / The picture could not be created.")
        return
      }
      setPicture({ mediaType: data.mediaType, image: data.image })
    } catch {
      setError("สร้างภาพไม่สำเร็จ / The picture could not be created.")
    } finally {
      setPending("")
    }
  }

  const text = snapshot.rows.find((row) => row.id === "qwen2.5:3b")
  const vision = snapshot.rows.find((row) => row.id === "qwen2.5vl:3b")
  const image = snapshot.rows.find((row) => row.id === "x/flux2-klein:4b")
  const deck = [
    { n: "1", step: "text", title: "ข้อความ qwen2.5:3b / Text", row: text, missing: "ติดตั้งจากปุ่มด้านล่าง / Install with the button below" },
    { n: "2", step: "vision", title: "อ่านรูป qwen2.5vl:3b / Vision", row: vision, missing: "ติดตั้งจากปุ่มด้านล่าง / Install with the button below" },
    { n: "3", step: "image", title: image ? "สร้างภาพ x/flux2-klein:4b / Image" : "สร้างภาพ / Image", row: image, missing: "ยังไม่มีบนระบบนี้ / Not on this operating system" },
  ]

  return (
    <div id="local-models" className="bbn-sketch space-y-4 scroll-mt-20">
      <ol className="bbn-sketch-steps" aria-label="ขั้นตอนติดตั้งโมเดล / Model install steps">
        {deck.map((item) => (
          <li key={item.step} data-step={item.step}>
            <span className="bbn-step-pill">{item.n}</span>
            <span>
              {item.title}
              {" · "}
              {item.row?.installed ? "ติดตั้งแล้ว / Installed" : item.row ? item.missing : "ยังไม่มีบนระบบนี้ / Not on this operating system"}
            </span>
          </li>
        ))}
      </ol>
      <aside className="bbn-sticky">
        <p className="text-sm">โมเดลเหล่านี้ไม่ได้ลงรายการบัญชี และไม่ได้ยื่น ภ.พ.30 These models do not post a journal and do not file VAT.</p>
      </aside>
      <p className="text-sm text-muted-foreground">
        ติดตั้งโมเดลจากหน้านี้ได้เลย ไม่ต้องลง Ollama Desktop, ComfyUI, Whisper หรือแอปเสียงแยก น้ำหนักโมเดลไม่ได้อยู่ในไฟล์ติดตั้ง จะดาวน์โหลดเมื่อกดเท่านั้น และอยู่บนเครื่องนี้
        {" "}
        Install models here. You do not need Ollama Desktop, ComfyUI, a Whisper app, or a separate voice app. Weights are not in the installer. A download starts only when you ask, and it stays on this computer.
      </p>
      {snapshot.daemonMessage ? <p role="alert" className="text-sm">{snapshot.daemonMessage}</p> : null}
      <Button type="button" variant="outline" disabled={pending !== ""} onClick={() => void refresh().catch(() => setError("ตรวจสถานะไม่สำเร็จ / Could not refresh the model list."))}>ตรวจอีกครั้ง / Check again</Button>
      {!canInstall ? <p className="text-sm text-muted-foreground">เฉพาะเจ้าของหรือผู้ดูแลติดตั้งหรือเอาโมเดลออกได้ / Only an owner or admin can install or remove models.</p> : null}
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      {progress ? <p className="text-sm tabular-nums">{progress}</p> : null}
      <ul className="space-y-4">
        {snapshot.rows.map((row) => (
          <li key={row.id} data-modality={row.modality} className="bbn-sketch-card space-y-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium"><span className="bbn-step-pill">{stepNumber(row.modality)}</span>{row.titleTh} / {row.titleEn}</h3>
              <span className="text-muted-foreground text-xs">{row.installed ? "ติดตั้งแล้ว / Installed" : "ยังไม่ได้ติดตั้ง / Not installed"}</span>
            </div>
            <p className="text-muted-foreground text-xs">{row.id} · {row.license} · {row.sizeNote}{row.installedBytes ? ` · ${formatBytes(row.installedBytes)}` : ""}</p>
            <p className="text-sm">{row.detailTh} {row.detailEn}</p>
            {canInstall ? (
              <Button type="button" variant={row.installed ? "outline" : "default"} disabled={pending !== "" || !snapshot.daemonUp} onClick={() => (row.installed ? remove(row.id) : install(row.id))}>
                {pending === row.id ? "กำลังทำงาน…" : row.installed ? "เอาออก / Remove" : "ติดตั้ง / Install"}
              </Button>
            ) : null}
            {row.installed && row.try === "vision" ? (
              <label className="block text-sm">
                ลองอ่านรูป / Try an image
                <input className="mt-1 block text-sm" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending !== ""} onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) void readImage(file)
                }} />
              </label>
            ) : null}
            {visionText && row.try === "vision" ? <p className="text-sm whitespace-pre-wrap">{visionText}</p> : null}
            {row.installed && row.try === "speech" ? (
              <form className="flex flex-wrap items-end gap-2" action={(form) => void speak(form)}>
                <label className="text-sm">ประโยคภาษาอังกฤษ / English sentence
                  <input name="text" maxLength={200} className="mt-1 block h-9 rounded-[0.6rem] border border-input bg-background px-3" />
                </label>
                <Button type="submit" variant="outline" disabled={pending !== ""}>พูด / Speak</Button>
              </form>
            ) : null}
            {audioUrl && row.try === "speech" ? <audio controls src={audioUrl} /> : null}
            {row.installed && row.try === "image" ? (
              <form className="flex flex-wrap items-end gap-2" action={(form) => void draw(form)}>
                <label className="text-sm">คำอธิบายภาพ / Picture prompt
                  <input name="prompt" maxLength={300} className="mt-1 block h-9 rounded-[0.6rem] border border-input bg-background px-3" />
                </label>
                <Button type="submit" variant="outline" disabled={pending !== ""}>สร้างภาพ / Draw</Button>
              </form>
            ) : null}
            {picture && row.try === "image" ? (
              // The picture exists only in this page's memory. next/image cannot optimize a data URL that is not stored.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="ภาพที่สร้างบนเครื่องนี้" src={`data:${picture.mediaType};base64,${picture.image}`} className="max-h-80 rounded-md border" />
            ) : null}
          </li>
        ))}
      </ul>
      {asr.offered ? (
        <section data-modality="asr" className="bbn-sketch-card space-y-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">ถอดเสียง / Speech to text</h3>
            <span className="text-muted-foreground text-xs">{asrInstalled ? "ติดตั้งแล้ว / Installed" : "ยังไม่ได้ติดตั้ง / Not installed"}</span>
          </div>
          <p className="text-muted-foreground text-xs">whisper.cpp {`b5454`} · MIT · ggml-tiny about 74 MB</p>
          <p className="text-sm">ถอดเสียงบนเครื่องนี้ แอปดาวน์โหลด whisper.cpp ให้เอง ไม่ต้องติดตั้ง Whisper Desktop โมเดล tiny ฟังภาษาไทยและภาษาอื่นได้ในระดับหนึ่ง ข้อความอยู่แค่บนหน้านี้ ไม่ได้ถูกบันทึกเป็นรายการบัญชีและไม่ได้ยื่น ภ.พ.30 Speech to text stays on this computer. This app downloads whisper.cpp. You do not install Whisper Desktop. The tiny model can transcribe Thai and other languages, with the limits of a small model. The text stays on this page. It is not saved as an accounting entry and it does not file VAT.</p>
          {canInstall ? (
            <Button type="button" variant={asrInstalled ? "outline" : "default"} disabled={pending !== ""} onClick={() => void (asrInstalled ? removeAsr() : installAsr())}>
              {pending === "asr" ? "กำลังทำงาน…" : asrInstalled ? "เอาออก / Remove" : "ติดตั้ง / Install"}
            </Button>
          ) : null}
          {asrInstalled ? (
            <label className="block text-sm">
              ลองถอดเสียง / Try a recording
              <input className="mt-1 block text-sm" type="file" accept="audio/wav,audio/mpeg,audio/flac,audio/ogg,.wav,.mp3,.flac,.ogg" disabled={pending !== ""} onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) void transcribe(file)
              }} />
            </label>
          ) : null}
          {transcript ? <p className="text-sm whitespace-pre-wrap">{transcript}</p> : null}
        </section>
      ) : null}
      <ul className="space-y-3">
        {blocked.map((item) => (
          <li key={item.modality} data-modality={item.modality} className="rounded-xl border border-dashed p-4 text-sm">
            <p className="font-medium">{blockedTitle(item.modality)}</p>
            <p className="text-muted-foreground mt-1">{item.reasonTh}</p>
            <p className="text-muted-foreground">{item.reasonEn}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function stepNumber(modality: string): string {
  switch (modality) {
    case "text":
      return "1"
    case "vision":
      return "2"
    case "image":
      return "3"
    case "tts":
      return "4"
    default:
      return "•"
  }
}

function blockedTitle(modality: string): string {
  switch (modality) {
    case "image":
      return "สร้างภาพ / Image"
    case "tts":
      return "อ่านออกเสียง / Speech"
    case "video":
      return "วิดีโอ / Video"
    case "asr":
      return "ถอดเสียง / Speech to text"
    case "voice-clone":
      return "โคลนเสียง / Voice clone"
    default:
      return modality
  }
}
