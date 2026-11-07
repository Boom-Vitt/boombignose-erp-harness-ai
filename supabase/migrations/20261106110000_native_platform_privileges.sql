-- Native PostgreSQL does not supply Supabase's platform table defaults.
-- Preserve migration-specific RLS, command-only tables and column grants: this
-- repairs named legacy consumers, never GRANT ALL ON ALL TABLES after revokes.

-- Existing clusters also need the defaults used before migrations on a fresh
-- native install. Future migrations must narrow them with their own REVOKEs.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- Direct CRUD and security-invoker document/deal commands still rely on these
-- table privileges; their existing tenant/role policies and triggers apply.
grant select, insert, update, delete on
  public.activities,
  public.automation_templates,
  public.clients,
  public.costs,
  public.deals,
  public.invoice_items,
  public.quote_items,
  public.quotes,
  public.time_entries
  to authenticated;

grant select, insert, update on
  public.accounting_connections,
  public.accounting_sync_map,
  public.invitations,
  public.invoices,
  public.milestones,
  public.project_tasks,
  public.projects
  to authenticated;

grant select, insert, delete on
  public.contacts,
  public.saved_views,
  public.subscriptions
  to authenticated;

grant select, insert on
  public.ai_outputs,
  public.audit_log,
  public.template_categories
  to authenticated;

-- Financial settlement, issue snapshots, outbox and recurrence state are read
-- here but remain writable only through their existing authorized commands.
-- payment_command_results is internal and receives no direct session grant.
grant select on
  public.invoice_snapshots,
  public.memberships,
  public.org_settings,
  public.organizations,
  public.outbound_events,
  public.payment_allocations,
  public.payment_claims,
  public.payments,
  public.profiles,
  public.reminders,
  public.subscription_occurrences
  to authenticated;

grant update (name) on public.organizations to authenticated;
grant update (locale) on public.profiles to authenticated;

-- A table-wide settings write would bypass the lock-date, seller identity and
-- different-payment-reviewer commands. Narrow both fresh platform defaults
-- and older hosted defaults before restoring the direct settings consumers.
revoke insert, update, delete on public.org_settings from authenticated;
grant insert (
  org_id,
  cash_balance_satang,
  monthly_burn_satang,
  public_document_refs_enabled,
  allow_negative_stock,
  bill_variance_tolerance_bps,
  over_receipt_tolerance_percent,
  purchase_approval_threshold_satang,
  scheduled_replenishment_enabled
), update (
  org_id,
  cash_balance_satang,
  monthly_burn_satang,
  public_document_refs_enabled,
  allow_negative_stock,
  bill_variance_tolerance_bps,
  over_receipt_tolerance_percent,
  purchase_approval_threshold_satang,
  scheduled_replenishment_enabled
) on public.org_settings to authenticated;

-- Privileged server consumers have their own cron-secret, recipient/token or
-- verified mobile-session boundary. Grant only their direct relation access;
-- security-definer RPCs do not require callers to own their table writes.
grant select on
  public.activities,
  public.deals,
  public.subscriptions,
  public.org_settings,
  public.invitations,
  public.organizations,
  public.clients,
  public.quotes,
  public.invoices,
  public.projects,
  public.invoice_items,
  public.payment_claims,
  public.invoice_balances,
  public.payments,
  public.payment_allocations
  to service_role;
grant insert on public.audit_log to service_role;
grant select, insert, update on
  public.mobile_pairings,
  public.mobile_devices
  to service_role;

-- No anon grants, view DML, migration-journal access, network credential-column
-- grants or purchase-order-line UPDATE widening belongs in this repair.
