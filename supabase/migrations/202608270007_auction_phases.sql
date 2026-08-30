-- Asta a fasi per ruolo: prima i portieri (P), poi difensori (D),
-- centrocampisti (C) e infine attaccanti (A).
--
-- Regole:
--   1. in ogni fase possono chiamare SOLO i partecipanti che hanno ancora
--      slot liberi per il ruolo della fase;
--   2. la ricerca/chiamata mostra solo i giocatori del ruolo corrente;
--   3. dopo ogni aggiudicazione il turno passa al prossimo chiamante idoneo;
--      se nessuno può più chiamare (slot pieni o listone esaurito per quel
--      ruolo) la fase avanza automaticamente alla successiva;
--   4. l'admin può comunque spostare la fase manualmente (set_league_phase).

alter table public.leagues
  add column if not exists auction_phase text not null default 'P'
  check (auction_phase in ('P', 'D', 'C', 'A'));

-- Slot previsti per un ruolo (da league_rules).
create or replace function private.role_slots(target_rules public.league_rules, role text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case role
    when 'P' then target_rules.goalkeeper_slots
    when 'D' then target_rules.defender_slots
    when 'C' then target_rules.midfielder_slots
    when 'A' then target_rules.attacker_slots
  end;
$$;

-- Quanti giocatori di un ruolo possiede già un partecipante.
-- Nota: nelle funzioni SQL i nomi di colonna hanno precedenza sui parametri,
-- quindi i parametri sono rinominati (target_participant, role_name); serve
-- DROP esplicito perché CREATE OR REPLACE non può rinominare i parametri.
drop function if exists private.owned_role(uuid, text);
create function private.owned_role(target_participant uuid, role_name text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.purchases pu
  join public.players p on p.id = pu.player_id
  where pu.participant_id = target_participant
    and p.role = role_name::public.player_role;
$$;

-- Prossimo chiamante idoneo: il primo partecipante (in ordine circolare dopo
-- from_turn, -1 per partire dal primo) con slot liberi per il ruolo della fase.
-- Ritorna null quando la fase è completata (nessuno può più chiamare o non
-- restano giocatori disponibili di quel ruolo).
create or replace function private.next_eligible_turn(target_league uuid, from_turn integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  phase text;
  rules_row public.league_rules;
  candidates integer[];
  n integer;
  t integer;
  pos integer;
  candidate_id uuid;
begin
  select auction_phase into phase from public.leagues where id = target_league;
  select * into rules_row from public.league_rules where league_id = target_league;

  if not exists (
    select 1 from public.players
    where league_id = target_league and status = 'AVAILABLE'
      and role = phase::public.player_role
  ) then
    return null;
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
    if candidate_id is not null
       and private.owned_role(candidate_id, phase) < private.role_slots(rules_row, phase)
    then
      return candidates[pos];
    end if;
  end loop;
  return null;
end;
$$;

-- Avanzamento turno + fase dopo un'aggiudicazione.
create or replace function private.advance_league(target_league uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  phase text;
  next_turn integer;
  phase_order text[] := array['P', 'D', 'C', 'A'];
  pos integer;
  new_phase text;
begin
  select auction_phase into phase from public.leagues where id = target_league;

  next_turn := private.next_eligible_turn(target_league,
    coalesce((select current_turn from public.leagues where id = target_league), -1));
  if next_turn is not null then
    update public.leagues set current_turn = next_turn, updated_at = now()
      where id = target_league;
    return;
  end if;

  -- Fase completata: passa alla successiva con almeno un chiamante idoneo.
  pos := array_position(phase_order, phase);
  for j in coalesce(pos, 0) + 1 .. 4 loop
    new_phase := phase_order[j];
    update public.leagues set auction_phase = new_phase where id = target_league;
    next_turn := private.next_eligible_turn(target_league, -1);
    if next_turn is not null then
      update public.leagues set current_turn = next_turn, updated_at = now()
        where id = target_league;
      return;
    end if;
  end loop;
  -- Tutte le fasi completate: nessun turno (resta invariato).
end;
$$;

-- complete_auction: l'aggiudicazione ora avanza turno e fase.
create or replace function private.complete_auction(target_auction uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auction public.auctions;
  result public.purchases;
begin
  select * into current_auction from public.auctions where id = target_auction for update;
  if current_auction.id is null then raise exception 'Asta inesistente'; end if;
  if current_auction.status <> 'ACTIVE' then raise exception 'Asta non attiva'; end if;
  if current_auction.highest_bidder_id is null then raise exception 'Nessun offerente'; end if;

  update public.participants set budget_remaining = budget_remaining - current_auction.current_bid
    where id = current_auction.highest_bidder_id and budget_remaining >= current_auction.current_bid;
  if not found then raise exception 'Budget insufficiente'; end if;
  update public.players set status = 'SOLD' where id = current_auction.player_id and status = 'NOMINATED';
  if not found then raise exception 'Stato giocatore non valido'; end if;
  update public.auctions set status = 'AWARDED', completed_at = now(), version = version + 1
    where id = current_auction.id;
  insert into public.purchases (league_id, auction_id, participant_id, player_id, price)
    values (current_auction.league_id, current_auction.id, current_auction.highest_bidder_id,
      current_auction.player_id, current_auction.current_bid) returning * into result;

  -- Turno e fase: il prossimo chiamante idoneo, o la fase successiva.
  perform private.advance_league(current_auction.league_id);
  return result;
end;
$$;

-- Nomina: validazione della fase corrente (ruolo giocatore + slot del chiamante).
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
  if player_row.role <> league_row.auction_phase::public.player_role then
    raise exception 'Fase corrente: % — puoi chiamare solo giocatori di quel ruolo', league_row.auction_phase;
  end if;
  select * into rules_row from public.league_rules where league_id = player_row.league_id;
  if private.owned_role(caller.id, league_row.auction_phase) >= private.role_slots(rules_row, league_row.auction_phase) then
    raise exception 'Hai gia completato gli slot per questo ruolo';
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

-- Cambio fase manuale (admin): imposta la fase e il turno sul primo chiamante
-- idoneo della nuova fase.
create or replace function public.set_league_phase(target_league uuid, new_phase text)
returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.leagues;
  next_turn integer;
begin
  if new_phase not in ('P', 'D', 'C', 'A') then raise exception 'Fase non valida'; end if;
  if not (select private.is_league_owner(target_league)) then raise exception 'Solo admin'; end if;
  update public.leagues set auction_phase = new_phase, updated_at = now()
    where id = target_league returning * into result;
  next_turn := private.next_eligible_turn(target_league, -1);
  if next_turn is not null then
    update public.leagues set current_turn = next_turn where id = target_league;
  end if;
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
  values (target_league, (select auth.uid()), 'SET_PHASE', jsonb_build_object('phase', new_phase));
  return result;
end;
$$;

revoke execute on function public.set_league_phase(uuid, text) from public, anon;
grant execute on function public.set_league_phase(uuid, text) to authenticated;
