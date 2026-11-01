-- A close note says why an unmatched statement line is not a customer receipt.
-- It does not match a receipt, post a journal, or file VAT.
-- Matching still goes through match_bank_line. A trigger clears the note so
-- this migration does not replace that function.

alter table public.bank_lines add column close_note text;
alter table public.bank_lines add constraint bank_lines_close_note_text
  check (close_note is null or (char_length(close_note) between 1 and 200 and close_note = btrim(close_note)));
comment on column public.bank_lines.close_note is
  'Why an unmatched statement line is not a customer receipt. Not a match and not a journal.';

create function private.clear_bank_close_note()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.matched_payment_id is not null then
    new.close_note := null;
  end if;
  return new;
end;
$$;

create trigger bank_lines_clear_close_note
  before update on public.bank_lines
  for each row execute function private.clear_bank_close_note();

create function public.note_bank_line(p_org_id uuid, p_line_id uuid, p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare line public.bank_lines; note text;
begin
  if not private.is_org_staff(p_org_id) and not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = (select auth.uid())
      and role::text = 'accountant'
  ) then
    raise exception 'Only staff may note a bank line';
  end if;
  select * into line from public.bank_lines where org_id = p_org_id and id = p_line_id for update;
  if not found then raise exception 'Bank line not found'; end if;
  if line.matched_payment_id is not null then raise exception 'Matched bank line does not take a close note'; end if;
  note := nullif(btrim(coalesce(p_note, '')), '');
  if note is not null and char_length(note) > 200 then raise exception 'Close note is too long'; end if;
  update public.bank_lines set close_note = note where org_id = p_org_id and id = p_line_id;
end;
$$;

revoke all on function public.note_bank_line(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.note_bank_line(uuid, uuid, text) to authenticated;
