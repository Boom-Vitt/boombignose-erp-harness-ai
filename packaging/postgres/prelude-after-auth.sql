-- Roles, migration bookkeeping, and a storage stub for a cluster whose
-- auth schema was created by the bundled Auth server (GoTrue).
-- Do not create auth.users or replace auth.uid(); Auth owns those.
create extension if not exists pgcrypto;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to authenticated, service_role;

-- Auth's migration runner owns public.schema_migrations (a version column).
-- ERP filenames are recorded here so the two books do not collide.
create table if not exists public.erp_schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

-- ERP migrations run as this cluster's migration owner, not Supabase's
-- managed postgres role. Install the platform defaults before creating tables
-- so each migration's narrower REVOKE/column GRANT remains authoritative.
-- Anonymous clients receive no default access to business data.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- Stub so the attachment migration can record a bucket. This is not Supabase Storage.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner_id text
);

grant usage on schema storage to authenticated, service_role;
