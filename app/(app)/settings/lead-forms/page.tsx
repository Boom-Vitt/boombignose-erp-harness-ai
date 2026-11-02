import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { LeadFormsDatabase } from "@/lib/lead-forms/database"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { buttonVariants } from "@/components/ui/button"
import { CopyField } from "./copy-field"
import { createLeadForm, disableLeadForm } from "./actions"

export const dynamic = "force-dynamic"

export default async function LeadFormsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const supabase = await createClient() as SupabaseClient<LeadFormsDatabase>
  const [forms, people] = await Promise.all([
    supabase.from("lead_forms").select("*").eq("org_id", ctx.orgId).order("created_at", { ascending: false }),
    supabase.rpc("record_activity_assignees", { p_org_id: ctx.orgId }),
  ])
  if (forms.error || people.error) throw new Error("Unable to load lead forms. Please try again.")
  const { error } = await searchParams
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""

  return (
    <div className="space-y-6">
      <PageHeader title="Lead forms" description="Website enquiries into Leads." />
      <Link href="/settings" className="text-sm underline">Back to settings</Link>
      {error ? <p role="alert" className="text-destructive">{error === "invalid" ? "Enter a form name, success message, and a team member as the default owner." : "Unable to save this form. Please try again."}</p> : null}
      <Card>
        <CardHeader><CardTitle><h2>Create lead form</h2></CardTitle></CardHeader>
        <CardContent>
          <form action={createLeadForm} className="max-w-xl space-y-4">
            <div className="space-y-2"><Label htmlFor="form-name">Form name</Label><Input id="form-name" name="name" required maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="default-owner">Default owner</Label>
              <select id="default-owner" name="defaultOwner" defaultValue={ctx.userId} required className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm">
                {(people.data ?? []).map(person => <option key={person.user_id} value={person.user_id}>{person.full_name || "Team member"}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label htmlFor="success-message">Success message</Label><Textarea id="success-message" name="successMessage" required maxLength={500} defaultValue="Thank you. We will be in touch soon." /></div>
            <button type="submit" className={buttonVariants()}>Create form</button>
          </form>
        </CardContent>
      </Card>
      {!forms.data?.length ? <p className="text-muted-foreground">No lead forms yet.</p> : null}
      {(forms.data ?? []).map(form => {
        const href = `${appUrl}/f/${form.token}`
        const embed = `<iframe src="${href}" title="Contact form" width="100%" height="760" style="border:0" loading="lazy"></iframe>`
        return (
          <Card key={form.id}>
            <CardHeader><CardTitle><h2>{form.name}</h2></CardTitle><p>{form.enabled ? "Enabled" : "Disabled"}{!form.default_owner ? " (owner unavailable)" : ""}</p></CardHeader>
            <CardContent className="space-y-4">
              {appUrl ? <>
                <CopyField id={`link-${form.id}`} label="Public link" value={href} />
                <CopyField id={`embed-${form.id}`} label="Embed snippet" value={embed} />
              </> : <p role="alert">Set NEXT_PUBLIC_APP_URL to your public app address before sharing this form.</p>}
              {form.enabled ? <form action={disableLeadForm}><input type="hidden" name="id" value={form.id} /><button type="submit" className={buttonVariants({ variant: "outline" })}>Disable {form.name}</button></form> : null}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
