-- Overview pubblica della lega: permette a chi ha il codice invito (QR)
-- di vedere nome/stato/prima entrata prima dell'autenticazione.
create or replace function public.get_league_overview(invite text)
returns table (
  id uuid,
  name text,
  status public.league_status,
  participant_limit smallint,
  initial_budget integer,
  min_bid integer,
  participant_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.status, l.participant_limit, l.initial_budget, l.min_bid,
    (select count(*) from public.participants p where p.league_id = l.id)
  from public.leagues l
  where l.invite_code = upper(invite);
$$;

grant execute on function public.get_league_overview(text) to anon, authenticated;

-- Ripristina un giocatore AVAILABLE annullando l'asta attiva (correzione admin).
create or replace function public.cancel_auction(target_auction uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auction public.auctions;
begin
  select * into current_auction from public.auctions where id = target_auction for update;
  if current_auction.id is null then raise exception 'Asta inesistente'; end if;
  if not (select private.is_league_owner(current_auction.league_id)) then raise exception 'Solo admin'; end if;
  if current_auction.status <> 'ACTIVE' then raise exception 'L asta non e attiva'; end if;

  delete from public.bids where auction_id = current_auction.id;
  update public.players set status = 'AVAILABLE' where id = current_auction.player_id and status = 'NOMINATED';
  update public.auctions set status = 'CANCELLED', highest_bidder_id = null, completed_at = now(), version = version + 1
    where id = current_auction.id;
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
    values (current_auction.league_id, (select auth.uid()), 'CANCEL_AUCTION',
      jsonb_build_object('auction_id', current_auction.id, 'player_id', current_auction.player_id));
end;
$$;

revoke execute on function public.cancel_auction(uuid) from public, anon;
grant execute on function public.cancel_auction(uuid) to authenticated;
