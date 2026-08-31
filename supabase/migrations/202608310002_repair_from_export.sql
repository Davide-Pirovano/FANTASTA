-- Import di una riparazione dall'Excel "Export lega completa". Le squadre
-- restano prenotate finché il relativo partecipante non le reclama in lobby.
create table public.repair_imported_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_name text not null,
  budget_remaining integer not null check (budget_remaining >= 0),
  turn_order smallint not null check (turn_order >= 0),
  roster jsonb not null default '[]'::jsonb check (jsonb_typeof(roster) = 'array'),
  claimed_participant_id uuid references public.participants(id) on delete set null,
  unique (league_id, team_name),
  unique (league_id, turn_order)
);

alter table public.repair_imported_teams enable row level security;
create policy repair_teams_owner_select on public.repair_imported_teams for select to authenticated
  using ((select private.is_league_owner(league_id)));
grant select on public.repair_imported_teams to authenticated;

alter table public.league_rules drop constraint if exists league_rules_release_refund_check;
alter table public.league_rules add constraint league_rules_release_refund_check
  check (release_refund in ('full','half','one','zero','quotation'));

create or replace function public.create_repair_auction_from_export(
  repair_name text, starting_budget integer, minimum_bid integer,
  auction_timer integer, auction_mode text, release_refund_rule text,
  moved_away_refund_rule text, credit_mode text, fixed_credits integer,
  player_rows jsonb, roster_rows jsonb
) returns public.leagues language plpgsql security definer set search_path = '' as $$
declare result public.leagues; team_item jsonb; purchase_item jsonb;
declare team_budget integer; missing_refund integer; team_index integer := 0;
declare p_slots integer; d_slots integer; c_slots integer; a_slots integer;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;
  if jsonb_typeof(player_rows) <> 'array' or jsonb_array_length(player_rows) = 0 then raise exception 'Importa il nuovo listone'; end if;
  if jsonb_typeof(roster_rows) <> 'array' or jsonb_array_length(roster_rows) < 2 then raise exception 'L export deve contenere almeno due squadre'; end if;
  if release_refund_rule not in ('one','half','full','zero','quotation') or moved_away_refund_rule not in ('one','half','full','quotation') then raise exception 'Regola crediti non valida'; end if;
  if credit_mode not in ('carry_over','fixed') or (credit_mode = 'fixed' and coalesce(fixed_credits,-1) < 0) then raise exception 'Modalita crediti non valida'; end if;

  with role_counts as (
    select t.ordinality as team_index, p.value->>'role' as role, count(p.value)::integer as amount
    from jsonb_array_elements(roster_rows) with ordinality t(value,ordinality)
    left join lateral jsonb_array_elements(t.value->'purchases') p on true
    group by t.ordinality,p.value->>'role'
  )
  select coalesce(max(amount) filter(where role='P'),0),
         coalesce(max(amount) filter(where role='D'),0),
         coalesce(max(amount) filter(where role='C'),0),
         coalesce(max(amount) filter(where role='A'),0)
    into p_slots,d_slots,c_slots,a_slots from role_counts;
  if p_slots+d_slots+c_slots+a_slots = 0 then raise exception 'L export non contiene rose valide'; end if;

  insert into public.leagues(owner_id,name,invite_code,status,participant_limit,initial_budget,min_bid,aste_mode)
  values ((select auth.uid()),trim(repair_name),upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'LOBBY',jsonb_array_length(roster_rows),starting_budget,minimum_bid,auction_mode)
  returning * into result;
  insert into public.league_rules(league_id,goalkeeper_slots,defender_slots,midfielder_slots,attacker_slots,auction_timer_seconds,release_refund)
  values(result.id,p_slots,d_slots,c_slots,a_slots,auction_timer,release_refund_rule);
  insert into public.players(league_id,name,real_team,role,quotation,is_trequartista)
  select result.id,trim(row.name),trim(row.real_team),upper(trim(row.role))::public.player_role,coalesce(nullif(row.quotation,'')::integer,1),coalesce(row.is_trequartista,false)
  from jsonb_to_recordset(player_rows) as row(name text,real_team text,role text,quotation text,is_trequartista boolean)
  on conflict do nothing;

  for team_item in select value from jsonb_array_elements(roster_rows) loop
    team_budget := case when credit_mode='fixed' then fixed_credits else (team_item->>'remainingBudget')::integer end;
    missing_refund := 0;
    for purchase_item in select value from jsonb_array_elements(team_item->'purchases') loop
      if not exists (select 1 from public.players where league_id=result.id and lower(name)=lower(trim(purchase_item->>'name'))) then
        missing_refund := missing_refund + case moved_away_refund_rule
          when 'one' then 1
          when 'half' then greatest(1,ceil((purchase_item->>'price')::integer/2.0))::integer
          when 'full' then (purchase_item->>'price')::integer
          else coalesce((purchase_item->>'quotation')::integer,(purchase_item->>'price')::integer) end;
      end if;
    end loop;
    insert into public.repair_imported_teams(league_id,team_name,budget_remaining,turn_order,roster)
    values(result.id,trim(team_item->>'teamName'),team_budget+missing_refund,team_index,team_item->'purchases');
    team_index := team_index+1;
  end loop;
  return result;
end $$;

