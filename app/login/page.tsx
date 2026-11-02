"use client"

import { Suspense, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { stepUpPath } from "@/lib/auth/totp"
import { safeReturnPath } from "@/lib/supabase/redirect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MODES, MODE_COPY } from "@/lib/mode"

// Local-dev convenience, off by default: the demo button renders only when both
// vars are set at build time. Never set them for a real deployment.
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_LOGIN_EMAIL
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_LOGIN_PASSWORD

function LoginForm() {
  const params = useSearchParams()
  const redirectTo = safeReturnPath(params.get("redirect"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function signIn(em: string, pw: string) {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    if (error) {
      setLoading(false)
      toast.error("Sign in failed", { description: error.message })
      return
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
    <main className="grid min-h-svh lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden border-r p-12 lg:flex"
        style={{
          backgroundImage:
            "radial-gradient(42rem 28rem at 15% 0%, rgb(224 168 74 / 0.16), transparent 70%), repeating-linear-gradient(0deg, transparent 0 39px, rgb(244 239 228 / 0.028) 39px 40px)",
        }}
      >
        <div className="flex items-center gap-3">
          <Image src="/icon.png" alt="" width={36} height={36} className="rounded-lg" priority />
          <span className="font-heading text-lg font-semibold tracking-tight">BoomBigNose ERP</span>
        </div>
        <div className="max-w-xl space-y-8">
          <h2 className="text-5xl leading-[1.08] font-semibold">
            ทั้งธุรกิจ ในที่ทำงานเดียว
            <span className="text-primary block">One desk for the whole business.</span>
          </h2>
          <ul className="grid gap-4">
            {MODES.map((m) => (
              <li key={m} className="border-signal/60 grid gap-0.5 border-l-2 pl-4">
                <span className="font-semibold">
                  {MODE_COPY[m].th} / {MODE_COPY[m].en}
                </span>
                <span className="text-muted-foreground text-sm">{MODE_COPY[m].tipTh}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground text-sm">
          AI ทำงานบนเครื่องคุณ ข้อมูลไม่ออกนอกเครื่อง / AI runs on your own machine.
        </p>
      </aside>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <Image src="/icon.png" alt="" width={32} height={32} className="rounded-lg lg:hidden" priority />
            <h1 className="text-3xl font-semibold">BoomBigNose ERP</h1>
            <p className="text-muted-foreground text-sm">Sign in to your workspace.</p>
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
              <Label htmlFor="email">Email</Label>
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
              <Label htmlFor="password">Password</Label>
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
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
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
                  Use demo account
                </Button>
              ) : null}
            </div>
          </form>
          <p className="text-muted-foreground text-sm">
            No account yet?{" "}
            <Link href="/signup" className="text-primary underline underline-offset-4">
              Sign up
            </Link>
          </p>
        </div>
      </section>
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
