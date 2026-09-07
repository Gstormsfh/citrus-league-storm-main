-- Run after migration. No business row is changed; transaction always rolls back.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select player_id from public.player_projected_stats limit 1;
do $test$
begin
  begin
    update public.player_projected_stats set projected_goals=projected_goals where false;
    raise exception 'Authenticated UPDATE unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.player_projected_stats where false;
    raise exception 'Authenticated DELETE unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.player_projected_stats(player_id,game_id,projection_date)
      select player_id,game_id,projection_date from public.player_projected_stats where false;
    raise exception 'Authenticated INSERT unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end
$test$;
reset role;
set local role anon;
select player_id from public.player_projected_stats limit 1;
reset role;
set local role service_role;
update public.player_projected_stats set projected_goals=projected_goals where false;
delete from public.player_projected_stats where false;
insert into public.player_projected_stats(player_id,game_id,projection_date)
  select player_id,game_id,projection_date from public.player_projected_stats where false;
reset role;
rollback;
select true as access_regression_passed;
