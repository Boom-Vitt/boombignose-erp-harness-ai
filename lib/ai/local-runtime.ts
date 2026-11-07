import "server-only"

import { safeModelId } from "@/lib/ai/model-catalog"

export class LocalModelUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "LocalModelUnavailable" }
}

/** A loopback address alone is not proof: Ollama can also proxy cloud-backed models. */
export async function checkedLocalModel(origin: string, model: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<"gguf" | "safetensors"> {
  if (!safeModelId(model) || /(?:^|[:/])cloud(?:$|[:/-])/i.test(model)) {
    throw new LocalModelUnavailable("Choose an installed local model. Cloud-backed models are not allowed for ERP data.")
  }
  let response: Response
  try {
    response = await fetchImpl(`${origin}/api/show`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }),
      redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    })
  } catch {
    throw new LocalModelUnavailable("The local model service could not be reached. Check Settings before retrying.")
  }
  if (response.status === 404) throw new LocalModelUnavailable(`Install ${model} in Settings first. No model is downloaded by this request.`)
  if (!response.ok) throw new LocalModelUnavailable(`The local model service could not verify ${model}.`)
  const data = await response.json().catch(() => null) as { remote_host?: unknown; remote_model?: unknown; details?: { format?: unknown }; capabilities?: unknown } | null
  const format = data?.details?.format
  if (!data || data.remote_host || data.remote_model || (format !== "gguf" && format !== "safetensors") || !Array.isArray(data.capabilities) || !data.capabilities.includes("completion")) {
    throw new LocalModelUnavailable("This model is not a verified local text/vision checkpoint. Cloud-backed or unsupported models are refused.")
  }
  return format
}
