-- Global model outputs are written by the service pipeline, not end users.
-- Preserve the existing public SELECT policy and privileged writer grants.
set local lock_timeout = '5s';
do $guard$
begin
  if not (select relrowsecurity from pg_class where oid='public.player_projected_stats'::regclass) then
    raise exception 'Expected RLS-enabled projection table';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
      and tablename='player_projected_stats' and policyname='Public can view player projected stats'
      and cmd='SELECT' and qual='true') then
    raise exception 'Expected public projection read policy';
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role' and rolbypassrls) then
    raise exception 'Expected privileged pipeline role';
  end if;
end
$guard$;

drop policy if exists "Authenticated users can manage player projected stats"
  on public.player_projected_stats;
revoke insert, update, delete on public.player_projected_stats from authenticated;

do $verify$
begin
  if has_table_privilege('authenticated','public.player_projected_stats','INSERT')
     or has_table_privilege('authenticated','public.player_projected_stats','UPDATE')
     or has_table_privilege('authenticated','public.player_projected_stats','DELETE') then
    raise exception 'Unexpected inherited end-user projection write grant';
  end if;
  if not has_table_privilege('authenticated','public.player_projected_stats','SELECT')
     or not has_table_privilege('anon','public.player_projected_stats','SELECT')
     or not has_table_privilege('service_role','public.player_projected_stats','INSERT,UPDATE,DELETE') then
    raise exception 'Read or pipeline access changed unexpectedly';
  end if;
end
$verify$;
