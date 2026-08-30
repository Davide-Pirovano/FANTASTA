create extension if not exists pgcrypto;
create schema if not exists private;

create type public.league_status as enum ('SETUP', 'LOBBY', 'LIVE', 'PAUSED', 'COMPLETED');
create type public.player_role as enum ('P', 'D', 'C', 'A');
create type public.player_status as enum ('AVAILABLE', 'NOMINATED', 'SOLD');
create type public.auction_status as enum ('ACTIVE', 'AWARDED', 'CANCELLED');

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 80),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  status public.league_status not null default 'SETUP',
  participant_limit smallint not null check (participant_limit between 2 and 30),
  initial_budget integer not null default 500 check (initial_budget > 0),
  min_bid integer not null default 1 check (min_bid > 0),
  current_turn integer not null default 0 check (current_turn >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.league_rules (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  goalkeeper_slots smallint not null default 3 check (goalkeeper_slots >= 0),
  defender_slots smallint not null default 8 check (defender_slots >= 0),
  midfielder_slots smallint not null default 8 check (midfielder_slots >= 0),
  attacker_slots smallint not null default 6 check (attacker_slots >= 0),
  updated_at timestamptz not null default now(),
  check (goalkeeper_slots + defender_slots + midfielder_slots + attacker_slots > 0)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 50),
  team_name text not null check (char_length(team_name) between 2 and 50),
  budget_remaining integer not null check (budget_remaining >= 0),
  turn_order smallint not null check (turn_order >= 0),
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (league_id, user_id),
  unique (league_id, turn_order)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  real_team text not null check (char_length(real_team) between 1 and 80),
  role public.player_role not null,
  status public.player_status not null default 'AVAILABLE',
  created_at timestamptz not null default now()
);

create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  nominated_by uuid not null references public.participants(id) on delete restrict,
  current_bid integer not null check (current_bid > 0),
  highest_bidder_id uuid references public.participants(id) on delete restrict,
  status public.auction_status not null default 'ACTIVE',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  version bigint not null default 0
);

create unique index one_active_auction_per_league
  on public.auctions (league_id) where status = 'ACTIVE';

