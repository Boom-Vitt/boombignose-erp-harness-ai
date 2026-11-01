begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  private.close_chain_recorded_at('2026-11-01 00:00:00+00'::timestamptz),
  '2026-11-01T00:00:00.000000Z',
  'chain timestamps are UTC with six-digit microseconds'
);
select is(
  private.close_chain_payload(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '2026-11-01T00:00:00.000000Z',
    'period_closed',
    '33333333-3333-4333-8333-333333333333',
    'Closed operational month 2026-01',
    '',
    '{"lockDate":"2026-01-31","month":"2026-01","kind":"operational_close","chainSha256":"ignored"}'::jsonb
  ),
  E'v1\n11111111-1111-4111-8111-111111111111\n22222222-2222-4222-8222-222222222222\n2026-11-01T00:00:00.000000Z\nperiod_closed\n33333333-3333-4333-8333-333333333333\nClosed operational month 2026-01\n\nlockDate=2026-01-31;month=2026-01;kind=operational_close',
  'payload matches the unit-test vector'
);
select is(
  private.close_chain_sha256(E'v1\n11111111-1111-4111-8111-111111111111\n22222222-2222-4222-8222-222222222222\n2026-11-01T00:00:00.000000Z\nperiod_closed\n33333333-3333-4333-8333-333333333333\nClosed operational month 2026-01\n\nlockDate=2026-01-31;month=2026-01;kind=operational_close'),
  'c4f7f4b763bc9aa183ad7f5b730f5b3e7fed442bcf56e0bf65f5985a18c0cd23',
  'sha256 matches the unit-test vector'
);

create function pg_temp.chain_id(n integer) returns uuid language sql immutable as $$
  select ('c4f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.chain_id(1), 'synthetic-chain-owner@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.chain_id(10), 'Synthetic chain intact', 'synthetic-chain-intact'),
  (pg_temp.chain_id(11), 'Synthetic chain tail', 'synthetic-chain-tail'),
  (pg_temp.chain_id(12), 'Synthetic chain gap', 'synthetic-chain-gap');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.chain_id(10), pg_temp.chain_id(1), 'owner'),
  (pg_temp.chain_id(11), pg_temp.chain_id(1), 'owner'),
  (pg_temp.chain_id(12), pg_temp.chain_id(1), 'owner');

insert into public.audit_log(id, org_id, entity, entity_id, action, summary, meta, created_at) values
  (pg_temp.chain_id(21), pg_temp.chain_id(10), 'organization', pg_temp.chain_id(10), 'period_closed', 'Closed one', '{"month":"2026-01"}'::jsonb, '2026-11-01 00:00:00+00');
insert into public.audit_log(id, org_id, entity, entity_id, action, summary, meta, created_at) values
  (pg_temp.chain_id(22), pg_temp.chain_id(10), 'organization', pg_temp.chain_id(10), 'support_exported', 'Exported one', '{"kind":"close_activity_csv","period":"2026-11-01","sha256":"abababababababababababababababababababababababababababababababab","bytes":4,"filing":false}'::jsonb, '2026-11-01 00:00:01+00');
select is((select close_chain_seq from public.audit_log where id = pg_temp.chain_id(22)), 2, 'the second close row is sequence 2');
select is(
  (select close_chain_prev from public.audit_log where id = pg_temp.chain_id(22)),
  (select close_chain_sha256 from public.audit_log where id = pg_temp.chain_id(21)),
  'the second row stores the first row hash'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.chain_id(1))::text, true);
set local role authenticated;
select is((public.verify_close_activity_chain(pg_temp.chain_id(10))->>'ok')::boolean, true, 'an intact chain verifies');
select is((public.verify_close_activity_chain(pg_temp.chain_id(10))->>'checked')::int, 2, 'both rows are checked');

reset role;
alter table public.audit_log disable trigger audit_close_chain_block_update;
update public.audit_log set summary = 'Changed after write' where id = pg_temp.chain_id(21);
alter table public.audit_log enable trigger audit_close_chain_block_update;
set local role authenticated;
select is((public.verify_close_activity_chain(pg_temp.chain_id(10))->>'ok')::boolean, false, 'an edited row breaks the chain');
select ok((public.verify_close_activity_chain(pg_temp.chain_id(10))->>'reason') like '%changed after it was written%', 'the verdict names the edited row');

reset role;
insert into public.audit_log(id, org_id, entity, entity_id, action, summary, created_at) values
  (pg_temp.chain_id(31), pg_temp.chain_id(11), 'organization', pg_temp.chain_id(11), 'period_closed', 'First', '2026-11-01 00:00:00+00'),
  (pg_temp.chain_id(32), pg_temp.chain_id(11), 'organization', pg_temp.chain_id(11), 'period_closed', 'Last', '2026-11-01 00:00:01+00');
delete from public.audit_log where id = pg_temp.chain_id(32);
set local role authenticated;
select is((public.verify_close_activity_chain(pg_temp.chain_id(11))->>'ok')::boolean, false, 'removing the last row leaves the stored head behind');
select ok((public.verify_close_activity_chain(pg_temp.chain_id(11))->>'reason') like '%stored chain head%', 'the verdict names the chain head');

reset role;
insert into public.audit_log(id, org_id, entity, entity_id, action, summary, created_at) values
  (pg_temp.chain_id(41), pg_temp.chain_id(12), 'organization', pg_temp.chain_id(12), 'period_closed', 'One', '2026-11-01 00:00:00+00'),
  (pg_temp.chain_id(42), pg_temp.chain_id(12), 'organization', pg_temp.chain_id(12), 'period_closed', 'Two', '2026-11-01 00:00:01+00'),
  (pg_temp.chain_id(43), pg_temp.chain_id(12), 'organization', pg_temp.chain_id(12), 'period_closed', 'Three', '2026-11-01 00:00:02+00');
delete from public.audit_log where id = pg_temp.chain_id(42);
set local role authenticated;
select is((public.verify_close_activity_chain(pg_temp.chain_id(12))->>'ok')::boolean, false, 'removing a middle row breaks the chain');
select is(public.verify_close_activity_chain(pg_temp.chain_id(12))->>'brokenAt', pg_temp.chain_id(43)::text, 'the next row is where the gap shows');

select * from finish();
rollback;
