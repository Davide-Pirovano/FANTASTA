# Architettura MVP

## Obiettivi

Fantasta usa Next.js App Router per interfaccia e rendering server-side, Supabase Auth per identita anonime e admin, PostgreSQL per regole di dominio e Supabase Realtime per propagare gli aggiornamenti confermati.

## Modello di esecuzione

1. L'admin autenticato crea una lega ed e registrato come proprietario.
2. Un partecipante apre il codice invito, esegue sign-in anonimo e chiama `join_league`. Se chiude la pagina e perde la sessione anonima (cookie cancellati, altro browser), `rejoin_league` riassegna la sessione corrente al partecipante tramite il nome squadra: funziona anche ad asta già partita (la pagina di ingresso offre la modalità "Rientra", e la home mostra "Rientra nella tua asta" per chi è dentro una lega attiva).
3. Le pagine leggono uno snapshot server-side della lega.
4. Il client si iscrive al canale privato `league:<id>` e invalida lo snapshot quando riceve un evento.
5. Offerte, aggiudicazioni e correzioni passano esclusivamente da RPC Postgres.
6. `place_bid` blocca la riga dell'asta, ricalcola budget e slot, quindi inserisce l'offerta e aggiorna l'asta nella stessa transazione.
7. La nomina apre l'asta con il chiamante come miglior offerente alla base d'asta e fissa `auctions.bid_deadline` (server-side, `league_rules.auction_timer_seconds`, default 15s); ogni offerta valida sposta la deadline avanti.
8. Allo scadere, `resolve_auction` (idempotente, serializzato dal lock sulla riga asta) aggiudica al miglior offerente: la prima chiamata vince, le successive sono no-op. Il client mostra solo un countdown della deadline; anche `nominate_player` chiude le aste scadute rimaste in sospeso (sweep) se nessun browser era connesso.
9. **Fasi per ruolo**: l'asta procede P → D → C → A (`leagues.auction_phase`). In ogni fase possono chiamare solo i partecipanti con slot liberi per quel ruolo (`private.next_eligible_turn`) e solo giocatori del ruolo corrente (validato in `nominate_player`). Dopo ogni aggiudicazione `private.advance_league` porta il turno al prossimo chiamante idoneo e, quando nessuno può più chiamare (slot pieni o listone esaurito), avanza la fase automaticamente; l'admin può spostarla manualmente con `set_league_phase`. In alternativa la lega può nascere in modalità **ordine sparso** (`leagues.aste_mode = 'libero'`): niente vincolo di ruolo, il turno gira tra chi ha slot totali liberi (`private.owned_total` / `private.total_slots`).
10. **Svincolo**: `release_player` libera un acquisto (`purchases.released_at`) quando la lega è LIVE/PAUSED/COMPLETED: il giocatore torna `AVAILABLE`, lo slot si libera e il rimborso segue `league_rules.release_refund` ('full' prezzo pieno, 'half' metà con minimo 1, 'one' 1 credito, 'zero' 0 crediti). Lo svincolo è sempre possibile; la politica decide solo il rimborso. I conteggi di rosa (`owned_role`, `owned_total`, `place_bid`) escludono le acquisizioni svincolate; un giocatore può avere al più un acquisto attivo (indice parziale `purchases_active_player_unique`).
11. **Pausa e timer**: mettendo la lega in PAUSED (`set_league_status`) il countdown delle aste attive viene congelato (`auctions.bid_deadline = null`): il timer client si ferma e `resolve_auction` non può mai scattare (blocca anche esplicitamente se la lega non è LIVE). Alla ripresa (LIVE) la deadline dell'asta ancora attiva riparte dal massimo (`now() + auction_timer_seconds`).
12. **Sessioni e multi-dispositivo**: una squadra appartiene a un solo utente (`unique(league_id, user_id)` + nome squadra univoco per lega). `join_league` rifiuta i nomi duplicati con un messaggio chiaro; `rejoin_league` ritorna anche `moved` quando la squadra viene spostata su un'altra sessione (l'ultimo che rientra vince). Il dispositivo che perde la squadra viene avvisato: `participant_transfers` registra ogni spostamento e `get_my_transfer` permette al server di mostrare l'avviso "La tua squadra è collegata a un altro dispositivo" (con ritorno automatico alla home e possibilità di rientrare da lì); a pagina aperta lo spostamento viene segnalato subito con un broadcast sul canale `team-moved:<league_id>` inviato da chi rientra (il realtime classico non raggiunge il vecchio device perché la RLS gli nasconde la riga).

