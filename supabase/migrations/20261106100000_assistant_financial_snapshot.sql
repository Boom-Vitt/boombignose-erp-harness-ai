-- Assistant evidence must come from one MVCC snapshot, not offset-paged HTTP reads.
-- Invoker rights retain the actor's table/view RLS and column privileges. Money
-- aggregates cross JSON as decimal strings so JavaScript can reject unsafe totals
-- without first rounding them. No contact, bank-evidence, labour-rate or profit data.
-- Browser callers remain actor-bound. The existing trusted OS-admin stdio caller
-- retains service_role's pre-existing database privileges; no HTTP elevation.
create function public.assistant_invoice_snapshot(
  p_org_id uuid,
  p_status text default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset bigint default 0,
  p_as_of timestamptz default statement_timestamp()
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with evidence as materialized (
    select i.id,i.org_id,i.client_id,i.project_id,i.source_quote_id,i.source_milestone_id,
      i.number,i.status,i.issue_date,i.due_date,i.amount_satang,i.total_satang,i.vat_satang,
      i.wht_satang,i.wht_rate_bps,i.discount_satang,i.is_recurring,i.recurring_interval,
      i.created_at,i.updated_at,b.paid_satang,b.credited_satang,
      case when i.status::text in ('draft','cancelled') then 0 else b.outstanding_satang end as outstanding_satang,
      case when i.status::text in ('draft','cancelled') then i.status::text
        when i.amount_satang>0 and b.paid_satang::numeric+b.credited_satang>=i.amount_satang then 'paid'
        when i.due_date<(p_as_of at time zone 'Asia/Bangkok')::date then 'overdue'
        when b.paid_satang::numeric+b.credited_satang>0 then 'partially_paid'
        else 'sent' end as effective_status
    from public.invoices i join public.invoice_balances b on b.org_id=i.org_id and b.invoice_id=i.id
    where i.org_id=p_org_id and (p_client_id is null or i.client_id=p_client_id)
  ), matching as materialized (
    select * from evidence where p_status is null or effective_status=p_status
  ), page as (
    select * from matching order by created_at desc,id asc
    limit greatest(1,least(p_limit,100)) offset greatest(p_offset,0)
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(page) || jsonb_build_object(
      'paid_satang',page.paid_satang::text,'credited_satang',page.credited_satang::text,
      'outstanding_satang',page.outstanding_satang::text) order by page.created_at desc,page.id asc) from page),'[]'::jsonb),
    'total',(select count(*)::text from matching),
    'summary',(select jsonb_build_object('issued_unpaid_count',count(*) filter(where outstanding_satang>0)::text,
      'outstanding_satang',coalesce(sum(outstanding_satang),0)::text) from matching)
  ) where exists(select 1 from public.organizations where id=p_org_id
    and (current_user='service_role' or (select auth.uid()) is not null));
$$;

create function public.assistant_finance_snapshot(
  p_org_id uuid,
  p_as_of timestamptz default statement_timestamp()
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with issued as materialized (
    select i.total_satang,i.amount_satang,b.outstanding_satang
    from public.invoices i join public.invoice_balances b on b.org_id=i.org_id and b.invoice_id=i.id
    where i.org_id=p_org_id and i.status::text not in ('draft','cancelled')
  ), settings as (
    select cash_balance_satang,monthly_burn_satang from public.org_settings where org_id=p_org_id
  ), cost_totals as (
    select coalesce(sum(amount_satang),0) as total,
      coalesce(sum(amount_satang) filter(where category::text<>'inventory'
        and incurred_on>=date_trunc('month',p_as_of at time zone 'Asia/Bangkok')::date
        and incurred_on<(date_trunc('month',p_as_of at time zone 'Asia/Bangkok')+interval '1 month')::date),0) as monthly
    from public.costs where org_id=p_org_id
  ), open_quotes as (
    select count(*) as count,coalesce(sum(total_satang),0) as total from public.quotes
    where org_id=p_org_id and status::text in ('draft','sent','accepted')
  ), pending_claims as (
    select count(*) as count,coalesce(sum(amount_satang),0) as total from public.payment_claims
    where org_id=p_org_id and status::text='pending'
  )
  select jsonb_build_object(
    'cash_balance_known',(select cash_balance_satang is not null from settings) is true,
    'cash_balance_satang',(select cash_balance_satang::text from settings),
    'monthly_burn_satang',coalesce((select monthly_burn_satang from settings),(select monthly from cost_totals))::text,
    'invoiced_total_satang',((select coalesce(sum(coalesce(total_satang,amount_satang)),0) from issued)
      -(select coalesce(sum(total_satang),0) from public.credit_note_revenue where org_id=p_org_id))::text,
    'verified_paid_satang',(select coalesce(sum(amount_satang),0)::text from public.payments where org_id=p_org_id and verification_state='verified'),
    'unpaid_satang',(select coalesce(sum(outstanding_satang),0)::text from issued),
    'unpaid_invoice_count',(select count(*) filter(where outstanding_satang>0)::text from issued),
    'costs_total_satang',(select total::text from cost_totals),
    'mrr_satang',(select div(coalesce(sum(amount_satang::numeric*case interval::text
      when 'weekly' then 52 when 'monthly' then 12 when 'quarterly' then 4 when 'yearly' then 1 else 0 end),0)+6,12)::text
      from public.subscriptions where org_id=p_org_id and status::text='active' and amount_satang>0),
    'open_quotes_count',(select count::text from open_quotes),
    'open_quotes_satang',(select total::text from open_quotes),
    'pipeline_satang',(select coalesce(sum(value_satang),0)::text from public.deals where org_id=p_org_id and stage::text not in ('won','lost')),
    'pending_claims_count',(select count::text from pending_claims),
    'pending_claims_satang',(select total::text from pending_claims)
  ) where exists(select 1 from public.organizations where id=p_org_id
    and (current_user='service_role' or (select auth.uid()) is not null));
$$;

revoke all on function public.assistant_invoice_snapshot(uuid,text,uuid,integer,bigint,timestamptz),
  public.assistant_finance_snapshot(uuid,timestamptz) from public,anon,service_role;
grant execute on function public.assistant_invoice_snapshot(uuid,text,uuid,integer,bigint,timestamptz),
  public.assistant_finance_snapshot(uuid,timestamptz) to authenticated,service_role;
notify pgrst, 'reload schema';
