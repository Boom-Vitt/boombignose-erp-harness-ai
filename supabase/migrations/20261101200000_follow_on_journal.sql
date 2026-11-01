-- A credit note reverses part of a posted sales invoice.
-- A verified cash receipt clears part of that receivable.
-- Bank, card, cheque, and withholding stay unposted.
-- This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.

alter table public.journal_entries add column source_credit_note_id uuid;
alter table public.journal_entries add column source_payment_id uuid;

alter table public.journal_entries
  add constraint journal_entries_source_credit
  foreign key (org_id, source_credit_note_id) references public.credit_notes (org_id, id) on delete cascade;

alter table public.journal_entries
  add constraint journal_entries_source_payment
  foreign key (org_id, source_payment_id) references public.payments (org_id, id) on delete cascade;

create unique index journal_entries_one_credit
  on public.journal_entries (org_id, source_credit_note_id)
  where source_credit_note_id is not null;

create unique index journal_entries_one_payment
  on public.journal_entries (org_id, source_payment_id)
  where source_payment_id is not null;

create or replace function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount','note','entryId','entryDate','debitSatang','lineCount','invoiceId','invoiceNumber','vatTreatment','creditNoteId','paymentId','source'];
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

-- A credit note no longer blocks the original sale. The credit posts on its own.
create or replace function public.post_issued_sales_invoice(p_org_id uuid, p_invoice_id uuid)
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
        'vatTreatment', treatment,
        'source', 'sales_invoice'
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This invoice is already posted.';
end;
$$;

