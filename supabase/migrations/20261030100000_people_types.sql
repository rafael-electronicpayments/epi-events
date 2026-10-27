-- 2026-10-27 owner request (People › Type): "Contractor" is shown as "Event Staff" (the stored value stays
-- 'contractor', so existing people, logins and permissions are unchanged), and two new types, Speaker and Panelist.
-- Speakers and Panelists work like Event Staff: they can sign in and see only what they are assigned to (their own
-- schedule, Session Support cards, travel, documents shared with them); they can't be team leads. Run exactly once.

alter table public.people drop constraint people_account_type_check,
  add constraint people_account_type_check check (account_type in ('admin', 'staff', 'contractor', 'speaker', 'panelist'));
alter table public.profiles drop constraint profiles_role_check,
  add constraint profiles_role_check check (role in ('admin', 'staff', 'contractor', 'speaker', 'panelist'));
alter table public.access_invites drop constraint access_invites_role_check,
  add constraint access_invites_role_check check (role in ('admin', 'staff', 'contractor', 'speaker', 'panelist'));

-- Saving a person accepts the new types (CREATE OR REPLACE keeps its grants and security settings).
do $$
declare def text;
begin
  def := pg_get_functiondef('public.ops_save_person(integer, jsonb, integer)'::regprocedure);
  if position('''contractor'',''speaker''' in def) = 0 then
    def := replace(def, 'v_type not in (''admin'',''staff'',''contractor'')', 'v_type not in (''admin'',''staff'',''contractor'',''speaker'',''panelist'')');
    def := replace(def, 'Choose Admin, Staff, or Contractor.', 'Choose Admin, Staff, Event Staff, Speaker, or Panelist.');
    if position('''speaker'',''panelist''' in def) = 0 then raise exception 'ops_save_person was not in the expected form; nothing changed.'; end if;
    execute def;
  end if;
end;
$$;
