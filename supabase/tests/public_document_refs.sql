begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.pref_id(n integer) returns uuid language sql immutable as $$
  select ('b3400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.pref_id(1), 'synthetic-pref-owner@example.invalid', now());
insert into public.organizations (id, name, slug) values
  (pg_temp.pref_id(10), 'Synthetic public ref workspace', 'synthetic-public-ref');
insert into public.clients (id, org_id, name, tax_id) values
  (pg_temp.pref_id(20), pg_temp.pref_id(10), 'Synthetic buyer', '1234567890123');
insert into public.quotes (id, org_id, client_id, number) values
  (pg_temp.pref_id(30), pg_temp.pref_id(10), pg_temp.pref_id(20), 'QUO-2026-001');
insert into public.quote_items (org_id, quote_id, description, quantity, unit_price_satang, amount_satang) values
  (pg_temp.pref_id(10), pg_temp.pref_id(30), 'Synthetic line', 1, 100, 100);

select throws_ok(
  $$insert into public.document_public_refs (org_id, reference, kind, record_id)
    values (pg_temp.pref_id(10), 'quo1' || repeat('q', 20), 'quote', pg_temp.pref_id(30))$$,
  'P0001',
  'Public document references are disabled',
  'a public reference cannot be stored while the workspace flag is off'
);

select is(
  (select number from public.quotes where id = pg_temp.pref_id(30)),
  'QUO-2026-001',
  'a refused public reference does not change the quote number'
);
select is(
  (select tax_id from public.clients where id = pg_temp.pref_id(20)),
  '1234567890123',
  'a refused public reference does not change the buyer tax ID'
);

insert into public.org_settings (org_id, public_document_refs_enabled)
  values (pg_temp.pref_id(10), true);

select throws_ok(
  $$insert into public.document_public_refs (org_id, reference, kind, record_id)
    values (pg_temp.pref_id(10), 'QUO-2026-001', 'quote', pg_temp.pref_id(30))$$,
  '23514',
  null,
  'an accounting number is not a typed public reference'
);

select lives_ok(
  $$insert into public.document_public_refs (org_id, reference, kind, record_id)
    values (pg_temp.pref_id(10), 'quo1' || repeat('q', 20), 'quote', pg_temp.pref_id(30))$$,
  'a shape-valid reference can be stored once the flag is on'
);

select is(
  (select number from public.quotes where id = pg_temp.pref_id(30)),
  'QUO-2026-001',
  'issuing a public reference keeps the accounting number'
);
select is(
  (select converted_invoice_id from public.quotes where id = pg_temp.pref_id(30)),
  null,
  'issuing a public reference does not create a document link'
);

select throws_ok(
  $$update public.document_public_refs set reference = 'quo1pppppppppppppppppppp'
    where org_id = pg_temp.pref_id(10)$$,
  'P0001',
  'Public document references are immutable',
  'a stored public reference cannot be edited in place'
);

select throws_ok(
  $$insert into public.document_public_refs (org_id, reference, kind, record_id)
    values (pg_temp.pref_id(10), 'po1' || repeat('q', 20), 'quote', pg_temp.pref_id(30))$$,
  '23514',
  null,
  'a purchase-order prefix cannot be stored as a customer quote'
);

select throws_ok(
  $$insert into public.document_public_refs (org_id, reference, kind, record_id)
    values (pg_temp.pref_id(10), 'quo1' || repeat('p', 20), 'quote', pg_temp.pref_id(99))$$,
  'P0001',
  'Document unavailable',
  'a public reference requires the target document'
);

select * from finish();
rollback;
