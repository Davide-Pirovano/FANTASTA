# Infrastruttura

- `docker/web.Dockerfile` costruisce l'immagine standalone della modalità web.
- `docker-compose.yml` resta alla radice come entrypoint pubblico del repository.
- `supabase/` resta alla radice perché è la posizione convenzionale attesa dalla Supabase CLI.

L'app desktop non userà questa infrastruttura: includerà runtime locale, SQLite e server LAN nel proprio pacchetto installabile.
