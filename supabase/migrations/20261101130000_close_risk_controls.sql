-- Operational close controls. A completed month can be locked only through its
-- last day, a future lock date is refused, and a reopen is a separate audit
-- action. Support-file checksums are recorded by command. None of this files
-- ภ.พ.30, sends e-Tax, or posts a statutory ledger.

create or replace function public.update_finance_lock_date(p_org_id uuid, p_lock_date date)
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
    next_summary := 'Reopened the finance lock';
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
      jsonb_build_object('lockDate', p_lock_date, 'previousLockDate', current_lock, 'kind', 'operational_lock')
    );
end;
$$;

create function public.close_completed_month(p_org_id uuid, p_month text)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  year int;
  mon int;
  period_end date;
  today date := (now() at time zone 'Asia/Bangkok')::date;
  current_lock date;
  actor text;
begin
  if not private.is_org_staff(p_org_id) then
    raise exception 'Only staff may change the finance lock date';
  end if;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'Enter a month as YYYY-MM.';
  end if;
  year := substring(p_month from 1 for 4)::int;
  mon := substring(p_month from 6 for 2)::int;
  if mon < 1 or mon > 12 or year < 1900 or year > 9999 then
    raise exception 'Enter a month as YYYY-MM.';
  end if;
  period_end := (make_date(year, mon, 1) + interval '1 month' - interval '1 day')::date;
  if period_end >= today then
    raise exception 'Close a completed month. The current month stays open.';
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select lock_date into current_lock from public.org_settings where org_id = p_org_id for update;
  if current_lock is not null and current_lock >= period_end then
    raise exception 'That month is already closed.';
  end if;
  insert into public.org_settings(org_id, lock_date) values (p_org_id, period_end)
    on conflict (org_id) do update set lock_date = excluded.lock_date;
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id,
      auth.uid(),
      actor,
      'organization',
      p_org_id,
      'period_closed',
      'Closed operational month ' || p_month,
      jsonb_build_object('month', p_month, 'lockDate', period_end, 'previousLockDate', current_lock, 'kind', 'operational_close')
    );
  return period_end;
end;
$$;

revoke all on function public.close_completed_month(uuid, text) from public, anon, service_role;
grant execute on function public.close_completed_month(uuid, text) to authenticated;

create function public.record_support_export(
  p_org_id uuid,
  p_kind text,
  p_period text,
  p_sha256 text,
  p_bytes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text;
  mon int;
  day int;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can record a support export';
  end if;
  if p_kind is null or p_kind not in ('accountant_pack_csv', 'accountant_pack_print', 'outstanding_pack_csv') then
    raise exception 'Unknown support export';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Support export checksum is not SHA-256';
  end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > 50000000 then
    raise exception 'Support export size is not valid';
  end if;
  if p_period is null or p_period !~ '^\d{4}-\d{2}(-\d{2})?$' then
    raise exception 'Support export period is not valid';
  end if;
  mon := substring(p_period from 6 for 2)::int;
  if mon < 1 or mon > 12 then
    raise exception 'Support export period is not valid';
  end if;
  if char_length(p_period) = 10 then
    day := substring(p_period from 9 for 2)::int;
    begin
      perform make_date(substring(p_period from 1 for 4)::int, mon, day);
    exception
      when others then
        raise exception 'Support export period is not valid';
    end;
  end if;
  perform 1 from public.organizations where id = p_org_id for update;
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
    values (
      p_org_id,
      auth.uid(),
      actor,
      'report',
      p_org_id,
      'support_exported',
      'Exported ' || p_kind || ' for ' || p_period || '. SHA-256 ' || p_sha256 || '. Support data only. Not a Revenue Department filing.',
      jsonb_build_object('kind', p_kind, 'period', p_period, 'sha256', p_sha256, 'bytes', p_bytes, 'filing', false)
    );
end;
$$;

revoke all on function public.record_support_export(uuid, text, text, text, integer) from public, anon, service_role;
grant execute on function public.record_support_export(uuid, text, text, text, integer) to authenticated;

-- The trigger function is not security definer. current_user stays the
-- caller, so a security-definer command can insert these actions and a
-- signed-in session cannot.
create function private.guard_close_audit_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'service_role')
     and new.action in ('finance_lock_updated', 'finance_lock_reopened', 'period_closed', 'support_exported') then
    raise exception 'Reserved audit action requires its command';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_close_audit_event() from public, anon, authenticated, service_role;

create trigger guard_close_audit_event
  before insert on public.audit_log
  for each row execute function private.guard_close_audit_event();
