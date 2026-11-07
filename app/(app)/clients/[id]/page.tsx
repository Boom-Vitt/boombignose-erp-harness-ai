import { ActivityDue } from "@/components/record/activity-due"
import { todayISO } from "@/lib/dates"
import { RecordHistory } from "@/components/record/record-history"
import Link from "next/link"
import { notFound } from "next/navigation"
import { z } from "zod"
import {
  Pencil,
  Users,
  Handshake,
  FileSignature,
  FolderKanban,
  ReceiptText,
  Scale,
  Activity as ActivityIcon,
  Mail,
  Phone,
} from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB } from "@/lib/money"
import { SmartButtons, recordHref } from "@/components/record/smart-buttons"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { DealStageBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatDate } from "../_lib/format"
import { AddContactDialog } from "../_components/add-contact-dialog"
import { DeleteContactButton } from "../_components/delete-contact-button"
import { DeleteClientButton } from "../_components/delete-client-button"
import { ClientPortalCard } from "@edition"

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, industry, source, notes, created_at")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle()
  if (clientError) throw new Error("Client details unavailable. Please reload.")

  if (!client) notFound()

  const [contactsRes, dealsRes, activitiesRes, quotesRes, invoicesRes, projectsRes, balanceRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, email, phone, role")
      .eq("org_id", ctx.orgId)
      .eq("client_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("deals")
      .select("id, title, stage, value_satang, updated_at", { count: "exact" })
      .eq("org_id", ctx.orgId)
      .eq("client_id", id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("activities")
      .select("id, type, body, due_date, done, created_at")
      .eq("org_id", ctx.orgId)
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("quotes").select("id", { count: "exact" }).eq("org_id", ctx.orgId).eq("client_id", id).limit(1),
    supabase.from("invoices").select("id", { count: "exact" }).eq("org_id", ctx.orgId).eq("client_id", id).limit(1),
    supabase.from("projects").select("id", { count: "exact" }).eq("org_id", ctx.orgId).eq("client_id", id).limit(1),
    supabase
      .from("client_balances")
      .select("outstanding_satang, credit_satang")
      .eq("org_id", ctx.orgId)
      .eq("client_id", id)
      .maybeSingle(),
  ])

  const contacts = contactsRes.data ?? []
  const deals = dealsRes.data ?? []
  const activities = activitiesRes.data ?? []

  // No row means no issued invoices. A failed read hides the balance rather than understate it.
  const balanceKnown = !balanceRes.error
  const openBalance = balanceRes.data?.outstanding_satang ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.name}
        description={balanceKnown ? `Client details · Customer credit ${formatTHB(balanceRes.data?.credit_satang ?? 0)}` : "Client details"}
        breadcrumbs={[{ label: "Clients", href: "/clients" }]}
      >
        <Button variant="outline" render={<Link href={`/finance/receipts?client=${id}`} />}>Customer receipts</Button>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/clients/${client.id}/edit`} />}
        >
          <Pencil />
          Edit
        </Button>
        <DeleteClientButton id={client.id} name={client.name} />
      </PageHeader>

      <SmartButtons
        buttons={[
          { label: "Deals", icon: Handshake, count: dealsRes.count ?? 0, href: "#deals" },
          {
            label: "Quotes",
            icon: FileSignature,
            count: quotesRes.count ?? 0,
            href: recordHref(quotesRes, (quoteId) => `/quotes/${quoteId}`, "/quotes"),
          },
          {
            label: "Invoices",
            icon: ReceiptText,
            count: invoicesRes.count ?? 0,
            href: recordHref(invoicesRes, (invoiceId) => `/finance/invoices/${invoiceId}`, "/finance"),
          },
          {
            label: "Projects",
            icon: FolderKanban,
            count: projectsRes.count ?? 0,
            href: recordHref(projectsRes, (projectId) => `/projects/${projectId}`, "/projects"),
          },
          {
            label: "Open balance",
            icon: Scale,
            count: balanceKnown ? openBalance : 0,
            value: formatTHB(openBalance),
            href: "/finance",
          },
        ]}
      />

      {/* Overview */}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Industry" value={client.industry} />
          <Field label="Source" value={client.source} />
          <Field label="Added" value={formatDate(client.created_at)} />
          {client.notes ? (
            <div className="space-y-1 sm:col-span-3">
              <p className="text-muted-foreground text-xs font-medium">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ClientPortalCard clientId={client.id} />

      {/* Contacts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" />
            Contacts
          </CardTitle>
          <AddContactDialog clientId={client.id} />
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Add the people you talk to at this client."
              className="border-0 p-6"
            />
          ) : (
            <ul className="divide-y">
              {contacts.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{person.name}</span>
                      {person.role ? (
                        <Badge variant="outline" className="shrink-0">
                          {person.role}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
                      {person.email ? (
                        <a
                          href={`mailto:${person.email}`}
                          className="flex items-center gap-1 hover:underline"
                        >
                          <Mail className="size-3.5" />
                          {person.email}
                        </a>
                      ) : null}
                      {person.phone ? (
                        <a
                          href={`tel:${person.phone}`}
                          className="flex items-center gap-1 hover:underline"
                        >
                          <Phone className="size-3.5" />
                          {person.phone}
                        </a>
                      ) : null}
                      {!person.email && !person.phone ? (
                        <span>No contact info</span>
                      ) : null}
                    </div>
                  </div>
                  <DeleteContactButton
                    contactId={person.id}
                    clientId={client.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Deals (read-only) */}
      <Card id="deals">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Handshake className="size-4" />
            Deals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deals.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="No deals yet"
              description="Deals for this client show up here."
              className="border-0 p-6"
            />
          ) : (
            <ul className="divide-y">
              {deals.map((deal) => (
                <li
                  key={deal.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <Link
                    href={`/deals/${deal.id}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {deal.title}
                  </Link>
                  <DealStageBadge stage={deal.stage} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Recent activity (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="size-4" />
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="No activity yet"
              description="Notes, calls, and follow-ups appear here."
              className="border-0 p-6"
            />
          ) : (
            <ul className="divide-y">
              {activities.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 py-3 text-sm"
                >
                  <Badge variant="outline" className="mt-0.5 shrink-0 capitalize">
                    {item.type.replace("_", " ")}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    {item.body ?? "—"}
                  </span>
                  <ActivityDue dueDate={item.due_date} today={todayISO()} done={item.done} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <RecordHistory recordType="client" recordId={id} />
    </div>
  )
}

function Field({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="text-sm">{value ? value : "—"}</p>
    </div>
  )
}
