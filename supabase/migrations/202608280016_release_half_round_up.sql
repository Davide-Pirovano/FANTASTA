-- Rimborso alla metà: arrotonda per eccesso (prima troncava: 7/2 = 3).
-- La divisione intera in PostgreSQL tronca, quindi passiamo a ceil(price / 2.0).

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
    when 'half' then greatest(1, ceil(purchase_row.price / 2.0))
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

revoke execute on function public.release_player(uuid) from public, anon;
grant execute on function public.release_player(uuid) to authenticated;