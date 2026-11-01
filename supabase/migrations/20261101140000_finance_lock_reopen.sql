-- A reopen from the screen needs a reason. When the workspace has more than
-- one owner or admin, a different one of them confirms it. The older
-- two-argument update_finance_lock_date still applies a date immediately so
-- existing database checks can unlock a period. The screen does not call it.
-- None of this files ภ.พ.30 or posts a statutory ledger.

create table public.finance_lock_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null,
  lock_date date,
  previous_lock_date date,
  reason text not null,
  status text not null default 'pending',
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint finance_lock_reopen_reason_text check (char_length(reason) between 1 and 200 and reason = btrim(reason)),
  constraint finance_lock_reopen_status check (status in ('pending', 'confirmed', 'cancelled')),
  constraint finance_lock_reopen_lock_finite check (lock_date is null or isfinite(lock_date)),
  constraint finance_lock_reopen_previous_finite check (previous_lock_date is null or isfinite(previous_lock_date))
);

create unique index finance_lock_reopen_one_pending
  on public.finance_lock_reopen_requests(org_id)
  where status = 'pending';

alter table public.finance_lock_reopen_requests enable row level security;
alter table public.finance_lock_reopen_requests force row level security;
revoke all on public.finance_lock_reopen_requests from public, anon, authenticated, service_role;

create function private.apply_finance_lock(
  p_org_id uuid,
  p_lock_date date,
  p_reason text,
  p_requested_by uuid,
  p_confirmed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lock date;
  today date := (now() at time zone 'Asia/Bangkok')::date;
  actor text;
  next_action text;
  next_summary text;
begin
  if not private.is_org_staff(p_org_id) then
    raise exception 'Only staff may change the finance lock date';
  end if;
  if p_lock_date is not null and not isfinite(p_lock_date) then
    raise exception 'Invalid finance lock date';
  end if;
  if p_lock_date is not null and p_lock_date > today then
    raise exception 'Finance lock date cannot be in the future';
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id for update;
  if current_lock is not distinct from p_lock_date then
    return;
  end if;
  insert into public.org_settings(org_id, lock_date) values (p_org_id, p_lock_date)
    on conflict (org_id) do update set lock_date = excluded.lock_date;
  if p_lock_date is null or (current_lock is not null and p_lock_date < current_lock) then
    next_action := 'finance_lock_reopened';
    next_summary := case when p_reason is null then 'Reopened the finance lock' else 'Reopened the finance lock: ' || p_reason end;
  else
    next_action := 'finance_lock_updated';
    next_summary := 'Updated finance lock date';
  end if;
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id,
      auth.uid(),
      actor,
      'organization',
      p_org_id,
      next_action,
      next_summary,
      jsonb_strip_nulls(jsonb_build_object(
        'lockDate', p_lock_date,
        'previousLockDate', current_lock,
        'kind', 'operational_lock',
        'reason', p_reason,
        'requestedBy', p_requested_by,
        'confirmedBy', p_confirmed_by
      ))
    );
end;
$$;

