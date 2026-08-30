-- Quando l'asta viene messa in pausa il timer deve FERMARSI: la deadline
-- dell'asta attiva viene spenta (bid_deadline = null), così resolve_auction
-- non può mai scattare e il client non mostra più un countdown.
-- Alla ripresa (LIVE) il timer RICOMINCIA DAL MASSIMO: la deadline viene
-- reimpostata a now() + timer_seconds per l'asta ancora attiva.

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

  if new_status = 'PAUSED' then
    -- Congela il countdown: senza deadline il timer è spento e non scade mai.
    update public.auctions
    set bid_deadline = null
    where league_id = target_league and status = 'ACTIVE' and bid_deadline is not null;
  elsif new_status = 'LIVE' then
    -- Ripresa: riparte dal massimo (now + timer), solo per l'asta ancora attiva
    -- che era stata congelata dalla pausa.
    update public.auctions a
    set bid_deadline = now() + make_interval(secs => r.auction_timer_seconds)
    from public.league_rules r
    where a.league_id = target_league
      and a.status = 'ACTIVE'
      and a.bid_deadline is null
      and r.league_id = a.league_id;
  end if;

  update public.leagues set status = new_status, updated_at = now() where id = target_league returning * into result;
  insert into public.admin_actions (league_id, actor_id, action_type, payload)
  values (target_league, (select auth.uid()), 'SET_STATUS', jsonb_build_object('status', new_status));
  return result;
end;
$$;

-- Garanzia extra: l'aggiudicazione automatica non deve MAI scattare se la
-- lega non è in corso (es. asta messa in pausa con deadline ancora valida
-- per un evento realtime non ancora arrivato).
create or replace function public.resolve_auction(target_auction uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  auction_row public.auctions;
  league_row public.leagues;
  result public.purchases;
begin
  select * into auction_row from public.auctions where id = target_auction for update;
  if auction_row.id is null then raise exception 'Asta inesistente'; end if;
  if auction_row.status <> 'ACTIVE' then return null; end if;
  if not (select private.is_league_member(auction_row.league_id)) then
    raise exception 'Non partecipi a questa lega';
  end if;
  select * into league_row from public.leagues where id = auction_row.league_id;
  if league_row.status <> 'LIVE' then
    raise exception 'La lega non e in corso: il timer resta fermo';
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
