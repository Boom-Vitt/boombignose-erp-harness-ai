import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LocalModelsCard } from "@/app/(app)/settings/_components/local-models"
import { buildSnapshot } from "@/lib/ai/model-catalog"

describe("local model settings", () => {
  it("tells a Linux operator which models install inside the ERP", () => {
    const snapshot = buildSnapshot(
      { platform: "linux", arch: "x64" },
      [{ name: "qwen3:4b", size: 100 }],
      { up: true },
    )
    const html = renderToStaticMarkup(createElement(LocalModelsCard, { initial: snapshot, canInstall: true }))
    expect(html).toContain("ตรวจอีกครั้ง / Check again")
    expect(html).toContain("ไม่ต้องลง Ollama Desktop")
    expect(html).toContain("You do not need Ollama Desktop, ComfyUI, a Whisper app")
    expect(html).toContain("ติดตั้งแล้ว / Installed")
    expect(html).toContain("qwen2.5vl:3b")
    expect(html).toContain("ติดตั้ง / Install")
    expect(html).toContain("ไม่ได้ยื่น ภ.พ.30")
    expect(html).toContain("วิดีโอ / Video")
    expect(html).toContain("ถอดเสียง / Speech to text")
    expect(html).toContain("โคลนเสียง / Voice clone")
    expect(html).toContain("Not available in this build")
    const offered = renderToStaticMarkup(createElement(LocalModelsCard, {
      initial: snapshot,
      canInstall: true,
      asr: { offered: true, installed: false },
    }))
    expect(offered).toContain("whisper.cpp")
    expect(offered).toContain("ไม่ต้องติดตั้ง Whisper Desktop")
    expect(offered).toContain("ภาษาไทย")
    expect(offered).not.toContain("data-modality=\"asr\" class=\"rounded-md border border-dashed")
    expect(html).not.toContain("x/flux2-klein:4b")
    expect(html).not.toContain(">phonon<")
  })

  it("offers image and speech install buttons on Apple Silicon", () => {
    const snapshot = buildSnapshot({ platform: "darwin", arch: "arm64" }, [], { up: false })
    const html = renderToStaticMarkup(createElement(LocalModelsCard, { initial: snapshot, canInstall: true }))
    expect(html).toContain("data-modality=\"image\"")
    expect(html).toContain("data-modality=\"tts\"")
    expect(html).toContain("x/flux2-klein:4b")
    expect(html).toContain("phonon")
    expect(html).toContain("ไม่ใช่การโคลนเสียง")
    expect(html).toContain("Ollama Desktop")
  })
})