revoke all on function private.apply_finance_lock(uuid, date, text, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.update_finance_lock_date(p_org_id uuid, p_lock_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_finance_lock(p_org_id, p_lock_date, null, null, null);
end;
$$;

create function private.reopen_reason(p_reason text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare trimmed text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if trimmed is null or char_length(trimmed) > 200 then
    raise exception 'A reason is required to reopen the finance lock.';
  end if;
  return trimmed;
end;
$$;

revoke all on function private.reopen_reason(text) from public, anon, authenticated, service_role;

create function public.propose_finance_lock(p_org_id uuid, p_lock_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lock date;
  today date := (now() at time zone 'Asia/Bangkok')::date;
  staff_count int;
  reason text;
  request_id uuid;
  actor text;
  reopening boolean;
begin
  if not private.is_org_staff(p_org_id) then
    raise exception 'Only staff may change the finance lock date';
  end if;
  if p_lock_date is not null and not isfinite(p_lock_date) then
    raise exception 'Invalid finance lock date';
  end if;
  if p_lock_date is not null and p_lock_date > today then
    raise exception 'Finance lock date cannot be in the future';
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id for update;
  if current_lock is not distinct from p_lock_date then
    return jsonb_build_object('applied', true, 'lockDate', current_lock);
  end if;
  reopening := p_lock_date is null or (current_lock is not null and p_lock_date < current_lock);
  if not reopening then
    perform private.apply_finance_lock(p_org_id, p_lock_date, null, null, null);
    return jsonb_build_object('applied', true, 'lockDate', p_lock_date);
  end if;
  reason := private.reopen_reason(p_reason);
  select count(*) into staff_count from public.memberships
    where org_id = p_org_id and role in ('owner', 'admin');
  if staff_count > 1 then
    begin
      insert into public.finance_lock_reopen_requests(org_id, requested_by, lock_date, previous_lock_date, reason)
        values (p_org_id, auth.uid(), p_lock_date, current_lock, reason)
        returning id into request_id;
    exception when unique_violation then
      raise exception 'A reopen is already waiting for confirmation.';
    end;
    select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
    insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
      values (
        p_org_id,
        auth.uid(),
        actor,
        'organization',
        p_org_id,
        'finance_lock_reopen_requested',
        'Asked to reopen the finance lock: ' || reason,
        jsonb_build_object(
          'requestId', request_id,
          'lockDate', p_lock_date,
          'previousLockDate', current_lock,
          'reason', reason,
          'staffCount', staff_count,
          'kind', 'operational_lock'
        )
      );
    return jsonb_build_object('pending', true, 'requestId', request_id, 'lockDate', p_lock_date);
  end if;
  perform private.apply_finance_lock(p_org_id, p_lock_date, reason, auth.uid(), auth.uid());
  return jsonb_build_object('applied', true, 'lockDate', p_lock_date);
end;
$$;

revoke all on function public.propose_finance_lock(uuid, date, text) from public, anon, service_role;
grant execute on function public.propose_finance_lock(uuid, date, text) to authenticated;

create function public.confirm_finance_lock_reopen(p_org_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare req public.finance_lock_reopen_requests;
begin
  if not private.is_org_staff(p_org_id) then
    raise exception 'Only staff may change the finance lock date';
  end if;
  if p_request_id is null then
    raise exception 'Reopen request not found';
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select * into req from public.finance_lock_reopen_requests
    where org_id = p_org_id and id = p_request_id and status = 'pending'
    for update;
  if not found then
    raise exception 'Reopen request not found';
  end if;
  if req.requested_by = (select auth.uid()) then
    raise exception 'Another owner or admin must confirm this reopen.';
  end if;
  perform private.apply_finance_lock(p_org_id, req.lock_date, req.reason, req.requested_by, auth.uid());
  update public.finance_lock_reopen_requests
    set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
    where id = req.id;
  return jsonb_build_object('applied', true, 'lockDate', req.lock_date);
end;
$$;

revoke all on function public.confirm_finance_lock_reopen(uuid, uuid) from public, anon, service_role;
grant execute on function public.confirm_finance_lock_reopen(uuid, uuid) to authenticated;

create function public.cancel_finance_lock_reopen(p_org_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare req public.finance_lock_reopen_requests; actor text;
begin
  if not private.is_org_staff(p_org_id) then
    raise exception 'Only staff may change the finance lock date';
  end if;
  select * into req from public.finance_lock_reopen_requests
    where org_id = p_org_id and id = p_request_id and status = 'pending'
    for update;
  if not found then
    raise exception 'Reopen request not found';
  end if;
  update public.finance_lock_reopen_requests
    set status = 'cancelled', confirmed_by = auth.uid(), confirmed_at = now()
    where id = req.id;
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id,
      auth.uid(),
      actor,
      'organization',
      p_org_id,
      'finance_lock_reopen_cancelled',
      'Cancelled a finance lock reopen request',
      jsonb_build_object('requestId', req.id, 'reason', req.reason, 'lockDate', req.lock_date, 'kind', 'operational_lock')
    );
end;
$$;

revoke all on function public.cancel_finance_lock_reopen(uuid, uuid) from public, anon, service_role;
grant execute on function public.cancel_finance_lock_reopen(uuid, uuid) to authenticated;

create function public.list_finance_lock_reopen_requests(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_staff(p_org_id) then
    raise exception 'Only staff may change the finance lock date';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'requestedBy', r.requested_by,
      'requesterEmail', nullif(lower(btrim(u.email)), ''),
      'lockDate', r.lock_date,
      'previousLockDate', r.previous_lock_date,
      'reason', r.reason,
      'createdAt', r.created_at
    ) order by r.created_at)
    from public.finance_lock_reopen_requests r
    left join auth.users u on u.id = r.requested_by
    where r.org_id = p_org_id and r.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_finance_lock_reopen_requests(uuid) from public, anon, service_role;
grant execute on function public.list_finance_lock_reopen_requests(uuid) to authenticated;

create function public.find_support_export(p_org_id uuid, p_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare row_meta jsonb; row_summary text;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can check an export';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Enter a SHA-256 checksum.';
  end if;
  select meta, summary into row_meta, row_summary
    from public.audit_log
    where org_id = p_org_id and action = 'support_exported' and meta->>'sha256' = p_sha256
    order by created_at desc
    limit 1;
  if row_meta is null then
    return null;
  end if;
  return jsonb_build_object(
    'sha256', p_sha256,
    'kind', row_meta->>'kind',
    'period', row_meta->>'period',
    'bytes', row_meta->'bytes',
    'summary', row_summary
  );
end;
$$;

revoke all on function public.find_support_export(uuid, text) from public, anon, service_role;
grant execute on function public.find_support_export(uuid, text) to authenticated;

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
       'support_exported'
     ) then
    raise exception 'Reserved audit action requires its command';
  end if;
  return new;
end;
$$;
