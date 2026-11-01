begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users(id, email, email_confirmed_at) values
  ('c1800000-0000-4000-8000-000000000001', 'synthetic-role-owner@example.invalid', now()),
  ('c1800000-0000-4000-8000-000000000002', 'synthetic-role-accountant@example.invalid', now()),
  ('c1800000-0000-4000-8000-000000000003', 'synthetic-role-staff@example.invalid', now());
insert into public.organizations(id, name, slug) values
  ('c1800000-0000-4000-8000-000000000010', 'Synthetic roles', 'synthetic-roles');
insert into public.memberships(org_id, user_id, role) values
  ('c1800000-0000-4000-8000-000000000010', 'c1800000-0000-4000-8000-000000000001', 'owner'),
  ('c1800000-0000-4000-8000-000000000010', 'c1800000-0000-4000-8000-000000000002', 'accountant'),
  ('c1800000-0000-4000-8000-000000000010', 'c1800000-0000-4000-8000-000000000003', 'member');
insert into public.clients(id, org_id, name) values
  ('c1800000-0000-4000-8000-000000000030', 'c1800000-0000-4000-8000-000000000010', 'Synthetic buyer');

select ok(
  pg_get_functiondef('public.issue_invoice(uuid,uuid,integer,uuid)'::regprocedure) like '%private.is_org_finance%',
  'issuing an invoice checks the finance role'
);
select ok(
  pg_get_functiondef('public.reverse_payment(uuid,uuid,text,date,uuid)'::regprocedure) like '%private.is_org_staff%'
  and pg_get_functiondef('public.reverse_payment(uuid,uuid,text,date,uuid)'::regprocedure) not like '%private.is_org_finance%',
  'reversing a receipt stays with owner and admin'
);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"c1800000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select ok(private.is_org_finance('c1800000-0000-4000-8000-000000000010'), 'accountant is a finance role');
select ok(not private.is_org_staff('c1800000-0000-4000-8000-000000000010'), 'accountant is not owner or admin');
select lives_ok(
  $$insert into public.invoices(id, org_id, client_id, number, status) values ('c1800000-0000-4000-8000-000000000050', 'c1800000-0000-4000-8000-000000000010', 'c1800000-0000-4000-8000-000000000030', 'ROLE-DRAFT', 'draft')$$,
  'accountant can insert a draft invoice'
);
with removed as (
  delete from public.invoices where id = 'c1800000-0000-4000-8000-000000000050' returning id
) select is((select count(*)::int from removed), 0, 'accountant cannot delete an invoice');
select throws_ok(
  $$insert into public.invitations(org_id, email, role, token) values ('c1800000-0000-4000-8000-000000000010', 'synthetic-role-invite@example.invalid', 'member', 'role-invite-token')$$,
  '42501',
  null,
  'accountant cannot invite a teammate'
);

reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"c1800000-0000-4000-8000-000000000003"}', true);
set local role authenticated;
select ok(not private.is_org_finance('c1800000-0000-4000-8000-000000000010'), 'staff member is not a finance role');
select ok(private.is_org_member('c1800000-0000-4000-8000-000000000010'), 'staff member still belongs to the workspace');
select throws_ok(
  $$insert into public.invoices(org_id, client_id, number, status) values ('c1800000-0000-4000-8000-000000000010', 'c1800000-0000-4000-8000-000000000030', 'ROLE-STAFF', 'draft')$$,
  '42501',
  null,
  'staff member cannot insert an invoice'
);

select * from finish();
rollback;
