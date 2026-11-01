begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.close_id(n integer) returns uuid language sql immutable as $$
  select ('c1f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.close_id(1), 'synthetic-close-owner@example.invalid', now()),
  (pg_temp.close_id(2), 'synthetic-close-member@example.invalid', now()),
  (pg_temp.close_id(4), 'synthetic-close-accountant@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.close_id(10), 'Synthetic close risk', 'synthetic-close-risk');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.close_id(10), pg_temp.close_id(1), 'owner'),
  (pg_temp.close_id(10), pg_temp.close_id(2), 'member'),
  (pg_temp.close_id(10), pg_temp.close_id(4), 'accountant');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.close_id(1))::text, true);
set local role authenticated;

select throws_ok(
  format('select public.update_finance_lock_date(%L, %L::date)', pg_temp.close_id(10), ((now() at time zone 'Asia/Bangkok')::date + 1)),
  'P0001',
  'Finance lock date cannot be in the future',
  'a lock date after Bangkok today is refused'
);
select ok((select lock_date from public.org_settings where org_id = pg_temp.close_id(10)) is null, 'a refused future lock writes no date');

select lives_ok($$select public.update_finance_lock_date(pg_temp.close_id(10), '2020-01-15')$$, 'owner can lock through a past date');
select lives_ok($$select public.update_finance_lock_date(pg_temp.close_id(10), '2020-01-15')$$, 'the same lock date does not write a second audit row');
select is((select count(*) from public.audit_log where org_id = pg_temp.close_id(10) and action = 'finance_lock_updated'), 1::bigint, 'one lock update is recorded');
select is((select actor_email from public.audit_log where org_id = pg_temp.close_id(10) and action = 'finance_lock_updated'), 'synthetic-close-owner@example.invalid', 'the lock audit names the owner');
select ok((select meta->>'previousLockDate' from public.audit_log where org_id = pg_temp.close_id(10) and action = 'finance_lock_updated') is null, 'the first lock has no previous date');
select is((select meta->>'kind' from public.audit_log where org_id = pg_temp.close_id(10) and action = 'finance_lock_updated'), 'operational_lock', 'the lock audit says it is operational');

select is(public.close_completed_month(pg_temp.close_id(10), '2020-02'), '2020-02-29'::date, 'a leap month closes on the 29th');
select is((select lock_date from public.org_settings where org_id = pg_temp.close_id(10)), '2020-02-29'::date, 'the finance lock is that month end');
select is((select count(*) from public.audit_log where org_id = pg_temp.close_id(10) and action = 'period_closed'), 1::bigint, 'the month close has its own audit action');
select is((select count(*) from public.audit_log where org_id = pg_temp.close_id(10) and action = 'finance_lock_updated'), 1::bigint, 'the month close does not pretend to be a manual lock edit');
select is((select meta->>'previousLockDate' from public.audit_log where org_id = pg_temp.close_id(10) and action = 'period_closed'), '2020-01-15', 'the close records the previous lock');
select is((select meta->>'kind' from public.audit_log where org_id = pg_temp.close_id(10) and action = 'period_closed'), 'operational_close', 'the close audit is not a statutory close');
select throws_ok($$select public.close_completed_month(pg_temp.close_id(10), '2020-02')$$, 'P0001', 'That month is already closed.', 'a covered month is refused');
select throws_ok(
  format('select public.close_completed_month(%L, %L)', pg_temp.close_id(10), to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM')),
  'P0001',
  'Close a completed month. The current month stays open.',
  'the current month stays open'
);
select throws_ok($$select public.close_completed_month(pg_temp.close_id(10), '2020-13')$$, 'P0001', 'Enter a month as YYYY-MM.', 'month 13 is refused');
select throws_ok($$select public.close_completed_month(pg_temp.close_id(10), 'February')$$, 'P0001', 'Enter a month as YYYY-MM.', 'a month name is refused');
select is(public.close_completed_month(pg_temp.close_id(10), '2021-02'), '2021-02-28'::date, 'a common February closes on the 28th');

select lives_ok($$select public.update_finance_lock_date(pg_temp.close_id(10), '2021-01-31')$$, 'owner can move the lock earlier');
select ok(exists(
  select 1 from public.audit_log
  where org_id = pg_temp.close_id(10) and action = 'finance_lock_reopened'
    and meta->>'lockDate' = '2021-01-31' and meta->>'previousLockDate' = '2021-02-28'
), 'moving the lock earlier records both dates');
select lives_ok($$select public.update_finance_lock_date(pg_temp.close_id(10), null)$$, 'owner can clear the lock');
select ok((select lock_date from public.org_settings where org_id = pg_temp.close_id(10)) is null, 'a clear removes the lock date');
select ok(exists(
  select 1 from public.audit_log
  where org_id = pg_temp.close_id(10) and action = 'finance_lock_reopened'
    and meta->>'previousLockDate' = '2021-01-31' and meta->>'lockDate' is null
), 'clearing the lock records the date it left');
select is((select count(*) from public.audit_log where org_id = pg_temp.close_id(10) and action = 'finance_lock_reopened'), 2::bigint, 'a clear is also a reopen');

select throws_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.close_id(10), pg_temp.close_id(1), 'organization', pg_temp.close_id(10), 'period_closed', 'Counterfeit close')$$,
  'P0001',
  'Reserved audit action requires its command',
  'a signed-in owner cannot forge a month close'
);
select throws_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.close_id(10), pg_temp.close_id(1), 'report', pg_temp.close_id(10), 'support_exported', 'Counterfeit export')$$,
  'P0001',
  'Reserved audit action requires its command',
  'a signed-in owner cannot forge an export checksum'
);
select lives_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.close_id(10), pg_temp.close_id(1), 'organization', pg_temp.close_id(10), 'note_added', 'Ordinary note')$$,
  'an ordinary audit note is still allowed'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.close_id(2))::text, true);
