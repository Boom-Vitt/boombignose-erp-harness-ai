begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.accept_id(n integer) returns uuid language sql immutable as $$
  select ('caf00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.accept_id(1), 'synthetic-accept-owner@example.invalid', now()),
  (pg_temp.accept_id(2), 'synthetic-accept-accountant@example.invalid', now()),
  (pg_temp.accept_id(3), 'synthetic-accept-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.accept_id(10), 'Synthetic draft acceptance', 'synthetic-draft-acceptance');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.accept_id(10), pg_temp.accept_id(1), 'owner'),
  (pg_temp.accept_id(10), pg_temp.accept_id(2), 'accountant'),
  (pg_temp.accept_id(10), pg_temp.accept_id(3), 'member');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.accept_id(1))::text, true);
set local role authenticated;

select public.install_thai_sme_chart(pg_temp.accept_id(10));
select lives_ok($$select public.update_finance_lock_date(pg_temp.accept_id(10), '2020-01-31')$$, 'the owner locks January 2020');
select lives_ok(
  $$select public.post_draft_journal(pg_temp.accept_id(10), '2020-01-15', 'ขายเงินสด', '[{"accountCode":"1110","debitSatang":100,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":100}]'::jsonb)$$,
  'a balanced journal is in the locked period'
);

select throws_ok(
  $$select public.propose_draft_close_acceptance(pg_temp.accept_id(10), '2020-02-01')$$,
  'P0001',
  'Accept a draft close only inside a locked period.',
  'a date after the lock is refused'
);
select is((public.propose_draft_close_acceptance(pg_temp.accept_id(10), '2020-01-31')->>'pending')::boolean, true, 'two finance users leave the acceptance pending');
select throws_ok(
  $$select public.confirm_draft_close_acceptance(pg_temp.accept_id(10), (select id from public.draft_close_acceptance_requests where org_id = pg_temp.accept_id(10) and status = 'pending'))$$,
  'P0001',
  'A different owner, admin, or accountant must confirm this acceptance.',
  'the requester cannot confirm'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.accept_id(2))::text, true);
select is((public.confirm_draft_close_acceptance(pg_temp.accept_id(10), (select id from public.draft_close_acceptance_requests where org_id = pg_temp.accept_id(10) and status = 'pending'))->>'applied')::boolean, true, 'the accountant confirms');
select is(
  (select figures_sha256 from public.draft_close_acceptance_requests where org_id = pg_temp.accept_id(10) and status = 'confirmed'),
  'c19e039fcea6e8aa5a2a925d72200b5e5df3beadce8ad68560bbdbe2833e577e',
  'the accepted figures hash matches the draft trial balance'
);
select ok(
  (select summary from public.audit_log where org_id = pg_temp.accept_id(10) and action = 'draft_close_accepted') like '%not a statutory sign-off%',
  'the acceptance is not a statutory sign-off'
);
select is(
  (select meta->>'filing' from public.audit_log where org_id = pg_temp.accept_id(10) and action = 'draft_close_accepted'),
  'false',
  'the acceptance is not a filing'
);
select is((public.verify_close_activity_chain(pg_temp.accept_id(10))->>'ok')::boolean, true, 'the acceptance joins the close chain');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.accept_id(1))::text, true);
select is((public.propose_draft_close_acceptance(pg_temp.accept_id(10), '2020-01-31')->>'already')::boolean, true, 'the same figures are not accepted twice');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.accept_id(3))::text, true);
select throws_ok(
  $$select public.propose_draft_close_acceptance(pg_temp.accept_id(10), '2020-01-31')$$,
  'P0001',
  'Only owners, admins, and accountants can accept a draft close',
  'a member cannot accept'
);

select * from finish();
rollback;
