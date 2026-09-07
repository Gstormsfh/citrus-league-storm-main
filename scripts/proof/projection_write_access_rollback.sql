-- Emergency manual rollback ONLY: restores the prior insecure direct-write access.
begin;
set local lock_timeout='5s';
grant insert, update, delete on public.player_projected_stats to authenticated;
create policy "Authenticated users can manage player projected stats"
on public.player_projected_stats for all to public
using ((select auth.role())='authenticated'::text)
with check ((select auth.role())='authenticated'::text);
commit;
