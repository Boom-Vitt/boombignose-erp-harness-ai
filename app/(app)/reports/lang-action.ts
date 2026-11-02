"use server"

import { createClient } from "@/lib/supabase/server"
import type { Lang } from "@/lib/lang"

/** Save the signed-in user's UI language on profiles.locale (own row only, by RLS). */
export async function saveLang(lang: Lang): Promise<void> {
  if (lang !== "th" && lang !== "en") return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from("profiles").update({ locale: lang }).eq("id", user.id)
}
