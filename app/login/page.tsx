"use client"

import { Suspense, useState, useSyncExternalStore } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { stepUpPath } from "@/lib/auth/totp"
import { safeReturnPath } from "@/lib/supabase/redirect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MODE_ICON } from "@/components/nav"
import { MODES, MODE_COPY } from "@/lib/mode"
import { StageBackdrop } from "@/components/three/stage-backdrop"

// Local-dev convenience, off by default: the demo button renders only when both
// vars are set at build time. Never set them for a real deployment.
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_LOGIN_EMAIL
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_LOGIN_PASSWORD

type Lang = "th" | "en"
const LANG_KEY = "bbn-lang"
const COPY = {
  th: { sub: "เข้าสู่ระบบพื้นที่ทำงานของคุณ", email: "อีเมล", password: "รหัสผ่าน", signIn: "เข้าสู่ระบบ", demo: "ใช้บัญชีทดลอง", failed: "เข้าสู่ระบบไม่สำเร็จ", noAccount: "ยังไม่มีบัญชี?", signUp: "สมัครใช้งาน", toggle: "สลับ ENG", toggleLabel: "Switch to English" },
  en: { sub: "Sign in to your workspace.", email: "Email", password: "Password", signIn: "Sign in", demo: "Use demo account", failed: "Sign in failed", noAccount: "No account yet?", signUp: "Sign up", toggle: "สลับ ไทย", toggleLabel: "สลับเป็นภาษาไทย" },
} as const

function LoginForm() {
  const params = useSearchParams()
  const redirectTo = safeReturnPath(params.get("redirect"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  // Thai by default; an explicit choice is kept in localStorage until the profile can hold it.
  const stored = useSyncExternalStore(() => () => {}, () => localStorage.getItem(LANG_KEY), () => null)
  const [picked, setPicked] = useState<Lang | null>(null)
  const lang: Lang = picked ?? (stored === "en" ? "en" : "th")
  const t = COPY[lang]
  function toggleLang() {
    const next: Lang = lang === "th" ? "en" : "th"
    setPicked(next)
    localStorage.setItem(LANG_KEY, next)
  }

  async function signIn(em: string, pw: string) {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    if (error) {
      setLoading(false)
      toast.error(t.failed, { description: error.message })
      return
    }
    // Toggled on this screen: that choice becomes the profile language. Otherwise profiles.locale rules.
    if (picked) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.from("profiles").update({ locale: picked }).eq("id", user.id)
    }
    const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (!level.error && level.data) {
      const next = stepUpPath({
        hasVerifiedTotp: level.data.nextLevel === "aal2",
        authenticatorAssuranceLevel: level.data.currentLevel,
      })
      if (next) {
        // Full load, so the cookie write is finished before the app renders.
        window.location.assign(next)
        return
      }
    }
    window.location.assign(redirectTo)
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden p-4 sm:p-8">
      <StageBackdrop section="other" />
      <div className="relative z-10 grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,24rem)]">
        <section className="hidden space-y-8 lg:block">
          <div className="flex items-center gap-3">
            <Image src="/icon.png" alt="" width={40} height={40} className="bbn-rough-sm" priority />
            <span className="font-heading text-lg font-semibold tracking-tight">BoomBigNose ERP</span>
          </div>
          <h2 className="text-5xl leading-[1.12] font-bold">
            ทั้งธุรกิจ ในที่ทำงานเดียว
            <span className="text-primary mt-1 block text-3xl font-semibold">One desk for the whole business.</span>
          </h2>
          <ul className="grid max-w-md gap-4">
            {MODES.map((m, i) => {
              const Icon = MODE_ICON[m]
              return (
                <li
                  key={m}
                  className="bbn-glass flex items-start gap-3 p-3.5"
                  style={{ marginLeft: `${i * 1.25}rem` }}
                >
                  <span className="bbn-rough-sm border-primary/60 bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center border">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="grid gap-0.5">
                    <span className="font-semibold">
                      {MODE_COPY[m].th} / {MODE_COPY[m].en}
                    </span>
                    <span className="text-muted-foreground text-sm">{MODE_COPY[m].tipTh}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <ShieldCheck className="text-gold size-4 shrink-0" aria-hidden />
            AI ทำงานบนเครื่องคุณ ข้อมูลไม่ออกนอกเครื่อง / AI runs on your own machine.
          </p>
        </section>

        <section className="bbn-glass w-full space-y-6 p-6 sm:p-8">
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" aria-label={t.toggleLabel} onClick={toggleLang}>{t.toggle}</Button>
          </div>
          <div className="space-y-2">
            <Image src="/icon.png" alt="" width={32} height={32} className="bbn-rough-sm lg:hidden" priority />
            <h1 className="bbn-title text-3xl font-bold">BoomBigNose ERP</h1>
            <p className="text-muted-foreground text-sm">{t.sub}</p>
            {params.get("error") ? <p role="alert" className="text-destructive text-sm">{params.get("error")}</p> : null}
          </div>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              void signIn(email, password)
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-3 pt-1">
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : t.signIn}
              </Button>
              {DEMO_EMAIL && DEMO_PASSWORD ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  disabled={loading}
                  onClick={() => void signIn(DEMO_EMAIL, DEMO_PASSWORD)}
                >
                  {t.demo}
                </Button>
              ) : null}
            </div>
          </form>
          <p className="text-muted-foreground border-t pt-4 text-sm">
            {t.noAccount}{" "}
            <Link href="/signup" className="text-primary underline underline-offset-4">
              {t.signUp}
            </Link>
          </p>
        </section>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
