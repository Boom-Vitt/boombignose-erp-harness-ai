-- Transfer, PromptPay, card, and cheque receipts post to bank account 1120.
-- This chart has no card-clearing account and no undeposited-cheque account.
-- A deposit invoice stays unposted: there is no customer-deposit account,
-- and the final invoice already folds the deposit into its discount.
-- This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.

create or replace function public.post_cash_receipt(p_org_id uuid, p_payment_id uuid)
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
  debit_account text;
  treatment text;
  label text;
  source_kind text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  select * into pay from public.payments where org_id = p_org_id and id = p_payment_id;
  if not found or pay.verification_state is distinct from 'verified' or pay.reversal_of is not null or pay.refund_of is not null or pay.amount_satang <= 0 then
    raise exception 'Only a verified receipt can post.';
  end if;
  if exists (select 1 from public.journal_entries where org_id = p_org_id and source_payment_id = p_payment_id) then
    raise exception 'This receipt is already posted.';
  end if;
  -- Cash uses 1110. Transfer, PromptPay, card, and cheque use 1120.
  -- This chart has no card-clearing account and no undeposited-cheque account.
  if pay.method::text = 'cash' then
    debit_account := '1110';
    treatment := 'cash';
    label := 'Cash';
    source_kind := 'cash_receipt';
  elsif pay.method::text in ('transfer', 'promptpay', 'card', 'cheque') then
    debit_account := '1120';
    treatment := 'bank';
    label := 'Bank';
    source_kind := 'bank_receipt';
  else
    raise exception 'This receipt method is not posted.';
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
  if not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = debit_account)
     or not exists (select 1 from public.gl_accounts where org_id = p_org_id and code = '1130') then
    raise exception 'Journal line account is not on the chart.';
  end if;
  reference := coalesce(nullif(btrim(pay.notes), ''), nullif(btrim(pay.verification_reference), ''), '');
  memo := case when reference = '' then label || ' receipt ' || paid_on::text else label || ' receipt ' || paid_on::text || ' ' || reference end;
  if length(memo) > 200 then
    raise exception 'Enter a journal memo.';
  end if;
  insert into public.journal_entries(org_id, entry_date, memo, created_by, source_payment_id)
    values (p_org_id, paid_on, memo, auth.uid(), p_payment_id)
    returning id into entry_id;
  insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
    values (p_org_id, entry_id, 1, debit_account, pay.amount_satang, 0),
           (p_org_id, entry_id, 2, '1130', 0, pay.amount_satang);
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id, auth.uid(), actor, 'journal', entry_id, 'journal_draft_posted',
      'Posted ' || lower(label) || ' receipt ' || paid_on::text || ' as a draft journal. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text,
        'entryDate', paid_on::text,
        'debitSatang', pay.amount_satang,
        'lineCount', 2,
        'kind', 'operational_journal',
        'filing', false,
        'paymentId', p_payment_id::text,
        'vatTreatment', treatment,
        'source', source_kind
      )
    );
  return entry_id;
exception when unique_violation then
  raise exception 'This receipt is already posted.';
end;
$$;

revoke all on function public.post_cash_receipt(uuid, uuid) from public, anon, service_role;
grant execute on function public.post_cash_receipt(uuid, uuid) to authenticated;
