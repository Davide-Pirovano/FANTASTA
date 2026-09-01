# Fantasta — avvia l'asta dal terminale

Asta di Fantacalcio giocata in **LAN senza server**. Questo comando apre la
**vera app desktop** sul tuo computer; i partecipanti si collegano dal telefono
(o da qualunque browser) sulla tua rete locale, senza installare nulla.

```bash
npx fantasta
```

Niente installer, niente avvisi di sicurezza: il binario Electron incluso nel
pacchetto è firmato da GitHub, quindi non c'è Gatekeeper da aggirare.

## Cosa succede

- Si apre la **finestra dell'app desktop** (regia);
- si avvia il **server SQLite/LAN** locale (porta `47821`);
- si avvia il **renderer** della regia (porta `47822`), raggiungibile anche dal
  browser dei partecipanti;
- **il terminale resta attivo** mentre l'asta è in corso: chiudilo con `Ctrl+C`
  per fermare tutto e disconnettere i partecipanti (oppure chiudi la finestra).

I partecipanti si collegano con il **QR code** mostrato durante la creazione
della lega (o col link) e seguono l'asta dal telefono. Serve una sola
connessione: quella del PC che gestisce l'asta.

## Modalità browser (opzionale)

Se preferisci la regia nel browser di default invece della finestra:

```bash
npx fantasta --browser
```

## Requisiti

- **Node.js 22 o superiore** (il database usa `node:sqlite`, incluso nel runtime).
- Al primo avvio npm scarica anche il binario Electron (~120 MB, una volta sola).

## Dove vengono salvati i dati

- Finestra desktop: `~/Library/Application Support/Fantasta/fantasta.db` (macOS),
  `%APPDATA%/Fantasta/fantasta.db` (Windows), `~/.config/Fantasta/fantasta.db` (Linux).
- Modalità browser / sessioni: `~/.fantasta/` (`fantasta.db`, `admin-session.txt`).

## Opzioni (variabili d'ambiente)

Tutte opzionali, se non impostate valgono i default qui sotto.

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `FANTASTA_PORT` | `47821` | Porta del server locale (SQLite/LAN) |
| `FANTASTA_RENDERER_PORT` | `47822` | Porta del renderer (regia e partecipanti) |
| `FANTASTA_DATABASE_PATH` | vedi sopra | Percorso del database |
| `FANTASTA_DATA_DIR` | `~/.fantasta` | Cartella dei dati (modalità browser) |
| `FANTASTA_BROWSER` | — | `1` equivale a `--browser` |

Esempio con porte diverse:

```bash
FANTASTA_PORT=49001 FANTASTA_RENDERER_PORT=49002 npx fantasta
```

## Perché npx e non l'installer?

L'"app desktop" di Fantasta è in realtà **due processi Node** (server LAN e
renderer) avvolti da **Electron**. Il pacchetto npm include tutto e lancia il
binario Electron ufficiale, firmato da GitHub: per questo non c'è alcun
**avviso di sicurezza** all'apertura su macOS, Windows o Linux (niente
Gatekeeper da aggirare). Se preferisci una finestra "installata" a sistema,
la distribuzione installer (`.dmg`/`.exe`) resta scaricabile dalle **GitHub
Releases** del progetto.

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