-- Customer deposits are a liability (2120), not sales, until a final invoice
-- applies the whole posted base. A partial or mixed-rate netting is refused.
-- This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.

insert into public.gl_accounts(org_id, code, name_th, name_en, kind)
select distinct existing.org_id, '2120', 'เงินรับล่วงหน้า', 'Customer deposits', 'liability'
from public.gl_accounts existing
where not exists (
  select 1 from public.gl_accounts already
  where already.org_id = existing.org_id and already.code = '2120'
);

create or replace function public.install_thai_sme_chart(p_org_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may install the chart of accounts'; end if;
  insert into public.gl_accounts(org_id, code, name_th, name_en, kind)
  select p_org_id, v.code, v.name_th, v.name_en, v.kind
  from (values
    ('1110','เงินสด','Cash','asset'),
    ('1120','เงินฝากธนาคาร','Bank','asset'),
    ('1130','ลูกหนี้การค้า','Accounts receivable','asset'),
    ('1140','ภาษีซื้อ','VAT input','asset'),
    ('1150','ภาษีถูกหัก ณ ที่จ่าย','Withholding receivable','asset'),
    ('2110','เจ้าหนี้การค้า','Accounts payable','liability'),
    ('2120','เงินรับล่วงหน้า','Customer deposits','liability'),
    ('2130','ภาษีขาย','VAT output','liability'),
    ('2140','ภาษีหัก ณ ที่จ่ายค้างจ่าย','Withholding payable','liability'),
    ('3100','ทุน','Owner equity','equity'),
    ('4100','รายได้จากการขาย','Sales','income'),
    ('5100','ต้นทุนขาย','Cost of goods sold','expense'),
    ('6100','ค่าใช้จ่ายในการดำเนินงาน','Operating expense','expense')
  ) as v(code, name_th, name_en, kind)
  where not exists (select 1 from public.gl_accounts existing where existing.org_id = p_org_id and existing.code = v.code);
end;
$$;

create or replace function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount','note','entryId','entryDate','debitSatang','lineCount','invoiceId','invoiceNumber','vatTreatment','creditNoteId','paymentId','source','depositSatang'];
  key text;
  parts text[] := array[]::text[];
  raw jsonb;
begin
  if p_meta is null then return ''; end if;
  foreach key in array keys loop
    if not (p_meta ? key) then continue; end if;
    raw := p_meta->key;
    if raw is null or raw = 'null'::jsonb or p_meta->>key = '' then continue; end if;
    if jsonb_typeof(raw) = 'boolean' then
      parts := parts || (key || '=' || case when p_meta->>key = 'true' then 'true' else 'false' end);
    elsif jsonb_typeof(raw) = 'number' then
      parts := parts || (key || '=' || (p_meta->>key));
    elsif jsonb_typeof(raw) = 'string' then
      parts := parts || (key || '=' || private.close_chain_escape(p_meta->>key));
    end if;
  end loop;
  return array_to_string(parts, ';');
end;
$$;

create function private.invoice_vat_base(p_invoice public.invoices, p_snapshot jsonb, out base_sum bigint, out vat_sum bigint)
language plpgsql
set search_path = ''
as $$
declare
  doc jsonb := p_snapshot->'document';
  rec record;
  bucket jsonb;
  rate integer;
  base_part bigint;
  vat_part bigint;
  expected bigint;
begin
  base_sum := 0;
  vat_sum := 0;
  if p_invoice.issued_snapshot_id is null or p_snapshot->>'kind' is distinct from 'operational_invoice'
     or p_invoice.status::text not in ('sent', 'partially_paid', 'paid', 'overdue') then
    raise exception 'Only an issued operational sales invoice can post.';
  end if;
  if p_invoice.wht_rate_bps <> 0 or p_invoice.wht_satang <> 0 then
    raise exception 'Withholding is not posted from the invoice.';
  end if;
  if p_invoice.issue_date is null or not isfinite(p_invoice.issue_date)
     or doc->>'number' is distinct from p_invoice.number
     or doc->>'issueDate' is distinct from p_invoice.issue_date::text
     or doc->'vatByRate' is distinct from p_invoice.tax_breakdown
     or coalesce(doc->>'pricesIncludeVat', '') is distinct from case when p_invoice.prices_include_vat then 'true' else 'false' end
     or coalesce(doc->>'subtotalSatang', '') is distinct from p_invoice.subtotal_satang::text
     or coalesce(doc->>'discountSatang', '') is distinct from p_invoice.discount_satang::text
     or coalesce(doc->>'vatSatang', '') is distinct from p_invoice.vat_satang::text
     or coalesce(doc->>'totalSatang', '') is distinct from p_invoice.total_satang::text
     or coalesce(doc->>'whtSatang', '') is distinct from p_invoice.wht_satang::text
     or coalesce(doc->>'whtRateBps', '') is distinct from p_invoice.wht_rate_bps::text
     or coalesce(doc->>'amountDueSatang', '') is distinct from p_invoice.amount_satang::text then
    raise exception 'The issued snapshot does not match the invoice.';
  end if;
  if p_invoice.discount_satang > p_invoice.subtotal_satang or jsonb_typeof(p_invoice.tax_breakdown) is distinct from 'array' or jsonb_array_length(p_invoice.tax_breakdown) = 0 then
    raise exception 'The stored totals do not match the VAT treatment.';
  end if;
  for rec in select value from jsonb_array_elements(p_invoice.tax_breakdown) as t(value) loop
    bucket := rec.value;
    begin
      rate := (bucket->>'rateBps')::integer;
      base_part := (bucket->>'baseSatang')::bigint;
      vat_part := (bucket->>'vatSatang')::bigint;
    exception when others then
      raise exception 'The stored VAT does not match the stated rate.';
    end;
    if rate is null or rate < 0 or rate > 10000 or base_part is null or vat_part is null or base_part < 0 or vat_part < 0 then
      raise exception 'The stored VAT does not match the stated rate.';
    end if;
    if p_invoice.prices_include_vat then
      expected := (2 * (base_part + vat_part) * rate + (10000 + rate)) / (2 * (10000 + rate));
    else
      expected := (2 * base_part * rate + 10000) / 20000;
    end if;
    if expected is distinct from vat_part then
      raise exception 'The stored VAT does not match the stated rate.';
    end if;
    base_sum := base_sum + base_part;
    vat_sum := vat_sum + vat_part;
  end loop;
  if vat_sum is distinct from p_invoice.vat_satang
     or base_sum + vat_sum is distinct from p_invoice.total_satang
     or p_invoice.amount_satang is distinct from p_invoice.total_satang
     or p_invoice.subtotal_satang - p_invoice.discount_satang is distinct from case when p_invoice.prices_include_vat then p_invoice.total_satang else base_sum end
     or p_invoice.total_satang <= 0 then
    raise exception 'The stored totals do not match the VAT treatment.';
  end if;
end;
$$;

revoke all on function private.invoice_vat_base(public.invoices, jsonb) from public, anon, authenticated, service_role;

create function public.post_deposit_invoice(p_org_id uuid, p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  snap public.invoice_snapshots;
  current_lock date;
  base_sum bigint;
  vat_sum bigint;
  entry_id uuid;
  line_no integer := 1;
  actor text;
  memo text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  select * into inv from public.invoices where org_id = p_org_id and id = p_invoice_id;
  if not found then raise exception 'A deposit invoice is not posted.'; end if;
  if exists (select 1 from public.journal_entries where org_id = p_org_id and source_invoice_id = p_invoice_id) then
    raise exception 'This invoice is already posted.';
  end if;
  if inv.quote_invoice_kind is distinct from 'deposit' or inv.quote_deposit_satang <= 0 or inv.quote_deposit_deduction_satang <> 0 or inv.source_quote_id is null then
    raise exception 'A deposit invoice is not posted.';
  end if;
  select * into snap from public.invoice_snapshots where org_id = p_org_id and id = inv.issued_snapshot_id;
  select parts.base_sum, parts.vat_sum into base_sum, vat_sum from private.invoice_vat_base(inv, snap.snapshot) parts;
  if base_sum is distinct from inv.quote_deposit_satang then
    raise exception 'The deposit base does not match the stored sale.';
  end if;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or inv.issue_date > current_lock then
    raise exception 'Post a journal only into a closed period.';
  end if;
  if not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1130')
     or not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '2120')
     or (vat_sum > 0 and not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '2130')) then
    raise exception 'Journal line account is not on the chart.';
  end if;
  memo := 'Issued deposit invoice ' || inv.number;
  insert into public.journal_entries(org_id, entry_date, memo, created_by, source_invoice_id)
    values (p_org_id, inv.issue_date, memo, auth.uid(), p_invoice_id)
    returning id into entry_id;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, line_no, '1130', inv.total_satang, 0);
  line_no := line_no + 1;
  if vat_sum > 0 then
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (p_org_id, entry_id, line_no, '2130', 0, vat_sum);
    line_no := line_no + 1;
  end if;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, line_no, '2120', 0, base_sum);
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id, auth.uid(), actor, 'journal', entry_id, 'journal_draft_posted',
      'Posted deposit invoice ' || inv.number || ' as a customer-deposit liability. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text, 'entryDate', inv.issue_date::text, 'debitSatang', inv.total_satang,
        'lineCount', line_no, 'kind', 'operational_journal', 'filing', false,
        'invoiceId', p_invoice_id::text, 'invoiceNumber', inv.number,
        'vatTreatment', case when vat_sum = 0 then 'no_vat' when inv.prices_include_vat then 'vat_inclusive' else 'vat_exclusive' end,
        'source', 'deposit_invoice', 'depositSatang', base_sum
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This invoice is already posted.';
end;
$$;

