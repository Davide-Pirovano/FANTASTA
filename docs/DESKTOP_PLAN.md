# Piano della modalità desktop

## Obiettivo

Distribuire Fantasta come applicazione nativa installabile su macOS e Windows senza Docker, mantenendo contemporaneamente la modalità web attuale. Il PC dell'admin è l'host autorevole dell'asta; telefoni e altri PC partecipano dal browser sulla stessa LAN.

## Architettura target

```text
App Electron sul PC host
├── finestra admin (UI Next/React riutilizzata)
├── server HTTP locale, esposto sulla LAN
├── server WebSocket per gli aggiornamenti live
└── SQLite, unico database autorevole
          │
          └── browser partecipanti su telefono o PC via QR/link LAN
```

La variante web conserva invece Next.js + Supabase/PostgreSQL/Realtime e l'avvio Docker esistente. Le due distribuzioni condividono dominio, contratti e gran parte della UI, ma usano adapter infrastrutturali distinti.

## Decisioni tecniche

| Area | Web | Desktop |
| --- | --- | --- |
| Shell | Browser | Electron |
| Rendering | Next.js | Next.js nel runtime locale |
| Database | PostgreSQL/Supabase | SQLite incorporato |
| Operazioni atomiche | RPC PostgreSQL | transazioni del servizio locale |
| Realtime | Supabase Realtime | WebSocket locale |
| Identità | sessione anonima Supabase | token locale per browser/dispositivo |
| Distribuzione | Docker/Vercel/VPS | installer firmabile macOS/Windows |

Electron è la prima scelta perché usa Chromium su entrambi i sistemi, massimizza la fedeltà visiva e permette di riutilizzare Next.js, Node e le librerie Excel. Tauri rimane un'alternativa futura, ma richiederebbe più lavoro d'integrazione e introdurrebbe differenze tra WebView di macOS e Windows.

## Confini da estrarre

1. **Dominio puro** — calcolo budget, slot, ruoli, turni, fasi, rilanci, timer e rimborsi senza import Supabase.
2. **Contratti** — schema stabile per snapshot, comandi ed eventi; validazione degli input condivisa.
3. **Accesso dati** — interfacce usate dalle azioni applicative, implementate prima da Supabase e poi da SQLite.
4. **Realtime** — un hook/API comune con adapter Supabase per il web e WebSocket per il desktop.
5. **UI** — componenti che ricevono dati e comandi, senza conoscere il trasporto sottostante. **I controlli d'asta usano ora `AuctionActionsProvider`: il web conserva le server action, il desktop può iniettare il client LAN.**

Il primo adapter client locale è in `apps/desktop/src/client.ts`: la UI potrà usarlo per snapshot, comandi ed eventi LAN. `LocalAdminShell` in `apps/web/components/auction` monta già la regia React esistente contro questo adapter; le pagine Next pubblicate continuano temporaneamente a usare Supabase, fino alla sostituzione graduale di query, sessione e realtime.

Non è prevista una sincronizzazione tra PostgreSQL e SQLite: ogni asta vive interamente nella modalità con cui è stata avviata. Questo evita conflitti e rende il database desktop semplice da salvare, ripristinare e trasferire.

## Fasi di sviluppo

Stato corrente: fasi 1–5 completate; fase 6 avviata — il pacchetto macOS (`.dmg`) include renderer Next standalone e server locale CommonJS, è firmato con identità Developer ID e l'avvio isolato (server SQLite + renderer + sessione admin cifrata) è verificato. Restano notarizzazione (servono i certificati), build Windows da CI e test multi-dispositivo reale.

### 1. Monorepo senza regressioni

- spostare la web app in `apps/web`;
- mantenere invariati `make up` e i comandi npm dalla radice;
- separare Docker e documentare i workspace.

### 2. Contratti e test di dominio

