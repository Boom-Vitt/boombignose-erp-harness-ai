import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { aal2Rollout, aal2RolloutNote, type Aal2Rollout } from "@/lib/auth/totp"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { EnrollTotp } from "./enroll-totp"

export const dynamic = "force-dynamic"

async function currentRollout(): Promise<Aal2Rollout> {
  const enrollFlag = process.env.LOCAL_TOTP_ENROLL
  try {
    const supabase = await createClient()
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (session.error || !token) throw new Error("Session assurance unavailable")
    const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(token)
    if (level.error || !level.data) {
      return aal2Rollout({
        enrollFlag,
        hasVerifiedTotp: false,
        authenticatorAssuranceLevel: null,
      })
    }
    return aal2Rollout({
      enrollFlag,
      hasVerifiedTotp: level.data.nextLevel === "aal2",
      authenticatorAssuranceLevel: level.data.currentLevel,
    })
  } catch {
    return aal2Rollout({
      enrollFlag,
      hasVerifiedTotp: false,
      authenticatorAssuranceLevel: null,
    })
  }
}

export default async function SecuritySettingsPage() {
  await requireOrgContext()
  const rollout = await currentRollout()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Authenticator"
        description="ตัวยืนยันตัวตนเสริมสำหรับบัญชีนี้"
      />
      <p className="text-sm">
        <Link href="/settings" className="underline">
          Back to settings
        </Link>
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">TOTP</CardTitle>
          <CardDescription>ลงทะเบียนผ่านระบบบนเครื่องนี้</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>{aal2RolloutNote(rollout)}</p>
          {rollout === "enroll" ? <EnrollTotp /> : null}
          {rollout === "challenge" ? (
            <p>
              <Link href="/login/mfa" className="underline">
                Enter the authenticator code
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
