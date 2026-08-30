-- Eliminazione definitiva di una lega (solo admin/owner).
-- Le FK con RESTRICT (purchases → auctions/participants/players) impediscono
-- una semplice cascata: la cancellazione segue l'ordine di dipendenza.

create or replace function public.delete_league(target_league uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_league_owner(target_league)) then raise exception 'Solo admin'; end if;

  delete from public.bids where auction_id in (select id from public.auctions where league_id = target_league);
  delete from public.purchases where league_id = target_league;
  delete from public.auctions where league_id = target_league;
  delete from public.admin_actions where league_id = target_league;
  delete from public.participants where league_id = target_league;
  delete from public.players where league_id = target_league;
  delete from public.league_rules where league_id = target_league;
  delete from public.leagues where id = target_league;

  if not found then raise exception 'Lega inesistente'; end if;
end;
$$;

revoke execute on function public.delete_league(uuid) from public, anon;
grant execute on function public.delete_league(uuid) to authenticated;
