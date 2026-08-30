# Pacchetti condivisi

Questa directory contiene solo codice realmente condiviso tra web e desktop. L'estrazione procede partendo dai comportamenti già coperti dall'app web.

Confini previsti:

- `domain` — **attivo**: tipi, snapshot e regole d'asta indipendenti dal database;
- `contracts` — **attivo**: comandi validati e mappa delle operazioni applicative;
- `ui` — componenti riutilizzabili che non dipendono da Supabase;
- `data-access` — interfacce dei repository e adapter per Supabase/SQLite;
- `realtime` — contratto di sottoscrizione con implementazioni Supabase/WebSocket.

`domain` e `contracts` sono già consumati da `apps/web` e coperti da test. Gli altri workspace nasceranno quando avranno un primo consumer e test propri.
