-- Post one issued sales invoice into the draft journal.
-- The stored VAT split is used. Withholding, deposits, credit notes, and
-- legacy adoptions are refused. This is not signed statutory books and
-- not a ภ.พ.30 or e-Tax filing.

alter table public.journal_entries
  add column source_invoice_id uuid;

alter table public.journal_entries
  add constraint journal_entries_source_invoice
  foreign key (org_id, source_invoice_id) references public.invoices (org_id, id) on delete cascade;

create unique index journal_entries_one_invoice
  on public.journal_entries (org_id, source_invoice_id)
  where source_invoice_id is not null;

create or replace function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount','note','entryId','entryDate','debitSatang','lineCount','invoiceId','invoiceNumber','vatTreatment'];
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

create function public.post_issued_sales_invoice(p_org_id uuid, p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  snap public.invoice_snapshots;
  doc jsonb;
  current_lock date;
  bucket jsonb;
  rec record;
  rate integer;
  base_part bigint;
  vat_part bigint;
  expected bigint;
  base_sum bigint := 0;
  vat_sum bigint := 0;
  gross bigint;
  entry_id uuid;
  line_no integer := 1;
  actor text;
  treatment text;
  treatment_label text;
  memo text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  select * into inv from public.invoices where org_id = p_org_id and id = p_invoice_id;
  if not found then
    raise exception 'Only an issued operational sales invoice can post.';
  end if;
  if exists (select 1 from public.journal_entries where org_id = p_org_id and source_invoice_id = p_invoice_id) then
    raise exception 'This invoice is already posted.';
  end if;
  if inv.issued_snapshot_id is null then
    raise exception 'Only an issued operational sales invoice can post.';
  end if;
  select * into snap from public.invoice_snapshots where org_id = p_org_id and id = inv.issued_snapshot_id;
  if snap.snapshot->>'kind' is distinct from 'operational_invoice' or inv.status::text not in ('sent', 'partially_paid', 'paid', 'overdue') then
    raise exception 'Only an issued operational sales invoice can post.';
  end if;
  if inv.quote_invoice_kind is distinct from 'lines' or inv.quote_deposit_satang <> 0 or inv.quote_deposit_deduction_satang <> 0 then
    raise exception 'A deposit invoice is not posted.';
  end if;
  if exists (select 1 from public.credit_notes where org_id = p_org_id and invoice_id = p_invoice_id) then
    raise exception 'A credit note already changes this invoice. Credit notes are not posted yet.';
  end if;
  if inv.wht_rate_bps <> 0 or inv.wht_satang <> 0 then
    raise exception 'Withholding is not posted from the invoice.';
  end if;
  doc := snap.snapshot->'document';
  if inv.issue_date is null or not isfinite(inv.issue_date)
     or doc->>'number' is distinct from inv.number
     or doc->>'issueDate' is distinct from inv.issue_date::text
     or doc->'vatByRate' is distinct from inv.tax_breakdown
     or coalesce(doc->>'pricesIncludeVat', '') is distinct from case when inv.prices_include_vat then 'true' else 'false' end
     or coalesce(doc->>'subtotalSatang', '') is distinct from inv.subtotal_satang::text
     or coalesce(doc->>'discountSatang', '') is distinct from inv.discount_satang::text
     or coalesce(doc->>'vatSatang', '') is distinct from inv.vat_satang::text
     or coalesce(doc->>'totalSatang', '') is distinct from inv.total_satang::text
     or coalesce(doc->>'whtSatang', '') is distinct from inv.wht_satang::text
     or coalesce(doc->>'whtRateBps', '') is distinct from inv.wht_rate_bps::text
     or coalesce(doc->>'amountDueSatang', '') is distinct from inv.amount_satang::text then
    raise exception 'The issued snapshot does not match the invoice.';
  end if;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or inv.issue_date > current_lock then
    raise exception 'Post a journal only into a closed period.';
  end if;
  if inv.discount_satang > inv.subtotal_satang or jsonb_typeof(inv.tax_breakdown) is distinct from 'array' or jsonb_array_length(inv.tax_breakdown) = 0 then
    raise exception 'The stored totals do not match the VAT treatment.';
  end if;
  for rec in select value from jsonb_array_elements(inv.tax_breakdown) as t(value) loop
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
    if inv.prices_include_vat then
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
  gross := case when inv.prices_include_vat then inv.total_satang else base_sum end;
  if vat_sum is distinct from inv.vat_satang
     or base_sum + vat_sum is distinct from inv.total_satang
     or inv.amount_satang is distinct from inv.total_satang
     or inv.subtotal_satang - inv.discount_satang is distinct from gross
     or inv.total_satang <= 0 then
    raise exception 'The stored totals do not match the VAT treatment.';
  end if;
  if not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1130')
     or (base_sum > 0 and not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '4100'))
     or (vat_sum > 0 and not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '2130')) then
    raise exception 'Journal line account is not on the chart.';
  end if;
  memo := 'Issued sales invoice ' || inv.number;
  if length(memo) > 200 then
    raise exception 'Enter a journal memo.';
  end if;
  treatment := case when vat_sum = 0 then 'no_vat' when inv.prices_include_vat then 'vat_inclusive' else 'vat_exclusive' end;
  treatment_label := case treatment when 'no_vat' then 'no VAT' when 'vat_inclusive' then 'VAT inclusive' else 'VAT exclusive' end;
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
  if base_sum > 0 then
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (p_org_id, entry_id, line_no, '4100', 0, base_sum);
  end if;
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id,
      auth.uid(),
      actor,
      'journal',
      entry_id,
      'journal_draft_posted',
      'Posted issued sales invoice ' || inv.number || ' as a draft journal. VAT treatment: ' || treatment_label || '. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text,
        'entryDate', inv.issue_date::text,
        'debitSatang', inv.total_satang,
        'lineCount', case when vat_sum > 0 and base_sum > 0 then 3 when vat_sum > 0 or base_sum > 0 then 2 else 1 end,
        'kind', 'operational_journal',
        'filing', false,
        'invoiceId', p_invoice_id::text,
        'invoiceNumber', inv.number,
        'vatTreatment', treatment
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This invoice is already posted.';
end;
$$;

revoke all on function public.post_issued_sales_invoice(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_issued_sales_invoice(uuid, uuid) to authenticated;
