-- An owner, admin, or accountant can accept the draft trial balance for a
-- date inside the finance lock. When more than one of them can accept, a
-- different one confirms. This is a step toward a legal close. It is not a
-- statutory sign-off and not a ภ.พ.30 filing.

create table public.draft_close_acceptance_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null,
  through_date date not null,
  debit_satang bigint not null,
  credit_satang bigint not null,
  line_count integer not null,
  figures_sha256 text not null,
  status text not null default 'pending',
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint draft_close_acceptance_status check (status in ('pending', 'confirmed', 'cancelled')),
  constraint draft_close_acceptance_through_finite check (isfinite(through_date)),
  constraint draft_close_acceptance_sha check (figures_sha256 ~ '^[a-f0-9]{64}$'),
  constraint draft_close_acceptance_totals check (debit_satang >= 0 and credit_satang >= 0 and line_count >= 0)
);

create unique index draft_close_acceptance_one_pending
  on public.draft_close_acceptance_requests (org_id)
  where status = 'pending';

create unique index draft_close_acceptance_one_figures
  on public.draft_close_acceptance_requests (org_id, through_date, figures_sha256)
  where status = 'confirmed';

alter table public.draft_close_acceptance_requests enable row level security;
alter table public.draft_close_acceptance_requests force row level security;
revoke all on public.draft_close_acceptance_requests from public, anon, authenticated, service_role;
grant select on public.draft_close_acceptance_requests to authenticated;
create policy finance_read on public.draft_close_acceptance_requests
  for select to authenticated using (private.is_org_finance(org_id));

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
    'journal_draft_posted',
    'draft_close_acceptance_requested',
    'draft_close_accepted',
    'draft_close_acceptance_cancelled'
  );
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
       'journal_draft_posted',
       'draft_close_acceptance_requested',
       'draft_close_accepted',
       'draft_close_acceptance_cancelled'
     ) then
    raise exception 'Reserved audit action requires its command';
  end if;
  return new;
end;
$$;

create or replace function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount','note','entryId','entryDate','debitSatang','lineCount','invoiceId','invoiceNumber','vatTreatment','creditNoteId','paymentId','source','depositSatang','through','creditSatang','figuresSha256'];
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

