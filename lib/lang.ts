import "server-only"

import { createClient } from "@/lib/supabase/server"

export type Lang = "th" | "en"

/** UI language: profiles.locale when it is "en", otherwise Thai (the default). */
export async function readLang(): Promise<Lang> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return "th"
  const { data } = await supabase.from("profiles").select("locale").eq("id", user.id).maybeSingle()
  return data?.locale === "en" ? "en" : "th"
}
