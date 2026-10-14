-- Supabase may install this event-trigger helper in the exposed public schema.
-- Event triggers do not need API callers to have EXECUTE permission.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
