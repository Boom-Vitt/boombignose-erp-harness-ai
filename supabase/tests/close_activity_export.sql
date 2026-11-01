begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.activity_id(n integer) returns uuid language sql immutable as $$
  select ('c3f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.activity_id(1), 'synthetic-activity-owner@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.activity_id(10), 'Synthetic close activity', 'synthetic-close-activity');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.activity_id(10), pg_temp.activity_id(1), 'owner');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.activity_id(1))::text, true);
set local role authenticated;

select lives_ok(
  $$select public.record_support_export(pg_temp.activity_id(10), 'close_activity_csv', '2026-11-01', repeat('ab', 32), 20)$$,
  'the close activity file can be recorded'
);
select is(
  public.find_support_export(pg_temp.activity_id(10), repeat('ab', 32))->>'kind',
  'close_activity_csv',
  'the stored checksum names the close activity file'
);
select is(
  (select meta->>'filing' from public.audit_log where org_id = pg_temp.activity_id(10) and action = 'support_exported' and meta->>'kind' = 'close_activity_csv'),
  'false',
  'the close activity checksum says it is not a filing'
);
select throws_ok(
  $$select public.record_support_export(pg_temp.activity_id(10), 'statutory_ledger', '2026-11-01', repeat('cd', 32), 20)$$,
  'P0001',
  'Unknown support export',
  'a statutory ledger export is not a support file'
);

select * from finish();
rollback;
