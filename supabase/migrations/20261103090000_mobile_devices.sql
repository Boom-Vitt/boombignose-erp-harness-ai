-- Mobile pairing: one-time QR tokens and the devices they link.
-- Only SHA-256 hashes of tokens are stored. RLS is on with no policies, so only the
-- server (service role, after an owner/admin check) can read or write these tables.

create table public.mobile_pairings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index mobile_devices_org_idx on public.mobile_devices(org_id);

alter table public.mobile_pairings enable row level security;
alter table public.mobile_devices enable row level security;
revoke all on public.mobile_pairings, public.mobile_devices from anon, authenticated;
