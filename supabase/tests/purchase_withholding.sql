begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.pw_id(n integer) returns uuid language sql immutable as $$
  select ('c4a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.pw_id(1), 'synthetic-wht-owner@example.invalid', now()),
  (pg_temp.pw_id(2), 'synthetic-wht-member@example.invalid', now());
insert into public.organizations(id, name, slug) values (pg_temp.pw_id(10), 'Synthetic WHT', 'synthetic-wht');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.pw_id(10), pg_temp.pw_id(1), 'owner'),
  (pg_temp.pw_id(10), pg_temp.pw_id(2), 'member');
insert into public.costs(id, org_id, category, amount_satang, input_vat_satang, incurred_on) values
  (pg_temp.pw_id(21), pg_temp.pw_id(10), 'other', 107000, 7000, '2026-10-05'),
  (pg_temp.pw_id(22), pg_temp.pw_id(10), 'other', 50001, 0, '2026-10-06'),
  (pg_temp.pw_id(23), pg_temp.pw_id(10), 'other', -500, 0, '2026-10-07');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pw_id(2))::text, true);
set local role authenticated;
select throws_ok(
  $$select public.record_purchase_withholding(pg_temp.pw_id(10), pg_temp.pw_id(21), '2026-10-31', 'pnd53', 'service_40_8', 300)$$,
  'P0001', 'Only owners and admins may record withholding', 'a plain member cannot record withholding');
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pw_id(1))::text, true);
set local role authenticated;
select lives_ok(
  $$select public.record_purchase_withholding(pg_temp.pw_id(10), pg_temp.pw_id(21), '2026-10-31', 'pnd53', 'service_40_8', 300)$$,
  'owner records 3% on a bill');
select is((select base_satang from public.purchase_withholdings where cost_id = pg_temp.pw_id(21)), 100000::bigint, 'base excludes input VAT');
select is((select wht_satang from public.purchase_withholdings where cost_id = pg_temp.pw_id(21)), 3000::bigint, '3% of 1,000.00 is 30.00');
select is((select certificate_no from public.purchase_withholdings where cost_id = pg_temp.pw_id(21)), 'WHT-2026-000001', 'first number of the year');
select lives_ok(
  $$select public.record_purchase_withholding(pg_temp.pw_id(10), pg_temp.pw_id(22), '2026-10-31', 'pnd3', 'professional_40_6', 300)$$,
  'second record');
select is((select certificate_no from public.purchase_withholdings where cost_id = pg_temp.pw_id(22)), 'WHT-2026-000002', 'consecutive');
select is((select wht_satang from public.purchase_withholdings where cost_id = pg_temp.pw_id(22)), 1500::bigint, '3% of 500.01 rounds half-up to 15.00');
select throws_ok(
  $$select public.record_purchase_withholding(pg_temp.pw_id(10), pg_temp.pw_id(21), '2026-10-31', 'pnd53', 'service_40_8', 300)$$,
  '23505', null, 'a cost carries one withholding');
select throws_ok(
  $$select public.record_purchase_withholding(pg_temp.pw_id(10), pg_temp.pw_id(23), '2026-10-31', 'pnd53', 'service_40_8', 300)$$,
  'P0001', 'Withholding applies to a positive payment, not a credit', 'a vendor credit is refused');
select throws_ok(
  $$select public.record_purchase_withholding(pg_temp.pw_id(10), pg_temp.pw_id(21), '2026-10-31', 'pnd53', 'service_40_8', 400)$$,
  'P0001', 'Invalid withholding rate', 'rate must be an allowed step');
select throws_ok($$update public.purchase_withholdings set wht_satang = 1$$, '42501', null, 'records cannot be edited');
select throws_ok($$delete from public.purchase_withholdings$$, '42501', null, 'records cannot be deleted');
select lives_ok(
  $$select public.record_support_export(pg_temp.pw_id(10), 'wht_support_csv', '2026-10', repeat('cd', 32), 10)$$,
  'WHT support file checksum can be recorded');
select lives_ok(
  $$select public.record_support_export(pg_temp.pw_id(10), 'vat_support_csv', '2026-10', repeat('ef', 32), 10)$$,
  'VAT support file checksum can be recorded');
reset role;
select is((select value from public.document_counters where org_id = pg_temp.pw_id(10) and kind = 'WHT50' and year = 2026), 2::bigint, 'refusals did not advance the counter');
select * from finish();
rollback;
