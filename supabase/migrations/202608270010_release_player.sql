-- Svincolo dei giocatori acquistati con rimborso configurabile.
--
-- Regole:
--   1. league_rules.release_refund decide quanto torna in cassa quando un
--      giocatore acquistato viene svincolato:
--        'full' -> prezzo pieno di acquisto;
--        'half' -> metà del prezzo (arrotondata per difetto, minimo 1 credito);
--        'one'  -> 1 credito fisso.
--   2. release_player: il proprietario del giocatore (o l'admin della lega)
--      può svincolare quando la lega è LIVE, PAUSED o COMPLETED. Il giocatore
--      torna AVAILABLE e può essere ricomprato, lo slot si libera e i crediti
--      di rimborso tornano in cassa.
--   3. gli acquisti svincolati restano nello storico (colonna released_at) ma
--      non contano più per rosa, slot e conteggi di budget.

alter table public.purchases
  add column if not exists released_at timestamptz;

-- Un giocatore può avere al più UNA acquisizione attiva (non svincolata);
-- lo storico può contenerne più di una se è stato ricomprato.
alter table public.purchases drop constraint if exists purchases_player_id_key;
create unique index if not exists purchases_active_player_unique
  on public.purchases (player_id) where released_at is null;

alter table public.league_rules
  add column if not exists release_refund text not null default 'half'
  check (release_refund in ('full', 'half', 'one'));

-- Conteggi rosa: contano solo le acquisizioni attive (non svincolate).
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
    and pu.released_at is null
    and p.role = role_name::public.player_role;
$$;

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
  where participant_id = target_participant
    and released_at is null;
$$;

-- place_bid: esclude gli svincolati dai conteggi e, in modalità 'libero',
-- applica il limite sugli slot TOTALI invece che sul singolo ruolo (coerente
-- con nominate_player della 009).
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
  owned_total := private.owned_total(bidder.id);
  owned_role := private.owned_role(bidder.id, player_role::text);
  total_slots := private.total_slots(rules);
  role_limit := case player_role
    when 'P' then rules.goalkeeper_slots when 'D' then rules.defender_slots
    when 'C' then rules.midfielder_slots when 'A' then rules.attacker_slots end;
  if target_league.aste_mode = 'libero' then
    if owned_total >= total_slots then raise exception 'Hai completato il numero massimo di giocatori'; end if;
  else
    if owned_role >= role_limit then raise exception 'Slot ruolo completati'; end if;
  end if;
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

-- Svincolo di un giocatore acquistato: rimborso secondo league_rules.release_refund.
create or replace function public.release_player(target_player uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_row public.purchases;
  league_row public.leagues;
  rules_row public.league_rules;
  refund integer;
  owner_participant public.participants;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;

  select * into purchase_row from public.purchases
    where player_id = target_player and released_at is null
    for update;
  if purchase_row.id is null then raise exception 'Giocatore non acquistato o gia svincolato'; end if;

  select * into league_row from public.leagues where id = purchase_row.league_id;
  if league_row.status not in ('LIVE', 'PAUSED', 'COMPLETED') then
    raise exception 'La lega non e in corso';
  end if;

  -- Solo il proprietario del giocatore o l'admin della lega possono svincolare.
  select * into owner_participant from public.participants
    where id = purchase_row.participant_id and user_id = (select auth.uid());
  if owner_participant.id is null
     and not (select private.is_league_owner(purchase_row.league_id)) then
    raise exception 'Non puoi svincolare questo giocatore';
  end if;

  select * into rules_row from public.league_rules where league_id = purchase_row.league_id;
  refund := case rules_row.release_refund
    when 'full' then purchase_row.price
    when 'half' then greatest(1, purchase_row.price / 2)
    else 1
  end;

  update public.participants set budget_remaining = budget_remaining + refund
    where id = purchase_row.participant_id;
  update public.players set status = 'AVAILABLE' where id = purchase_row.player_id;
  update public.purchases set released_at = now() where id = purchase_row.id
    returning * into purchase_row;
  return purchase_row;
end;
$$;

-- create_league: rimpiazza la firma della 009 (con auction_mode) aggiungendo
-- release_refund in coda. Firma: 11 parametri.
drop function if exists public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text);
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
revoke execute on function public.release_player(uuid) from public, anon;
grant execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text) to authenticated;
grant execute on function public.release_player(uuid) to authenticated;
