import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { TeamInvitations } from "@/app/(app)/settings/_components/team-invitations"

export async function InvitationsCard() {
  const ctx = await requireOrgContext()
  const canEdit = ctx.role === "owner" || ctx.role === "admin"
  if (!canEdit) return null
  const supabase = await createClient()
  // Pending invitations (owner/admin manage these).
  const { data: pendingInvites } = await supabase
    .from("invitations")
    .select("id, email, role, token")
    .eq("org_id", ctx.orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invitations</CardTitle>
        <CardDescription>Invite teammates by email.</CardDescription>
      </CardHeader>
      <CardContent>
        <TeamInvitations
          invites={(pendingInvites ?? []).map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            token: i.token,
          }))}
          appUrl={appUrl}
        />
      </CardContent>
    </Card>
  )
}
