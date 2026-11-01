begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.journal_id(n integer) returns uuid language sql immutable as $$
  select ('c6f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

insert into auth.users(id, email, email_confirmed_at) values
  (pg_temp.journal_id(1), 'synthetic-journal-owner@example.invalid', now()),
  (pg_temp.journal_id(2), 'synthetic-journal-accountant@example.invalid', now()),
  (pg_temp.journal_id(3), 'synthetic-journal-member@example.invalid', now());
insert into public.organizations(id, name, slug) values
  (pg_temp.journal_id(10), 'Synthetic draft journal', 'synthetic-draft-journal');
insert into public.memberships(org_id, user_id, role) values
  (pg_temp.journal_id(10), pg_temp.journal_id(1), 'owner'),
  (pg_temp.journal_id(10), pg_temp.journal_id(2), 'accountant'),
  (pg_temp.journal_id(10), pg_temp.journal_id(3), 'member');

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.journal_id(1))::text, true);
set local role authenticated;

select lives_ok($$select public.install_thai_sme_chart(pg_temp.journal_id(10))$$, 'the owner installs the chart');
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'ขายเงินสด', '[{"accountCode":"1110","debitSatang":10700,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":10700}]'::jsonb)$$,
  'P0001',
  'Post a journal only into a closed period.',
  'a journal needs a finance lock'
);
select lives_ok($$select public.update_finance_lock_date(pg_temp.journal_id(10), '2020-01-31')$$, 'the owner locks January');
select lives_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', '  ขายเงินสด  ', '[{"accountCode":"1110","debitSatang":10700,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":10700}]'::jsonb)$$,
  'a balanced journal posts into the closed period'
);
select is(
  (select memo from public.journal_entries where org_id = pg_temp.journal_id(10)),
  'ขายเงินสด',
  'the memo is trimmed'
);
select is(
  (select sum(debit_satang) from public.journal_lines where org_id = pg_temp.journal_id(10)),
  10700::bigint,
  'debits are stored in satang'
);
select is(
  (select sum(credit_satang) from public.journal_lines where org_id = pg_temp.journal_id(10)),
  10700::bigint,
  'credits match the debits'
);
select ok(
  (select summary from public.audit_log where org_id = pg_temp.journal_id(10) and action = 'journal_draft_posted') like '%not signed statutory books%',
  'the audit says these are not signed statutory books'
);
select is(
  (select meta->>'filing' from public.audit_log where org_id = pg_temp.journal_id(10) and action = 'journal_draft_posted'),
  'false',
  'the audit says this is not a filing'
);
select is((public.verify_close_activity_chain(pg_temp.journal_id(10))->>'ok')::boolean, true, 'the journal joins the close chain');

select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'ไม่สมดุล', '[{"accountCode":"1110","debitSatang":100,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":90}]'::jsonb)$$,
  'P0001',
  'Journal debits and credits do not balance.',
  'unbalanced lines are refused'
);
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'สองด้าน', '[{"accountCode":"1110","debitSatang":100,"creditSatang":100},{"accountCode":"4100","debitSatang":0,"creditSatang":100}]'::jsonb)$$,
  'P0001',
  'A journal line is debit or credit, not both.',
  'a line cannot be both debit and credit'
);
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'ไม่มีบัญชี', '[{"accountCode":"9999","debitSatang":100,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":100}]'::jsonb)$$,
  'P0001',
  'Journal line account is not on the chart.',
  'an unknown account is refused'
);
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'เศษสตางค์', '[{"accountCode":"1110","debitSatang":1.5,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":1.5}]'::jsonb)$$,
  'P0001',
  'Journal line amount must be integer satang.',
  'a fractional satang amount is refused'
);
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-02-01', 'นอกงวด', '[{"accountCode":"1110","debitSatang":100,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":100}]'::jsonb)$$,
  'P0001',
  'Post a journal only into a closed period.',
  'a date after the lock is refused'
);
select throws_ok(
  $$insert into public.audit_log(org_id, actor_id, entity, entity_id, action, summary) values (pg_temp.journal_id(10), pg_temp.journal_id(1), 'journal', pg_temp.journal_id(10), 'journal_draft_posted', 'Counterfeit journal')$$,
  'P0001',
  'Reserved audit action requires its command',
  'a signed-in user cannot forge a journal post'
);

select lives_ok($$select public.update_finance_lock_date(pg_temp.journal_id(10), null)$$, 'the owner clears the lock');
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'ไม่มีล็อก', '[{"accountCode":"1110","debitSatang":100,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":100}]'::jsonb)$$,
  'P0001',
  'Post a journal only into a closed period.',
  'a cleared lock refuses the journal'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.journal_id(3))::text, true);
select throws_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-15', 'สมาชิก', '[{"accountCode":"1110","debitSatang":100,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":100}]'::jsonb)$$,
  'P0001',
  'Only owners, admins, and accountants can post a draft journal',
  'a member cannot post'
);

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.journal_id(1))::text, true);
select lives_ok($$select public.update_finance_lock_date(pg_temp.journal_id(10), '2020-01-31')$$, 'the owner locks the period again');
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.journal_id(2))::text, true);
select lives_ok(
  $$select public.post_draft_journal(pg_temp.journal_id(10), '2020-01-31', 'นักบัญชี', '[{"accountCode":"6100","debitSatang":5000,"creditSatang":0},{"accountCode":"1110","debitSatang":0,"creditSatang":5000}]'::jsonb)$$,
  'an accountant can post a balanced journal'
);
select is(
  (select count(*) from public.journal_entries where org_id = pg_temp.journal_id(10)),
  2::bigint,
  'two draft journals are stored'
);
select is((public.verify_close_activity_chain(pg_temp.journal_id(10))->>'ok')::boolean, true, 'the chain still holds after the second post');

select * from finish();
rollback;
