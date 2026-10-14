-- Explicitly approved POC data update; run against staging before production.
-- This prepares roster emails only. It creates no Auth users and sends no mail.
do $$
declare
  person record;
  parts text[];
  address text;
  changed integer := 0;
begin
  -- Serialize with normal roster writes and invalidate stale open editors once.
  perform 1 from public.ops_state where id=1 for update;
  for person in
    select p.* from public.people p
    where not p.archived
      and not exists(select 1 from public.access_invites i where i.person_id=p.id)
    order by p.id
  loop
    if exists(select 1 from public.profiles f where f.person_id=person.id) then
      raise exception 'A person without a roster email already has a login profile; review manually.';
    end if;
    parts := regexp_split_to_array(regexp_replace(btrim(person.name),
      '^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?)[[:space:]]+', '', 'i'), '[[:space:]]+');
    if cardinality(parts)<2 or parts[1] !~ '^[A-Za-z]' then
      raise exception 'Cannot derive a first initial and last name for person %.', person.id;
    end if;
    address := lower(left(parts[1],1) || regexp_replace(parts[cardinality(parts)], '[^A-Za-z0-9]', '', 'g'));
    if length(address)<2 then raise exception 'Invalid generated address for person %.',person.id; end if;
    address := address || '@epieventstest.com';
    if exists(select 1 from public.access_invites i where i.email=address)
      or exists(select 1 from auth.users u where lower(u.email)=address) then
      raise exception 'Generated test address collision: %. No changes were saved.', address;
    end if;
    insert into public.access_invites(email,role,person_id)
      values(address,person.account_type,person.id);
    changed := changed+1;
  end loop;
  if changed>0 then
    insert into public.activity_log(action,details)
      values('Added test roster emails',jsonb_build_object('people',changed,'domain','epieventstest.com'));
    update public.ops_state set revision=revision+1 where id=1;
  end if;
end;
$$;
