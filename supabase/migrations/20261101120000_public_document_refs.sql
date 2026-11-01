-- Optional typed public document references (issue #34).
-- The flag defaults to false. Existing quote, invoice, purchase-order, and
-- stock-document numbers, tax IDs, and links are not modified.

begin;

alter table public.org_settings
  add column public_document_refs_enabled boolean not null default false;

comment on column public.org_settings.public_document_refs_enabled is
  'When false, typed public document references cannot be issued. Tax IDs, accounting numbers, and document links stay unchanged.';

create table public.document_public_refs (
  org_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  kind text not null check (kind in ('quote', 'purchase_order', 'receipt', 'delivery', 'invoice')),
  record_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (org_id, reference),
  unique (org_id, kind, record_id),
  check (reference ~ '^(quo|po|grn|dlv|inv)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20}$'),
  check (
    (kind = 'quote' and reference like 'quo1%')
    or (kind = 'purchase_order' and reference like 'po1%')
    or (kind = 'receipt' and reference like 'grn1%')
    or (kind = 'delivery' and reference like 'dlv1%')
    or (kind = 'invoice' and reference like 'inv1%')
  )
);

comment on table public.document_public_refs is
  'Optional public codes for manual lookup. Application code checks the Bech32m checksum before insert and on every lookup. The checksum is not authorization.';

create function private.document_public_ref_target_exists(p_org_id uuid, p_kind text, p_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'quote' then exists (select 1 from public.quotes where org_id = p_org_id and id = p_record_id)
    when 'invoice' then exists (select 1 from public.invoices where org_id = p_org_id and id = p_record_id)
    when 'purchase_order' then exists (select 1 from public.purchase_orders where org_id = p_org_id and id = p_record_id)
    when 'receipt' then exists (select 1 from public.stock_documents where org_id = p_org_id and id = p_record_id and kind = 'receipt')
    when 'delivery' then exists (select 1 from public.stock_documents where org_id = p_org_id and id = p_record_id and kind = 'delivery')
    else false
  end;
$$;

revoke all on function private.document_public_ref_target_exists(uuid, text, uuid) from public, anon, authenticated;

create function private.guard_document_public_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Public document references are immutable';
  end if;
  if not exists (
    select 1 from public.org_settings
    where org_id = new.org_id and public_document_refs_enabled
  ) then
    raise exception 'Public document references are disabled';
  end if;
  if not private.document_public_ref_target_exists(new.org_id, new.kind, new.record_id) then
    raise exception 'Document unavailable';
  end if;
  if auth.uid() is not null then
    if new.created_by is null then
      new.created_by := auth.uid();
    elsif new.created_by is distinct from auth.uid() then
      raise exception 'Public reference actor mismatch';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_document_public_ref() from public, anon, authenticated;

create trigger guard_document_public_ref
  before insert or update on public.document_public_refs
  for each row execute function private.guard_document_public_ref();

alter table public.document_public_refs enable row level security;
alter table public.document_public_refs force row level security;
revoke all on public.document_public_refs from public, anon, authenticated;
grant select, insert on public.document_public_refs to authenticated;

create policy tenant_read on public.document_public_refs
  for select to authenticated
  using (private.is_org_member(org_id));

create policy tenant_insert on public.document_public_refs
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and exists (
      select 1 from public.org_settings
      where org_id = document_public_refs.org_id
        and public_document_refs_enabled
    )
  );

commit;
