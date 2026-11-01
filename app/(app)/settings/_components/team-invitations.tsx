"use client"

import { useState, useTransition } from "react"
import { Copy, Mail, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { inviteMember, revokeInvitation } from "@/app/(app)/settings/org-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"

export type PendingInvite = {
  id: string
  email: string
  role: string
  token: string
}

/**
 * Invite teammates by email and manage pending invitations. Owner/admin only
 * (the server actions re-check the role). The invite link is shown after
 * creation so it can be copied and shared (email delivery is optional/separate).
 */
export function TeamInvitations({
  invites,
  appUrl,
}: {
  invites: PendingInvite[]
  appUrl: string
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"member" | "accountant" | "admin">("member")
  const [pending, startTransition] = useTransition()

  function inviteLink(token: string): string {
    const base = appUrl.replace(/\/$/, "")
    return `${base}/invite/${token}`
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token))
      toast.success("Invite link copied")
    } catch {
      toast.error("Could not copy — link: " + inviteLink(token))
    }
  }

  function submit() {
    const value = email.trim()
    if (!value) {
      toast.error("Enter an email to invite")
      return
    }
    startTransition(async () => {
      const res = await inviteMember({ email: value, role })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      setEmail("")
      toast.success("Invitation created")
      if (res?.token) await copy(res.token)
    })
  }

  function revoke(id: string) {
    startTransition(async () => {
      const res = await revokeInvitation({ id })
      if (res?.error) toast.error(res.error)
      else toast.success("Invitation revoked")
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          className="flex-1"
        />
        <Select
          value={role}
          onValueChange={(v) => setRole(v as "member" | "accountant" | "admin")}
        >
          <SelectTrigger className="sm:w-40" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Staff</SelectItem>
            <SelectItem value="accountant">Accountant</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={submit} disabled={pending}>
          <UserPlus /> Invite
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Staff record customers and notes. Accountants also record invoices, receipts, and credit notes. Admins manage settings and the team. An owner is not offered here.
      </p>

      {invites.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No pending invitations"
          description="Invite a teammate by email to give them access."
          className="border-0 p-6"
        />
      ) : (
        <ul className="divide-y">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{inv.email}</p>
                <p className="text-muted-foreground text-xs">Pending</p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {inv.role === "member" ? "Staff" : inv.role === "accountant" ? "Accountant" : inv.role === "admin" ? "Admin" : inv.role}
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy invite link"
                onClick={() => copy(inv.token)}
                disabled={pending}
              >
                <Copy />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Revoke invitation"
                onClick={() => revoke(inv.id)}
                disabled={pending}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
