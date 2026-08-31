alter table public.purchases add column is_initial_roster boolean not null default false;

update public.purchases purchase set is_initial_roster = true
where exists (select 1 from public.leagues where id = purchase.league_id and status = 'LOBBY' and repair_of_league_id is not null)
   or exists (select 1 from public.repair_imported_teams where league_id = purchase.league_id);

create function public.mark_repair_initial_roster() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.leagues where id = new.league_id and status = 'LOBBY' and repair_of_league_id is not null)
    or exists (select 1 from public.repair_imported_teams where league_id = new.league_id) then
    new.is_initial_roster := true;
  end if;
  return new;
end $$;

create trigger purchases_mark_repair_initial_roster
  before insert on public.purchases for each row execute function public.mark_repair_initial_roster();
