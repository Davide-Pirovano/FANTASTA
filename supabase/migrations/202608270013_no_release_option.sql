-- Nuova opzione "senza svincolo": league_rules.release_refund = 'none'.
-- In quel caso release_player rifiuta e l'acquisto è definitivo.

alter table public.league_rules
  drop constraint if exists league_rules_release_refund_check;

alter table public.league_rules
  add constraint league_rules_release_refund_check
  check (release_refund in ('full', 'half', 'one', 'none'));

-- create_league: accetta anche 'none' (firma 11 parametri, come la 011).
drop function if exists public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text);
create function public.create_league(
  league_name text,
  team_limit integer default 8,
  starting_budget integer default 500,
  minimum_bid integer default 1,
  goalkeeper_slots integer default 3,
  defender_slots integer default 8,
  midfielder_slots integer default 8,
  attacker_slots integer default 6,
  auction_timer_seconds integer default 15,
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
  if release_refund not in ('full', 'half', 'one', 'none') then raise exception 'Rimborso svincolo non valido'; end if;
  insert into public.leagues (owner_id, name, invite_code, participant_limit, initial_budget, min_bid, aste_mode)
  values ((select auth.uid()), trim(league_name), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), team_limit, starting_budget, minimum_bid, auction_mode)
  returning * into result;
  insert into public.league_rules (league_id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds, release_refund)
  values (result.id, goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds, release_refund);
  return result;
end;
$$;

revoke execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text) from public, anon;
grant execute on function public.create_league(text, integer, integer, integer, integer, integer, integer, integer, integer, text, text) to authenticated;

-- release_player: blocca quando lo svincolo è disabilitato.
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

  select * into rules_row from public.league_rules where league_id = purchase_row.league_id;
  if rules_row.release_refund = 'none' then
    raise exception 'Lo svincolo e disabilitato in questa lega';
  end if;

  -- Solo il proprietario del giocatore o l'admin della lega possono svincolare.
  select * into owner_participant from public.participants
    where id = purchase_row.participant_id and user_id = (select auth.uid());
  if owner_participant.id is null
     and not (select private.is_league_owner(purchase_row.league_id)) then
    raise exception 'Non puoi svincolare questo giocatore';
  end if;

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
