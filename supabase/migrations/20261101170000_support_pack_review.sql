-- A finance user can record that they looked at one stored support file.
-- The mark names that person, the time, and the checksum. It is not a
-- statutory sign-off and not a filing. The row joins the close-activity chain.

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
    'support_pack_reviewed'
  );
$$;

create or replace function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount','note'];
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
       'support_pack_reviewed'
     ) then
    raise exception 'Reserved audit action requires its command';
  end if;
  return new;
end;
$$;

create function public.review_support_pack(p_org_id uuid, p_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  src jsonb;
  existing uuid;
  actor text;
  kind text;
  period text;
  bytes integer;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can review a support file';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Enter a SHA-256 checksum.';
  end if;
  select id into existing
    from public.audit_log
    where org_id = p_org_id and action = 'support_pack_reviewed' and actor_id = (select auth.uid()) and meta->>'sha256' = p_sha256
    limit 1;
  if existing is not null then
    return jsonb_build_object('already', true, 'id', existing);
  end if;
  select meta into src
    from public.audit_log
    where org_id = p_org_id and action = 'support_exported' and meta->>'sha256' = p_sha256
    order by created_at desc
    limit 1;
  if src is null then
    raise exception 'No stored support export has this checksum.';
  end if;
  kind := src->>'kind';
  period := src->>'period';
  if src ? 'bytes' and jsonb_typeof(src->'bytes') = 'number' then
    bytes := (src->>'bytes')::integer;
  end if;
  select nullif(lower(btrim(u.email)), '') into actor from auth.users u where u.id = (select auth.uid());
  begin
    insert into public.audit_log(org_id, actor_id, actor_email, entity, entity_id, action, summary, meta)
      values (
        p_org_id,
        auth.uid(),
        actor,
        'report',
        p_org_id,
        'support_pack_reviewed',
        'Reviewed support file ' || coalesce(kind, 'export') || ' for ' || coalesce(period, 'unknown') || '. SHA-256 ' || p_sha256 || '. This is not a statutory sign-off and not a filing.',
        jsonb_strip_nulls(jsonb_build_object(
          'sha256', p_sha256,
          'kind', kind,
          'period', period,
          'bytes', bytes,
          'filing', false
        ))
      )
      returning id into existing;
  exception when unique_violation then
    select id into existing
      from public.audit_log
      where org_id = p_org_id and action = 'support_pack_reviewed' and actor_id = (select auth.uid()) and meta->>'sha256' = p_sha256
      limit 1;
    return jsonb_build_object('already', true, 'id', existing);
  end;
  return jsonb_build_object('already', false, 'id', existing);
end;
$$;

revoke all on function public.review_support_pack(uuid, text) from public, anon, service_role;
grant execute on function public.review_support_pack(uuid, text) to authenticated;

create unique index support_pack_review_once
  on public.audit_log (org_id, actor_id, (meta->>'sha256'))
  where action = 'support_pack_reviewed';
