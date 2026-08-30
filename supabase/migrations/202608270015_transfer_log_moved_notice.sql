-- Avviso sul dispositivo che perde la squadra quando qualcuno rientra da un
-- altro dispositivo. Il realtime (postgres_changes) non arriva al vecchio
-- device perché dopo lo spostamento la RLS gli nasconde la riga: serve quindi
-- un log persistente che il server consulta a ogni caricamento, più un canale
-- broadcast lato client per il "calcio" immediato a pagina aperta.

create table public.participant_transfers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_name text not null,
  old_user_id uuid not null references auth.users(id) on delete cascade,
  new_user_id uuid not null references auth.users(id) on delete cascade,
  moved_at timestamptz not null default now()
);

create index participant_transfers_league_olduser_idx
  on public.participant_transfers (league_id, old_user_id, moved_at desc);

alter table public.participant_transfers enable row level security;
create policy transfers_select_old_user on public.participant_transfers
  for select to authenticated
  using (old_user_id = (select auth.uid()));

grant select on public.participant_transfers to authenticated;

-- Rientro: oltre a restituire `moved`, registra lo spostamento nel log.
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
    insert into public.participant_transfers (league_id, team_name, old_user_id, new_user_id)
    values (existing.league_id, existing.team_name, existing.user_id, (select auth.uid()));

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

-- Per il server: restituisce l'ultimo spostamento che ha riguardato la sessione
-- corrente come "vecchio dispositivo", per mostrare l'avviso e tornare in home.
create or replace function public.get_my_transfer(invite text)
returns table (team_name text, moved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.team_name, t.moved_at
  from public.participant_transfers t
  join public.leagues l on l.id = t.league_id
  where l.invite_code = upper(invite)
    and t.old_user_id = (select auth.uid())
  order by t.moved_at desc
  limit 1;
$$;

revoke execute on function public.get_my_transfer(text) from public, anon;
grant execute on function public.get_my_transfer(text) to authenticated;
