-- Run only against an isolated test database with all migrations applied.
-- Requires real GoTrue auth.mfa_factors (including TOTP fixture columns below),
-- request-aware auth.uid()/auth.jwt(), and a privileged fixture/migration owner.
-- All auth fixtures and enrollment transitions are rolled back with this test.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email, email_confirmed_at) values
  ('d1900000-0000-4000-8000-000000000001', 'network-owner-a@example.invalid', now()),
  ('d1900000-0000-4000-8000-000000000002', 'network-member-a@example.invalid', now()),
  ('d1900000-0000-4000-8000-000000000003', 'network-owner-b@example.invalid', now());
insert into auth.mfa_factors(id, user_id, factor_type, status, created_at, updated_at, secret) values
  ('d1900000-0000-4000-8000-000000000050', 'd1900000-0000-4000-8000-000000000001',
    'totp', 'unverified', now(), now(), 'SYNTHETICNETWORKTESTSECRET');
insert into public.organizations(id, name, slug) values
  ('d1900000-0000-4000-8000-000000000010', 'Synthetic network A', 'synthetic-network-a'),
  ('d1900000-0000-4000-8000-000000000020', 'Synthetic network B', 'synthetic-network-b');
insert into public.memberships(org_id, user_id, role) values
  ('d1900000-0000-4000-8000-000000000010', 'd1900000-0000-4000-8000-000000000001', 'owner'),
  ('d1900000-0000-4000-8000-000000000010', 'd1900000-0000-4000-8000-000000000002', 'member'),
  ('d1900000-0000-4000-8000-000000000020', 'd1900000-0000-4000-8000-000000000003', 'owner');
insert into public.network_devices(id, org_id, name, created_by, token_hash) values
  ('d1900000-0000-4000-8000-000000000030', 'd1900000-0000-4000-8000-000000000010', 'Synthetic Mac A', 'd1900000-0000-4000-8000-000000000001', repeat('a',64)),
  ('d1900000-0000-4000-8000-000000000040', 'd1900000-0000-4000-8000-000000000020', 'Synthetic Mac B', 'd1900000-0000-4000-8000-000000000003', repeat('b',64));

select ok(not has_function_privilege('anon', 'private.network_staff_allowed(uuid)', 'EXECUTE'),
  'anonymous role cannot execute the factor-checking helper');
select ok(not has_function_privilege('service_role', 'private.network_staff_allowed(uuid)', 'EXECUTE'),
  'ingestion role does not need the staff assurance helper');
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'missing actor is denied even with AAL2');
select is((select count(id)::int from public.network_devices), 0, 'missing actor cannot read devices');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000099","aal":"aal2"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'unrecognized actor is denied even with AAL2');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'missing AAL fails closed for a non-enrolled owner');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000001","aal":"aal3"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'unrecognized AAL fails closed for a non-enrolled owner');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000001","aal":"aal1"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), true,
  'AAL1 owner without a verified factor is allowed; unverified enrollment does not require step-up');
select throws_ok($$select user_id, status from auth.mfa_factors$$, '42501', null,
  'staff assurance helper does not disclose factor rows');
select is((select count(id)::int from public.network_devices), 1, 'owner sees only own workspace device');
select throws_ok($$select token_hash from public.network_devices$$, '42501', null, 'even owners cannot select credential hashes');
select lives_ok($$insert into public.network_devices(org_id,name,created_by,token_hash) values
  ('d1900000-0000-4000-8000-000000000010','Enrolled Mac','d1900000-0000-4000-8000-000000000001',repeat('c',64))$$,
  'owner may enroll a device in own workspace');
select throws_ok($$insert into public.network_devices(org_id,name,created_by,token_hash) values
  ('d1900000-0000-4000-8000-000000000020','Wrong workspace','d1900000-0000-4000-8000-000000000001',repeat('d',64))$$,
  '42501', null, 'owner cannot enroll in another workspace');
select lives_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['192.0.2.10/24','2001:db8::/32'])$$,
  'policy supports IPv4 host bits and IPv6');
select lives_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['198.51.100.0/24'])$$,
  'policy updates atomically without workspace identity update grants');
select is((select allowed_cidrs from public.network_policy), array['198.51.100.0/24'], 'saved policy contains latest explicit CIDR');
select throws_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['192.0.2.0/99'])$$,
  '23514', null, 'database rejects invalid CIDR');
