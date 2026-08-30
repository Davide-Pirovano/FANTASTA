# Contribuire a Fantasta

Grazie per l'interesse. Prima di iniziare un cambiamento ampio, apri una issue descrivendo problema, utenti coinvolti e
comportamento atteso. Per vulnerabilità usa invece il canale privato indicato in [SECURITY.md](SECURITY.md).

## Ambiente di sviluppo

Requisiti: Node.js 22, npm e, per la modalità web locale completa, Docker Desktop.

```bash
npm ci
npm run verify
```

Per il renderer web:

```bash
npm run dev
```

Per Electron in sviluppo, usa due terminali:

```bash
npm run desktop:renderer
npm run desktop:electron
```

## Pull request

- Mantieni web e desktop coerenti: condividono UI e logica di dominio.
- Aggiungi o aggiorna i test per regole d'asta, persistenza e contratti.
- Non committare `.env`, database, backup, installer o output di Playwright.
- Esegui `npm run verify` e `npm run web:build` prima di aprire la PR.
- Aggiorna `CHANGELOG.md` per cambiamenti visibili agli utenti.
- Descrivi come hai verificato il comportamento su desktop e mobile.

Le modifiche alla release desktop devono seguire [docs/RELEASING.md](docs/RELEASING.md).
