-- A model-selected status/client subset must not hide workspace receivables.
-- Keep filtered display/summary intact, but return authoritative workspace-wide
-- issued-unpaid evidence from the very same statement snapshot. Only 16 coverage
-- rows cross the wire; count and sum precede that bound. Invoker RLS/ACLs remain.
create or replace function public.assistant_invoice_snapshot(
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
    where i.org_id=p_org_id
  ), matching as materialized (
    select * from evidence where (p_status is null or effective_status=p_status)
      and (p_client_id is null or client_id=p_client_id)
  ), page as (
    select * from matching order by created_at desc,id asc
    limit greatest(1,least(p_limit,100)) offset greatest(p_offset,0)
  ), receivables as materialized (
    select * from evidence where outstanding_satang>0 and status::text not in ('draft','cancelled')
  ), coverage_page as (
    select id,number,effective_status,due_date,outstanding_satang,created_at
    from receivables order by created_at desc,id asc limit 16
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(page) || jsonb_build_object(
      'paid_satang',page.paid_satang::text,'credited_satang',page.credited_satang::text,
      'outstanding_satang',page.outstanding_satang::text) order by page.created_at desc,page.id asc) from page),'[]'::jsonb),
    'total',(select count(*)::text from matching),
    'summary',(select jsonb_build_object('issued_unpaid_count',count(*) filter(where outstanding_satang>0)::text,
      'outstanding_satang',coalesce(sum(outstanding_satang),0)::text) from matching),
    'receivables_coverage',jsonb_build_object(
      'invoice_count',(select count(*)::text from receivables),
      'outstanding_satang',(select coalesce(sum(outstanding_satang),0)::text from receivables),
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'number',number,'status',effective_status,'due_date',due_date,
        'outstanding_satang',outstanding_satang::text) order by created_at desc,id asc)
        from coverage_page),'[]'::jsonb),
      'has_more',(select count(*)>16 from receivables))
  ) where exists(select 1 from public.organizations where id=p_org_id
    and (current_user='service_role' or (select auth.uid()) is not null));
$$;

-- Preserve existing session and trusted local-admin callers; never anonymous.
revoke all on function public.assistant_invoice_snapshot(uuid,text,uuid,integer,bigint,timestamptz) from public,anon;
grant execute on function public.assistant_invoice_snapshot(uuid,text,uuid,integer,bigint,timestamptz) to authenticated,service_role;
notify pgrst, 'reload schema';
