begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.sale_id(n integer) returns uuid language sql immutable as $$
  select ('c7f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.sale_id(1), 'synthetic-sale-owner@example.invalid', now()),
  (pg_temp.sale_id(2), 'synthetic-sale-accountant@example.invalid', now()),
  (pg_temp.sale_id(3), 'synthetic-sale-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.sale_id(10), 'Synthetic sales journal', 'synthetic-sales-journal');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.sale_id(10), pg_temp.sale_id(1), 'owner'),
  (pg_temp.sale_id(10), pg_temp.sale_id(2), 'accountant'),
  (pg_temp.sale_id(10), pg_temp.sale_id(3), 'member');
insert into public.clients(id, org_id, name) values
  (pg_temp.sale_id(20), pg_temp.sale_id(10), 'Synthetic buyer');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.sale_id(1))::text, true);
set local role authenticated;

select public.update_tax_business_profile(pg_temp.sale_id(10), 'Synthetic seller', 'Seller address', '1234567890123', true, 700, false, 'Head office');
select public.install_thai_sme_chart(pg_temp.sale_id(10));

insert into public.invoices(id, org_id, client_id, number) values
  (pg_temp.sale_id(30), pg_temp.sale_id(10), pg_temp.sale_id(20), 'SALE-EXCLUSIVE');
insert into public.invoice_items(org_id, invoice_id, description, unit_price_satang, tax_rate_bps) values
  (pg_temp.sale_id(10), pg_temp.sale_id(30), 'Taxable service', 100000, 700);
select lives_ok(
  $$select public.issue_invoice(pg_temp.sale_id(10), pg_temp.sale_id(30), (select version from public.invoices where id = pg_temp.sale_id(30)), pg_temp.sale_id(40))$$,
  'the exclusive invoice issues'
);

select public.update_tax_business_profile(pg_temp.sale_id(10), 'Synthetic seller', 'Seller address', '1234567890123', true, 700, true, 'Head office');
insert into public.invoices(id, org_id, client_id, number) values
  (pg_temp.sale_id(31), pg_temp.sale_id(10), pg_temp.sale_id(20), 'SALE-INCLUSIVE');
insert into public.invoice_items(org_id, invoice_id, description, unit_price_satang, tax_rate_bps) values
  (pg_temp.sale_id(10), pg_temp.sale_id(31), 'Inclusive service', 107000, 700);
select lives_ok(
  $$select public.issue_invoice(pg_temp.sale_id(10), pg_temp.sale_id(31), (select version from public.invoices where id = pg_temp.sale_id(31)), pg_temp.sale_id(41))$$,
  'the inclusive invoice issues'
);

select public.update_tax_business_profile(pg_temp.sale_id(10), 'Synthetic seller', 'Seller address', '1234567890123', true, 700, false, 'Head office');
insert into public.invoices(id, org_id, client_id, number) values
  (pg_temp.sale_id(32), pg_temp.sale_id(10), pg_temp.sale_id(20), 'SALE-WHT');
insert into public.invoice_items(org_id, invoice_id, description, unit_price_satang, tax_rate_bps) values
  (pg_temp.sale_id(10), pg_temp.sale_id(32), 'Withheld service', 100000, 700);
update public.invoices set wht_rate_bps = 300 where id = pg_temp.sale_id(32);
select lives_ok(
  $$select public.issue_invoice(pg_temp.sale_id(10), pg_temp.sale_id(32), (select version from public.invoices where id = pg_temp.sale_id(32)), pg_temp.sale_id(42))$$,
  'the withheld invoice issues'
);

insert into public.invoices(id, org_id, client_id, number) values
  (pg_temp.sale_id(33), pg_temp.sale_id(10), pg_temp.sale_id(20), 'SALE-DRAFT');
insert into public.invoice_items(org_id, invoice_id, description, unit_price_satang, tax_rate_bps) values
  (pg_temp.sale_id(10), pg_temp.sale_id(33), 'Draft service', 100000, 0);

