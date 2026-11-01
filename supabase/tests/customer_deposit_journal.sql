begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.dep_id(n integer) returns uuid language sql immutable as $$
  select ('c9f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.dep_id(1), 'synthetic-deposit-owner@example.invalid', now()),
  (pg_temp.dep_id(2), 'synthetic-deposit-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.dep_id(10), 'Synthetic customer deposit', 'synthetic-customer-deposit');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.dep_id(10), pg_temp.dep_id(1), 'owner'),
  (pg_temp.dep_id(10), pg_temp.dep_id(2), 'member');
insert into public.clients(id, org_id, name) values
  (pg_temp.dep_id(20), pg_temp.dep_id(10), 'Synthetic buyer');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.dep_id(1))::text, true);
set local role authenticated;

select public.update_tax_business_profile(pg_temp.dep_id(10), 'Synthetic seller', 'Seller address', '1234567890123', true, 700, false, 'Head office');
select public.install_thai_sme_chart(pg_temp.dep_id(10));
select ok(exists(select 1 from public.gl_accounts where org_id = pg_temp.dep_id(10) and code = '2120' and kind = 'liability'), 'the chart includes customer deposits');

insert into public.quotes(id, org_id, client_id, number) values
  (pg_temp.dep_id(40), pg_temp.dep_id(10), pg_temp.dep_id(20), 'DEP-QUOTE');
insert into public.quote_items(id, org_id, quote_id, description, quantity, unit_price_satang, tax_rate_bps) values
  (pg_temp.dep_id(41), pg_temp.dep_id(10), pg_temp.dep_id(40), 'Quoted work', 10, 1000, 700);
update public.quotes set status = 'sent' where id = pg_temp.dep_id(40);
update public.quotes set status = 'accepted' where id = pg_temp.dep_id(40);
select public.convert_accepted_quote(pg_temp.dep_id(10), pg_temp.dep_id(40), pg_temp.dep_id(42), null, null, 2500);
select public.convert_accepted_quote(pg_temp.dep_id(10), pg_temp.dep_id(40), pg_temp.dep_id(43));

select lives_ok(
  $$select public.issue_invoice(pg_temp.dep_id(10), id, version, pg_temp.dep_id(44)) from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'deposit'$$,
  'the deposit invoice issues'
);
select lives_ok(
  $$select public.issue_invoice(pg_temp.dep_id(10), id, version, pg_temp.dep_id(45)) from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'lines'$$,
  'the final invoice issues'
);
select is((select quote_deposit_satang from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'deposit'), 2500::bigint, 'the deposit stores the pretax base');
select is((select total_satang from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'deposit'), 2675::bigint, 'the deposit total includes VAT');
select is((select quote_deposit_deduction_satang from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'lines'), 2500::bigint, 'the final invoice deducts that base');

select lives_ok(
  format('select public.update_finance_lock_date(%L, (now() at time zone ''Asia/Bangkok'')::date)', pg_temp.dep_id(10)),
  'the owner locks through today'
);
select throws_ok(
  $$select public.post_final_with_deposit(pg_temp.dep_id(10), id) from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'lines'$$,
  'P0001',
  'Post the deposit invoice before this final invoice.',
  'the final invoice waits for the deposit'
);
select lives_ok(
  $$select public.post_deposit_invoice(pg_temp.dep_id(10), id) from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'deposit'$$,
  'the deposit posts'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '2120' and entry_id = (select e.id from public.journal_entries e join public.invoices i on i.id = e.source_invoice_id where i.quote_invoice_kind = 'deposit' and i.source_quote_id = pg_temp.dep_id(40))),
  2500::bigint,
  'the deposit base is a liability'
);
select is(
  (select count(*) from public.journal_lines where account_code = '4100' and entry_id = (select e.id from public.journal_entries e join public.invoices i on i.id = e.source_invoice_id where i.quote_invoice_kind = 'deposit' and i.source_quote_id = pg_temp.dep_id(40))),
  0::bigint,
  'the deposit is not sales'
);
select lives_ok(
  $$select public.post_final_with_deposit(pg_temp.dep_id(10), id) from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'lines'$$,
  'the final invoice applies the deposit'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '4100' and entry_id = (select e.id from public.journal_entries e join public.invoices i on i.id = e.source_invoice_id where i.quote_invoice_kind = 'lines' and i.source_quote_id = pg_temp.dep_id(40))),
  10000::bigint,
  'sales is the remainder plus the applied deposit'
);
select is(
  (select debit_satang from public.journal_lines where account_code = '2120' and entry_id = (select e.id from public.journal_entries e join public.invoices i on i.id = e.source_invoice_id where i.quote_invoice_kind = 'lines' and i.source_quote_id = pg_temp.dep_id(40))),
  2500::bigint,
  'the liability is cleared'
);
select is((public.verify_close_activity_chain(pg_temp.dep_id(10))->>'ok')::boolean, true, 'the deposit posts join the close chain');
select ok(
  (select summary from public.audit_log where org_id = pg_temp.dep_id(10) and meta->>'source' = 'deposit_invoice') like '%not signed statutory books%',
  'the deposit audit is not signed statutory books'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.dep_id(2))::text, true);
select throws_ok(
  $$select public.post_deposit_invoice(pg_temp.dep_id(10), id) from public.invoices where source_quote_id = pg_temp.dep_id(40) and quote_invoice_kind = 'deposit'$$,
  'P0001',
  'Only owners, admins, and accountants can post a draft journal',
  'a member cannot post'
);

select * from finish();
rollback;
