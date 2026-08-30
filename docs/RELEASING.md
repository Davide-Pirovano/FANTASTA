# Pubblicare una release desktop

Questa procedura mantiene coerenti versione, tag, installer e note pubbliche.

## Checklist

1. Porta `main` in uno stato pulito e aggiornato.
2. Aggiorna la versione in `package.json`, `apps/desktop/package.json` e nelle rispettive voci di `package-lock.json`.
3. Sposta le voci da `Unreleased` alla nuova versione in `CHANGELOG.md`.
4. Esegui `npm ci` e `npm run verify`.
5. Esegui almeno una build installabile sulla piattaforma corrente con `npm run desktop:package`.
6. Prova installazione, primo avvio, creazione lega, accesso di un partecipante reale, backup e ripristino.
7. Crea e pubblica il tag firmato `vX.Y.Z` solo dopo il test manuale.

```bash
git tag -s vX.Y.Z -m "Fantasta vX.Y.Z"
git push origin vX.Y.Z
```

La workflow `release-desktop.yml` rifiuta un tag che non coincide con la versione del pacchetto desktop. Esegue il quality
gate, genera i tre installer, pubblica le note GitHub e allega `SHA256SUMS.txt`.

## Firma e notarizzazione

Le release destinate a utenti finali dovrebbero essere firmate. Configura i secret elencati nella workflow:

- macOS: certificato Developer ID, credenziali Apple e Team ID;
- Windows: certificato Authenticode e password.

Se i secret non sono presenti, la pipeline produce build non firmate. Questa condizione deve essere dichiarata nelle note
della release e nel README finché non viene completata la catena di firma.

## Verifica degli artefatti

Dopo la pubblicazione:

1. scarica ogni installer dalla release, non dagli artifact temporanei della workflow;
2. verifica il checksum contro `SHA256SUMS.txt`;
3. controlla la firma su macOS con `codesign --verify --deep --strict` e su Windows dalle proprietà del file;
4. installa su una macchina pulita o una VM;
5. conferma che i link `releases/latest/download` del README rispondano.

Non modificare o sostituire manualmente un installer già pubblicato sotto lo stesso tag. Per qualsiasi correzione crea una
nuova patch release.
