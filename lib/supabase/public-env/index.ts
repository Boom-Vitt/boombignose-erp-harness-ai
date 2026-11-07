import { createElement } from "react"
import { connection } from "next/server"

export const PUBLIC_ENV_SCRIPT_ID = "erp-public-env"

export interface PublicSupabaseEnv {
  url: string
  anonKey: string
  nativeAuthProxy?: boolean
}

export function serializePublicEnv(
  env: NodeJS.ProcessEnv = process.env
): string {
  const payload: PublicSupabaseEnv = {
    url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    ...(env.BOOMBIGNOSE_NATIVE === "1" ? { nativeAuthProxy: true } : {}),
  }
  return JSON.stringify(payload).replace(/</g, "\\u003c")
}

// Client callers pass literal NEXT_PUBLIC reads only as build-time fallbacks; the injected data script takes precedence.
export interface PublicEnvFallback {
  NEXT_PUBLIC_SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string
}

export function readPublicEnv(
  doc?: { getElementById(id: string): { textContent: string | null } | null } | null,
  env: PublicEnvFallback = {}
): PublicSupabaseEnv {
  const targetDoc =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
        ? document
        : null
  const raw = targetDoc?.getElementById(PUBLIC_ENV_SCRIPT_ID)?.textContent
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<PublicSupabaseEnv>
      const url = typeof parsed?.url === "string" && parsed.url ? parsed.url : (env.NEXT_PUBLIC_SUPABASE_URL ?? "")
      const anonKey =
        typeof parsed?.anonKey === "string" && parsed.anonKey
          ? parsed.anonKey
          : (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
      return { url, anonKey, ...(parsed.nativeAuthProxy === true ? { nativeAuthProxy: true } : {}) }
    } catch {
      // Fall back to process.env below
    }
  }
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  }
}

export async function PublicEnvScript() {
  await connection()
  const json = serializePublicEnv(process.env)
  return createElement("script", {
    id: PUBLIC_ENV_SCRIPT_ID,
    type: "application/json",
    dangerouslySetInnerHTML: { __html: json },
  })
}
