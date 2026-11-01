-- Each close-activity row stores the SHA-256 of the previous row.
-- A missing or edited row breaks verify_close_activity_chain.
-- The database owner can disable the trigger and rewrite the head.
-- This is not the export-file checksum, not an external timestamp, and not a filing.

alter table public.audit_log add column close_chain_seq integer;
alter table public.audit_log add column close_chain_prev text;
alter table public.audit_log add column close_chain_sha256 text;
alter table public.audit_log add constraint audit_log_close_chain_sha
  check (close_chain_sha256 is null or close_chain_sha256 ~ '^[a-f0-9]{64}$');
alter table public.audit_log add constraint audit_log_close_chain_seq
  check (close_chain_seq is null or close_chain_seq > 0);

alter table public.org_settings add column close_chain_head text;
alter table public.org_settings add column close_chain_seq integer not null default 0;
alter table public.org_settings add constraint org_settings_close_chain_seq check (close_chain_seq >= 0);
alter table public.org_settings add constraint org_settings_close_chain_head
  check (close_chain_head is null or close_chain_head ~ '^[a-f0-9]{64}$');

create index audit_log_close_chain_idx
  on public.audit_log (org_id, close_chain_seq)
  where close_chain_sha256 is not null;

create function private.close_activity_action(p_action text)
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
    'support_exported'
  );
$$;

revoke all on function private.close_activity_action(text) from public, anon, authenticated, service_role;

