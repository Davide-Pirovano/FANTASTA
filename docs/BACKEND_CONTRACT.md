# Contratto applicativo e garanzie del backend

Questo documento fotografa il comportamento effettivo della modalità web dopo tutte le migrazioni Supabase. È il riferimento per implementare il futuro servizio SQLite senza riscrivere o duplicare la UI.

## Confine applicativo

La UI invia comandi definiti in `@fantasta/contracts` e consuma lo snapshot `LeagueState` di `@fantasta/domain`. Supabase è l'adapter attuale; il servizio locale desktop dovrà implementare gli stessi casi d'uso e produrre lo stesso snapshot.

```text
UI Next/React
   │ comandi e snapshot condivisi
   ▼
Application service
   ├── adapter Supabase: RPC + RLS + Realtime
   └── adapter desktop: SQLite + sessioni locali + WebSocket
```

## Modello persistente corrente

| Tabella | Responsabilità | Vincoli che il desktop deve mantenere |
| --- | --- | --- |
| `leagues` | Configurazione e stato dell'asta | codice invito univoco; owner; budget/minimo positivi; turno non negativo |
| `league_rules` | Slot, timer e rimborso | una riga per lega; almeno uno slot; timer e modalità validi |
| `participants` | Squadre e sessioni | utente, ordine turno e nome squadra univoci nella lega; budget non negativo |
| `players` | Listone e disponibilità | identità nome+squadra univoca nella lega; stato coerente con asta/acquisto |
| `auctions` | Asta attiva e storico | al massimo una asta `ACTIVE` per lega; versione incrementale; deadline server-side |
| `bids` | Storico offerte | importo positivo e riferimenti validi |
| `purchases` | Acquisti e svincoli | una aggiudicazione per asta; al massimo un acquisto non svincolato per giocatore |
| `participant_transfers` | Cambio dispositivo | ultimo spostamento recuperabile dalla sessione precedente |
| `admin_actions` | Audit minimo | registra stato, aggiudicazioni e operazioni automatiche |

Gli indici parziali `one_active_auction_per_league` e `purchases_active_player_unique` sono invarianti di dominio, non semplici ottimizzazioni PostgreSQL.

## Operazioni pubbliche

I nomi Supabase sono centralizzati in `SUPABASE_RPC`; il servizio desktop userà nomi applicativi indipendenti dal database.

| Operazione | Attore | Garanzia atomica / effetto |
| --- | --- | --- |
| `getLeagueOverview` | pubblico | restituisce solo i dati minimi necessari per aprire l'ingresso |
| `getMyTransfer` | sessione precedente | restituisce l'ultimo trasferimento visibile al vecchio dispositivo |
| `createLeague` | utente autenticato | crea lega e regole nella stessa transazione |
| `importPlayers` | admin | inserimento massivo, normalizzazione e deduplicazione |
| `joinLeague` | utente autenticato | blocca la lega; verifica stato, capienza e unicità; assegna il turno |
| `rejoinLeague` | utente autenticato | trasferisce atomicamente la squadra alla nuova sessione e registra il vecchio device |
| `setLeagueStatus` | admin | aggiorna stato; pausa congela la deadline, ripresa la rigenera |
| `setLeaguePhase` | admin | valida modalità/fase e ricalcola un chiamante idoneo |
| `nominatePlayer` | partecipante di turno | blocca giocatore e lega; chiude eventuali aste scadute; valida slot/fase; crea asta, offerta base e deadline |
| `placeBid` | partecipante | blocca asta e offerente; valida deadline, stato, slot e riserva di budget; registra offerta e rinnova deadline |
| `awardPlayer` | admin | completa una sola volta l'asta, scala budget, crea acquisto e avanza turno/fase |
| `resolveAuction` | membro | come `awardPlayer`, ma solo dopo deadline; se già completata restituisce senza duplicare |
| `cancelAuction` | admin | blocca l'asta, la annulla e riporta il giocatore tra i disponibili |
| `releasePlayer` | proprietario squadra o admin | blocca l'acquisto attivo; accredita rimborso, libera giocatore e slot |
| `deleteLeague` | admin | elimina la lega e i dati dipendenti tramite cascata |

## Regole pure già estratte

`@fantasta/domain` contiene ora:

- ruoli, fasi, modalità, stati e politiche di rimborso;
- calcolo del rimborso `full/half/one/zero`;
- massimo rilancio con riserva del minimo per gli slot residui;
- validazione preliminare dell'offerta;
- conteggio slot e costruzione delle rose attive, escludendo gli svincoli.

`@fantasta/contracts` contiene gli schemi runtime dei comandi, lo schema di setup/import e la mappa completa delle operazioni Supabase. Questi schemi devono validare sia richieste HTTP/WebSocket desktop sia Server Actions web.

## Concorrenza da replicare in SQLite

Per ogni comando di scrittura il servizio desktop deve:

1. validare formato e identità prima della transazione quando possibile;
2. aprire una transazione di scrittura breve;
3. rileggere all'interno della transazione asta, lega, partecipante e acquisto coinvolti;
4. applicare controlli e aggiornamenti senza chiamate esterne;
5. fare commit prima di pubblicare l'evento WebSocket;
6. produrre un solo nuovo snapshot/versione per il comando confermato.

SQLite serializza gli scrittori, ma questo non sostituisce aggiornamenti condizionali e vincoli univoci: timer, click admin e rilanci possono comunque arrivare quasi contemporaneamente. L'aggiudicazione deve restare idempotente e il primo commit valido deve vincere.

## Identità e autorizzazione

Nel web, `auth.uid()`, RLS e privilegi minimi isolano ogni lega. Nel desktop l'equivalente deve stare nel servizio locale, mai nel browser:

- token di sessione casuale conservato dal client;
- associazione token → admin o partecipante;
- controllo lega e ruolo su ogni comando;
- nessun accesso diretto al file SQLite dalla UI Electron;
- token e segreti esclusi da URL, QR, log ed export.

L'accesso LAN non rende affidabile la rete: un partecipante può inviare richieste manuali e deve ricevere gli stessi rifiuti garantiti oggi dalle RPC.

## Realtime

Supabase invalida lo snapshot dopo modifiche confermate. Il desktop deve fare lo stesso via WebSocket:

- emettere eventi soltanto dopo il commit;
- includere almeno `leagueId`, tipo evento e versione monotona;
- permettere al client riconnesso di scartare eventi vecchi e ricaricare lo snapshot;
- conservare un canale dedicato al trasferimento della squadra verso un altro dispositivo.

Gli eventi sono notifiche di invalidazione, non la fonte autorevole dei dati: dopo una disconnessione lo snapshot del server prevale sempre.