select throws_ok($$select public.close_completed_month(pg_temp.close_id(10), '2020-03')$$, 'P0001', 'Only staff may change the finance lock date', 'a member cannot close a month');
select throws_ok($$select public.update_finance_lock_date(pg_temp.close_id(10), null)$$, 'P0001', 'Only staff may change the finance lock date', 'a member cannot change the lock');
select throws_ok(
  $$select public.record_support_export(pg_temp.close_id(10), 'accountant_pack_csv', '2020-02', 'ab' || repeat('ab', 31), 3)$$,
  'P0001',
  'Only owners, admins, and accountants can record a support export',
  'a member cannot record an export'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.close_id(4))::text, true);
select throws_ok($$select public.close_completed_month(pg_temp.close_id(10), '2020-03')$$, 'P0001', 'Only staff may change the finance lock date', 'an accountant cannot close a month');
select lives_ok(
  $$select public.record_support_export(pg_temp.close_id(10), 'outstanding_pack_csv', '2020-02-29', repeat('ab', 32), 8)$$,
  'an accountant can record a support export'
);
select throws_ok(
  $$select public.record_support_export(pg_temp.close_id(10), 'pp30', '2020-02', repeat('cd', 32), 8)$$,
  'P0001',
  'Unknown support export',
  'an unknown export kind is refused'
);
select throws_ok(
  $$select public.record_support_export(pg_temp.close_id(10), 'accountant_pack_csv', '2020-02', 'not-a-hash', 8)$$,
  'P0001',
  'Support export checksum is not SHA-256',
  'a checksum that is not SHA-256 is refused'
);
select throws_ok(
  $$select public.record_support_export(pg_temp.close_id(10), 'accountant_pack_csv', '2020-02-31', repeat('ab', 32), 8)$$,
  'P0001',
  'Support export period is not valid',
  '31 February is refused'
);
select is(
  (select meta->>'sha256' from public.audit_log where org_id = pg_temp.close_id(10) and action = 'support_exported'),
  repeat('ab', 32),
  'the export audit stores the checksum'
);
select is(
  (select meta->>'filing' from public.audit_log where org_id = pg_temp.close_id(10) and action = 'support_exported'),
  'false',
  'the export audit says it is not a filing'
);
select is(
  (select actor_email from public.audit_log where org_id = pg_temp.close_id(10) and action = 'support_exported'),
  'synthetic-close-accountant@example.invalid',
  'the export audit names the accountant'
);

reset role;
grant insert on public.audit_log to service_role;
select ok(not has_function_privilege('anon', 'public.close_completed_month(uuid,text)', 'execute'), 'anon cannot close a month');
select ok(not has_function_privilege('anon', 'public.record_support_export(uuid,text,text,text,integer)', 'execute'), 'anon cannot record an export');
select ok(not has_function_privilege('service_role', 'public.close_completed_month(uuid,text)', 'execute'), 'service role cannot call the close command');

set local role service_role;
select throws_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.close_id(10), pg_temp.close_id(1), 'organization', pg_temp.close_id(10), 'finance_lock_reopened', 'Counterfeit reopen')$$,
  'P0001',
  'Reserved audit action requires its command',
  'service role cannot forge a reopen'
);

select * from finish();
rollback;
