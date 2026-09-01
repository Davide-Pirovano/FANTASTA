# Fantasta — avvia l'asta dal terminale

Asta di Fantacalcio giocata in **LAN senza server**. Questo comando avvia la
regia sul tuo computer; i partecipanti si collegano dal telefono (o da qualunque
browser) sulla tua rete locale, senza installare nulla.

Niente `npm install`: servi e via.

```bash
npx fantasta
```

## Cosa succede

- Si avvia il **server SQLite/LAN** locale (porta `47821`);
- si avvia il **renderer** della regia (porta `47822`);
- si apre il **browser** di default sulla home dell'asta;
- **il terminale resta attivo** mentre l'asta è in corso: chiudilo con `Ctrl+C`
  per fermare tutto e disconnettere i partecipanti.

I partecipanti si collegano con il **QR code** mostrato durante la creazione
della lega (o col link) e seguono l'asta dal telefono. Serve una sola
connessione: quella del PC che gestisce l'asta.

## Requisiti

- **Node.js 22 o superiore** (il database usa `node:sqlite`, incluso nel runtime).

## Dove vengono salvati i dati

- Database: `~/.fantasta/fantasta.db`
- Sessione admin: `~/.fantasta/admin-session.txt`

## Opzioni (variabili d'ambiente)

Tutte opzionali, se non impostate valgono i default qui sotto.

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `FANTASTA_PORT` | `47821` | Porta del server locale (SQLite/LAN) |
| `FANTASTA_RENDERER_PORT` | `47822` | Porta del renderer (regia e partecipanti) |
| `FANTASTA_DATABASE_PATH` | `~/.fantasta/fantasta.db` | Percorso del database |
| `FANTASTA_DATA_DIR` | `~/.fantasta` | Cartella dei dati (se il DB non è personalizzato) |
| `FANTASTA_SESSION_FILE` | `~/.fantasta/admin-session.txt` | File della sessione admin |

Esempio con porte diverse:

```bash
FANTASTA_PORT=49001 FANTASTA_RENDERER_PORT=49002 npx fantasta
```

## Perché non c'è un installer?

L'"app desktop" di Fantasta è in realtà **due processi Node**: il server LAN e
il renderer. `npx` li avvia direttamente, senza `electron`, senza `.app` e senza
binari nativi da firmare — per questo non c'è alcun **avviso di sicurezza**
all'apertura su macOS, Windows o Linux (niente Gatekeeper da aggirare).

Se preferisci una finestra dedicata, la distribuzione installer (`.dmg`/`.exe`)
è scaricabile dalle **GitHub Releases** del progetto.

## Sviluppo in questo repo

Il pacchetto viene costruito a partire dagli artifact del monorepo:

```bash
# dalla radice del progetto:
npm run web:build        # produce apps/web/.next/standalone (renderer)
# poi, dentro cli/:
npm publish              # prepack assembla le risorse e carica il tarball
```

### Pubblicare su npm

Il pacchetto assembla le risorse automaticamente con `prepack`:

```bash
cd cli
npm publish   # esegue prepack e carica il tarball
```

Dopo il publish, dalla **root del progetto** va allineata la stessa versione
del monorepo al prossimo tag di release.