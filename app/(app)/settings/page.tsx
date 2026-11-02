import { Wallet, Flame, Users, Lock, Cpu, Download, Smartphone } from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB, satangToBaht } from "@/lib/money"
import { PersonalAiCallout } from "@/components/personal-ai"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SettingsForm } from "./_components/settings-form"
import { PublicReferenceSetting } from "./_components/public-reference-setting"
import { InvitationsCard } from "./_components/invitations-card"
import { AccountingIntegrationCard } from "@edition"
import { StartLogViewer, UpdateCheckButton } from "./_components/local-install"
import { LocalBackupCard } from "./_components/local-backup"
import { MobileLinkCard } from "./_components/mobile-link"
import { LocalModelsCard } from "./_components/local-models"
import { currentModelHost } from "@/lib/ai/local-model-access"
import { asrCard } from "@/lib/ai/asr-install"
import { loadModelSettings } from "@/lib/ai/ollama-admin"
import { updateOrgSettings } from "./actions"
import { listDevices } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

function initials(name: string | null, fallback: string): string {
  const base = name?.trim() || fallback
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

const SECTION_LINK =
  "border-input text-muted-foreground hover:border-primary/70 hover:bg-accent hover:text-foreground rounded-full border px-3.5 py-1.5 text-sm transition-colors"

export default async function SettingsPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const canEdit = ctx.role === "owner" || ctx.role === "admin"

  // org_settings is a single row per org (org_id unique). May not exist yet.
  const { data: settings } = await supabase
    .from("org_settings")
    .select("cash_balance_satang, monthly_burn_satang, public_document_refs_enabled")
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  const cashSatang = settings?.cash_balance_satang ?? 0
  const burnSatang = settings?.monthly_burn_satang ?? null

  // Team: memberships have no PostgREST FK embed to profiles, so fetch both and
  // join in memory. RLS lets co-members read each other's profiles.
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true })

  const userIds = (members ?? []).map((m) => m.user_id)
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds)
    : { data: [] as { id: string; full_name: string | null }[] }

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name] as const)
  )

  const mobileDevices = canEdit ? await listDevices(createAdminClient(), ctx.orgId) : []
  const localModels = await loadModelSettings(currentModelHost())
  const asr = await asrCard(process.platform, process.arch)

  const team = (members ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    fullName: nameById.get(m.user_id) ?? null,
    // Email isn't stored on profiles (it lives in auth.users, hidden by RLS).
    // We can only surface the signed-in user's own email reliably.
    email: m.user_id === ctx.userId ? ctx.email : null,
    isSelf: m.user_id === ctx.userId,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Workspace and team."
      />
      <PersonalAiCallout
        installed={localModels.rows.filter((r) => r.installed).length}
        total={localModels.rows.length}
        daemonUp={localModels.daemonUp}
      />
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        <Link href="/settings/security" className={SECTION_LINK}>Authenticator</Link>
        {canEdit ? <Link href="/settings/purchasing" className={SECTION_LINK}>Purchasing</Link> : null}
        {canEdit ? <Link href="/settings/finance" className={SECTION_LINK}>Finance</Link> : null}
        {canEdit ? <Link href="/settings/lead-forms" className={SECTION_LINK}>Lead forms</Link> : null}
        <Link href="/settings#local-models" className={`${SECTION_LINK} !border-primary !border-solid !text-primary`}>โมเดล AI / Local models</Link>
        {canEdit ? <Link href="/settings/connections" className={SECTION_LINK}>เชื่อมต่อแอป / Connect apps</Link> : null}
      </nav>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          compact
          label="Cash on hand"
          value={formatTHB(cashSatang)}
          icon={Wallet}
        />
        <StatCard
          compact
          label="Monthly burn override"
          value={burnSatang === null ? "Not set" : formatTHB(burnSatang)}
          icon={Flame}
          tone={burnSatang === null ? "default" : "warning"}
          hint={burnSatang === null ? "Using actual recorded costs" : undefined}
        />
        <StatCard
          compact
          label="Team members"
          value={String(team.length)}
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace</CardTitle>
            <CardDescription>{canEdit ? "Name and finances." : "View only."}</CardDescription>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <SettingsForm
                defaultOrgName={ctx.orgName}
                defaultCashBaht={satangToBaht(cashSatang)}
                defaultBurnBaht={burnSatang === null ? null : satangToBaht(burnSatang)}
                action={updateOrgSettings}
              />
            ) : (
              <div className="space-y-4">
                <Alert>
                  <Lock className="size-4" />
                  <AlertTitle>View only</AlertTitle>
                  <AlertDescription>
                    Only an owner or admin can change workspace settings.
                  </AlertDescription>
                </Alert>
                <dl className="divide-y text-sm">
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-muted-foreground">Workspace name</dt>
                    <dd className="font-medium">{ctx.orgName}</dd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-muted-foreground">Cash balance</dt>
                    <dd className="font-medium">{formatTHB(cashSatang)}</dd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-muted-foreground">Monthly burn override</dt>
                    <dd className="font-medium">
                      {burnSatang === null ? "Not set" : formatTHB(burnSatang)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
            <CardDescription>Who has access.</CardDescription>
          </CardHeader>
          <CardContent>
            {team.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No team members"
                description="No invitations yet."
                className="border-0 p-6"
              />
            ) : (
              <ul className="divide-y">
                {team.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <Avatar className="size-9 shrink-0">
                      <AvatarFallback className="text-xs">
                        {initials(member.fullName, member.email ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {member.fullName ?? "Unnamed teammate"}
                        </span>
                        {member.isSelf ? (
                          <Badge variant="secondary" className="shrink-0">
                            You
                          </Badge>
                        ) : null}
                      </div>
                      {member.email ? (
                        <p className="text-muted-foreground truncate text-xs">
                          {member.email}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {member.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card id="local-models" className="bbn-deck-panel border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="text-primary size-4" aria-hidden />โมเดล AI บนเครื่องนี้ / Local AI models</CardTitle>
          <CardDescription>ดาวน์โหลดและใช้ในแอปนี้</CardDescription>
        </CardHeader>
        <CardContent>
          <LocalModelsCard initial={localModels} canInstall={canEdit} asr={asr} />
        </CardContent>
      </Card>

      <PublicReferenceSetting enabled={settings?.public_document_refs_enabled ?? false} canEdit={canEdit} />

      <InvitationsCard />

      <AccountingIntegrationCard />

      {canEdit ? <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="text-primary size-4" aria-hidden />เชื่อมมือถือ / Link mobile</CardTitle>
          <CardDescription>สแกน QR ครั้งเดียวจากแอป iOS</CardDescription>
        </CardHeader>
        <CardContent><MobileLinkCard initial={mobileDevices} /></CardContent>
      </Card> : null}

      {canEdit ? <Card>
        <CardHeader>
          <CardTitle className="text-base">Local backup</CardTitle>
          <CardDescription>โฟลเดอร์บนเครื่องนี้</CardDescription>
        </CardHeader>
        <CardContent><LocalBackupCard /></CardContent>
      </Card> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bbn-deck-panel border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Download className="text-primary size-4" aria-hidden />อัปเดตแอป / App update</CardTitle>
            <CardDescription>ตรวจรุ่นใหม่เมื่อกด</CardDescription>
          </CardHeader>
          <CardContent><UpdateCheckButton canUpdate={canEdit} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start logs</CardTitle>
            <CardDescription>บันทึกการเริ่มระบบบนเครื่องนี้</CardDescription>
          </CardHeader>
          <CardContent><StartLogViewer /></CardContent>
        </Card>
      </div>
    </div>
  )
}
