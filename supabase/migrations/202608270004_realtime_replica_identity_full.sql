-- Realtime + RLS richiede REPLICA IDENTITY FULL sulle tabelle sottoscritte:
-- senza di essa gli eventi UPDATE/DELETE non includono il vecchio record e la
-- valutazione delle policy (Postgres Changes con RLS) scarta gli eventi.
alter table public.leagues replica identity full;
alter table public.participants replica identity full;
alter table public.players replica identity full;
alter table public.auctions replica identity full;
alter table public.bids replica identity full;
alter table public.purchases replica identity full;
