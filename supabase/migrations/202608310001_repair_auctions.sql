-- Un'asta di riparazione è una nuova lega collegata alla fonte: lo storico
-- dell'asta iniziale resta immutabile e la preparazione è atomica.
alter table public.leagues add column if not exists repair_of_league_id uuid
  references public.leagues(id) on delete set null;
create index if not exists leagues_repair_of_idx on public.leagues(repair_of_league_id);

create or replace function public.create_repair_auction(
  source_league uuid, repair_name text, starting_budget integer, minimum_bid integer,
  auction_timer integer, auction_mode text, release_refund_rule text,
  moved_away_refund_rule text, credit_mode text, fixed_credits integer, player_rows jsonb
) returns public.leagues language plpgsql security definer set search_path = '' as $$
declare source public.leagues; source_rules public.league_rules; result public.leagues;
declare source_purchase record; copied_participant uuid; copied_player uuid; copied_auction uuid; refund integer;
begin
  if not (select private.is_league_owner(source_league)) then raise exception 'Solo l''admin dell''asta iniziale puo creare la riparazione'; end if;
  select * into source from public.leagues where id = source_league for share;
  if source.id is null or source.status <> 'COMPLETED' then raise exception 'Seleziona un''asta conclusa'; end if;
  if jsonb_typeof(player_rows) <> 'array' or jsonb_array_length(player_rows) = 0 then raise exception 'Importa il nuovo listone'; end if;
  if release_refund_rule not in ('one','half','full','zero','quotation') or moved_away_refund_rule not in ('one','half','full','quotation') then raise exception 'Regola crediti non valida'; end if;
  if credit_mode not in ('carry_over','fixed') or (credit_mode = 'fixed' and coalesce(fixed_credits, -1) < 0) then raise exception 'Modalita crediti non valida'; end if;
  select * into source_rules from public.league_rules where league_id = source.id;
  insert into public.leagues(owner_id,name,invite_code,status,participant_limit,initial_budget,min_bid,aste_mode,repair_of_league_id)
  values ((select auth.uid()), trim(repair_name), upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)), 'LOBBY', source.participant_limit, starting_budget, minimum_bid, auction_mode, source.id) returning * into result;
  insert into public.league_rules(league_id,goalkeeper_slots,defender_slots,midfielder_slots,attacker_slots,auction_timer_seconds,release_refund)
  values(result.id,source_rules.goalkeeper_slots,source_rules.defender_slots,source_rules.midfielder_slots,source_rules.attacker_slots,auction_timer,release_refund_rule);
  insert into public.players(league_id,name,real_team,role,quotation,is_trequartista)
  select result.id,trim(row.name),trim(row.real_team),upper(trim(row.role))::public.player_role,coalesce(nullif(row.quotation,'')::integer,1),coalesce(row.is_trequartista,false)
  from jsonb_to_recordset(player_rows) as row(name text,real_team text,role text,quotation text,is_trequartista boolean)
  on conflict do nothing;
  insert into public.participants(league_id,user_id,display_name,team_name,budget_remaining,turn_order,connected)
  select result.id,p.user_id,p.display_name,p.team_name,case when credit_mode='fixed' then fixed_credits else p.budget_remaining end,p.turn_order,false
  from public.participants p where p.league_id=source.id;
  -- I calciatori ancora nel listone restano in rosa, con prezzo storico. Gli
  -- assenti sono già svincolati e accreditano la regola specifica.
  for source_purchase in
    select pu.*, old.quotation as old_quotation, old.name from public.purchases pu join public.players old on old.id=pu.player_id
    where pu.league_id=source.id and pu.released_at is null
  loop
    select id into copied_participant from public.participants where league_id=result.id and team_name=(select team_name from public.participants where id=source_purchase.participant_id);
    select id into copied_player from public.players where league_id=result.id and lower(name)=lower(source_purchase.name) limit 1;
    if copied_player is null then
      refund := case moved_away_refund_rule when 'one' then 1 when 'half' then greatest(1,ceil(source_purchase.price/2.0)) when 'full' then source_purchase.price else source_purchase.old_quotation end;
      update public.participants set budget_remaining=budget_remaining+refund where id=copied_participant;
    else
      update public.players set status='SOLD' where id=copied_player;
      insert into public.auctions(id,league_id,player_id,nominated_by,current_bid,highest_bidder_id,status,completed_at)
      values(gen_random_uuid(),result.id,copied_player,copied_participant,source_purchase.price,copied_participant,'AWARDED',now()) returning id into copied_auction;
      insert into public.purchases(league_id,auction_id,participant_id,player_id,price,created_at)
      values(result.id,copied_auction,copied_participant,copied_player,source_purchase.price,source_purchase.created_at);
    end if;
  end loop;
  return result;
end $$;
revoke execute on function public.create_repair_auction(uuid,text,integer,integer,integer,text,text,text,text,integer,jsonb) from public, anon;
grant execute on function public.create_repair_auction(uuid,text,integer,integer,integer,text,text,text,text,integer,jsonb) to authenticated;
