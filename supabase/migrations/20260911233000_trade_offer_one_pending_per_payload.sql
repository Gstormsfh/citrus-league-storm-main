-- Duplicate pending trade offers (2026-09-11)
--
-- A double tap on PROPOSE TRADE created two identical pending offers 455 ms
-- apart in production (23:24:27.172 and 23:24:27.628, same league, same two
-- teams, same players). trade_offers had no uniqueness beyond its primary key
-- and TradeService.createTradeOffer inserted without looking, so both landed
-- and the recipient saw the same trade twice.
--
-- Two parts, in order:
--   1. Cancel the duplicates already sitting in the table, keeping the first
--      of each identical pending set -- the one the manager meant to send.
--      Without this the index below cannot be created.
--   2. A partial unique index so a concurrent pair can never both land again.
--      Array equality is order-sensitive, which is what a double submit needs:
--      both requests carry the same payload in the same order. A genuinely
--      re-thought offer differs in players, and a re-sent identical offer is
--      already answered by the pending one.

with ranked as (
  select id,
         row_number() over (
           partition by league_id, from_team_id, to_team_id,
                        offered_player_ids, requested_player_ids
           order by created_at, id
         ) as rn
    from public.trade_offers
   where status = 'pending'
)
update public.trade_offers t
   set status = 'cancelled',
       updated_at = now()
  from ranked r
 where t.id = r.id
   and r.rn > 1;

create unique index if not exists trade_offers_one_pending_per_payload
    on public.trade_offers (league_id, from_team_id, to_team_id,
                            offered_player_ids, requested_player_ids)
 where status = 'pending';