select throws_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000020',array['0.0.0.0/0'])$$,
  'P0001', 'Forbidden', 'owner cannot set another workspace policy');
select throws_ok($$update public.network_devices set latest_report='{}'::jsonb$$,
  '42501', null, 'session cannot forge telemetry');
select throws_ok($$select public.ingest_network_report(null,null,null,now(),'{}'::jsonb)$$,
  '42501', null, 'session cannot call device ingestion RPC');
with changed as (update public.network_devices set revoked_at=now() where name='Enrolled Mac' returning id)
select is((select count(*)::int from changed), 1, 'AAL1 owner without verified factors may revoke own device');

reset role;
update auth.mfa_factors set status='verified', updated_at=now()
  where id='d1900000-0000-4000-8000-000000000050';
delete from public.network_policy where org_id='d1900000-0000-4000-8000-000000000010';
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000001","aal":"aal1"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'enrolled owner must step up from AAL1');
select is((select count(id)::int from public.network_devices), 0, 'enrolled AAL1 owner cannot read devices');
select throws_ok($$insert into public.network_devices(org_id,name,created_by,token_hash) values
  ('d1900000-0000-4000-8000-000000000010','MFA bypass Mac','d1900000-0000-4000-8000-000000000001',repeat('f',64))$$,
  '42501', null, 'enrolled AAL1 owner cannot enroll a credential directly');
with changed as (update public.network_devices set revoked_at=now() where id='d1900000-0000-4000-8000-000000000030' returning id)
select is((select count(*)::int from changed), 0, 'enrolled AAL1 owner cannot revoke');
select throws_ok($$insert into public.network_policy(org_id,allowed_cidrs,updated_by) values
  ('d1900000-0000-4000-8000-000000000010',array['0.0.0.0/0'],'d1900000-0000-4000-8000-000000000001')$$,
  '42501', null, 'enrolled AAL1 owner cannot insert policy directly');
select throws_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['0.0.0.0/0'])$$,
  'P0001', 'Forbidden', 'enrolled AAL1 owner cannot create policy through RPC');
reset role;
insert into public.network_policy(org_id,allowed_cidrs,updated_by) values
  ('d1900000-0000-4000-8000-000000000010',array['198.51.100.0/24'],'d1900000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(org_id)::int from public.network_policy), 0, 'enrolled AAL1 owner cannot read existing policy');
with changed as (update public.network_policy set allowed_cidrs=array['0.0.0.0/0'],
  updated_by='d1900000-0000-4000-8000-000000000001'
  where org_id='d1900000-0000-4000-8000-000000000010' returning org_id)
select is((select count(*)::int from changed), 0, 'enrolled AAL1 owner cannot update policy directly');
select throws_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['0.0.0.0/0'])$$,
  'P0001', 'Forbidden', 'enrolled AAL1 owner cannot update policy through RPC');
select throws_ok($$select user_id, status from auth.mfa_factors$$, '42501', null,
  'enrolled owner cannot inspect factor rows');

reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000002","aal":"aal2"}', true);
set local role authenticated;
select is((select count(id)::int from public.network_devices), 0, 'member cannot read network devices');
select is((select count(org_id)::int from public.network_policy), 0, 'member cannot read policy');
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'AAL2 does not elevate a member to staff');
select throws_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['0.0.0.0/0'])$$,
  'P0001', 'Forbidden', 'AAL2 member cannot change policy through RPC');
select throws_ok($$insert into public.network_devices(org_id,name,created_by,token_hash) values
  ('d1900000-0000-4000-8000-000000000010','Member Mac','d1900000-0000-4000-8000-000000000002',repeat('e',64))$$,
  '42501', null, 'member cannot enroll');
with changed as (update public.network_devices set revoked_at=now() where id='d1900000-0000-4000-8000-000000000030' returning id)
select is((select count(*)::int from changed), 0, 'member cannot revoke');

