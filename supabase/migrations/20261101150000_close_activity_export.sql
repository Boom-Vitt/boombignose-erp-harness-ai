-- The close activity file uses the same checksum command as the other
-- support downloads. It is not a filing.

create or replace function public.record_support_export(
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
  if p_kind is null or p_kind not in ('accountant_pack_csv', 'accountant_pack_print', 'outstanding_pack_csv', 'close_activity_csv') then
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
