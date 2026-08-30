-- Messaggi chiari sui casi limite di ingresso/rientro:
-- 1. join_league rifiuta i nomi squadra duplicati con un messaggio comprensibile
--    (prima falliva solo sul vincolo unico con l'errore PostgreSQL grezzo).
-- 2. rejoin_league segnala esplicitamente quando la squadra viene spostata su
--    questo dispositivo (l'eventuale altro dispositivo collegato si stacca).

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

  if exists (
    select 1 from public.participants
    where league_id = target.id and lower(team_name) = lower(trim(fantasy_team))
  ) then
    raise exception 'Nome squadra gia usato in questa lega: scegline un altro';
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

drop function if exists public.rejoin_league(text, text);
create function public.rejoin_league(
  invite text,
  fantasy_team text
)
returns table (participant public.participants, moved boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.leagues;
  existing public.participants;
  was_moved boolean;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;

  select * into target from public.leagues where invite_code = upper(invite);
  if target.id is null then raise exception 'Lega non trovata'; end if;

  select * into existing from public.participants
  where league_id = target.id and lower(team_name) = lower(trim(fantasy_team));
  if existing.id is null then raise exception 'Nessuna squadra con questo nome in questa lega'; end if;

  -- La squadra era collegata a un'altra sessione: viene spostata su quella corrente.
  was_moved := existing.user_id <> (select auth.uid());

  if was_moved then
    update public.participants
    set user_id = (select auth.uid()),
        connected = true
    where id = existing.id
    returning * into existing;
  else
    update public.participants set connected = true where id = existing.id;
  end if;

  participant := existing;
  moved := was_moved;
  return next;
end;
$$;

revoke execute on function public.rejoin_league(text, text) from public, anon;
grant execute on function public.rejoin_league(text, text) to authenticated;
