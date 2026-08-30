-- Rientro dei partecipanti dopo perdita della sessione anonima.
-- Se un partecipante chiude la pagina e perde il cookie (altro browser,
-- cookie cancellati, telefono), la sessione anonima non è recuperabile:
-- con rejoin_league la squadra "adotta" la sessione corrente dell'utente,
-- così il partecipante rientra nella stessa squadra anche ad asta già partita.

create or replace function public.rejoin_league(
  invite text,
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
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;

  select * into target from public.leagues where invite_code = upper(invite);
  if target.id is null then raise exception 'Lega non trovata'; end if;

  select * into result from public.participants
  where league_id = target.id and lower(team_name) = lower(trim(fantasy_team));
  if result.id is null then raise exception 'Nessuna squadra con questo nome in questa lega'; end if;

  -- Sessione già legata a questa squadra: nessuna modifica necessaria.
  if result.user_id = (select auth.uid()) then
    return result;
  end if;

  -- Adotta il partecipante con la sessione corrente.
  update public.participants
  set user_id = (select auth.uid()),
      connected = true
  where id = result.id
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.rejoin_league(text, text) from public, anon;
grant execute on function public.rejoin_league(text, text) to authenticated;