create function private.close_chain_escape(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(coalesce(p_text, ''), '\', '\\'), E'\n', '\n');
$$;

revoke all on function private.close_chain_escape(text) from public, anon, authenticated, service_role;

create function private.close_chain_meta(p_meta jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['lockDate','previousLockDate','month','reason','kind','period','sha256','bytes','filing','requestId','requestedBy','confirmedBy','staffCount'];
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

revoke all on function private.close_chain_meta(jsonb) from public, anon, authenticated, service_role;

create function private.close_chain_payload(
  p_org_id uuid,
  p_id uuid,
  p_recorded_at text,
  p_action text,
  p_actor_id uuid,
  p_summary text,
  p_prev text,
  p_meta jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'v1' || E'\n'
    || p_org_id::text || E'\n'
    || p_id::text || E'\n'
    || p_recorded_at || E'\n'
    || p_action || E'\n'
    || coalesce(p_actor_id::text, '') || E'\n'
    || private.close_chain_escape(p_summary) || E'\n'
    || coalesce(p_prev, '') || E'\n'
    || private.close_chain_meta(p_meta);
$$;

revoke all on function private.close_chain_payload(uuid, uuid, text, text, uuid, text, text, jsonb) from public, anon, authenticated, service_role;

create function private.close_chain_sha256(p_payload text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare schema_name text; hashed text;
begin
  if to_regprocedure('public.digest(bytea, text)') is not null then
    schema_name := 'public';
  elsif to_regprocedure('extensions.digest(bytea, text)') is not null then
    schema_name := 'extensions';
  else
    raise exception 'SHA-256 is not available';
  end if;
  execute format('select encode(%I.digest(convert_to($1, %L), %L), %L)', schema_name, 'UTF8', 'sha256', 'hex')
    into hashed
    using p_payload;
  return hashed;
end;
$$;

revoke all on function private.close_chain_sha256(text) from public, anon, authenticated, service_role;

create function private.close_chain_recorded_at(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

revoke all on function private.close_chain_recorded_at(timestamptz) from public, anon, authenticated, service_role;

create function private.close_chain_apply(
  p_org_id uuid,
  p_id uuid,
  p_recorded_at timestamptz,
  p_action text,
  p_actor_id uuid,
  p_summary text,
  p_meta jsonb,
  p_prev text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.close_chain_sha256(private.close_chain_payload(
    p_org_id, p_id, private.close_chain_recorded_at(p_recorded_at), p_action, p_actor_id, p_summary, p_prev, p_meta
  ));
$$;

revoke all on function private.close_chain_apply(uuid, uuid, timestamptz, text, uuid, text, jsonb, text) from public, anon, authenticated, service_role;

-- Link rows that already exist, oldest first, before the insert trigger.
do $$
declare
  org uuid;
  rec record;
  prev text;
  seq integer;
  hashed text;
begin
  for org in
    select distinct a.org_id from public.audit_log a where private.close_activity_action(a.action)
  loop
    prev := '';
    seq := 0;
    for rec in
      select id, created_at, action, actor_id, summary, meta
      from public.audit_log
      where org_id = org and private.close_activity_action(action)
      order by created_at, id
    loop
      seq := seq + 1;
      hashed := private.close_chain_apply(org, rec.id, rec.created_at, rec.action, rec.actor_id, rec.summary, rec.meta, prev);
      update public.audit_log
        set close_chain_seq = seq, close_chain_prev = prev, close_chain_sha256 = hashed
        where id = rec.id;
      prev := hashed;
    end loop;
    insert into public.org_settings(org_id, close_chain_head, close_chain_seq)
      values (org, nullif(prev, ''), seq)
      on conflict (org_id) do update
        set close_chain_head = excluded.close_chain_head, close_chain_seq = excluded.close_chain_seq;
  end loop;
end $$;

create function private.assign_close_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare prev text := ''; seq integer := 0; hashed text;
begin
  if not private.close_activity_action(new.action) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.org_id::text));
  select close_chain_seq, close_chain_sha256 into seq, prev
    from public.audit_log
    where org_id = new.org_id and close_chain_sha256 is not null
    order by close_chain_seq desc
    limit 1
    for update;
  seq := coalesce(seq, 0) + 1;
  prev := coalesce(prev, '');
  hashed := private.close_chain_apply(new.org_id, new.id, new.created_at, new.action, new.actor_id, new.summary, new.meta, prev);
  new.close_chain_seq := seq;
  new.close_chain_prev := prev;
  new.close_chain_sha256 := hashed;
  insert into public.org_settings(org_id, close_chain_head, close_chain_seq)
    values (new.org_id, hashed, seq)
    on conflict (org_id) do update
      set close_chain_head = excluded.close_chain_head, close_chain_seq = excluded.close_chain_seq;
  return new;
end;
$$;

revoke all on function private.assign_close_chain() from public, anon, authenticated, service_role;

create trigger audit_close_chain_before_insert
  before insert on public.audit_log
  for each row execute function private.assign_close_chain();

create function private.block_close_chain_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.close_chain_sha256 is not null then
    raise exception 'Close-activity chain rows cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function private.block_close_chain_update() from public, anon, authenticated, service_role;

create trigger audit_close_chain_block_update
  before update on public.audit_log
  for each row execute function private.block_close_chain_update();

create function public.verify_close_activity_chain(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rec record;
  expected_seq integer := 0;
  previous text := '';
  hashed text;
  head text;
  head_seq integer := 0;
  uncovered uuid;
begin
  if not private.is_org_finance(p_org_id) then
    raise exception 'Only owners, admins, and accountants can check the close chain';
  end if;
  select id into uncovered
    from public.audit_log
    where org_id = p_org_id and private.close_activity_action(action) and close_chain_sha256 is null
    order by created_at, id
    limit 1;
  if uncovered is not null then
    return jsonb_build_object(
      'ok', false,
      'checked', 0,
      'reason', 'มีแถวปิดงวดที่ยังไม่ถูกผูกโซ่ / Some close-activity rows are not in the chain.',
      'brokenAt', uncovered
    );
  end if;
  for rec in
    select id, created_at, action, actor_id, summary, meta, close_chain_seq, close_chain_prev, close_chain_sha256
    from public.audit_log
    where org_id = p_org_id and close_chain_sha256 is not null
    order by close_chain_seq, id
  loop
    expected_seq := expected_seq + 1;
    if rec.close_chain_seq is distinct from expected_seq or rec.close_chain_prev is distinct from previous then
      return jsonb_build_object(
        'ok', false,
        'checked', expected_seq - 1,
        'reason', 'มีแถวปิดงวดหายไปก่อนแถวนี้ / A close-activity row is missing before this one.',
        'brokenAt', rec.id
      );
    end if;
    hashed := private.close_chain_apply(p_org_id, rec.id, rec.created_at, rec.action, rec.actor_id, rec.summary, rec.meta, rec.close_chain_prev);
    if hashed is distinct from rec.close_chain_sha256 then
      return jsonb_build_object(
        'ok', false,
        'checked', expected_seq - 1,
        'reason', 'แถวนี้ถูกแก้หลังจากบันทึก / This close-activity row was changed after it was written.',
        'brokenAt', rec.id
      );
    end if;
    previous := rec.close_chain_sha256;
  end loop;
  select close_chain_head, close_chain_seq into head, head_seq
    from public.org_settings where org_id = p_org_id;
  if coalesce(head_seq, 0) is distinct from expected_seq or coalesce(head, '') is distinct from previous then
    return jsonb_build_object(
      'ok', false,
      'checked', expected_seq,
      'reason', 'แถวล่าสุดไม่ตรงกับหัวโซ่ที่เก็บไว้ / The latest close-activity row does not match the stored chain head.',
      'brokenAt', null
    );
  end if;
  return jsonb_build_object('ok', true, 'checked', expected_seq, 'reason', null, 'brokenAt', null);
end;
$$;

revoke all on function public.verify_close_activity_chain(uuid) from public, anon, service_role;
grant execute on function public.verify_close_activity_chain(uuid) to authenticated;
