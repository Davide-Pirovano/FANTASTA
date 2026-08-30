# Sicurezza

## Versioni supportate

Le correzioni di sicurezza vengono applicate all'ultima release pubblicata. Prima di segnalare un problema,
verifica di poterlo riprodurre con la versione più recente disponibile nella pagina delle Release.

## Segnalare una vulnerabilità

Non aprire una issue pubblica per vulnerabilità, possibili fughe di dati o bypass dei controlli di accesso.
Usa la funzione **Report a vulnerability** nella scheda **Security** del repository GitHub. Includi:

- versione e sistema operativo;
- passaggi minimi per riprodurre il problema;
- impatto osservato o potenziale;
- log o screenshot privati, dopo aver rimosso codici lega e dati personali.

La segnalazione verrà confermata appena possibile. Gli aggiornamenti sostanziali e l'eventuale coordinamento della
pubblicazione avverranno nello stesso canale privato.

## Modello di sicurezza della modalità desktop

- I dati dell'asta restano nel database locale del PC dell'admin.
- Il servizio partecipanti è raggiungibile sulla rete LAN durante l'esecuzione dell'app.
- I codici lega e i link di invito vanno condivisi solo con i partecipanti.
- Le reti Wi-Fi pubbliche o non fidate non sono consigliate per ospitare un'asta.
- Il renderer Electron usa sandbox, isolamento del contesto e nessuna Node integration.

Fantasta non richiede password o account nella modalità desktop. Non inviare mai database di backup in una issue pubblica.