revoke all on function public.post_issued_sales_invoice(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_issued_sales_invoice(uuid, uuid) to authenticated;

create function public.post_issued_credit_note(p_org_id uuid, p_credit_note_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  note public.credit_notes;
  inv public.invoices;
  doc jsonb;
  bucket jsonb;
  rec record;
  rate integer;
  base_part bigint;
  vat_part bigint;
  expected bigint;
  base_sum bigint := 0;
  vat_sum bigint := 0;
  invoice_base bigint;
  posted_base bigint;
  posted_vat bigint;
  posted_total bigint;
  posted_receipt bigint;
  current_lock date;
  entry_id uuid;
  line_no integer := 1;
  actor text;
  inclusive boolean;
  treatment text;
  treatment_label text;
  memo text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  select * into note from public.credit_notes where org_id = p_org_id and id = p_credit_note_id;
  if not found or note.snapshot->>'kind' is distinct from 'credit_note' then
    raise exception 'Only an issued credit note can post.';
  end if;
  if exists (select 1 from public.journal_entries where org_id = p_org_id and source_credit_note_id = p_credit_note_id) then
    raise exception 'This credit note is already posted.';
  end if;
  select * into inv from public.invoices where org_id = p_org_id and id = note.invoice_id;
  if not found or not exists (select 1 from public.journal_entries where org_id = p_org_id and source_invoice_id = inv.id) then
    raise exception 'Post the sales invoice before this credit note.';
  end if;
  doc := note.snapshot->'document';
  inclusive := coalesce(doc->>'pricesIncludeVat', '') = 'true';
  if note.issue_date is null or not isfinite(note.issue_date)
     or doc->>'number' is distinct from note.number
     or doc->>'issueDate' is distinct from note.issue_date::text
     or coalesce(doc->>'amountDueSatang', '') is distinct from note.amount_satang::text
     or coalesce(doc->>'pricesIncludeVat', '') not in ('true', 'false')
     or inclusive is distinct from inv.prices_include_vat then
    raise exception 'The issued snapshot does not match the credit note.';
  end if;
  if coalesce(doc->>'whtSatang', '') is distinct from '0' or coalesce(doc->>'whtRateBps', '') is distinct from '0' then
    raise exception 'Withholding is not posted from the credit note.';
  end if;
  if jsonb_typeof(doc->'vatByRate') is distinct from 'array' or jsonb_array_length(doc->'vatByRate') = 0 then
    raise exception 'The stored totals do not match the VAT treatment.';
  end if;
  for rec in select value from jsonb_array_elements(doc->'vatByRate') as t(value) loop
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
    if inclusive then
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
  if coalesce(doc->>'baseSatang', '') is distinct from base_sum::text
     or coalesce(doc->>'vatSatang', '') is distinct from vat_sum::text
     or coalesce(doc->>'totalSatang', '') is distinct from (base_sum + vat_sum)::text
     or note.amount_satang is distinct from base_sum + vat_sum
     or base_sum + vat_sum <= 0 then
    raise exception 'The stored totals do not match the VAT treatment.';
  end if;
  invoice_base := inv.total_satang - inv.vat_satang;
  select coalesce(sum((c.snapshot->'document'->>'baseSatang')::bigint), 0),
         coalesce(sum((c.snapshot->'document'->>'vatSatang')::bigint), 0),
         coalesce(sum((c.snapshot->'document'->>'totalSatang')::bigint), 0)
    into posted_base, posted_vat, posted_total
    from public.credit_notes c
    join public.journal_entries j on j.org_id = c.org_id and j.source_credit_note_id = c.id
    where c.org_id = p_org_id and c.invoice_id = inv.id;
  select coalesce(sum(a.amount_satang), 0) into posted_receipt
    from public.payment_allocations a
    join public.journal_entries j on j.org_id = a.org_id and j.source_payment_id = a.payment_id
    where a.org_id = p_org_id and a.invoice_id = inv.id and a.amount_satang > 0;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or note.issue_date > current_lock then
    raise exception 'Post a journal only into a closed period.';
  end if;
  if base_sum > invoice_base - posted_base or vat_sum > inv.vat_satang - posted_vat or base_sum + vat_sum > inv.total_satang - posted_total then
    raise exception 'This credit is larger than the sale still posted.';
  end if;
  if base_sum + vat_sum > inv.total_satang - posted_total - posted_receipt then
    raise exception 'This credit is larger than the receivable still posted.';
  end if;
  if not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1130')
     or (base_sum > 0 and not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '4100'))
     or (vat_sum > 0 and not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '2130')) then
    raise exception 'Journal line account is not on the chart.';
  end if;
  memo := 'Issued credit note ' || note.number;
  if length(memo) > 200 then
    raise exception 'Enter a journal memo.';
  end if;
  treatment := case when vat_sum = 0 then 'no_vat' when inclusive then 'vat_inclusive' else 'vat_exclusive' end;
  treatment_label := case treatment when 'no_vat' then 'no VAT' when 'vat_inclusive' then 'VAT inclusive' else 'VAT exclusive' end;
  insert into public.journal_entries(org_id, entry_date, memo, created_by, source_credit_note_id)
    values (p_org_id, note.issue_date, memo, auth.uid(), p_credit_note_id)
    returning id into entry_id;
  if base_sum > 0 then
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (p_org_id, entry_id, line_no, '4100', base_sum, 0);
    line_no := line_no + 1;
  end if;
  if vat_sum > 0 then
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (p_org_id, entry_id, line_no, '2130', vat_sum, 0);
    line_no := line_no + 1;
  end if;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, line_no, '1130', 0, base_sum + vat_sum);
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id, auth.uid(), actor, 'journal', entry_id, 'journal_draft_posted',
      'Posted credit note ' || note.number || ' as a draft journal. VAT treatment: ' || treatment_label || '. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text,
        'entryDate', note.issue_date::text,
        'debitSatang', base_sum + vat_sum,
        'lineCount', line_no,
        'kind', 'operational_journal',
        'filing', false,
        'invoiceId', inv.id::text,
        'invoiceNumber', inv.number,
        'vatTreatment', treatment,
        'creditNoteId', p_credit_note_id::text,
        'source', 'credit_note'
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This credit note is already posted.';
end;
$$;

