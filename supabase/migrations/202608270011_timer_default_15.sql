-- Default del conto alla rovescia portato a 15 secondi.

alter table public.league_rules
  alter column auction_timer_seconds set default 15;

-- create_league: rimpiazza la firma della 010 aggiornando il default del timer.
drop function if exists public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text);
create function public.create_league(
  league_name text,
  team_limit integer default 8,
  starting_budget integer default 500,
  minimum_bid integer default 1,
  goalkeeper_slots integer default 3,
  defender_slots integer default 8,
  midfielder_slots integer default 8,
  attacker_slots integer default 6,
  auction_timer_seconds integer default 15,
  auction_mode text default 'per_ruoli',
  release_refund text default 'half'
)
returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.leagues;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;
  if auction_mode not in ('per_ruoli', 'libero') then raise exception 'Modalita asta non valida'; end if;
  if release_refund not in ('full', 'half', 'one') then raise exception 'Rimborso svincolo non valido'; end if;
  insert into public.leagues (owner_id, name, invite_code, participant_limit, initial_budget, min_bid, aste_mode)
  values ((select auth.uid()), trim(league_name), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), team_limit, starting_budget, minimum_bid, auction_mode)
  returning * into result;
  insert into public.league_rules (league_id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds, release_refund)
  values (result.id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds, release_refund);
  return result;
end;
$$;

revoke execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text) from public, anon;
grant execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text) to authenticated;
