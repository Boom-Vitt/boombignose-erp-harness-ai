import { Wallet, Flame, Users, Lock } from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB, satangToBaht } from "@/lib/money"
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
import { InvitationsCard } from "./_components/invitations-card"
import { AccountingIntegrationCard } from "@edition"
import { StartLogViewer, UpdateCheckButton } from "./_components/local-install"
import { LocalBackupCard } from "./_components/local-backup"
import { updateOrgSettings } from "./actions"

export const dynamic = "force-dynamic"

function initials(name: string | null, fallback: string): string {
  const base = name?.trim() || fallback
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default async function SettingsPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const canEdit = ctx.role === "owner" || ctx.role === "admin"

  // org_settings is a single row per org (org_id unique). May not exist yet.
  const { data: settings } = await supabase
    .from("org_settings")
    .select("cash_balance_satang, monthly_burn_satang")
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
        description="Workspace finances and your team. Cash here drives the dashboard."
      />
      <Link href="/settings/security" className="mr-4 text-sm underline">Authenticator</Link>
      {canEdit ? <Link href="/settings/purchasing" className="mr-4 text-sm underline">Purchasing</Link> : null}
      {canEdit ? <Link href="/settings/finance" className="mr-4 text-sm underline">Finance</Link> : null}
      {canEdit ? <Link href="/settings/lead-forms" className="text-sm underline">Lead forms</Link> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Cash on hand"
          value={formatTHB(cashSatang)}
          icon={Wallet}
        />
        <StatCard
          label="Monthly burn override"
          value={burnSatang === null ? "Not set" : formatTHB(burnSatang)}
          icon={Flame}
          tone={burnSatang === null ? "default" : "warning"}
          hint={burnSatang === null ? "Using actual recorded costs" : undefined}
        />
        <StatCard
          label="Team members"
          value={String(team.length)}
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace</CardTitle>
            <CardDescription>
              {canEdit
                ? "Update your workspace name and finances."
                : "Financial settings (view only)."}
            </CardDescription>
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
            <CardDescription>People with access to this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {team.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No team members"
                description="Invitations will appear here once teammates join."
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

      <InvitationsCard />

      <AccountingIntegrationCard />

      {canEdit ? <Card>
        <CardHeader>
          <CardTitle className="text-base">Local backup</CardTitle>
          <CardDescription>One folder on this computer. The checksum is checked before a restore.</CardDescription>
        </CardHeader>
        <CardContent><LocalBackupCard /></CardContent>
      </Card> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Updates</CardTitle>
            <CardDescription>Look up the public release when you ask. The check shows a link and does not download.</CardDescription>
          </CardHeader>
          <CardContent><UpdateCheckButton /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start logs</CardTitle>
            <CardDescription>Local Postgres, auth, and API logs from this computer.</CardDescription>
          </CardHeader>
          <CardContent><StartLogViewer /></CardContent>
        </Card>
      </div>
    </div>
  )
}