reset role;
set local role service_role;
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000020',repeat('a',64),now(),'{}'::jsonb) is null, 'wrong workspace cannot ingest');
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('b',64),now(),'{}'::jsonb) is null, 'wrong credential hash cannot ingest');
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('a',64),now()-interval '6 minutes','{}'::jsonb) is null, 'stale report rejected');
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('a',64),now()+interval '61 seconds','{}'::jsonb) is null, 'future report rejected');
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('a',64),now(),jsonb_build_object(
    'capturedAt',now(),'coverage','current_user_tcp_snapshot','observations','[]'::jsonb,'truncated',false)) is not null,
  'authenticated device report accepted');
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('a',64),now(),'{}'::jsonb) is null, 'replayed timestamp rejected');
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('a',64),now()-interval '1 second','{}'::jsonb) is null, 'backward timestamp rejected');
select ok((select last_received_at is not null and latest_captured_at=now() from public.network_devices
  where id='d1900000-0000-4000-8000-000000000030'), 'server receive time stored separately from capture time');

reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000003","aal":"aal2"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), false,
  'AAL2 does not authorize another workspace owner');
select is((select count(id)::int from public.network_devices
  where org_id='d1900000-0000-4000-8000-000000000010'), 0, 'AAL2 other-workspace owner cannot read devices');
select is((select count(org_id)::int from public.network_policy), 0, 'AAL2 other-workspace owner cannot read policy');
select throws_ok($$insert into public.network_devices(org_id,name,created_by,token_hash) values
  ('d1900000-0000-4000-8000-000000000010','Other owner Mac','d1900000-0000-4000-8000-000000000003',repeat('8',64))$$,
  '42501', null, 'AAL2 other-workspace owner cannot enroll');
select throws_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['0.0.0.0/0'])$$,
  'P0001', 'Forbidden', 'AAL2 other-workspace owner cannot change policy');
with changed as (update public.network_devices set revoked_at=now() where id='d1900000-0000-4000-8000-000000000030' returning id)
select is((select count(*)::int from changed), 0, 'other workspace owner cannot revoke');

reset role;
delete from public.network_policy where org_id='d1900000-0000-4000-8000-000000000010';
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d1900000-0000-4000-8000-000000000001","aal":"aal2"}', true);
set local role authenticated;
select is(private.network_staff_allowed('d1900000-0000-4000-8000-000000000010'), true,
  'enrolled owner with AAL2 is allowed');
select is((select count(id)::int from public.network_devices), 2, 'enrolled AAL2 owner reads own devices');
select lives_ok($$insert into public.network_devices(org_id,name,created_by,token_hash) values
  ('d1900000-0000-4000-8000-000000000010','AAL2 Mac','d1900000-0000-4000-8000-000000000001',repeat('7',64))$$,
  'enrolled AAL2 owner may enroll');
select lives_ok($$insert into public.network_policy(org_id,allowed_cidrs,updated_by) values
  ('d1900000-0000-4000-8000-000000000010',array['192.0.2.0/24'],'d1900000-0000-4000-8000-000000000001')$$,
  'enrolled AAL2 owner may insert policy directly');
with changed as (update public.network_policy set allowed_cidrs=array['198.51.100.0/24'],
  updated_by='d1900000-0000-4000-8000-000000000001'
  where org_id='d1900000-0000-4000-8000-000000000010' returning org_id)
select is((select count(*)::int from changed), 1, 'enrolled AAL2 owner may update policy directly');
select lives_ok($$select public.set_network_policy('d1900000-0000-4000-8000-000000000010',array['203.0.113.0/24'])$$,
  'enrolled AAL2 owner may update policy through RPC');
select is((select allowed_cidrs from public.network_policy), array['203.0.113.0/24'],
  'enrolled AAL2 owner may read policy');
with changed as (update public.network_devices set revoked_at=now() where id='d1900000-0000-4000-8000-000000000030' returning id)
select is((select count(*)::int from changed), 1, 'owner revokes own device');
with changed as (update public.network_devices set revoked_at=null where id='d1900000-0000-4000-8000-000000000030' returning id)
select is((select count(*)::int from changed), 0, 'session cannot reactivate a revoked credential');

reset role;
set local role service_role;
select ok(public.ingest_network_report('d1900000-0000-4000-8000-000000000030',
  'd1900000-0000-4000-8000-000000000010',repeat('a',64),now()+interval '1 second','{}'::jsonb) is null,
  'newer telemetry immediately rejected after revocation');
reset role;
select * from finish();
rollback;