- inventariare RPC, tabelle e assunzioni RLS dell'app corrente;
- estrarre tipi, validazioni e regole pure in `packages`;
- creare test di parità sui flussi critici prima di cambiare il trasporto.

### 3. Servizio locale e SQLite

- scegliere ORM/driver SQLite compatibile con Electron e packaging;
- definire schema e migrazioni locali;
- implementare transazioni equivalenti alle RPC: join/rientro, nomina, offerta, aggiudicazione, pausa, svincolo ed export;
- implementare backup atomico e ripristino esplicito del file database.

Il backup consistente è implementato con l'API nativa SQLite e testato; il ripristino esplicito dalla shell Electron (dialogo nativo, validazione, copia di sicurezza pre-ripristino e riavvio del servizio) è implementato in `apps/desktop/electron/main.cjs` ed esposto al renderer via preload.

### 4. Server LAN e identità locale

- esporre HTTP/WebSocket soltanto sulle interfacce necessarie; **prima versione implementata**;
- generare token di sessione locali e codici lega non prevedibili; **sessioni locali già disponibili via `/api/session`**;
- mostrare IP/porta/QR e diagnostica firewall;
- gestire cambio rete, sospensione del PC e riconnessione dei client.

La prima vista partecipante LAN è implementata in `LocalParticipantShell`: sessione browser locale, join/rientro, snapshot HTTP e WebSocket. Il renderer Next viene esposto sulla LAN (`HOSTNAME=0.0.0.0`), quindi il QR del wizard è apribile dal telefono. Il test reale multi-browser e la diagnostica firewall restano da completare.

### 5. Shell Electron

- avviare e arrestare in modo coordinato server e database; **implementata** in `apps/desktop/electron/main.cjs` (lock a singola istanza, avvio/arresto dei due processi, health check);
- mostrare stato host, URL LAN e partecipanti connessi; **da completare** (oggi la regia riusa la vista web, l'URL LAN appare nel QR del wizard);
- impedire istanze host concorrenti sullo stesso archivio; **implementato** con `requestSingleInstanceLock`;
- aggiungere log diagnostici esportabili senza includere segreti; **da completare**;
- il setup desktop riusa già il wizard React web e la sessione admin viene salvata cifrata con `safeStorage` quando disponibile.

### 6. Packaging e release

- produrre artefatti macOS e Windows tramite GitHub Actions; **workflow scritto** (`.github/workflows/release-desktop.yml`: macos-13/14 + windows-latest, firma via `CSC_*`, notarizzazione condizionale);
- aggiungere icone, versionamento e aggiornamenti controllati; **icone custom generate** (`apps/desktop/build/icon.icns`/`.ico` dallo stesso logo web), versionamento da tag `v*`, aggiornamenti automatici non ancora configurati;
- firmare/notarizzare quando sono disponibili i certificati; **firma Developer ID verificata localmente**, notarizzazione pronta in CI ma da attivare con i secret Apple;
- documentare chiaramente gli avvisi di sicurezza per build non firmate.

## Criteri di parità

La modalità desktop è pronta quando copre setup/import, lobby e QR, entrambe le modalità d'asta, timer e aggiudicazione automatica, pausa/ripresa, svincolo, rientro/trasferimento dispositivo, export e recupero dopo riavvio. I test devono includere almeno due browser partecipanti reali oltre alla finestra admin.

## Rischi principali

- tradurre correttamente in transazioni SQLite le garanzie oggi offerte dalle RPC PostgreSQL;
- evitare doppie aggiudicazioni tra timer, admin e riconnessioni;
- firewall e reti Wi-Fi con isolamento client;
- moduli SQLite nativi e compatibilità degli installer per entrambe le piattaforme;
- firma/notarizzazione, che non blocca lo sviluppo ma incide sull'esperienza di installazione pubblica.

Il codice UI non deve essere duplicato per aggirare questi rischi: le differenze devono rimanere negli adapter dati, realtime e runtime.
