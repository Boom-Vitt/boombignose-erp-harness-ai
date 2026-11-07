-- profiles has no org_id and no PostgREST membership relationship. Join explicitly
-- instead of relying on shares_org, which also permits profiles in other workspaces.
-- SECURITY INVOKER keeps both profile and membership RLS/column grants unchanged.
-- In particular, non-staff see only their session-visible membership/profile.
create function public.assistant_workspace_profiles(p_org_id uuid)
returns table (
  id uuid,
  full_name text,
  locale text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.full_name, p.locale, p.created_at, p.updated_at
  from public.profiles p
  where private.is_org_member(p_org_id)
    and exists (
      select 1 from public.memberships m
      where m.org_id = p_org_id and m.user_id = p.id
    );
$$;

revoke all on function public.assistant_workspace_profiles(uuid) from public, anon, service_role;
grant execute on function public.assistant_workspace_profiles(uuid) to authenticated;
