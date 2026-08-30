-- Modalità di svolgimento dell'asta: 'per_ruoli' (default, fasi P/D/C/A come
-- nella migration 007) oppure 'libero' (ordine sparso: si chiama qualsiasi
-- ruolo, il turno gira tra chi ha ancora slot complessivi liberi, niente fasi).
--
-- Regole in modalità 'libero':
--   1. la ricerca/chiamata mostra tutti i ruoli (gestito lato UI);
--   2. il prossimo chiamante è chi ha ancora slot TOTALI liberi (non per ruolo);
--   3. nomina valida qualunque giocatore finché il chiamante ha un posto libero
--      nella rosa complessiva;
--   4. niente avanzamento di fase (resta impostata ma viene ignorata).

alter table public.leagues
  add column if not exists aste_mode text not null default 'per_ruoli'
  check (aste_mode in ('per_ruoli', 'libero'));

-- Quanti slot totali ha una squadra (somma dei ruoli).
create or replace function private.total_slots(target_rules public.league_rules)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select target_rules.goalkeeper_slots + target_rules.defender_slots
       + target_rules.midfielder_slots + target_rules.attacker_slots;
$$;

-- Quanti giocatori possiede già un partecipante in assoluto (tutti i ruoli).
drop function if exists private.owned_total(uuid);
create function private.owned_total(target_participant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.purchases
  where participant_id = target_participant;
$$;

-- Prossimo chiamante idoneo, rispettando la modalità d'asta:
--   * per_ruoli -> slot liberi nel ruolo della fase corrente;
--   * libero    -> slot liberi complessivi.
drop function if exists private.next_eligible_turn(uuid, integer);
create function private.next_eligible_turn(target_league uuid, from_turn integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  phase text;
  mode text;
  rules_row public.league_rules;
  candidates integer[];
  n integer;
  t integer;
  pos integer;
  candidate_id uuid;
begin
  select auction_phase, aste_mode into phase, mode
    from public.leagues where id = target_league;
  select * into rules_row from public.league_rules where league_id = target_league;

  if mode = 'libero' then
    if not exists (
      select 1 from public.players
      where league_id = target_league and status = 'AVAILABLE'
    ) then
      return null;
    end if;
  else
    if not exists (
      select 1 from public.players
      where league_id = target_league and status = 'AVAILABLE'
        and role = phase::public.player_role
    ) then
      return null;
    end if;
  end if;

  select array_agg(turn_order order by turn_order) into candidates
    from public.participants where league_id = target_league;
  if candidates is null then return null; end if;
  n := array_length(candidates, 1);

  for i in 1..n loop
    t := (from_turn + i) % n;           -- turn_order candidato (0-based)
    pos := t + 1;                       -- posizione nell'array (1-based)
    select id into candidate_id from public.participants
      where league_id = target_league and turn_order = candidates[pos];
    if candidate_id is not null then
      if mode = 'libero' then
        if private.owned_total(candidate_id) < private.total_slots(rules_row) then
          return candidates[pos];
        end if;
      else
        if private.owned_role(candidate_id, phase) < private.role_slots(rules_row, phase) then
          return candidates[pos];
        end if;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

-- Nomina: in modalità 'libero' non c'è vincolo di ruolo, conta solo lo slot
-- libero complessivo. In modalità 'per_ruoli' valgono le regole della 007.
create or replace function public.nominate_player(target_player uuid)
returns public.auctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.players;
  league_row public.leagues;
  rules_row public.league_rules;
  caller public.participants;
  expired_id uuid;
  result public.auctions;
begin
  select * into player_row from public.players where id = target_player for update;
  if player_row.id is null or player_row.status <> 'AVAILABLE' then raise exception 'Giocatore non disponibile'; end if;
  select * into league_row from public.leagues where id = player_row.league_id for update;
  if league_row.status <> 'LIVE' then raise exception 'Lega non in corso'; end if;

  -- Aggiudica in automatico le aste il cui timer e scaduto (best effort).
  for expired_id in
    select a.id from public.auctions a
    where a.league_id = league_row.id and a.status = 'ACTIVE'
      and a.bid_deadline is not null and a.bid_deadline <= now()
  loop
    begin
      perform private.complete_auction(expired_id);
    exception when others then
      null;
    end;
  end loop;

  -- Rileggi lo stato: turno/fase potrebbero essere avanzati dalla sweep.
  select * into league_row from public.leagues where id = player_row.league_id;
  select * into caller from public.participants
    where league_id = player_row.league_id and user_id = (select auth.uid());
  if caller.id is null or caller.turn_order <> league_row.current_turn then
    raise exception 'Non e il tuo turno';
  end if;
  select * into rules_row from public.league_rules where league_id = player_row.league_id;

  if league_row.aste_mode = 'libero' then
    if private.owned_total(caller.id) >= private.total_slots(rules_row) then
      raise exception 'Hai completato il numero massimo di giocatori';
    end if;
  else
    if player_row.role <> league_row.auction_phase::public.player_role then
      raise exception 'Fase corrente: % — puoi chiamare solo giocatori di quel ruolo', league_row.auction_phase;
    end if;
    if private.owned_role(caller.id, league_row.auction_phase) >= private.role_slots(rules_row, league_row.auction_phase) then
      raise exception 'Hai gia completato gli slot per questo ruolo';
    end if;
  end if;
  if exists (select 1 from public.auctions where league_id = player_row.league_id and status = 'ACTIVE') then
    raise exception 'Esiste gia un giocatore all asta';
  end if;

  update public.players set status = 'NOMINATED' where id = player_row.id;
  insert into public.auctions (league_id, player_id, nominated_by, current_bid, highest_bidder_id, bid_deadline)
  values (player_row.league_id, player_row.id, caller.id, league_row.min_bid, caller.id,
    now() + make_interval(secs => rules_row.auction_timer_seconds))
  returning * into result;
  insert into public.bids (auction_id, participant_id, amount)
    values (result.id, caller.id, league_row.min_bid);
  return result;
end;
$$;

-- create_league: rimpiazza la firma della 005 (con auction_timer_seconds)
-- aggiungendo aste_mode in coda. Firma: 10 parametri.
drop function if exists public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer);
create function public.create_league(
  league_name text,
  team_limit integer default 8,
  starting_budget integer default 500,
  minimum_bid integer default 1,
  goalkeeper_slots integer default 3,
  defender_slots integer default 8,
  midfielder_slots integer default 8,
  attacker_slots integer default 6,
  auction_timer_seconds integer default 5,
  auction_mode text default 'per_ruoli'
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
  insert into public.leagues (owner_id, name, invite_code, participant_limit, initial_budget, min_bid, aste_mode)
  values ((select auth.uid()), trim(league_name), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), team_limit, starting_budget, minimum_bid, auction_mode)
  returning * into result;
  insert into public.league_rules (league_id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds)
  values (result.id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds);
  return result;
end;
$$;

revoke execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text) to authenticated;

-- Il vecchio overload senza timer (della 001) non serve piu: resta in giro solo
-- se qualcuno lo richiamasse; lo rimuoviamo per pulizia.
drop function if exists public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer);