import { localModelAccess } from "@/lib/ai/local-model-access"
import { localUpdatesDir } from "@/lib/install/logs"
import { performDesktopUpdate, UpdateFlowError, type UpdateEvent } from "@/lib/release/perform-update"
import { APP_VERSION } from "@/lib/release/version"
import { helperConfigured } from "@/lib/release/update-plan"

export const dynamic = "force-dynamic"

export async function POST() {
  const block = await localModelAccess(true)
  if (block) return block
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: UpdateEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      try {
        await performDesktopUpdate({
          platform: process.platform,
          arch: process.arch,
          currentVersion: APP_VERSION,
          helperConfigured: helperConfigured(),
          fetchImpl: fetch,
          stageDir: localUpdatesDir() ?? "",
          onEvent: send,
        })
      } catch (error) {
        const message = error instanceof UpdateFlowError ? error.message : "The update stopped."
        send({ phase: "error", message })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
