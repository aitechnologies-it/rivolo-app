# Verifica del progetto

## Controlli locali riproducibili

Eseguire dalla radice del repository:

```sh
npm test -- --maxWorkers=2
npm run lint
npm run build
npm run mcp:build
npm run test:events-runtime
git diff --check
```

La suite copre repository SQLite, import/export e backup, editor e ricerca, parsing delle risposte AI, provider cloud, migrazione OneDrive, autorizzazione degli eventi e coordinamento tra schede. I provider esterni sono simulati: un test verde non dimostra che permessi o revisioni siano rispettati da un account reale. Il controllo del relay usa il runtime Cloudflare locale e binding tra Pages e Worker distinti.

## PWA e interfaccia

Usare `npm run build` seguito da `npm run preview`, con un profilo browser di prova e note sintetiche. Per OAuth e relay usare invece `npm run dev:cloud`, che avvia anche Pages Functions e il Worker. Non cancellare lo storage del profilo abituale.

1. Scrivere una nota con testo Unicode, todo e righe vuote; attendere il salvataggio, ricaricare e verificare il testo.
2. Attendere l'attivazione del service worker. Verificare che la cache contenga anche il modulo SQLite `.wasm`, quindi riaprire offline senza affidarsi alla cache HTTP. Scrivere, ricaricare e confrontare nuovamente la nota.
3. Provare timeline, ricerca e impostazioni a 320, 375 e 1280 pixel: nessuno scorrimento orizzontale, link lunghi leggibili, controlli raggiungibili e comandi touch utilizzabili.
4. Su iOS Safari e PWA installata, aprire la tastiera, scorrere, passare in background e tornare. Verificare area sicura, campo di input visibile, salvataggio e ripresa del sync.
5. Aprire due schede: verificare un solo responsabile della sincronizzazione e il blocco delle scritture nella scheda con snapshot obsoleto dopo un salvataggio nell'altra.

## OneDrive prima del rollout

Il [piano giornaliero](plans/2026-10-01-onedrive-daily-sync.md) descrive protocollo, invarianti e stato storico. Le prove seguenti richiedono cartelle di test dedicate e account Microsoft reali; usare sia un account personale sia Business/SharePoint dove disponibili.

| Prova | Criterio di riuscita |
| --- | --- |
| Due account sulla stessa cartella | Identità canonica identica, accesso verificato e aggiornamenti ricevuti sul secondo client |
| Migrazione del Markdown unico | Originale conservato; stessa destinazione per entrambi i client; ripresa dopo interruzione; nessun allargamento dei permessi |
| Writer concorrenti | Condizioni applicate dal server al commit; aggiunte indipendenti conservate; conflitti riconciliati prima del retry |
| Modifica di oggi su storico realistico | Solo il file del giorno trasferito; richieste e byte registrati separatamente dall'inventario iniziale |
| Disconnessione e ritorno in primo piano | Recupero degli eventi persi, bozze preservate, giorni scaricati leggibili offline |
| Eliminazione remota e client offline | Nessuna ricreazione di un giorno invariato già eliminato; nuove modifiche locali riconciliate |
| Permessi revocati o relay assente | Errore comprensibile, note locali disponibili, ripresa dopo il ripristino dell'accesso |

Prima del rollout distribuire il Worker compatibile, poi Pages e il client. Aggiornare o riavviare i vecchi client che possono ancora scrivere nel monolite. Nessuna prova locale equivale a un deploy.

## AI e MCP

Le regressioni di parsing e applicazione delle modifiche AI sono riproducibili senza credenziali. Qualità delle risposte, CORS di endpoint personalizzati, autenticazione e ricerca web richiedono una prova con il provider selezionato e note sintetiche.

Il server MCP è locale e in sola lettura: verificare i suoi strumenti su un'esportazione Markdown sintetica. Non legge direttamente la cartella giornaliera OneDrive; consultare [le istruzioni MCP](../mcp/README.md).

## Evidenze

I report Agentic QA vengono generati in `tests/agentic-qa-tests/runs/<timestamp>/` e sono esclusi da Git. Conservare qui e nel piano un riepilogo degli esiti verificati e dei limiti, così la documentazione versionata non dipende da artefatti locali.

### Audit del 2 ottobre 2026

Branch verificato: `feat/onedrive-sync`. Run locale: `20261002-120014`.

