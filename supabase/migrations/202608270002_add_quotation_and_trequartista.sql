-- Aggiunta campi quotation e is_trequartista alla tabella players
alter table public.players
  add column if not exists quotation integer not null default 1 check (quotation >= 0),
  add column if not exists is_trequartista boolean not null default false;

-- Indici per performance filtri e ordinamenti
create index if not exists players_quotation_idx on public.players (league_id, quotation desc);
create index if not exists players_trequartista_idx on public.players (league_id, is_trequartista);

-- Aggiornamento della funzione RPC import_players
create or replace function public.import_players(target_league uuid, player_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if not (select private.is_league_owner(target_league)) then
    raise exception 'Solo admin';
  end if;

  if jsonb_typeof(player_rows) <> 'array' then
    raise exception 'Formato import non valido: array atteso';
  end if;

  insert into public.players (league_id, name, real_team, role, quotation, is_trequartista)
  select
    target_league,
    trim(row.name),
    trim(row.real_team),
    upper(trim(row.role))::public.player_role,
    coalesce(nullif(row.quotation, '')::integer, 1),
    coalesce(row.is_trequartista, false)
  from jsonb_to_recordset(player_rows) as row(
    name text,
    real_team text,
    role text,
    quotation text,
    is_trequartista boolean
  )
  where char_length(trim(row.name)) >= 2
    and char_length(trim(row.real_team)) >= 1
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
