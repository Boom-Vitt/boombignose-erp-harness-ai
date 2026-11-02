-- Gap-free TX (full) and ABB (abbreviated) tax-invoice series.
-- Operational INV issue is unchanged. A tax invoice is issued by public.issue_tax_invoice,
-- which hands the doc type to private.issue_invoice_document through a transaction-local
-- setting that PostgREST clients cannot set. Nothing here is e-Tax or a Revenue Department filing.
--
-- Gap-free: the counter row is bumped in the same transaction as the snapshot. Any refusal or
-- rollback undoes the bump, and the row lock serialises concurrent issues, so committed numbers
-- are consecutive per org, doc type and year.
-- The snapshot keeps kind 'operational_invoice' so the sales journal posting checks still apply.

create or replace function private.issue_invoice_document(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;profile public.org_settings;buyer public.clients;cmd public.invoice_issue_requests;target uuid;lines jsonb;subtotal numeric;totals jsonb;yr integer;num text;doc jsonb;today date:=(now() at time zone 'Asia/Bangkok')::date;
  doc_type text:=nullif(current_setting('bbn.tax_doc_type',true),'');counter bigint;branch text;buyer_json jsonb;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue invoices';end if;
  if p_key is null or p_expected_version is null or p_expected_version<1 then raise exception 'Invalid issue command';end if;
  if doc_type is not null and doc_type not in ('TX','ABB') then raise exception 'Invalid tax invoice type';end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found then raise exception 'Invoice unavailable';end if;
  insert into public.invoice_issue_requests(org_id,key,invoice_id,source_version) values(p_org_id,p_key,i.id,p_expected_version) on conflict do nothing;
  select * into cmd from public.invoice_issue_requests where org_id=p_org_id and key=p_key for update;
  if cmd.invoice_id<>i.id or cmd.source_version<>p_expected_version then raise exception 'Idempotency conflict';end if;
  if cmd.snapshot_id is not null then return cmd.snapshot_id;end if;
  if i.issued_snapshot_id is not null then
    if (select source_version from public.invoice_snapshots where org_id=p_org_id and id=i.issued_snapshot_id)<>p_expected_version then raise exception 'Stale invoice version';end if;
    update public.invoice_issue_requests set snapshot_id=i.issued_snapshot_id where org_id=p_org_id and key=p_key;return i.issued_snapshot_id;
  end if;
  if i.status<>'draft' or i.version<>p_expected_version then raise exception 'Draft at expected version required';end if;
  select * into profile from public.org_settings where org_id=p_org_id for share;
  if not found or profile.legal_name is null or length(btrim(profile.legal_name)) not between 1 and 200 or profile.business_address is null or length(btrim(profile.business_address)) not between 1 and 1000
    or (profile.vat_registered and profile.tax_id is null) then raise exception 'Complete seller profile required';end if;
  perform private.assert_finance_date_open(p_org_id,today);
  if not profile.vat_registered and exists(select 1 from public.invoice_items where org_id=p_org_id and invoice_id=i.id and tax_rate_bps>0) then raise exception 'VAT registration required for taxable lines';end if;
  select * into buyer from public.clients where org_id=p_org_id and id=i.client_id for share;
  if not found or length(btrim(buyer.name))<1 then raise exception 'Buyer required';end if;
  buyer_json:=jsonb_build_object('id',buyer.id,'name',buyer.name,'address',buyer.billing_address,'taxId',buyer.tax_id,'branchLabel',buyer.branch_label);
  if doc_type is not null then
    if not profile.vat_registered or profile.tax_id is null or profile.tax_id !~ '^[0-9]{13}$' then raise exception 'VAT registration and a 13-digit seller tax ID required for a tax invoice';end if;
    branch:=nullif(btrim(profile.tax_invoice_template->>'branch_code'),'');
    if branch is null or branch !~ '^[0-9]{5}$' then raise exception 'Save a 5-digit branch code (00000 for head office) before issuing a tax invoice';end if;
    if not exists(select 1 from public.invoice_items where org_id=p_org_id and invoice_id=i.id and tax_rate_bps>0) then raise exception 'A tax invoice needs at least one VAT line';end if;
    if doc_type='TX' then
      if buyer.billing_address is null or length(btrim(buyer.billing_address))<1 then raise exception 'Buyer address required for a full tax invoice';end if;
      if buyer.tax_id is not null and buyer.tax_id !~ '^[0-9]{13}$' then raise exception 'Buyer tax ID must be 13 digits';end if;
    else
      -- ABB never carries the buyer address or tax ID, even if the client record has them.
      buyer_json:=jsonb_build_object('id',buyer.id,'name',buyer.name,'address',null,'taxId',null,'branchLabel',null);
    end if;
  end if;
  select coalesce(sum(amount_satang),0),jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unitPriceSatang',unit_price_satang,'amountSatang',amount_satang,'position',position,'taxRateBps',tax_rate_bps) order by position,id) into subtotal,lines from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  select private.document_tax_totals(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),i.discount_satang,i.prices_include_vat,i.wht_rate_bps) into totals from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  if lines is null or subtotal>9007199254740991 or i.discount_satang>subtotal or i.amount_satang<=0 or i.amount_satang<>(totals->>'amountDueSatang')::bigint then raise exception 'Valid complete priced lines required';end if;
  i.issue_date:=today;
  yr:=extract(year from today);
  if doc_type is null then
    num:=private.allocate_invoice_number(p_org_id,yr);
  else
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,doc_type,yr,1)
      on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:=doc_type||'-'||yr::text||'-'||case when length(counter::text)<6 then lpad(counter::text,6,'0') else counter::text end;
  end if;
  doc:=jsonb_build_object('version',1,'kind','operational_invoice','seller',jsonb_build_object('legalName',profile.legal_name,'address',profile.business_address,'taxId',profile.tax_id,'taxStatus',profile.tax_status,'vatRegistered',profile.vat_registered,'branchLabel',profile.branch_label),
    'buyer',buyer_json,
    'document',jsonb_build_object('number',num,'issueDate',i.issue_date,'dueDate',i.due_date,'notes',i.notes,'subtotalSatang',subtotal,'discountSatang',i.discount_satang,'totalSatang',i.total_satang,'vatSatang',i.vat_satang,'whtSatang',i.wht_satang,'whtRateBps',i.wht_rate_bps,'amountDueSatang',i.amount_satang,'pricesIncludeVat',i.prices_include_vat,'vatByRate',i.tax_breakdown),'lines',lines);
  if doc_type is not null then
    doc:=doc||jsonb_build_object('taxInvoice',jsonb_build_object('docType',doc_type,'branchCode',branch,'copyLabel',coalesce(nullif(btrim(profile.tax_invoice_template->>'copy_label'),''),'ต้นฉบับ')));
  end if;
  insert into public.invoice_snapshots(org_id,invoice_id,source_version,number,snapshot,issued_by) values(p_org_id,i.id,i.version,num,doc,auth.uid()) returning id into target;
  update public.invoices set number=num,issue_date=today,status='sent',issued_snapshot_id=target where org_id=p_org_id and id=i.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'invoice',i.id,'invoice_issued',
    case when doc_type is null then 'Issued frozen operational invoice' else 'Issued frozen tax invoice ('||doc_type||'); not an e-Tax Invoice' end,
    jsonb_build_object('snapshotId',target,'sourceVersion',i.version,'number',num)||case when doc_type is null then '{}'::jsonb else jsonb_build_object('docType',doc_type) end);
  update public.invoice_issue_requests set snapshot_id=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;

create function public.issue_tax_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid,p_doc_type text)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;actual text;
begin
  if p_doc_type is null or p_doc_type not in ('TX','ABB') then raise exception 'Invalid tax invoice type';end if;
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue invoices';end if;
  perform set_config('bbn.tax_doc_type',p_doc_type,true);
  target:=public.issue_invoice(p_org_id,p_invoice_id,p_expected_version,p_key);
  perform set_config('bbn.tax_doc_type','',true);
  -- A replayed key or an already-issued invoice returns the original snapshot; it must be the type asked for.
  select snapshot->'taxInvoice'->>'docType' into actual from public.invoice_snapshots where org_id=p_org_id and id=target;
  if actual is distinct from p_doc_type then raise exception 'Idempotency conflict';end if;
  return target;
end;
$$;
revoke all on function public.issue_tax_invoice(uuid,uuid,integer,uuid,text) from public,anon,service_role;
grant execute on function public.issue_tax_invoice(uuid,uuid,integer,uuid,text) to authenticated;
