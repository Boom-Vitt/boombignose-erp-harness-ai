begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.review_id(n integer) returns uuid language sql immutable as $$
  select ('c5f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.review_id(1), 'synthetic-review-owner@example.invalid', now()),
  (pg_temp.review_id(2), 'synthetic-review-accountant@example.invalid', now()),
  (pg_temp.review_id(3), 'synthetic-review-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.review_id(10), 'Synthetic support review', 'synthetic-support-review');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.review_id(10), pg_temp.review_id(1), 'owner'),
  (pg_temp.review_id(10), pg_temp.review_id(2), 'accountant'),
  (pg_temp.review_id(10), pg_temp.review_id(3), 'member');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.review_id(1))::text, true);
set local role authenticated;

select throws_ok(
  $$select public.review_support_pack(pg_temp.review_id(10), repeat('ab', 32))$$,
  'P0001',
  'No stored support export has this checksum.',
  'a review requires a stored export'
);
select lives_ok(
  $$select public.record_support_export(pg_temp.review_id(10), 'accountant_pack_csv', '2026-10', repeat('ab', 32), 12)$$,
  'the owner records a support file'
);
select is((public.review_support_pack(pg_temp.review_id(10), repeat('ab', 32))->>'already')::boolean, false, 'the first look is recorded');
select is((public.review_support_pack(pg_temp.review_id(10), repeat('ab', 32))->>'already')::boolean, true, 'the same person does not record a second look');
select is(
  (select count(*) from public.audit_log where org_id = pg_temp.review_id(10) and action = 'support_pack_reviewed'),
  1::bigint,
  'one review row exists'
);
select is(
  (select meta->>'filing' from public.audit_log where org_id = pg_temp.review_id(10) and action = 'support_pack_reviewed'),
  'false',
  'the review says it is not a filing'
);
select ok(
  (select summary from public.audit_log where org_id = pg_temp.review_id(10) and action = 'support_pack_reviewed') like '%not a statutory sign-off%',
  'the review is not a statutory sign-off'
);
select is((public.verify_close_activity_chain(pg_temp.review_id(10))->>'ok')::boolean, true, 'the review joins the close chain');
select throws_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.review_id(10), pg_temp.review_id(1), 'report', pg_temp.review_id(10), 'support_pack_reviewed', 'Counterfeit review')$$,
  'P0001',
  'Reserved audit action requires its command',
  'a signed-in user cannot forge a review'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.review_id(3))::text, true);
select throws_ok(
  $$select public.review_support_pack(pg_temp.review_id(10), repeat('ab', 32))$$,
  'P0001',
  'Only owners, admins, and accountants can review a support file',
  'a member cannot review a support file'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.review_id(2))::text, true);
select is((public.review_support_pack(pg_temp.review_id(10), repeat('ab', 32))->>'already')::boolean, false, 'the accountant can record a separate look');
select is(
  (select count(*) from public.audit_log where org_id = pg_temp.review_id(10) and action = 'support_pack_reviewed'),
  2::bigint,
  'the owner and the accountant each have a mark'
);

select * from finish();
rollback;
