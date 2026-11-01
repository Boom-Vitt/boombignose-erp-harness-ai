begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.reopen_id(n integer) returns uuid language sql immutable as $$
  select ('c2f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.reopen_id(1), 'synthetic-reopen-owner@example.invalid', now()),
  (pg_temp.reopen_id(2), 'synthetic-reopen-admin@example.invalid', now()),
  (pg_temp.reopen_id(3), 'synthetic-reopen-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.reopen_id(10), 'Synthetic sole reopen', 'synthetic-sole-reopen'),
  (pg_temp.reopen_id(11), 'Synthetic pair reopen', 'synthetic-pair-reopen');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.reopen_id(10), pg_temp.reopen_id(1), 'owner'),
  (pg_temp.reopen_id(11), pg_temp.reopen_id(1), 'owner'),
  (pg_temp.reopen_id(11), pg_temp.reopen_id(2), 'admin'),
  (pg_temp.reopen_id(11), pg_temp.reopen_id(3), 'member');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.reopen_id(1))::text, true);
set local role authenticated;

select is(public.propose_finance_lock(pg_temp.reopen_id(10), '2020-06-30', null)->>'applied', 'true', 'a forward lock does not need a reason');
select throws_ok($$select public.propose_finance_lock(pg_temp.reopen_id(10), null, '   ')$$, 'P0001', 'A reason is required to reopen the finance lock.', 'a blank reason cannot reopen');
select is(public.propose_finance_lock(pg_temp.reopen_id(10), null, 'Bank statement arrived late')->>'applied', 'true', 'the only owner or admin can reopen with a reason');
select ok((select lock_date from public.org_settings where org_id = pg_temp.reopen_id(10)) is null, 'the sole reopen clears the lock');
select is((select meta->>'reason' from public.audit_log where org_id = pg_temp.reopen_id(10) and action = 'finance_lock_reopened'), 'Bank statement arrived late', 'the reopen audit stores the reason');

select is(public.propose_finance_lock(pg_temp.reopen_id(11), '2020-06-30', null)->>'applied', 'true', 'two staff can still move a lock forward');
select is(public.propose_finance_lock(pg_temp.reopen_id(11), null, 'Need the other person')->>'pending', 'true', 'a second owner or admin must confirm a reopen');
select is((select lock_date from public.org_settings where org_id = pg_temp.reopen_id(11)), '2020-06-30'::date, 'a pending reopen does not move the lock');
select is(jsonb_array_length(public.list_finance_lock_reopen_requests(pg_temp.reopen_id(11))), 1, 'the pending request is listed');
select throws_ok(
  format('select public.propose_finance_lock(%L, null, %L)', pg_temp.reopen_id(11), 'Another reason'),
  'P0001',
  'A reopen is already waiting for confirmation.',
  'a second request waits until the first is finished'
);
select set_config('test.reopen_request', public.list_finance_lock_reopen_requests(pg_temp.reopen_id(11))->0->>'id', true);
select throws_ok(
  format('select public.confirm_finance_lock_reopen(%L, %L)', pg_temp.reopen_id(11), current_setting('test.reopen_request')::uuid),
  'P0001',
  'Another owner or admin must confirm this reopen.',
  'the requester cannot confirm their own reopen'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.reopen_id(3))::text, true);
select throws_ok(
  format('select public.confirm_finance_lock_reopen(%L, %L)', pg_temp.reopen_id(11), current_setting('test.reopen_request')::uuid),
  'P0001',
  'Only staff may change the finance lock date',
  'a member cannot confirm a reopen'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.reopen_id(2))::text, true);
select is(
  public.confirm_finance_lock_reopen(pg_temp.reopen_id(11), current_setting('test.reopen_request')::uuid)->>'applied',
  'true',
  'the other owner or admin confirms the reopen'
);
select ok((select lock_date from public.org_settings where org_id = pg_temp.reopen_id(11)) is null, 'confirmation moves the lock');
select is((select meta->>'reason' from public.audit_log where org_id = pg_temp.reopen_id(11) and action = 'finance_lock_reopened'), 'Need the other person', 'the confirmed reopen keeps the reason');
select is(jsonb_array_length(public.list_finance_lock_reopen_requests(pg_temp.reopen_id(11))), 0, 'a confirmed request leaves the queue');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.reopen_id(1))::text, true);
select public.propose_finance_lock(pg_temp.reopen_id(11), '2020-05-31', null);
select public.propose_finance_lock(pg_temp.reopen_id(11), null, 'Cancel this one');
select public.cancel_finance_lock_reopen(pg_temp.reopen_id(11), (public.list_finance_lock_reopen_requests(pg_temp.reopen_id(11))->0->>'id')::uuid);
select is((select lock_date from public.org_settings where org_id = pg_temp.reopen_id(11)), '2020-05-31'::date, 'cancelling a request leaves the lock where it is');
select is((select count(*) from public.audit_log where org_id = pg_temp.reopen_id(11) and action = 'finance_lock_reopen_cancelled'), 1::bigint, 'a cancelled request is audited');

select lives_ok(
  $$select public.record_support_export(pg_temp.reopen_id(10), 'accountant_pack_csv', '2020-06', repeat('ab', 32), 4)$$,
  'an owner can record a support export'
);
select is(public.find_support_export(pg_temp.reopen_id(10), repeat('ab', 32))->>'period', '2020-06', 'a saved checksum finds the stored export');
select ok(public.find_support_export(pg_temp.reopen_id(10), repeat('cd', 32)) is null, 'a different checksum is not a stored export');
select throws_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.reopen_id(10), pg_temp.reopen_id(1), 'organization', pg_temp.reopen_id(10), 'finance_lock_reopen_requested', 'Counterfeit request')$$,
  'P0001',
  'Reserved audit action requires its command',
  'a signed-in user cannot forge a reopen request'
);

reset role;
select ok(not has_function_privilege('anon', 'public.propose_finance_lock(uuid,date,text)', 'execute'), 'anon cannot propose a lock change');
select ok(not has_function_privilege('service_role', 'public.confirm_finance_lock_reopen(uuid,uuid)', 'execute'), 'service role cannot confirm a reopen');

select * from finish();
rollback;
