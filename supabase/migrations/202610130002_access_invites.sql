-- Trusted invitations provision app access when an Auth user is created.
-- Login remains invite-only: no browser can write this allowlist.
create table public.access_invites (
  email text primary key check (email = lower(btrim(email))),
  role text not null check (role in ('admin','staff','contractor')),
  person_id integer unique references public.people(id),
  check (role = 'admin' or person_id is not null)
);
alter table public.access_invites enable row level security;
create policy invites_admin_read on public.access_invites for select to authenticated using (ops_private.is_admin());
revoke all on public.access_invites from anon, authenticated;
grant select on public.access_invites to authenticated;

create function ops_private.provision_user() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id,role,person_id)
    select new.id,i.role,i.person_id from public.access_invites i
    where i.email=lower(new.email)
    on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function ops_private.provision_user() from public, anon, authenticated;
create trigger event_ops_provision_user after insert on auth.users
  for each row execute function ops_private.provision_user();