revoke all on function public.post_issued_credit_note(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_issued_credit_note(uuid, uuid) to authenticated;

create function public.post_cash_receipt(p_org_id uuid, p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments;
  paid_on date;
  current_lock date;
  allocated bigint;
  rec record;
  inv public.invoices;
  posted_total bigint;
  posted_receipt bigint;
  entry_id uuid;
  actor text;
  reference text;
  memo text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  select * into pay from public.payments where org_id = p_org_id and id = p_payment_id;
  if not found or pay.verification_state is distinct from 'verified' or pay.reversal_of is not null or pay.refund_of is not null or pay.amount_satang <= 0 then
    raise exception 'Only a verified cash receipt can post.';
  end if;
  if exists (select 1 from public.journal_entries where org_id = p_org_id and source_payment_id = p_payment_id) then
    raise exception 'This receipt is already posted.';
  end if;
  if pay.method::text is distinct from 'cash' then
    raise exception 'Only a cash receipt is posted. Bank, card, and cheque receipts are not posted yet.';
  end if;
  paid_on := (pay.paid_at at time zone 'Asia/Bangkok')::date;
  if paid_on is null or not isfinite(paid_on) then
    raise exception 'Enter a journal date.';
  end if;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or paid_on > current_lock then
    raise exception 'Post a journal only into a closed period.';
  end if;
  if exists (select 1 from public.payment_allocations where org_id = p_org_id and payment_id = p_payment_id and amount_satang <= 0) then
    raise exception 'This receipt is not fully allocated to posted invoices.';
  end if;
  select coalesce(sum(amount_satang), 0) into allocated from public.payment_allocations where org_id = p_org_id and payment_id = p_payment_id;
  if allocated is distinct from pay.amount_satang then
    raise exception 'This receipt is not fully allocated to posted invoices.';
  end if;
  for rec in
    select invoice_id, sum(amount_satang)::bigint as slice
    from public.payment_allocations
    where org_id = p_org_id and payment_id = p_payment_id
    group by invoice_id
  loop
    select * into inv from public.invoices where org_id = p_org_id and id = rec.invoice_id;
    if not found or not exists (select 1 from public.journal_entries where org_id = p_org_id and source_invoice_id = inv.id) then
      raise exception 'Post the sales invoice before this receipt.';
    end if;
    if inv.wht_satang <> 0 or inv.wht_rate_bps <> 0 or inv.amount_satang is distinct from inv.total_satang then
      raise exception 'Withholding is not posted from the receipt.';
    end if;
    select coalesce(sum((c.snapshot->'document'->>'totalSatang')::bigint), 0) into posted_total
      from public.credit_notes c
      join public.journal_entries j on j.org_id = c.org_id and j.source_credit_note_id = c.id
      where c.org_id = p_org_id and c.invoice_id = inv.id;
    select coalesce(sum(a.amount_satang), 0) into posted_receipt
      from public.payment_allocations a
      join public.journal_entries j on j.org_id = a.org_id and j.source_payment_id = a.payment_id
      where a.org_id = p_org_id and a.invoice_id = inv.id and a.amount_satang > 0;
    if rec.slice > inv.total_satang - posted_total - posted_receipt then
      raise exception 'This receipt is larger than the receivable still posted.';
    end if;
  end loop;
  if not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1110')
     or not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1130') then
    raise exception 'Journal line account is not on the chart.';
  end if;
  reference := coalesce(nullif(btrim(pay.notes), ''), nullif(btrim(pay.verification_reference), ''), '');
  memo := case when reference = '' then 'Cash receipt ' || paid_on::text else 'Cash receipt ' || paid_on::text || ' ' || reference end;
  if length(memo) > 200 then
    raise exception 'Enter a journal memo.';
  end if;
  insert into public.journal_entries(org_id, entry_date, memo, created_by, source_payment_id)
    values (p_org_id, paid_on, memo, auth.uid(), p_payment_id)
    returning id into entry_id;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, 1, '1110', pay.amount_satang, 0),
           (p_org_id, entry_id, 2, '1130', 0, pay.amount_satang);
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id, auth.uid(), actor, 'journal', entry_id, 'journal_draft_posted',
      'Posted cash receipt ' || paid_on::text || ' as a draft journal. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text,
        'entryDate', paid_on::text,
        'debitSatang', pay.amount_satang,
        'lineCount', 2,
        'kind', 'operational_journal',
        'filing', false,
        'paymentId', p_payment_id::text,
        'source', 'cash_receipt'
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This receipt is already posted.';
end;
$$;

revoke all on function public.post_cash_receipt(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_cash_receipt(uuid, uuid) to authenticated;
