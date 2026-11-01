-- Finance writers are owner, admin, and accountant. Owner and admin stay
-- the only staff for settings, team, purchasing, inventory, and receipt reversal.

create or replace function private.is_org_finance(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where org_id = target_org
      and user_id = (select auth.uid())
      and role in ('owner', 'admin', 'accountant')
  );
$$;

revoke all on function private.is_org_finance(uuid) from public, anon, service_role;
grant execute on function private.is_org_finance(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['invoices', 'invoice_items']
  loop
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format(
      'create policy tenant_insert on public.%I for insert to authenticated with check (private.is_org_finance(org_id))',
      t
    );
    execute format(
      'create policy tenant_update on public.%I for update to authenticated using (private.is_org_finance(org_id)) with check (private.is_org_finance(org_id))',
      t
    );
  end loop;
end $$;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.is_org_finance(org_id));

-- One staff gate per command. A function with a different count fails this
-- migration instead of widening a purchase or reversal check by accident.
do $$
declare
  signature text;
  def text;
  hits int;
begin
  foreach signature in array array[
    'public.issue_invoice(uuid,uuid,integer,uuid)',
    'public.submit_customer_payment_claim(uuid,uuid,bigint,jsonb,text,uuid)',
    'public.apply_customer_credit(uuid,uuid,jsonb,uuid)',
    'public.refund_customer_credit(uuid,uuid,bigint,text,date,public.payment_method,uuid)',
    'public.issue_credit_note(uuid,uuid,jsonb,text,uuid)',
    'public.submit_internal_payment_claim(uuid,uuid,bigint,text,uuid)',
    'public.review_payment_claim_with_evidence(uuid,uuid,bigint,text,uuid,text,date,public.payment_method)',
    'public.reconcile_legacy_payment_with_evidence(uuid,uuid,bigint,text,uuid,date,public.payment_method)',
    'public.adopt_legacy_invoice(uuid,uuid,integer,uuid,text)',
    'public.add_bank_line(uuid,date,bigint,text)',
    'public.match_bank_line(uuid,uuid,uuid)'
  ]
  loop
    def := pg_get_functiondef(signature::regprocedure);
    hits := (length(def) - length(replace(def, 'private.is_org_staff', ''))) / length('private.is_org_staff');
    if hits <> 1 then
      raise exception 'expected one staff gate in % (found %)', signature, hits;
    end if;
    execute replace(def, 'private.is_org_staff', 'private.is_org_finance');
  end loop;
end $$;