create function private.draft_close_figures(p_org_id uuid, p_through date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rowtext text;
  debit_total bigint;
  credit_total bigint;
  included integer;
  payload text;
  hashed text;
begin
  select coalesce(string_agg(nets.code || ' ' || nets.debit || ' ' || nets.credit, E'\n' order by nets.code), ''),
         coalesce(sum(nets.debit), 0),
         coalesce(sum(nets.credit), 0)
    into rowtext, debit_total, credit_total
    from (
      select account_code as code,
             case when net > 0 then net else 0 end as debit,
             case when net < 0 then -net else 0 end as credit
      from (
        select l.account_code, sum(l.debit_satang) - sum(l.credit_satang) as net
        from public.journal_lines l
        join public.journal_entries e on e.org_id = l.org_id and e.id = l.entry_id
        where e.org_id = p_org_id and e.entry_date <= p_through
        group by l.account_code
      ) raw
      where net <> 0
    ) nets;
  select count(*)::integer into included
    from public.journal_lines l
    join public.journal_entries e on e.org_id = l.org_id and e.id = l.entry_id
    where e.org_id = p_org_id and e.entry_date <= p_through;
  payload := 'v1' || E'\n' || p_through::text || E'\n' || rowtext || E'\n'
    || debit_total::text || E'\n' || credit_total::text || E'\n' || included::text;
  hashed := private.close_chain_sha256(payload);
  return jsonb_build_object(
    'debitSatang', debit_total,
    'creditSatang', credit_total,
    'lineCount', included,
    'balanced', debit_total = credit_total,
    'sha256', hashed
  );
end;
$$;

revoke all on function private.draft_close_figures(uuid, date) from public, anon, authenticated, service_role;

create function private.record_draft_close_acceptance(
  p_org_id uuid,
  p_request_id uuid,
  p_through date,
  p_debit bigint,
  p_credit bigint,
  p_lines integer,
  p_sha text,
  p_requested_by uuid,
  p_confirmed_by uuid,
  p_action text,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor text;
begin
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id, auth.uid(), actor, 'report', p_org_id, p_action, p_summary,
      jsonb_strip_nulls(jsonb_build_object(
        'through', p_through::text,
        'debitSatang', p_debit,
        'creditSatang', p_credit,
        'lineCount', p_lines,
        'figuresSha256', p_sha,
        'requestId', p_request_id,
        'requestedBy', p_requested_by,
        'confirmedBy', p_confirmed_by,
        'kind', 'draft_gl_acceptance',
        'filing', false
      ))
    );
end;
$$;

revoke all on function private.record_draft_close_acceptance(uuid, uuid, date, bigint, bigint, integer, text, uuid, uuid, text, text) from public, anon, authenticated, service_role;

create function public.propose_draft_close_acceptance(p_org_id uuid, p_through date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lock date;
  figures jsonb;
  finance_count integer;
  request_id uuid;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can accept a draft close';
  end if;
  if p_through is null or not isfinite(p_through) then
    raise exception 'Accept a draft close only inside a locked period.';
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id;
  if current_lock is null or not isfinite(current_lock) or p_through > current_lock then
    raise exception 'Accept a draft close only inside a locked period.';
  end if;
  figures := private.draft_close_figures(p_org_id, p_through);
  if coalesce((figures->>'balanced')::boolean, false) is distinct from true then
    raise exception 'Accept a trial balance only when debits equal credits.';
  end if;
  if exists (
    select 1 from public.draft_close_acceptance_requests
    where org_id = p_org_id and through_date = p_through and figures_sha256 = figures->>'sha256' and status = 'confirmed'
  ) then
    return jsonb_build_object('already', true, 'through', p_through, 'figuresSha256', figures->>'sha256');
  end if;
  select count(*) into finance_count from public.memberships
    where org_id = p_org_id and role in ('owner', 'admin', 'accountant');
  if finance_count > 1 then
    begin
      insert into public.draft_close_acceptance_requests(org_id, requested_by, through_date, debit_satang, credit_satang, line_count, figures_sha256)
        values (p_org_id, auth.uid(), p_through, (figures->>'debitSatang')::bigint, (figures->>'creditSatang')::bigint, (figures->>'lineCount')::integer, figures->>'sha256')
        returning id into request_id;
    exception when unique_violation then
      raise exception 'A draft close acceptance is already waiting for confirmation.';
    end;
    perform private.record_draft_close_acceptance(
      p_org_id, request_id, p_through, (figures->>'debitSatang')::bigint, (figures->>'creditSatang')::bigint,
      (figures->>'lineCount')::integer, figures->>'sha256', auth.uid(), null,
      'draft_close_acceptance_requested',
      'Asked to accept the draft trial balance through ' || p_through::text || '. Not a statutory sign-off and not a ภ.พ.30 filing.'
    );
    return jsonb_build_object('pending', true, 'requestId', request_id, 'through', p_through);
  end if;
  insert into public.draft_close_acceptance_requests(org_id, requested_by, through_date, debit_satang, credit_satang, line_count, figures_sha256, status, confirmed_by, confirmed_at)
    values (p_org_id, auth.uid(), p_through, (figures->>'debitSatang')::bigint, (figures->>'creditSatang')::bigint, (figures->>'lineCount')::integer, figures->>'sha256', 'confirmed', auth.uid(), now())
    returning id into request_id;
  perform private.record_draft_close_acceptance(
    p_org_id, request_id, p_through, (figures->>'debitSatang')::bigint, (figures->>'creditSatang')::bigint,
    (figures->>'lineCount')::integer, figures->>'sha256', auth.uid(), auth.uid(),
    'draft_close_accepted',
    'Accepted the draft trial balance through ' || p_through::text || '. One finance user. Not a statutory sign-off and not a ภ.พ.30 filing.'
  );
  return jsonb_build_object('applied', true, 'through', p_through, 'figuresSha256', figures->>'sha256');
end;
$$;

revoke all on function public.propose_draft_close_acceptance(uuid, date) from public, anon, service_role;
grant execute on function public.propose_draft_close_acceptance(uuid, date) to authenticated;

create function public.confirm_draft_close_acceptance(p_org_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.draft_close_acceptance_requests;
  figures jsonb;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can accept a draft close';
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select * into req from public.draft_close_acceptance_requests
    where org_id = p_org_id and id = p_request_id and status = 'pending'
    for update;
  if not found then
    raise exception 'Draft close acceptance not found';
  end if;
  if req.requested_by = (select auth.uid()) then
    raise exception 'A different owner, admin, or accountant must confirm this acceptance.';
  end if;
  figures := private.draft_close_figures(p_org_id, req.through_date);
  if figures->>'sha256' is distinct from req.figures_sha256 or coalesce((figures->>'balanced')::boolean, false) is distinct from true then
    raise exception 'The draft trial balance changed. Ask again.';
  end if;
  update public.draft_close_acceptance_requests
    set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
    where id = req.id;
  perform private.record_draft_close_acceptance(
    p_org_id, req.id, req.through_date, req.debit_satang, req.credit_satang, req.line_count, req.figures_sha256,
    req.requested_by, auth.uid(),
    'draft_close_accepted',
    'Accepted the draft trial balance through ' || req.through_date::text || '. A second finance user confirmed. Not a statutory sign-off and not a ภ.พ.30 filing.'
  );
  return jsonb_build_object('applied', true, 'through', req.through_date);
end;
$$;

revoke all on function public.confirm_draft_close_acceptance(uuid, uuid) from public, anon, service_role;
grant execute on function public.confirm_draft_close_acceptance(uuid, uuid) to authenticated;

create function public.cancel_draft_close_acceptance(p_org_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare req public.draft_close_acceptance_requests;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can accept a draft close';
  end if;
  select * into req from public.draft_close_acceptance_requests
    where org_id = p_org_id and id = p_request_id and status = 'pending'
    for update;
  if not found then
    raise exception 'Draft close acceptance not found';
  end if;
  update public.draft_close_acceptance_requests
    set status = 'cancelled', confirmed_by = auth.uid(), confirmed_at = now()
    where id = req.id;
  perform private.record_draft_close_acceptance(
    p_org_id, req.id, req.through_date, req.debit_satang, req.credit_satang, req.line_count, req.figures_sha256,
    req.requested_by, null,
    'draft_close_acceptance_cancelled',
    'Cancelled a draft trial balance acceptance. Not a statutory sign-off and not a filing.'
  );
end;
$$;

revoke all on function public.cancel_draft_close_acceptance(uuid, uuid) from public, anon, service_role;
grant execute on function public.cancel_draft_close_acceptance(uuid, uuid) to authenticated;
