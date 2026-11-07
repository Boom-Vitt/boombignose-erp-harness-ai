"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { saveLoginLocale } from "../actions"
import { safeReturnPath } from "@/lib/supabase/redirect"

function MfaForm() {
  const params = useSearchParams()
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)

  async function confirm(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const factors = await supabase.auth.mfa.listFactors()
    const factor = (factors.data?.totp ?? []).find((item) => item.status === "verified")
    if (factors.error || !factor) {
      setLoading(false)
      toast.error("No authenticator is enrolled for this account", {
        description: factors.error?.message,
      })
      return
    }
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challenge.error || !challenge.data?.id) {
      setLoading(false)
      toast.error("Could not start verification", { description: challenge.error?.message })
      return
    }
    const checked = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.data.id,
      code: code.trim(),
    })
    if (checked.error) {
      setLoading(false)
      toast.error("Code was not accepted", { description: checked.error.message })
      return
    }
    const chosen = localStorage.getItem("bbn-lang")
    if (chosen && await saveLoginLocale(chosen)) localStorage.removeItem("bbn-lang")
    window.location.assign(safeReturnPath(params.get("redirect")))
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Authenticator</CardTitle>
          <CardDescription>This account has a saved authenticator. Other accounts are not asked.</CardDescription>
        </CardHeader>
        <form onSubmit={(event) => void confirm(event)}>
          <CardContent className="space-y-2">
            <Label htmlFor="mfa-code">Code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Continue"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

export default function MfaPage() {
  return <Suspense><MfaForm /></Suspense>
}
