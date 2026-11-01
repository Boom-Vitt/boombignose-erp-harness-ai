begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.follow_id(n integer) returns uuid language sql immutable as $$
  select ('c8f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.follow_id(1), 'synthetic-follow-owner@example.invalid', now()),
  (pg_temp.follow_id(2), 'synthetic-follow-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.follow_id(10), 'Synthetic follow-on journal', 'synthetic-follow-on-journal');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.follow_id(10), pg_temp.follow_id(1), 'owner'),
  (pg_temp.follow_id(10), pg_temp.follow_id(2), 'member');
insert into public.clients(id, org_id, name) values
  (pg_temp.follow_id(20), pg_temp.follow_id(10), 'Synthetic buyer');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.follow_id(1))::text, true);
set local role authenticated;

select public.update_tax_business_profile(pg_temp.follow_id(10), 'Synthetic seller', 'Seller address', '1234567890123', true, 700, false, 'Head office');
select public.install_thai_sme_chart(pg_temp.follow_id(10));
insert into public.invoices(id, org_id, client_id, number) values
  (pg_temp.follow_id(30), pg_temp.follow_id(10), pg_temp.follow_id(20), 'FOLLOW-SALE');
insert into public.invoice_items(org_id, invoice_id, description, unit_price_satang, tax_rate_bps) values
  (pg_temp.follow_id(10), pg_temp.follow_id(30), 'Taxable service', 100000, 700);
select lives_ok(
  $$select public.issue_invoice(pg_temp.follow_id(10), pg_temp.follow_id(30), (select version from public.invoices where id = pg_temp.follow_id(30)), pg_temp.follow_id(40))$$,
  'the sales invoice issues'
);
select lives_ok(
  $$select public.issue_credit_note(pg_temp.follow_id(10), pg_temp.follow_id(30), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.follow_id(30)), 'amount_satang', 10000)), 'Returned part of the service', pg_temp.follow_id(41))$$,
  'a partial credit note issues'
);
select is((select amount_satang from public.credit_notes where invoice_id = pg_temp.follow_id(30)), 10700::bigint, 'the credit note amount due is base plus VAT');

reset role;
insert into public.payments(id, org_id, client_id, invoice_id, amount_satang, paid_at, method, verification_state, notes)
  values (pg_temp.follow_id(50), pg_temp.follow_id(10), pg_temp.follow_id(20), pg_temp.follow_id(30), 5000, now(), 'cash', 'verified', 'เงินสดหน้าร้าน');
insert into public.payment_allocations(org_id, payment_id, invoice_id, amount_satang)
  values (pg_temp.follow_id(10), pg_temp.follow_id(50), pg_temp.follow_id(30), 5000);
insert into public.payments(id, org_id, client_id, invoice_id, amount_satang, paid_at, method, verification_state, notes)
  values (pg_temp.follow_id(51), pg_temp.follow_id(10), pg_temp.follow_id(20), pg_temp.follow_id(30), 1000, now(), 'transfer', 'verified', 'โอนธนาคาร');
insert into public.payment_allocations(org_id, payment_id, invoice_id, amount_satang)
  values (pg_temp.follow_id(10), pg_temp.follow_id(51), pg_temp.follow_id(30), 1000);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.follow_id(1))::text, true);
set local role authenticated;

select lives_ok(
  format('select public.update_finance_lock_date(%L, (now() at time zone ''Asia/Bangkok'')::date)', pg_temp.follow_id(10)),
  'the owner locks through today'
);
select throws_ok(
  $$select public.post_issued_credit_note(pg_temp.follow_id(10), (select id from public.credit_notes where invoice_id = pg_temp.follow_id(30)))$$,
  'P0001',
  'Post the sales invoice before this credit note.',
  'the credit note waits for the sales journal'
);
select lives_ok($$select public.post_issued_sales_invoice(pg_temp.follow_id(10), pg_temp.follow_id(30))$$, 'the sale posts even though a credit note exists');
select lives_ok(
  $$select public.post_issued_credit_note(pg_temp.follow_id(10), (select id from public.credit_notes where invoice_id = pg_temp.follow_id(30)))$$,
  'the credit note posts'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '1130' and entry_id = (select id from public.journal_entries where source_credit_note_id = (select id from public.credit_notes where invoice_id = pg_temp.follow_id(30)))),
  10700::bigint,
  'the credit note credits the receivable'
);
select is(
  (select debit_satang from public.journal_lines where account_code = '4100' and entry_id = (select id from public.journal_entries where source_credit_note_id = (select id from public.credit_notes where invoice_id = pg_temp.follow_id(30)))),
  10000::bigint,
  'the credit note debits sales for the base'
);
select lives_ok($$select public.post_cash_receipt(pg_temp.follow_id(10), pg_temp.follow_id(50))$$, 'the cash receipt posts');
select is(
  (select debit_satang from public.journal_lines where account_code = '1110' and entry_id = (select id from public.journal_entries where source_payment_id = pg_temp.follow_id(50))),
  5000::bigint,
  'cash is debited'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '1130' and entry_id = (select id from public.journal_entries where source_payment_id = pg_temp.follow_id(50))),
  5000::bigint,
  'the receipt credits the receivable'
);
select throws_ok(
  $$select public.post_cash_receipt(pg_temp.follow_id(10), pg_temp.follow_id(51))$$,
  'P0001',
  'Only a cash receipt is posted. Bank, card, and cheque receipts are not posted yet.',
  'a bank transfer is refused'
);
select throws_ok(
  $$select public.post_issued_credit_note(pg_temp.follow_id(10), (select id from public.credit_notes where invoice_id = pg_temp.follow_id(30)))$$,
  'P0001',
  'This credit note is already posted.',
  'the credit note does not post twice'
);
select ok(
  (select summary from public.audit_log where org_id = pg_temp.follow_id(10) and meta->>'source' = 'credit_note') like '%not signed statutory books%',
  'the credit note audit is not signed statutory books'
);
select is((public.verify_close_activity_chain(pg_temp.follow_id(10))->>'ok')::boolean, true, 'the follow-on posts join the close chain');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.follow_id(2))::text, true);
select throws_ok(
  $$select public.post_cash_receipt(pg_temp.follow_id(10), pg_temp.follow_id(51))$$,
  'P0001',
  'Only owners, admins, and accountants can post a draft journal',
  'a member cannot post'
);

select * from finish();
rollback;
