# Privacy e dati

Fantasta può essere usato in due modalità con confini dati diversi.

## App desktop

- Lega, partecipanti, rose, offerte e storico sono salvati nel database SQLite sul PC dell'admin.
- Durante l'asta, il PC espone sulla rete locale il renderer e le API necessarie ai partecipanti.
- L'app non richiede un account Fantasta e non invia telemetria applicativa.
- I backup esportati sono file locali sotto il controllo dell'utente.

Chi organizza l'asta è responsabile della condivisione del link di invito e della conservazione dei backup. È consigliato usare
una rete privata e condividere il codice lega soltanto con i partecipanti.

## Web app

La modalità web usa l'istanza Supabase configurata da chi distribuisce il progetto. Dati e tempi di conservazione dipendono
quindi dall'infrastruttura scelta dall'operatore. Il repository non configura servizi pubblicitari o analytics.

## Dati diagnostici

Le segnalazioni di supporto non devono includere database, codici lega, chiavi d'ambiente o altri dati personali. Prima di
allegare log o screenshot, rimuovi nomi e informazioni non necessarie alla diagnosi.

Questo documento descrive il comportamento del software nel repository e non sostituisce l'informativa privacy che un
eventuale gestore di un'istanza web pubblica deve fornire ai propri utenti.
