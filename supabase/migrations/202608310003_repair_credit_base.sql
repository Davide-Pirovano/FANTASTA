-- La base uguale può sommarsi ai crediti residui senza alterare la semantica
-- delle due RPC originarie. Le rinominiamo e le avvolgiamo nel nuovo modo.
alter function public.create_repair_auction(uuid,text,integer,integer,integer,text,text,text,text,integer,jsonb)
  rename to create_repair_auction_base;
alter function public.create_repair_auction_from_export(text,integer,integer,integer,text,text,text,text,integer,jsonb,jsonb)
  rename to create_repair_auction_from_export_base;

create function public.create_repair_auction(
  source_league uuid, repair_name text, starting_budget integer, minimum_bid integer,
  auction_timer integer, auction_mode text, release_refund_rule text,
  moved_away_refund_rule text, credit_mode text, fixed_credits integer, player_rows jsonb
) returns public.leagues language plpgsql security definer set search_path = '' as $$
declare result public.leagues;
begin
  if credit_mode = 'carry_plus' then
    if coalesce(fixed_credits, -1) < 0 then raise exception 'Modalita crediti non valida'; end if;
    select * into result from public.create_repair_auction_base(source_league,repair_name,starting_budget,minimum_bid,auction_timer,auction_mode,release_refund_rule,moved_away_refund_rule,'carry_over',null,player_rows);
    update public.participants set budget_remaining=budget_remaining+fixed_credits where league_id=result.id;
    return result;
  end if;
  return public.create_repair_auction_base(source_league,repair_name,starting_budget,minimum_bid,auction_timer,auction_mode,release_refund_rule,moved_away_refund_rule,credit_mode,fixed_credits,player_rows);
end $$;

create function public.create_repair_auction_from_export(
  repair_name text, starting_budget integer, minimum_bid integer, auction_timer integer,
  auction_mode text, release_refund_rule text, moved_away_refund_rule text,
  credit_mode text, fixed_credits integer, player_rows jsonb, roster_rows jsonb
) returns public.leagues language plpgsql security definer set search_path = '' as $$
declare result public.leagues;
begin
  if credit_mode = 'carry_plus' then
    if coalesce(fixed_credits, -1) < 0 then raise exception 'Modalita crediti non valida'; end if;
    select * into result from public.create_repair_auction_from_export_base(repair_name,starting_budget,minimum_bid,auction_timer,auction_mode,release_refund_rule,moved_away_refund_rule,'carry_over',null,player_rows,roster_rows);
    update public.repair_imported_teams set budget_remaining=budget_remaining+fixed_credits where league_id=result.id;
    return result;
  end if;
  return public.create_repair_auction_from_export_base(repair_name,starting_budget,minimum_bid,auction_timer,auction_mode,release_refund_rule,moved_away_refund_rule,credit_mode,fixed_credits,player_rows,roster_rows);
end $$;

revoke execute on function public.create_repair_auction(uuid,text,integer,integer,integer,text,text,text,text,integer,jsonb) from public,anon;
grant execute on function public.create_repair_auction(uuid,text,integer,integer,integer,text,text,text,text,integer,jsonb) to authenticated;
revoke execute on function public.create_repair_auction_from_export(text,integer,integer,integer,text,text,text,text,integer,jsonb,jsonb) from public,anon;
grant execute on function public.create_repair_auction_from_export(text,integer,integer,integer,text,text,text,text,integer,jsonb,jsonb) to authenticated;
