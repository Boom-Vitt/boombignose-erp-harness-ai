-- Plain-SQL checks for the TX / ABB tax-invoice series (no pgTAP needed).
-- Run on a migrated database: psql -v ON_ERROR_STOP=1 -f supabase/tests/tax_invoice_series.sql
-- Everything rolls back. A failed check raises and stops psql.
begin;
do $$
declare
  org uuid:=gen_random_uuid(); owner uuid:=gen_random_uuid(); buyer uuid:=gen_random_uuid(); bare uuid:=gen_random_uuid();
  inv1 uuid:=gen_random_uuid(); inv2 uuid:=gen_random_uuid(); inv3 uuid:=gen_random_uuid(); inv4 uuid:=gen_random_uuid(); inv5 uuid:=gen_random_uuid(); inv6 uuid:=gen_random_uuid();
  snap uuid; replay uuid; num text; sj jsonb; yr text:=extract(year from (now() at time zone 'Asia/Bangkok')::date)::text;
  today date:=(now() at time zone 'Asia/Bangkok')::date; failed boolean; key uuid; msg text; ver integer;
begin
  insert into auth.users(id,email) values(owner,'tx-'||owner||'@example.invalid');
  insert into public.organizations(id,name,slug) values(org,'Tax series','tx-'||org);
  insert into public.memberships(org_id,user_id,role) values(org,owner,'owner');
  insert into public.clients(id,org_id,name,billing_address,tax_id) values(buyer,org,'Full buyer','1 Buyer Road','1234567890123'),(bare,org,'Walk-in',null,null);
  insert into public.invoices(id,org_id,client_id,number) select i,org,case when i in (inv3) then bare else buyer end,'DRAFT-'||i from unnest(array[inv1,inv2,inv3,inv4,inv5,inv6]) i;
  perform set_config('request.jwt.claim.sub',owner::text,true);
  set local role authenticated;
  perform public.update_tax_business_profile(org,'Seller Co','1 Seller Road','1111111111119',true,700,false,'สำนักงานใหญ่');
  reset role;
  insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang,tax_rate_bps)
    select org,i,'Line',10000,700 from unnest(array[inv1,inv2,inv3,inv4,inv5,inv6]) i;
  select min(version) into ver from public.invoices where org_id=org;
  assert ver=(select max(version) from public.invoices where org_id=org), 'drafts share one version';
  set local role authenticated;

  -- 1. non-VAT profile: every tax invoice is refused
  perform public.update_tax_business_profile(org,'Seller Co','1 Seller Road','1111111111119',false,700,false,'สำนักงานใหญ่');
  begin perform public.issue_tax_invoice(org,inv1,ver,gen_random_uuid(),'TX'); failed:=false; msg:='issued'; exception when others then msg:=sqlerrm; failed:=true; end;
  assert failed and msg like 'VAT registration%', 'non-VAT seller must be refused: '||msg;

  -- 2. VAT but no branch code: refused
  perform public.update_tax_business_profile(org,'Seller Co','1 Seller Road','1111111111119',true,700,false,'สำนักงานใหญ่');
  begin perform public.issue_tax_invoice(org,inv1,ver,gen_random_uuid(),'TX'); failed:=false; exception when others then failed:=sqlerrm like 'Save a 5-digit branch code%'; end;
  assert failed, 'missing branch code must be refused';
  perform public.save_tax_invoice_template(org,'{"seller_phone":"","branch_code":"00000","copy_label":""}'::jsonb);

  -- 3. TX needs a buyer address; refusals burn no number
  begin perform public.issue_tax_invoice(org,inv3,ver,gen_random_uuid(),'TX'); failed:=false; exception when others then failed:=sqlerrm like 'Buyer address required%'; end;
  assert failed, 'TX without buyer address must be refused';

  -- 4. TX issue: first number, frozen branch / label / type / buyer tax id
  key:=gen_random_uuid();
  snap:=public.issue_tax_invoice(org,inv1,ver,key,'TX');
  reset role;
  select number,snapshot into num,sj from public.invoice_snapshots where id=snap;
  set local role authenticated;
  assert num='TX-'||yr||'-000001', 'first TX number: '||num;
  assert sj->'taxInvoice'='{"docType":"TX","branchCode":"00000","copyLabel":"ต้นฉบับ"}'::jsonb, 'TX snapshot block: '||(sj->'taxInvoice')::text;
  assert sj->>'kind'='operational_invoice', 'kind stays operational for journal posting';
  assert sj->'buyer'->>'taxId'='1234567890123', 'TX keeps buyer tax id';

  -- 5. replay: same key + type returns the same snapshot; other type is a conflict
  replay:=public.issue_tax_invoice(org,inv1,ver,key,'TX');
  assert replay=snap, 'replay returns original snapshot';
  begin perform public.issue_tax_invoice(org,inv1,ver,key,'ABB'); failed:=false; exception when others then failed:=sqlerrm like 'Idempotency conflict%'; end;
  assert failed, 'same key with another doc type must conflict';

  -- 6. ABB: own series, buyer address and tax id omitted though the client has them
  snap:=public.issue_tax_invoice(org,inv2,ver,gen_random_uuid(),'ABB');
  reset role;
  select number,snapshot into num,sj from public.invoice_snapshots where id=snap;
  set local role authenticated;
  assert num='ABB-'||yr||'-000001', 'first ABB number: '||num;
  assert sj->'buyer'->>'taxId' is null and sj->'buyer'->>'address' is null, 'ABB omits buyer tax id and address';
  assert sj->'taxInvoice'->>'docType'='ABB', 'ABB doc type frozen';

  -- 7. locked date: refused, and the counter does not move
  perform public.update_finance_lock_date(org,today);
  begin perform public.issue_tax_invoice(org,inv4,ver,gen_random_uuid(),'TX'); failed:=false; exception when others then failed:=sqlerrm ilike '%lock%' or sqlerrm ilike '%closed%'; end;
  assert failed, 'locked date must refuse a tax invoice: '||coalesce(sqlerrm,'');
  perform public.update_finance_lock_date(org,null);

  -- 8. gap-free: the next TX is 000002 despite the refusals above
  snap:=public.issue_tax_invoice(org,inv4,ver,gen_random_uuid(),'TX');
  reset role;
  select number into num from public.invoice_snapshots where id=snap;
  set local role authenticated;
  assert num='TX-'||yr||'-000002', 'second TX number has no gap: '||num;

  -- 9. plain issue stays on INV with no tax block
  snap:=public.issue_invoice(org,inv5,ver,gen_random_uuid());
  reset role;
  select number,snapshot into num,sj from public.invoice_snapshots where id=snap;
  set local role authenticated;
  assert num like 'INV-%' and not (sj ? 'taxInvoice'), 'plain issue is operational INV';

  -- 10. a tax-invoice type cannot be forced onto plain issue by a client
  assert coalesce(current_setting('bbn.tax_doc_type',true),'')='', 'doc type setting cleared after issue';

  -- 11. snapshot is immutable, even for the table owner (trigger, not just privileges)
  reset role;
  begin update public.invoice_snapshots set snapshot=snapshot||'{"x":1}'::jsonb where org_id=org; failed:=false; exception when others then failed:=true; end;
  assert failed, 'snapshot update must be refused';
end $$;
rollback;
select 'tax_invoice_series ok' as result;
