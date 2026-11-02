-- 2026-11-02 production slowdown: every open app reloaded the full snapshot every 10 seconds (~660 KB for an admin),
-- which wore out the small production database server. The app now asks this cheap question every 10 seconds and
-- loads the full snapshot only when the revision changed (or every 2 minutes, and when the app comes back to the
-- front). Returns only the revision number; signed-in users only. Safe to run more than once.
create or replace function public.ops_revision() returns integer language sql stable
security definer set search_path = '' as $$
  select revision from public.ops_state where id = 1 and auth.uid() is not null;
$$;
revoke all on function public.ops_revision() from public, anon;
grant execute on function public.ops_revision() to authenticated;