create or replace function public.join_league(invite text, participant_name text, fantasy_team text)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare target public.leagues; result public.participants; next_turn integer;
declare reserved public.repair_imported_teams; purchase_item jsonb; target_player uuid; target_auction uuid;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;
  select * into target from public.leagues where invite_code=upper(invite) for update;
  if target.id is null or target.status not in ('SETUP','LOBBY') then raise exception 'Lega non disponibile'; end if;

  select * into reserved from public.repair_imported_teams
  where league_id=target.id and lower(team_name)=lower(trim(fantasy_team)) for update;
  if reserved.id is not null then
    if reserved.claimed_participant_id is not null then raise exception 'Questa squadra e gia stata collegata'; end if;
    insert into public.participants(league_id,user_id,display_name,team_name,budget_remaining,turn_order)
    values(target.id,(select auth.uid()),trim(participant_name),reserved.team_name,reserved.budget_remaining,reserved.turn_order)
    returning * into result;
    for purchase_item in select value from jsonb_array_elements(reserved.roster) loop
      select id into target_player from public.players where league_id=target.id and lower(name)=lower(trim(purchase_item->>'name')) limit 1;
      if target_player is not null then
        update public.players set status='SOLD' where id=target_player;
        insert into public.auctions(league_id,player_id,nominated_by,current_bid,highest_bidder_id,status,completed_at)
        values(target.id,target_player,result.id,(purchase_item->>'price')::integer,result.id,'AWARDED',now()) returning id into target_auction;
        insert into public.purchases(league_id,auction_id,participant_id,player_id,price)
        values(target.id,target_auction,result.id,target_player,(purchase_item->>'price')::integer);
      end if;
    end loop;
    update public.repair_imported_teams set claimed_participant_id=result.id where id=reserved.id;
    return result;
  end if;

  if exists(select 1 from public.repair_imported_teams where league_id=target.id) then
    raise exception 'Inserisci il nome esatto di una squadra presente nell export';
  end if;
  if exists(select 1 from public.participants where league_id=target.id and lower(team_name)=lower(trim(fantasy_team))) then raise exception 'Nome squadra gia usato in questa lega'; end if;
  select count(*) into next_turn from public.participants where league_id=target.id;
  if next_turn>=target.participant_limit then raise exception 'Lobby completa'; end if;
  insert into public.participants(league_id,user_id,display_name,team_name,budget_remaining,turn_order)
  values(target.id,(select auth.uid()),trim(participant_name),trim(fantasy_team),target.initial_budget,next_turn) returning * into result;
  return result;
end $$;

-- Nelle riparazioni importate l'asta può partire solo dopo che tutte le rose
-- sono state reclamate dai rispettivi partecipanti.
create or replace function public.set_league_status(target_league uuid,new_status public.league_status)
returns public.leagues language plpgsql security definer set search_path = '' as $$
declare result public.leagues;
begin
  if not (select private.is_league_owner(target_league)) then raise exception 'Solo admin'; end if;
  if new_status='LIVE' and not exists(select 1 from public.participants where league_id=target_league) then raise exception 'Serve almeno un partecipante'; end if;
  if new_status='LIVE' and exists(select 1 from public.repair_imported_teams where league_id=target_league and claimed_participant_id is null) then raise exception 'Attendi che tutte le squadre entrino nella lobby'; end if;
  update public.leagues set status=new_status,updated_at=now() where id=target_league returning * into result;
  insert into public.admin_actions(league_id,actor_id,action_type,payload) values(target_league,(select auth.uid()),'SET_STATUS',jsonb_build_object('status',new_status));
  return result;
end $$;

-- Lo svincolo preparatorio è consentito già in lobby.
create or replace function public.release_player(target_player uuid)
returns public.purchases language plpgsql security definer set search_path = '' as $$
declare purchase_row public.purchases; league_row public.leagues; rules_row public.league_rules; player_quotation integer; refund integer; owner_participant public.participants;
begin
  if (select auth.uid()) is null then raise exception 'Autenticazione richiesta'; end if;
  select * into purchase_row from public.purchases where player_id=target_player and released_at is null for update;
  if purchase_row.id is null then raise exception 'Giocatore non acquistato o gia svincolato'; end if;
  select * into league_row from public.leagues where id=purchase_row.league_id;
  if league_row.status not in ('LOBBY','LIVE','PAUSED','COMPLETED') then raise exception 'La lega non consente svincoli'; end if;
  select * into owner_participant from public.participants where id=purchase_row.participant_id and user_id=(select auth.uid());
  if owner_participant.id is null and not (select private.is_league_owner(purchase_row.league_id)) then raise exception 'Non puoi svincolare questo giocatore'; end if;
  select * into rules_row from public.league_rules where league_id=purchase_row.league_id;
  select quotation into player_quotation from public.players where id=purchase_row.player_id;
  refund := case rules_row.release_refund when 'full' then purchase_row.price when 'half' then greatest(1,ceil(purchase_row.price/2.0)) when 'one' then 1 when 'quotation' then player_quotation else 0 end;
  update public.participants set budget_remaining=budget_remaining+refund where id=purchase_row.participant_id;
  update public.players set status='AVAILABLE' where id=purchase_row.player_id;
  update public.purchases set released_at=now() where id=purchase_row.id returning * into purchase_row;
  return purchase_row;
end $$;

revoke execute on function public.create_repair_auction_from_export(text,integer,integer,integer,text,text,text,text,integer,jsonb,jsonb) from public,anon;
grant execute on function public.create_repair_auction_from_export(text,integer,integer,integer,text,text,text,text,integer,jsonb,jsonb) to authenticated;
