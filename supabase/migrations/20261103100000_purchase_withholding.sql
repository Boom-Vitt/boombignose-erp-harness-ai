-- Purchase withholding (หัก ณ ที่จ่าย) captured against a vendor bill or expense cost, with a
-- gap-free 50 ทวิ working-copy number per org and year. Support data for the accountant's
-- ภ.ง.ด.3 / ภ.ง.ด.53 lists. Nothing here files with the Revenue Department, signs a statutory
-- certificate, or posts a journal (purchase journal posting is separate work).
--
-- A record is insert-only: an authenticated client cannot update or delete it, so the number
-- and amounts stay as exported. The counter row is bumped in the same transaction as the
-- insert, so a refusal rolls the number back and committed numbers are consecutive.

create table public.purchase_withholdings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cost_id uuid not null,
  paid_on date not null check(isfinite(paid_on)),
  form text not null check(form in ('pnd3','pnd53')),
  income_type text not null check(income_type in ('service_40_8','professional_40_6','contract_40_7','rent_40_5','royalty_40_3','other')),
  rate_bps integer not null check(rate_bps in (100,200,300,500)),
  base_satang bigint not null check(base_satang > 0 and base_satang <= 9007199254740991),
  wht_satang bigint not null check(wht_satang > 0 and wht_satang <= base_satang),
  certificate_year integer not null,
  certificate_seq bigint not null check(certificate_seq > 0),
  certificate_no text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(org_id, id),
  unique(org_id, cost_id),
  unique(org_id, certificate_no),
  foreign key(org_id, cost_id) references public.costs(org_id, id)
);
create index purchase_withholdings_period_idx on public.purchase_withholdings(org_id, paid_on);

alter table public.purchase_withholdings enable row level security;
alter table public.purchase_withholdings force row level security;
revoke all on public.purchase_withholdings from public, anon, authenticated;
grant select on public.purchase_withholdings to authenticated;
create policy finance_read on public.purchase_withholdings for select to authenticated using(private.is_org_finance(org_id));

comment on table public.purchase_withholdings is 'Withholding already deducted on a purchase, for ภ.ง.ด.3/53 support lists. certificate_no is an internal working-copy number, not a filed 50 ทวิ.';

create function public.record_purchase_withholding(
  p_org_id uuid,
  p_cost_id uuid,
  p_paid_on date,
  p_form text,
  p_income_type text,
  p_rate_bps integer
)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.costs;base bigint;wht bigint;yr integer;counter bigint;num text;target uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may record withholding';end if;
  -- Same lock order as record_support_export (organization row first), so the two cannot deadlock.
  perform 1 from public.organizations where id=p_org_id for update;
  if p_form is null or p_form not in ('pnd3','pnd53') then raise exception 'Choose ภ.ง.ด.3 or ภ.ง.ด.53';end if;
  if p_rate_bps is null or p_rate_bps not in (100,200,300,500) then raise exception 'Invalid withholding rate';end if;
  if p_income_type is null or p_income_type not in ('service_40_8','professional_40_6','contract_40_7','rent_40_5','royalty_40_3','other') then raise exception 'Invalid income type';end if;
  select * into c from public.costs where org_id=p_org_id and id=p_cost_id for share;
  if not found then raise exception 'Cost unavailable';end if;
  if c.amount_satang<=0 then raise exception 'Withholding applies to a positive payment, not a credit';end if;
  perform private.assert_finance_date_open(p_org_id,p_paid_on);
  -- Base is the payment before input VAT. Half-up on the satang, same rule as sales invoices.
  base:=c.amount_satang-c.input_vat_satang;
  if base<=0 then raise exception 'Nothing to withhold on';end if;
  wht:=div(2*base*p_rate_bps+10000,20000);
  if wht<=0 then raise exception 'Withholding rounds to zero';end if;
  yr:=extract(year from p_paid_on);
  insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'WHT50',yr,1)
    on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
  num:='WHT-'||yr::text||'-'||case when length(counter::text)<6 then lpad(counter::text,6,'0') else counter::text end;
  insert into public.purchase_withholdings(org_id,cost_id,paid_on,form,income_type,rate_bps,base_satang,wht_satang,certificate_year,certificate_seq,certificate_no,created_by)
    values(p_org_id,p_cost_id,p_paid_on,p_form,p_income_type,p_rate_bps,base,wht,yr,counter,num,auth.uid()) returning id into target;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'cost',p_cost_id,'purchase_withholding_recorded','Recorded purchase withholding '||num||'; working copy, not a filed 50 ทวิ',
      jsonb_build_object('withholdingId',target,'certificateNo',num,'form',p_form,'rateBps',p_rate_bps,'whtSatang',wht));
  return target;
end;
$$;
revoke all on function public.record_purchase_withholding(uuid,uuid,date,text,text,integer) from public,anon,service_role;
grant execute on function public.record_purchase_withholding(uuid,uuid,date,text,text,integer) to authenticated;

-- The two new report files use the same checksum command as the other support downloads.
do $$
declare def text;
begin
  select pg_get_functiondef('public.record_support_export(uuid,text,text,text,integer)'::regprocedure) into def;
  if position('''close_activity_csv'')' in def)=0 then raise exception 'record_support_export kind list changed; update this migration';end if;
  def:=replace(def,'''close_activity_csv'')','''close_activity_csv'', ''vat_support_csv'', ''wht_support_csv'')');
  execute def;
end;
$$;
