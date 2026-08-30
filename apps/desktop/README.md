# Fantasta Desktop

Questo workspace contiene l'app desktop distribuita per macOS e Windows. Electron avvia il renderer Next.js, il servizio SQLite e il server LAN nello stesso prodotto installabile; l'admin usa la finestra nativa e i partecipanti entrano dal browser senza installare nulla.

Principi del prodotto:

- un solo database SQLite autorevole sul PC che gestisce l'asta;
- interfaccia admin eseguita nella finestra desktop;
- partecipanti da browser mobile o desktop tramite la stessa LAN;
- riuso dell'interfaccia Next.js e della logica condivisa;
- nessuna dipendenza da Docker o Supabase nella distribuzione desktop;
- modalità web Docker mantenuta e supportata in parallelo.

## Database locale

La persistenza usa `node:sqlite`, incluso nel runtime Node 24 di Electron 44. Non serve quindi compilare o distribuire un modulo SQLite nativo separato.

- schema e indici: `src/database/migrations.ts`;
- apertura, pragma e runner transazionale: `src/database/database.ts`;
- primi casi d'uso: `src/database/league-store.ts`;
- test di invarianti e persistenza: `src/database/database.test.ts`.

`createLocalBackup()` in `src/database/backup.ts` usa il backup nativo SQLite: produce una copia consistente anche con journal WAL attivo. Nella regia Electron i pulsanti **Esporta backup** e **Ripristina** aprono dialoghi nativi; il ripristino richiede conferma, valida il file scelto, salva prima una copia di sicurezza del database corrente e riavvia il servizio locale. Nei browser normali questi pulsanti non vengono mostrati.

## Servizio LAN

`src/server.ts` espone health check, creazione sessione, snapshot lega e comandi applicativi su HTTP; gli aggiornamenti di una lega vengono notificati ai client collegati a `/api/events` via WebSocket. Il servizio ascolta su `0.0.0.0` quando avviato dall'host e usa `x-session-id` come identità locale temporanea.

`src/client.ts` è il client usato dalle schermate React locali: gestisce sessione, snapshot, comandi e sottoscrizione agli eventi senza importare Supabase.

I controlli React dell'asta sono già disaccoppiati tramite `apps/web/components/auction/auction-actions.tsx`: sul web usano le Server Actions correnti, mentre `createLocalAuctionActions(client)` fornisce la stessa interfaccia per SQLite/LAN.

## Shell Electron

La shell in `electron/` impedisce doppie istanze, avvia il servizio SQLite/LAN e carica home, setup o regia locale dal renderer Next. Il renderer resta sandboxed, con `contextIsolation` e senza Node integration; il preload espone solo i comandi necessari per configurazione host, backup e ripristino.

In sviluppo il renderer Next va avviato separatamente (`npm run desktop:renderer`, esposto sulla LAN con `--hostname 0.0.0.0`). Al primo avvio Electron crea automaticamente una sessione admin e apre la home locale; dopo la creazione conserva sessione cifrata e codice lega nel profilo dell'app. Su macOS e Windows la cifratura sfrutta i meccanismi del sistema operativo.

Nel pacchetto installabile il renderer Next standalone e il server locale compilato (`dist/local-server.cjs`) sono inclusi come risorse dell'app (`Resources/web` e `Resources/local-server.cjs`); anche il renderer viene esposto sulla LAN (`HOSTNAME=0.0.0.0`, porta `47822`) così i telefoni aprono la vista partecipante dal QR.

Il QR del wizard locale porta a `/local/league/:codice`: il partecipante crea una sessione nel proprio browser, entra/rientra nella squadra e usa la stessa vista mobile dell'asta, aggiornata tramite WebSocket. L'URL sostituisce automaticamente l'host loopback dell'API con l'IP LAN rilevato; resta disponibile la correzione manuale dell'URL per VPN o reti con più interfacce.

```bash
# terminale 1: renderer React esposto alla LAN
npm run desktop:renderer

# terminale 2: finestra Electron + server SQLite/LAN
npm run desktop:electron
```

### Packaging

```bash
npm run desktop:package   # dalla radice: web:build + bundle server + electron-builder
```

Produce `apps/desktop/release/` con `.dmg` (macOS) o installer assistito `.exe` NSIS (Windows). Le icone sono in `apps/desktop/build/`. La GitHub Action `.github/workflows/release-desktop.yml` esegue il quality gate, produce le tre architetture pubbliche e genera checksum SHA-256. Firma e notarizzazione vengono applicate solo quando i certificati richiesti sono configurati nei secret del repository.

Per avviare solo il servizio host senza Electron:

```bash
FANTASTA_PORT=47821 npm run start --workspace @fantasta/desktop
```

Il file viene salvato in `~/.fantasta/fantasta.db`; il percorso può essere sovrascritto con `FANTASTA_DATABASE_PATH`.

Esecuzione dalla radice:

```bash
npm test
npm run typecheck
```

Il piano tecnico è in [`docs/DESKTOP_PLAN.md`](../../docs/DESKTOP_PLAN.md); la checklist di pubblicazione è in [`docs/RELEASING.md`](../../docs/RELEASING.md).