insert into public.invoices(id, org_id, client_id, number) values
  (pg_temp.sale_id(34), pg_temp.sale_id(10), pg_temp.sale_id(20), 'SALE-NONE');
insert into public.invoice_items(org_id, invoice_id, description, unit_price_satang, tax_rate_bps) values
  (pg_temp.sale_id(10), pg_temp.sale_id(34), 'Untaxed service', 5000, 0);
select lives_ok(
  $$select public.issue_invoice(pg_temp.sale_id(10), pg_temp.sale_id(34), (select version from public.invoices where id = pg_temp.sale_id(34)), pg_temp.sale_id(44))$$,
  'the zero-VAT invoice issues'
);

select lives_ok(
  format('select public.update_finance_lock_date(%L, (now() at time zone ''Asia/Bangkok'')::date)', pg_temp.sale_id(10)),
  'the owner locks through today'
);

select throws_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(32))$$,
  'P0001',
  'Withholding is not posted from the invoice.',
  'withholding is refused'
);
select throws_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(33))$$,
  'P0001',
  'Only an issued operational sales invoice can post.',
  'a draft is refused'
);

select lives_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(30))$$,
  'the exclusive invoice posts'
);
select is(
  (select debit_satang from public.journal_lines where account_code = '1130' and entry_id = (select id from public.journal_entries where source_invoice_id = pg_temp.sale_id(30))),
  107000::bigint,
  'accounts receivable is the gross total'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '4100' and entry_id = (select id from public.journal_entries where source_invoice_id = pg_temp.sale_id(30))),
  100000::bigint,
  'sales is the base before VAT'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '2130' and entry_id = (select id from public.journal_entries where source_invoice_id = pg_temp.sale_id(30))),
  7000::bigint,
  'output VAT is the stored seven percent'
);
select is(
  (select meta->>'vatTreatment' from public.audit_log where org_id = pg_temp.sale_id(10) and action = 'journal_draft_posted' and meta->>'invoiceId' = pg_temp.sale_id(30)::text),
  'vat_exclusive',
  'the audit names VAT exclusive'
);
select ok(
  (select summary from public.audit_log where org_id = pg_temp.sale_id(10) and meta->>'invoiceId' = pg_temp.sale_id(30)::text) like '%not signed statutory books%',
  'the audit says these are not signed statutory books'
);
select is(
  (select meta->>'filing' from public.audit_log where org_id = pg_temp.sale_id(10) and meta->>'invoiceId' = pg_temp.sale_id(30)::text),
  'false',
  'the audit says this is not a filing'
);
select throws_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(30))$$,
  'P0001',
  'This invoice is already posted.',
  'the same invoice does not post twice'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.sale_id(2))::text, true);
select lives_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(31))$$,
  'an accountant posts the inclusive invoice'
);
select is(
  (select meta->>'vatTreatment' from public.audit_log where org_id = pg_temp.sale_id(10) and meta->>'invoiceId' = pg_temp.sale_id(31)::text),
  'vat_inclusive',
  'the audit names VAT inclusive'
);
select is(
  (select credit_satang from public.journal_lines where account_code = '4100' and entry_id = (select id from public.journal_entries where source_invoice_id = pg_temp.sale_id(31))),
  100000::bigint,
  'inclusive sales is the extracted base'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.sale_id(1))::text, true);
select lives_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(34))$$,
  'a zero-VAT invoice posts'
);
select is(
  (select count(*) from public.journal_lines where entry_id = (select id from public.journal_entries where source_invoice_id = pg_temp.sale_id(34)) and account_code = '2130'),
  0::bigint,
  'no output VAT line is stored when VAT is zero'
);
select is((public.verify_close_activity_chain(pg_temp.sale_id(10))->>'ok')::boolean, true, 'the invoice posts join the close chain');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.sale_id(3))::text, true);
select throws_ok(
  $$select public.post_issued_sales_invoice(pg_temp.sale_id(10), pg_temp.sale_id(33))$$,
  'P0001',
  'Only owners, admins, and accountants can post a draft journal',
  'a member cannot post'
);

select * from finish();
rollback;