revoke all on function public.post_deposit_invoice(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_deposit_invoice(uuid, uuid) to authenticated;

create function public.post_final_with_deposit(p_org_id uuid, p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  snap public.invoice_snapshots;
  current_lock date;
  base_sum bigint;
  vat_sum bigint;
  posted_base bigint;
  entry_id uuid;
  line_no integer := 0;
  actor text;
  memo text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  select * into inv from public.invoices where org_id = p_org_id and id = p_invoice_id;
  if not found or inv.quote_invoice_kind is distinct from 'lines' or inv.quote_deposit_deduction_satang <= 0 or inv.quote_deposit_satang <> 0 or inv.source_quote_id is null then
    raise exception 'This final invoice does not apply the whole posted deposit.';
  end if;
  if exists (select 1 from public.journal_entries where org_id = p_org_id and source_invoice_id = p_invoice_id) then
    raise exception 'This invoice is already posted.';
  end if;
  if inv.discount_satang is distinct from inv.quote_discount_satang + inv.quote_deposit_deduction_satang then
    raise exception 'This deposit deduction is not in the invoice discount.';
  end if;
  if exists (
    select 1 from public.credit_notes c
    join public.invoices d on d.org_id = c.org_id and d.id = c.invoice_id
    where d.org_id = p_org_id and d.source_quote_id = inv.source_quote_id and d.quote_invoice_kind = 'deposit' and d.status::text <> 'cancelled'
  ) then
    raise exception 'A credit note on a deposit invoice is not applied.';
  end if;
  if exists (
    select 1 from public.invoices d
    where d.org_id = p_org_id and d.source_quote_id = inv.source_quote_id and d.quote_invoice_kind = 'deposit' and d.status::text <> 'cancelled'
      and not exists (select 1 from public.journal_entries e where e.org_id = d.org_id and e.source_invoice_id = d.id)
  ) then
    raise exception 'Post the deposit invoice before this final invoice.';
  end if;
  select coalesce(sum(l.credit_satang), 0) into posted_base
    from public.journal_lines l
    join public.journal_entries e on e.org_id = l.org_id and e.id = l.entry_id
    join public.invoices d on d.org_id = e.org_id and d.id = e.source_invoice_id
    where l.account_code = '2120' and l.credit_satang > 0
      and d.org_id = p_org_id and d.source_quote_id = inv.source_quote_id and d.quote_invoice_kind = 'deposit' and d.status::text <> 'cancelled';
  if posted_base is distinct from inv.quote_deposit_deduction_satang then
    raise exception 'This final invoice does not apply the whole posted deposit.';
  end if;
  select * into snap from public.invoice_snapshots where org_id = p_org_id and id = inv.issued_snapshot_id;
  select parts.base_sum, parts.vat_sum into base_sum, vat_sum from private.invoice_vat_base(inv, snap.snapshot) parts;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or inv.issue_date > current_lock then
    raise exception 'Post a journal only into a closed period.';
  end if;
  if not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1130')
     or not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '2120')
     or not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '4100')
     or (vat_sum > 0 and not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '2130')) then
    raise exception 'Journal line account is not on the chart.';
  end if;
  memo := 'Issued sales invoice ' || inv.number || ' applying posted deposit';
  insert into public.journal_entries(org_id, entry_date, memo, created_by, source_invoice_id)
    values (p_org_id, inv.issue_date, memo, auth.uid(), p_invoice_id)
    returning id into entry_id;
  if inv.total_satang > 0 then
    line_no := line_no + 1;
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (p_org_id, entry_id, line_no, '1130', inv.total_satang, 0);
  end if;
  line_no := line_no + 1;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, line_no, '2120', inv.quote_deposit_deduction_satang, 0);
  if vat_sum > 0 then
    line_no := line_no + 1;
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (p_org_id, entry_id, line_no, '2130', 0, vat_sum);
  end if;
  line_no := line_no + 1;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, line_no, '4100', 0, base_sum + inv.quote_deposit_deduction_satang);
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id, auth.uid(), actor, 'journal', entry_id, 'journal_draft_posted',
      'Posted sales invoice ' || inv.number || ' and applied the posted deposit to sales. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text, 'entryDate', inv.issue_date::text,
        'debitSatang', inv.total_satang + inv.quote_deposit_deduction_satang,
        'lineCount', line_no, 'kind', 'operational_journal', 'filing', false,
        'invoiceId', p_invoice_id::text, 'invoiceNumber', inv.number,
        'vatTreatment', case when vat_sum = 0 then 'no_vat' when inv.prices_include_vat then 'vat_inclusive' else 'vat_exclusive' end,
        'source', 'sales_invoice', 'depositSatang', inv.quote_deposit_deduction_satang
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This invoice is already posted.';
end;
$$;

revoke all on function public.post_final_with_deposit(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_final_with_deposit(uuid, uuid) to authenticated;
