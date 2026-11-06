-- Network visibility stores metadata snapshots, never packet contents or credentials.
create table public.network_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_received_at timestamptz,
  latest_captured_at timestamptz,
  latest_report jsonb,
  check ((latest_report is null and latest_captured_at is null and last_received_at is null)
    or (latest_report is not null and latest_captured_at is not null and last_received_at is not null))
);
create index network_devices_org_idx on public.network_devices(org_id);

-- inet accepts CIDRs with host bits set; preserve the explicit policy as entered.
create function private.network_cidrs_valid(values_to_check text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare item text;
begin
  if values_to_check is null then return false; end if;
  foreach item in array values_to_check loop
    if item is null or item !~ '^[0-9A-Fa-f:.]+/[0-9]{1,3}$' then return false; end if;
    perform item::inet;
  end loop;
  return true;
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function private.network_cidrs_valid(text[]) from public, anon;
grant execute on function private.network_cidrs_valid(text[]) to authenticated, service_role;
-- An empty policy means unknown, not implicitly trusted private IPs.
create table public.network_policy (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  allowed_cidrs text[] not null default '{}' check (
    cardinality(allowed_cidrs) <= 100 and private.network_cidrs_valid(allowed_cidrs)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.network_devices enable row level security;
alter table public.network_devices force row level security;
alter table public.network_policy enable row level security;
alter table public.network_policy force row level security;
revoke all on public.network_devices, public.network_policy from public, anon, authenticated;
grant all on public.network_devices, public.network_policy to service_role;

-- The hash is not readable even by a session with owner/admin access.
grant select (id, org_id, name, created_by, created_at, revoked_at, last_received_at, latest_captured_at, latest_report)
  on public.network_devices to authenticated;
grant insert (org_id, name, created_by, token_hash) on public.network_devices to authenticated;
grant update (revoked_at) on public.network_devices to authenticated;
create policy network_devices_read on public.network_devices for select to authenticated
  using (private.is_org_staff(org_id));
create policy network_devices_enroll on public.network_devices for insert to authenticated
  with check (private.is_org_staff(org_id) and created_by = (select auth.uid()));
create policy network_devices_revoke on public.network_devices for update to authenticated
  using (private.is_org_staff(org_id) and revoked_at is null)
  with check (private.is_org_staff(org_id) and revoked_at is not null);

grant select on public.network_policy to authenticated;
grant insert (org_id, allowed_cidrs, updated_by), update (allowed_cidrs, updated_by, updated_at)
  on public.network_policy to authenticated;
create policy network_policy_read on public.network_policy for select to authenticated
  using (private.is_org_staff(org_id));
create policy network_policy_insert on public.network_policy for insert to authenticated
  with check (private.is_org_staff(org_id) and updated_by = (select auth.uid()));
create policy network_policy_update on public.network_policy for update to authenticated
  using (private.is_org_staff(org_id))
  with check (private.is_org_staff(org_id) and updated_by = (select auth.uid()));

-- Explicit conflict columns avoid granting UPDATE of the workspace identity.
create function public.set_network_policy(p_org_id uuid, p_allowed_cidrs text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Forbidden'; end if;
  insert into public.network_policy(org_id, allowed_cidrs, updated_by)
    values(p_org_id, p_allowed_cidrs, (select auth.uid()))
    on conflict(org_id) do update set allowed_cidrs = excluded.allowed_cidrs,
      updated_by = excluded.updated_by, updated_at = clock_timestamp();
end;
$$;
revoke all on function public.set_network_policy(uuid, text[]) from public, anon, service_role;
grant execute on function public.set_network_policy(uuid, text[]) to authenticated;

-- A single conditional UPDATE serializes against revocation and other reports.
-- A revoke that wins the row lock prevents ingestion; an ingestion that wins
-- finishes before the revoke. Replayed/backward capture times cannot overwrite.
create function public.ingest_network_report(
  p_device_id uuid, p_org_id uuid, p_token_hash text, p_captured_at timestamptz, p_report jsonb
) returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare received_at timestamptz := clock_timestamp(); accepted_at timestamptz;
begin
  if p_captured_at is null or not isfinite(p_captured_at)
    or p_captured_at > received_at + interval '60 seconds'
    or p_captured_at < received_at - interval '5 minutes'
    or p_report is null or jsonb_typeof(p_report) <> 'object' then
    return null;
  end if;
  update public.network_devices
    set latest_report = p_report, latest_captured_at = p_captured_at, last_received_at = received_at
    where id = p_device_id and org_id = p_org_id and token_hash = p_token_hash
      and revoked_at is null
      and (latest_captured_at is null or latest_captured_at < p_captured_at)
    returning last_received_at into accepted_at;
  return accepted_at;
end;
$$;
revoke all on function public.ingest_network_report(uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_network_report(uuid, uuid, text, timestamptz, jsonb)
  to service_role;
