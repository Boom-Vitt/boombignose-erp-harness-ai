-- A balanced draft journal into a period the finance lock already covers.
-- Issued documents do not post here. This is not signed statutory books
-- and not a ภ.พ.30 or e-Tax filing.

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null check (isfinite(entry_date)),
  memo text not null check (length(btrim(memo)) between 1 and 200 and memo = btrim(memo)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.journal_lines (
  org_id uuid not null,
  entry_id uuid not null,
  line_no integer not null check (line_no between 1 and 20),
  account_code text not null check (account_code ~ '^[0-9]{4}$'),
  debit_satang bigint not null check (debit_satang >= 0 and debit_satang <= 9007199254740991),
  credit_satang bigint not null check (credit_satang >= 0 and credit_satang <= 9007199254740991),
  primary key (entry_id, line_no),
  foreign key (org_id, entry_id) references public.journal_entries (org_id, id) on delete cascade,
  foreign key (org_id, account_code) references public.gl_accounts (org_id, code),
  check (not (debit_satang > 0 and credit_satang > 0)),
  check (debit_satang > 0 or credit_satang > 0)
);

create index journal_entries_org_date_idx on public.journal_entries (org_id, entry_date desc, id);
create index journal_lines_account_idx on public.journal_lines (org_id, account_code);

alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
alter table public.journal_lines enable row level security;
alter table public.journal_lines force row level security;
revoke all on public.journal_entries from public, anon, authenticated;
revoke all on public.journal_lines from public, anon, authenticated;
grant select on public.journal_entries to authenticated;
grant select on public.journal_lines to authenticated;
create policy tenant_read on public.journal_entries for select to authenticated using (private.is_org_finance(org_id));
create policy tenant_read on public.journal_lines for select to authenticated using (private.is_org_finance(org_id));

-- Posted lines are not edited. Delete stays open so removing a workspace can cascade.
create function private.block_journal_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A posted draft journal cannot be changed';
end;
$$;

revoke all on function private.block_journal_change() from public, anon, authenticated, service_role;

create trigger journal_entries_block_update
  before update on public.journal_entries
  for each row execute function private.block_journal_change();

create trigger journal_lines_block_update
  before update on public.journal_lines
  for each row execute function private.block_journal_change();

-- A committed insert that does not balance fails, including a direct insert by the database owner.
create function private.assert_journal_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  debits bigint;
  credits bigint;
  n integer;
begin
  select coalesce(sum(debit_satang), 0), coalesce(sum(credit_satang), 0), count(*)
    into debits, credits, n
    from public.journal_lines
    where entry_id = new.entry_id;
  if n = 0 then
    return null;
  end if;
  if n < 2 or n > 20 then
    raise exception 'A journal needs 2 to 20 lines.';
  end if;
  if debits is distinct from credits or debits <= 0 then
    raise exception 'Journal debits and credits do not balance.';
  end if;
  if debits > 9007199254740991 then
    raise exception 'Journal line amount must be integer satang.';
  end if;
  return null;
end;
$$;

revoke all on function private.assert_journal_balanced() from public, anon, authenticated, service_role;

create constraint trigger journal_lines_must_balance
  after insert on public.journal_lines
  deferrable initially deferred
  for each row execute function private.assert_journal_balanced();

create or replace function private.close_activity_action(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action in (
    'finance_lock_updated',
    'finance_lock_reopened',
    'finance_lock_reopen_requested',
    'finance_lock_reopen_cancelled',
    'period_closed',
    'support_exported',
    'support_pack_reviewed',
    'journal_draft_posted'
  );
$$;

create or replace function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount','note','entryId','entryDate','debitSatang','lineCount'];
  key text;
  parts text[] := array[]::text[];
  raw jsonb;
begin
  if p_meta is null then return ''; end if;
  foreach key in array keys loop
    if not (p_meta ? key) then continue; end if;
    raw := p_meta->key;
    if raw is null or raw = 'null'::jsonb or p_meta->>key = '' then continue; end if;
    if jsonb_typeof(raw) = 'boolean' then
      parts := parts || (key || '=' || case when p_meta->>key = 'true' then 'true' else 'false' end);
    elsif jsonb_typeof(raw) = 'number' then
      parts := parts || (key || '=' || (p_meta->>key));
    elsif jsonb_typeof(raw) = 'string' then
      parts := parts || (key || '=' || private.close_chain_escape(p_meta->>key));
    end if;
  end loop;
  return array_to_string(parts, ';');
end;
$$;

create or replace function private.guard_close_audit_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'service_role')
     and new.action in (
       'finance_lock_updated',
       'finance_lock_reopened',
       'finance_lock_reopen_requested',
       'finance_lock_reopen_cancelled',
       'period_closed',
       'support_exported',
       'support_pack_reviewed',
       'journal_draft_posted'
     ) then
    raise exception 'Reserved audit action requires its command';
  end if;
  return new;
end;
$$;

create function public.post_draft_journal(p_org_id uuid, p_entry_date date, p_memo text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lock date;
  memo text;
  count_lines integer;
  elem jsonb;
  i integer;
  code text;
  debit_text text;
  credit_text text;
  debit bigint;
  credit bigint;
  debits bigint := 0;
  credits bigint := 0;
  entry_id uuid;
  actor text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can post a draft journal';
  end if;
  if p_entry_date is null or not isfinite(p_entry_date) then
    raise exception 'Enter a journal date.';
  end if;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or p_entry_date > current_lock then
    raise exception 'Post a journal only into a closed period.';
  end if;
  memo := btrim(p_memo);
  if memo is null or length(memo) < 1 or length(memo) > 200 then
    raise exception 'Enter a journal memo.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'A journal needs 2 to 20 lines.';
  end if;
  count_lines := jsonb_array_length(p_lines);
  if count_lines < 2 or count_lines > 20 then
    raise exception 'A journal needs 2 to 20 lines.';
  end if;

  for i in 0 .. count_lines - 1 loop
    elem := p_lines->i;
    if jsonb_typeof(elem) is distinct from 'object' then
      raise exception 'Journal line account is not on the chart.';
    end if;
    code := elem->>'accountCode';
    if code is null or code !~ '^[0-9]{4}$' or not exists (
      select 1 from public.gl_accounts where org_id = p_org_id and gl_accounts.code = code
    ) then
      raise exception 'Journal line account is not on the chart.';
    end if;
    debit_text := elem->>'debitSatang';
    credit_text := elem->>'creditSatang';
    if debit_text is null or credit_text is null or debit_text !~ '^[0-9]+$' or credit_text !~ '^[0-9]+$' then
      raise exception 'Journal line amount must be integer satang.';
    end if;
    begin
      debit := debit_text::bigint;
      credit := credit_text::bigint;
    exception when others then
      raise exception 'Journal line amount must be integer satang.';
    end;
    if debit > 9007199254740991 or credit > 9007199254740991 then
      raise exception 'Journal line amount must be integer satang.';
    end if;
    if debit > 0 and credit > 0 then
      raise exception 'A journal line is debit or credit, not both.';
    end if;
    if debit = 0 and credit = 0 then
      raise exception 'A journal line needs an amount.';
    end if;
    if debits > 9007199254740991 - debit or credits > 9007199254740991 - credit then
      raise exception 'Journal line amount must be integer satang.';
    end if;
    debits := debits + debit;
    credits := credits + credit;
  end loop;

  if debits is distinct from credits or debits <= 0 then
    raise exception 'Journal debits and credits do not balance.';
  end if;

  insert into public.journal_entries(org_id, entry_date, memo, created_by)
    values (p_org_id, p_entry_date, memo, auth.uid())
    returning id into entry_id;

  for i in 0 .. count_lines - 1 loop
    elem := p_lines->i;
    insert into public.journal_lines(org_id, entry_id, line_no, account_code, debit_satang, credit_satang)
      values (
        p_org_id,
        entry_id,
        i + 1,
        elem->>'accountCode',
        (elem->>'debitSatang')::bigint,
        (elem->>'creditSatang')::bigint
      );
  end loop;

  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id,
      auth.uid(),
      actor,
      'journal',
      entry_id,
      'journal_draft_posted',
      'Posted a draft journal on ' || p_entry_date::text || ' for ' || debits::text || ' satang. This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.',
      jsonb_build_object(
        'entryId', entry_id::text,
        'entryDate', p_entry_date::text,
        'debitSatang', debits,
        'lineCount', count_lines,
        'kind', 'operational_journal',
        'filing', false
      )
    );
  return entry_id;
end;
$$;

revoke all on function public.post_draft_journal(uuid, date, text, jsonb) from public, anon, service_role;
grant execute on function public.post_draft_journal(uuid, date, text, jsonb) to authenticated;