- Baseline: 57 file / 495 test superati; lint, build app/Functions/Worker e build MCP superati.
- Corretto un difetto confermato nel parser AI: un tag `insert` annidato in una citazione malformata veniva eseguito come modifica della nota. Il parser conserva ora il markup malformato come testo, mantenendo il contesto anche oltre newline, limite del buffer e confini dei chunk. I comandi validi successivi continuano a essere riconosciuti.
- Verifica dopo la correzione: **57 file / 506 test superati**, comprese 11 nuove regressioni del parser e della chat nelle modalità finale, streaming e retry. Tutte le **15 prove QA indipendenti** superate. Lint e build rieseguiti con esito positivo.
- Runtime Cloudflare: superato dopo autorizzazione all'apertura delle porte locali fuori dal sandbox. Verificati binding esterno, isolamento dei quaderni, handshake, deduplicazione per file e generazioni di migrazione.
- Prove aggiuntive: round-trip ripetuto con Unicode e marker letterali, migrazione di 1.000 giorni, merge fino a 1.000 righe, journal SQL di sostituzione/cancellazione e rollback, validazione dei documenti e output AI. La precache prodotta include il modulo SQLite `.wasm`.
- La build segnala chunk JavaScript oltre 500 kB. È un punto da misurare sui dispositivi target, non un errore di compilazione né una regressione prestazionale dimostrata.
- Browser: dopo un iniziale errore dell'automazione, eseguito un controllo parziale su Zen in finestra privata con build locale e dati sintetici: apertura del giorno, navigazione alle impostazioni e pannello OneDrive a 320 pixel. Il pannello osservato resta entro il viewport e i comandi sono raggiungibili; inserito anche un link sintetico non salvato. La sessione si è interrotta prima del confronto completo a 375/1280 pixel e della verifica di persistenza dopo reload. Nessuna nuova attestazione di avvio offline reale o ciclo di vita iOS; l'emulazione del viewport non equivale a Safari su iPhone.
- Nessuna chiamata a Microsoft o a provider AI con credenziali dell'utente; permessi reali, collaborazione tra account, comportamento dei commit Graph e qualità delle risposte AI restano da verificare nelle condizioni sopra indicate.

### Chiusura documentale del 5 ottobre 2026

README, istruzioni MCP e testo del pannello backup sono allineati al formato giornaliero OneDrive. `docs/plans` non è più esclusa da Git; il piano distingue il punto di partenza storico dagli esiti dell'implementazione. Le modifiche sono nella working tree, senza commit, push o deploy eseguiti da questo audit.

I quattro passaggi Agentic QA sono disponibili localmente:

- [Report iniziale](../tests/agentic-qa-tests/runs/20261002-120014/REPORT.md), che descrive il difetto prima della correzione.
- [Verifica indipendente](../tests/agentic-qa-tests/runs/20261002-120014/VERIFICATION.md).
- [Piano della correzione](../tests/agentic-qa-tests/runs/20261002-120014/plans/AQA-20261002-001-plan.md).
- [Verifiche ancora inconclusive](../tests/agentic-qa-tests/runs/20261002-120014/inconclusive-findings/REPORT.md).

Gli esiti successivi alla correzione sono in `final-tests.log`, `probes-after-fix.log` e nel presente riepilogo. I report iniziali restano evidenze storiche: il loro giudizio di rischio precede la correzione. Le prove su account reali, iOS e la race nel cambio provider indicata come inconclusiva non sono state sostituite da affermazioni basate sui mock.

### Integrazione con main e configurazione del fork — 6 ottobre 2026

Integrato `origin/main` a `b58e276` nel branch `feat/onedrive-sync`, preservando OneDrive giornaliero e i 36 commit upstream, inclusi MCP ospitato, accesso agenti, copia dei messaggi, aggiornamenti mobile e logo SVG. Risolti i conflitti in README, SyncSection, Settings e configurazione Cloudflare.

- Suite finale: **77 file / 666 test superati**; lint e build app/Functions/Worker, MCP locale e dry-run MCP ospitato superati. Runtime locale OneDrive superato.
- Compilazione del bundle Pages Functions con Wrangler superata. Il primo check remoto ha rifiutato `account_id` nel file Pages; rimosso da `wrangler.toml`, conservandolo solo nei file dei Worker dove è supportato.
- Dopo la correzione, anche il build remoto e la compilazione delle Functions passano. La pubblicazione della preview resta bloccata dall'errore Cloudflare `8000109: Script rivolo-onedrive-events-dev not found`: distribuire prima il relay dev, poi rilanciare Pages. Wrangler locale non è autenticato; la sessione dashboard usata per creare D1 non autentica la CLI.
- Tre nuove regressioni verificano l'indipendenza dei controlli OneDrive dal MCP ospitato, il passaggio a OneDrive con Agent access attivo e l'origine MCP configurata senza fiducia implicita nell'origine upstream.
- Controllo visivo in Zen, finestra privata, con build locale: pannello OneDrive a 320, 375 e 1280 pixel, senza overflow osservato. Nessuna autenticazione provider o modifica delle note dell'utente; questa prova non equivale a iOS Safari/PWA installata.
- Configurati domini `aitlab.it`, `mcp.aitlab.it`, `dev.aitlab.it` e `mcp-dev.aitlab.it` e risorse dell'account Cloudflare AIT. Creati due database D1 vuoti, produzione e dev, con ID riportati nel README; nessuna migrazione remota o pubblicazione dei Worker eseguita in questa verifica. I relay OneDrive di produzione e preview hanno nomi distinti.
- La build segnala ancora chunk oltre 500 kB e due regole CSS generate senza selettore nel gruppo di utility hover. Non sono errori bloccanti della build; la visualizzazione mobile osservata resta utilizzabile.

Prima della messa online del fork applicare le migrazioni ai database AIT, configurare i segreti e le callback OAuth dei provider, distribuire i relay e il MCP e collegare i domini. Il MCP ospitato conserva il supporto Dropbox/Google Drive; OneDrive usa il MCP locale su esportazione manuale.