create table public.bids (
  id bigint generated always as identity primary key,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  auction_id uuid not null unique references public.auctions(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  player_id uuid not null unique references public.players(id) on delete restrict,
  price integer not null check (price > 0),
  created_at timestamptz not null default now()
);

create table public.admin_actions (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index participants_league_idx on public.participants (league_id);
create index participants_user_idx on public.participants (user_id);
create unique index participants_team_name_unique on public.participants (league_id, lower(team_name));
create index players_filter_idx on public.players (league_id, status, role, real_team);
create index players_search_idx on public.players (league_id, lower(name));
create unique index players_identity_unique on public.players (league_id, lower(name), lower(real_team));
create index auctions_league_started_idx on public.auctions (league_id, started_at desc);
create index bids_auction_created_idx on public.bids (auction_id, created_at desc);
create index bids_participant_idx on public.bids (participant_id);
create index purchases_league_created_idx on public.purchases (league_id, created_at desc);
create index purchases_participant_idx on public.purchases (participant_id);
create index admin_actions_league_idx on public.admin_actions (league_id, created_at desc);

create or replace function private.is_league_member(target_league uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
    where p.league_id = target_league and p.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.leagues l
    where l.id = target_league and l.owner_id = (select auth.uid())
  );
$$;

create or replace function private.is_league_owner(target_league uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leagues l
    where l.id = target_league and l.owner_id = (select auth.uid())
  );
$$;

alter table public.leagues enable row level security;
alter table public.league_rules enable row level security;
alter table public.participants enable row level security;
alter table public.players enable row level security;
alter table public.auctions enable row level security;
alter table public.bids enable row level security;
alter table public.purchases enable row level security;
alter table public.admin_actions enable row level security;

create policy leagues_select_member on public.leagues for select to authenticated
  using ((select private.is_league_member(id)));
create policy leagues_insert_owner on public.leagues for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy rules_select_member on public.league_rules for select to authenticated
  using ((select private.is_league_member(league_id)));
create policy participants_select_member on public.participants for select to authenticated
  using ((select private.is_league_member(league_id)));
create policy players_select_member on public.players for select to authenticated
  using ((select private.is_league_member(league_id)));
create policy auctions_select_member on public.auctions for select to authenticated
  using ((select private.is_league_member(league_id)));
create policy bids_select_member on public.bids for select to authenticated
  using (exists (
    select 1 from public.auctions a
    where a.id = auction_id and (select private.is_league_member(a.league_id))
  ));
create policy purchases_select_member on public.purchases for select to authenticated
  using ((select private.is_league_member(league_id)));
create policy actions_select_owner on public.admin_actions for select to authenticated
  using ((select private.is_league_owner(league_id)));

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.league_rules, public.participants, public.players,
  public.auctions, public.bids, public.purchases, public.admin_actions from authenticated;
grant select on public.leagues, public.league_rules, public.participants, public.players,
  public.auctions, public.bids, public.purchases to authenticated;
grant insert on public.leagues to authenticated;
grant select on public.admin_actions to authenticated;

create or replace function public.join_league(
  invite text,
  participant_name text,
  fantasy_team text
)
returns public.participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.leagues;
  result public.participants;
  next_turn integer;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;
  select * into target from public.leagues where invite_code = upper(invite) for update;
  if target.id is null or target.status not in ('SETUP', 'LOBBY') then
    raise exception 'Lega non disponibile';
  end if;
  select count(*) into next_turn from public.participants where league_id = target.id;
  if next_turn >= target.participant_limit then raise exception 'Lobby completa'; end if;
  insert into public.participants (
    league_id, user_id, display_name, team_name, budget_remaining, turn_order
  ) values (
    target.id, (select auth.uid()), trim(participant_name), trim(fantasy_team),
    target.initial_budget, next_turn
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.create_league(
  league_name text,
  team_limit integer default 8,
  starting_budget integer default 500,
  minimum_bid integer default 1,
  goalkeeper_slots integer default 3,
  defender_slots integer default 8,
  midfielder_slots integer default 8,
  attacker_slots integer default 6
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
  insert into public.league_rules (league_id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots)
  values (result.id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots);
  return result;
end;
$$;

create or replace function public.import_players(target_league uuid, player_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare inserted_count integer;
begin
  if not (select private.is_league_owner(target_league)) then raise exception 'Solo admin'; end if;
  if jsonb_typeof(player_rows) <> 'array' then raise exception 'Formato import non valido'; end if;
  insert into public.players (league_id, name, real_team, role)
  select target_league, trim(row.name), trim(row.real_team), upper(trim(row.role))::public.player_role
  from jsonb_to_recordset(player_rows) as row(name text, real_team text, role text)
  where char_length(trim(row.name)) >= 2 and char_length(trim(row.real_team)) >= 1
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.set_league_status(target_league uuid, new_status public.league_status)
returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare result public.leagues;
begin
  if not (select private.is_league_owner(target_league)) then raise exception 'Solo admin'; end if;
  if new_status = 'LIVE' and not exists (select 1 from public.participants where league_id = target_league) then
    raise exception 'Serve almeno un partecipante';
  end if;
  update public.leagues set status = new_status, updated_at = now() where id = target_league returning * into result;
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
  values (target_league, (select auth.uid()), 'SET_STATUS', jsonb_build_object('status', new_status));
  return result;
end;
$$;

create or replace function public.nominate_player(target_player uuid)
returns public.auctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.players;
  league_row public.leagues;
  caller public.participants;
  result public.auctions;
begin
  select * into player_row from public.players where id = target_player for update;
  if player_row.id is null or player_row.status <> 'AVAILABLE' then raise exception 'Giocatore non disponibile'; end if;
  select * into league_row from public.leagues where id = player_row.league_id for update;
  if league_row.status <> 'LIVE' then raise exception 'Lega non in corso'; end if;
  select * into caller from public.participants where league_id = player_row.league_id and user_id = (select auth.uid());
  if caller.id is null or caller.turn_order <> league_row.current_turn then raise exception 'Non e il tuo turno'; end if;
  if exists (select 1 from public.auctions where league_id = player_row.league_id and status = 'ACTIVE') then
    raise exception 'Esiste gia un giocatore all asta';
  end if;
  update public.players set status = 'NOMINATED' where id = player_row.id;
  insert into public.auctions (league_id, player_id, nominated_by, current_bid)
  values (player_row.league_id, player_row.id, caller.id, league_row.min_bid)
  returning * into result;
  return result;
end;
$$;

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
  select * into target_league from public.leagues where id = current_auction.league_id;
  if target_league.status <> 'LIVE' then raise exception 'La lega non e in corso'; end if;
  select * into bidder from public.participants
    where league_id = current_auction.league_id and user_id = (select auth.uid()) for update;
  if bidder.id is null then raise exception 'Non partecipi a questa lega'; end if;
  if (current_auction.highest_bidder_id is null and new_amount < current_auction.current_bid)
    or (current_auction.highest_bidder_id is not null and new_amount <= current_auction.current_bid) then
    raise exception 'Offerta troppo bassa';
  end if;

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
    version = version + 1 where id = current_auction.id returning * into current_auction;
  return current_auction;
end;
$$;

create or replace function public.award_player(target_auction uuid)
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
  if current_auction.id is null or current_auction.status <> 'ACTIVE' then raise exception 'Asta non attiva'; end if;
  if not (select private.is_league_owner(current_auction.league_id)) then raise exception 'Solo admin'; end if;
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
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
    values (current_auction.league_id, (select auth.uid()), 'AWARD_PLAYER', jsonb_build_object('purchase_id', result.id));
  return result;
end;
$$;

revoke execute on function public.join_league(text, text, text) from public, anon;
revoke execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer) from public, anon;
revoke execute on function public.import_players(uuid, jsonb) from public, anon;
revoke execute on function public.set_league_status(uuid, public.league_status) from public, anon;
revoke execute on function public.nominate_player(uuid) from public, anon;
revoke execute on function public.place_bid(uuid, integer) from public, anon;
revoke execute on function public.award_player(uuid) from public, anon;
grant execute on function public.join_league(text, text, text) to authenticated;
grant execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer) to authenticated;
grant execute on function public.import_players(uuid, jsonb) to authenticated;
grant execute on function public.set_league_status(uuid, public.league_status) to authenticated;
grant execute on function public.nominate_player(uuid) to authenticated;
grant execute on function public.place_bid(uuid, integer) to authenticated;
grant execute on function public.award_player(uuid) to authenticated;

alter publication supabase_realtime add table public.leagues;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.auctions;
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.purchases;
