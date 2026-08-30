-- Timer di aggiudicazione automatica.
--
-- Nuova meccanica asta:
--   1. chi chiama un giocatore diventa subito il miglior offerente alla base
--      d'asta (min_bid) e parte il timer (league_rules.auction_timer_seconds).
--   2. ogni offerta valida resetta il timer.
--   3. al raggiungimento di zero l'asta viene aggiudicata in automatico al
--      miglior offerente (RPC resolve_auction, idempotente, race-safe).
-- L'admin può comunque aggiudicare prima (award_player) o annullare (cancel_auction).

alter table public.league_rules
  add column if not exists auction_timer_seconds smallint not null default 5
  check (auction_timer_seconds between 1 and 60);

alter table public.auctions
  add column if not exists bid_deadline timestamptz;

-- Helper condiviso: completa l'aggiudicazione (crediti, rosa, turno, storico).
-- Nessun controllo di autorizzazione qui: i chiamanti (award_player,
-- resolve_auction, sweep di nominate_player) gestiscono i propri permessi.
create or replace function private.complete_auction(target_auction uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auction public.auctions;
  result public.purchases;
  next_turn_value integer;
  participants_count integer;
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

  select count(*) into participants_count from public.participants where league_id = current_auction.league_id;
  select (current_turn + 1) % greatest(participants_count, 1) into next_turn_value
    from public.leagues where id = current_auction.league_id;
  update public.leagues set current_turn = next_turn_value, updated_at = now()
    where id = current_auction.league_id;
  return result;
end;
$$;

revoke all on function private.complete_auction(uuid) from public, anon, authenticated;

-- Aggiudicazione manuale (admin, può avvenire in qualsiasi momento).
create or replace function public.award_player(target_auction uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  auction_row public.auctions;
  result public.purchases;
begin
  select * into auction_row from public.auctions where id = target_auction;
  if auction_row.id is null then raise exception 'Asta inesistente'; end if;
  if not (select private.is_league_owner(auction_row.league_id)) then raise exception 'Solo admin'; end if;
  result := private.complete_auction(target_auction);
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
    values (auction_row.league_id, (select auth.uid()), 'AWARD_PLAYER',
      jsonb_build_object('purchase_id', result.id));
  return result;
end;
$$;

-- Aggiudicazione automatica allo scadere del timer. Può essere chiamata da
-- qualsiasi membro: la prima chiamata vince, le successive sono no-op
-- (idempotente). Il lock sulla riga asta serializza rispetto a place_bid.
create or replace function public.resolve_auction(target_auction uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  auction_row public.auctions;
  result public.purchases;
begin
  select * into auction_row from public.auctions where id = target_auction for update;
  if auction_row.id is null then raise exception 'Asta inesistente'; end if;
  if auction_row.status <> 'ACTIVE' then return null; end if;
  if not (select private.is_league_member(auction_row.league_id)) then
    raise exception 'Non partecipi a questa lega';
  end if;
  if auction_row.bid_deadline is null or now() < auction_row.bid_deadline then
    raise exception 'Il tempo per le offerte non e ancora scaduto';
  end if;
  result := private.complete_auction(target_auction);
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
    values (auction_row.league_id, (select auth.uid()), 'AUTO_AWARD',
      jsonb_build_object('purchase_id', result.id));
  return result;
end;
$$;

-- create_league con parametro timer
drop function if exists public.create_league(text, integer, integer, integer, integer, integer, integer, integer);
create or replace function public.create_league(
  league_name text,
  team_limit integer default 8,
  starting_budget integer default 500,
  minimum_bid integer default 1,
  goalkeeper_slots integer default 3,
  defender_slots integer default 8,
  midfielder_slots integer default 8,
  attacker_slots integer default 6,
  auction_timer_seconds integer default 5
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
  insert into public.leagues (owner_id, name, invite_code, participant_limit, initial_budget, min_bid)
  values ((select auth.uid()), trim(league_name), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), team_limit, starting_budget, minimum_bid)
  returning * into result;
  insert into public.league_rules (league_id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds)
  values (result.id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds);
  return result;
end;
$$;

-- Nomina: il chiamante parte subito come miglior offerente alla base d'asta e
-- il timer parte. Prima della chiamata chiude eventuali aste scadute rimaste
-- in sospeso (nessun browser connesso allo scadere).
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

  -- Rileggi lo stato: il turno potrebbe essere avanzato dalla sweep.
  select * into league_row from public.leagues where id = player_row.league_id;
  select * into caller from public.participants
    where league_id = player_row.league_id and user_id = (select auth.uid());
  if caller.id is null or caller.turn_order <> league_row.current_turn then
    raise exception 'Non e il tuo turno';
  end if;
  if exists (select 1 from public.auctions where league_id = player_row.league_id and status = 'ACTIVE') then
    raise exception 'Esiste gia un giocatore all asta';
  end if;

  select * into rules_row from public.league_rules where league_id = player_row.league_id;
  update public.players set status = 'NOMINATED' where id = player_row.id;
  insert into public.auctions (league_id, player_id, nominated_by, current_bid, highest_bidder_id, bid_deadline)
  values (player_row.league_id, player_row.id, caller.id, league_row.min_bid, caller.id,
    now() + make_interval(secs => rules_row.auction_timer_seconds))
  returning * into result;
  -- La base d'asta del chiamante entra nello storico offerte.
  insert into public.bids (auction_id, participant_id, amount)
    values (result.id, caller.id, league_row.min_bid);
  return result;
end;
$$;

-- Offerta: solo entro la deadline; ogni offerta resetta il timer.
create or replace function public.place_bid(target_auction uuid, new_amount integer)
returns public.auctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auction public.auctions;
  bidder public.participants;
  target_league public.leagues;
  rules public.league_rules;
  player_role public.player_role;
  owned_total integer;
  owned_role integer;
  total_slots integer;
  role_limit integer;
  slots_left integer;
  bid_limit integer;
begin
  select * into current_auction from public.auctions where id = target_auction for update;
  if current_auction.id is null or current_auction.status <> 'ACTIVE' then
    raise exception 'Asta non attiva';
  end if;
  if current_auction.bid_deadline is not null and now() >= current_auction.bid_deadline then
    raise exception 'Tempo scaduto: il giocatore verra aggiudicato automaticamente';
  end if;
  select * into target_league from public.leagues where id = current_auction.league_id;
  if target_league.status <> 'LIVE' then raise exception 'La lega non e in corso'; end if;
  select * into bidder from public.participants
    where league_id = current_auction.league_id and user_id = (select auth.uid()) for update;
  if bidder.id is null then raise exception 'Non partecipi a questa lega'; end if;
  if new_amount <= current_auction.current_bid then raise exception 'Offerta troppo bassa'; end if;

  select * into rules from public.league_rules where league_id = current_auction.league_id;
  select role into player_role from public.players where id = current_auction.player_id;
  select count(*), count(*) filter (where p.role = player_role)
    into owned_total, owned_role
    from public.purchases pu join public.players p on p.id = pu.player_id
    where pu.participant_id = bidder.id;
  total_slots := rules.goalkeeper_slots + rules.defender_slots + rules.midfielder_slots + rules.attacker_slots;
  role_limit := case player_role
    when 'P' then rules.goalkeeper_slots when 'D' then rules.defender_slots
    when 'C' then rules.midfielder_slots when 'A' then rules.attacker_slots end;
  if owned_role >= role_limit then raise exception 'Slot ruolo completati'; end if;
  slots_left := total_slots - owned_total;
  bid_limit := bidder.budget_remaining - ((slots_left - 1) * target_league.min_bid);
  if new_amount > bid_limit then raise exception 'Budget massimo disponibile: %', bid_limit; end if;

  insert into public.bids (auction_id, participant_id, amount)
    values (current_auction.id, bidder.id, new_amount);
  update public.auctions set current_bid = new_amount, highest_bidder_id = bidder.id,
    bid_deadline = now() + make_interval(secs => rules.auction_timer_seconds),
    version = version + 1 where id = current_auction.id returning * into current_auction;
  return current_auction;
end;
$$;

revoke execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon;
revoke execute on function public.resolve_auction(uuid) from public, anon;
revoke execute on function public.nominate_player(uuid) from public, anon;
revoke execute on function public.place_bid(uuid, integer) from public, anon;
revoke execute on function public.award_player(uuid) from public, anon;
grant execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
grant execute on function public.resolve_auction(uuid) to authenticated;
grant execute on function public.nominate_player(uuid) to authenticated;
grant execute on function public.place_bid(uuid, integer) to authenticated;
grant execute on function public.award_player(uuid) to authenticated;