## Accesso da smartphone (rete locale)

- `apps/web/hooks/use-lan-origin.ts` risolve l'origin dei link di invito: se la pagina è servita da `localhost` rileva l'IP locale del Mac (trucco RTCPeerConnection) e genera QR/link con `http://<IP>:3000`; l'admin può sovrascrivere a mano (persistito in `localStorage`).
- `apps/web/lib/supabase/client.ts` riscrive l'host di `NEXT_PUBLIC_SUPABASE_URL` con l'host della pagina quando questa è servita da un host non loopback: sul telefono REST e realtime raggiungono Supabase via `http://<IP>:54321` invece di `127.0.0.1`.
- Le porte `3000` e `54321` sono pubblicate su `0.0.0.0` dai container Docker; il telefono deve essere sulla stessa rete Wi-Fi del Mac.

## Route

| Route | Ruolo | Scopo |
| --- | --- | --- |
| `/` | pubblico | ingresso e creazione lega |
| `/setup` | admin | wizard lega, import, regole e lobby |
| `/league/[code]` | partecipante | ingresso e asta mobile-first |
| `/league/[code]/admin` | admin | regia desktop dell'asta |

La verifica end-to-end del motore asta (crea lega, import, join, nomina con base d'asta, offerte atomiche, aggiudicazione manuale, scadenza timer + aggiudicazione automatica, annullamento, rollback, modalità libera, svincolo con le tre politiche di rimborso) è in `scripts/e2e-auction-flow.ts`: `node --env-file=.env.local scripts/e2e-auction-flow.ts`.

## Moduli React

- `auction-stage`: giocatore corrente, prezzo, leader e stato turno.
- `bid-controls`: rilanci rapidi, offerta personalizzata e limite dinamico.
- `team-overview`: crediti, slot e composizione delle rose.
- `setup-wizard`: creazione, import Excel, regole e lobby QR.
- `recent-purchases`: storico recente dell'asta.

## Autorizzazione

- Le tabelle pubbliche hanno RLS attiva e grant minimi.
- Le letture richiedono appartenenza alla lega.
- Le modifiche dirette a budget, rose, aste e acquisti non sono concesse ai client.
- Le funzioni privilegiate sono in schema `private`, hanno `search_path = ''` e sono esposte tramite wrapper RPC con controlli espliciti.
- Le azioni admin verificano sempre `leagues.owner_id = auth.uid()`.

## Realtime

Per l'MVP sono abilitate le Postgres Changes sulle tabelle calde (`leagues`, `participants`, `players`, `auctions`, `purchases`). Le offerte non vengono sottoscritte direttamente: ogni `place_bid` aggiorna la riga `auctions` (prezzo + miglior offerente) e quel cambiamento invalida lo snapshot.

Due accorgimenti necessari per farlo funzionare con RLS:

1. `apps/web/hooks/use-league-realtime.ts` propaga la sessione al client realtime (`getSession` + `setSession`) prima di `subscribe()`: in caso contrario la join del canale parte anonima e Postgres Changes applica RLS scartando ogni evento.
2. La migrazione `202608270004_realtime_replica_identity_full.sql` imposta `REPLICA IDENTITY FULL` sulle tabelle sottoscritte, altrimenti gli eventi UPDATE/DELETE non includono il vecchio record e la valutazione delle policy fallisce.

Per carichi maggiori la migrazione e predisposta a passare a Broadcast su canali privati, soluzione raccomandata da Supabase per scalabilita e sicurezza.

## Export

`read-excel-file` e `write-excel-file` vengono caricati dinamicamente soltanto durante import/export. L'export partecipante crea una sheet rosa; quello admin aggiunge riepilogo, una sheet per squadra e storico acquisti.

## Import Excel

Il parser `apps/web/lib/domain/excel-parser.ts` supporta il formato FantaMaster reale: foglio `Tutti` (o divisione per ruolo), riga banner, intestazioni `Nome/Squadra/Ruolo/Quotazione/Trequartista` e righe di coda ignorate. Tipi, snapshot e calcoli indipendenti dal trasporto sono in `packages/domain`; gli schemi dei comandi sono in `packages/contracts`.
