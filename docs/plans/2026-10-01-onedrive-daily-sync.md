# OneDrive: quaderno condiviso con un Markdown per giorno

Data: 1 ottobre 2026. Il disegno e il punto di partenza qui sotto sono storici; lo stato implementato e le verifiche ancora necessarie sono riportati nelle sezioni finali. Il completamento dei test locali non attesta il rollout né la verifica su account Microsoft reali.

## 1. Decisioni e obiettivo

La richiesta definitiva è **divisione per giorni, esclusivamente per OneDrive**. La precedente ipotesi mensile è superata. Non creare `notebook.json` né un indice remoto che debba essere riscritto a ogni modifica.

Rivolo viene usato soprattutto per scrivere nel giorno corrente, con poco testo giornaliero. L'obiettivo è trasferire e confrontare quel giorno, senza ricaricare il quaderno storico. L'interfaccia continua a mostrare un unico quaderno scorrevole.

Vincoli concordati:

- Google Drive e Dropbox mantengono il Markdown unico e i comportamenti attuali.
- Il contenuto viaggia direttamente tra browser e OneDrive via HTTPS. Cloudflare gestisce OAuth, autorizzazione del canale ed eventi, senza ricevere testo o nomi degli autori.
- La collaborazione conserva il merge **sempre per righe**, senza ripiego sui paragrafi e senza avvisi relativi alle dimensioni del merge.
- Le aggiunte concorrenti si combinano; su modifiche incompatibili alla stessa riga prevale il contenuto locale dell'ultimo push riuscito, dopo aver riletto e riconciliato la versione remota.
- Il pulsante autori accanto a ogni giorno continua a mostrare l'ultimo autore noto per riga. Non implementare cursori condivisi o una cronologia completa delle modifiche.
- Gli aggiornamenti da Rivolo sono segnalati da eventi. Non ripristinare il polling OneDrive ogni cinque secondi.
- Mantenere protezione delle bozze, backup locali, funzionamento offline e coordinamento tra schede.
- Migrare automaticamente all’avvio le configurazioni OneDrive con Markdown unico, prima di abilitare la sincronizzazione. Il formato operativo supportato dopo l’aggiornamento è soltanto quello giornaliero.
- Conservare il vecchio file e i backup; sostituire automaticamente il target/link salvato con quello della cartella quando accesso e migrazione sono verificati.

## 2. Punto di partenza verificato nel repository (prima dell'implementazione)

| Area | Stato attuale | Intervento |
| --- | --- | --- |
| `src/lib/oneDrive.ts` | Un solo target Markdown; export/import del quaderno completo; upload diretto; controllo revisioni e ritentativi | Target cartella e operazioni per giorno |
| `src/lib/oneDriveState.ts` | Un solo `lastRemoteRev`, hash, baseline e contatore locale | Identità del quaderno e registri indipendenti per giorno |
| `src/lib/oneDriveMerge.ts`, `oneDriveBlame.ts` | Merge per righe e attribuzione nel Markdown | Riutilizzo su documenti con un solo giorno |
| `src/lib/sync.ts` | Interfaccia comune e adapter distinti per provider | Estensioni minime per aggiornamenti mirati; nessuna riscrittura degli altri adapter |
| `src/lib/syncDirty.ts` | Ogni modifica marca genericamente tutti i provider come dirty | Propagare i giorni interessati a OneDrive, mantenendo il dirty globale degli altri provider |
| `src/store/syncActions.ts` | Coda seriale per pull/push e refresh della UI | Conservare serializzazione e aggiungere richieste mirate/coalescenti |
| `src/components/timeline/DayBlame.tsx` | Attribuzione letta dalla baseline OneDrive | Leggere la baseline del giorno richiesto |
| `src/lib/oneDriveEvents.ts`, API events, Worker | Relay WebSocket per singolo file, outbox e riconnessioni | Un canale per cartella, eventi e deduplicazione per giorno |
| Impostazioni e notifiche | Target file; apertura della sezione provider | Target cartella, migrazione, stato e risoluzione degli errori |

Al momento della stesura iniziale il relay era presente nella working tree insieme a modifiche precedenti non ancora committate e la divisione giornaliera non era ancora implementata. Questa descrizione non rappresenta lo stato corrente né attesta una distribuzione in produzione.

## 3. Formato remoto e identità

Struttura proposta:

```text
Rivolo/
  2026/
    09/
      2026-09-30.md
    10/
      2026-10-01.md
      2026-10-02.md
```

- Il quaderno è identificato dalla coppia canonica `driveId + folderItemId`, non dal percorso o dal testo del link condiviso.
- Condividere la cartella radice con permesso di modifica. I permessi del vecchio file non vanno considerati automaticamente trasferiti alla nuova cartella.
- Ciascun file contiene esattamente un giorno nel formato Markdown esistente: marker `day:AAAA-MM-GG`, titolo, contenuto e footer degli autori limitato a quel giorno.
- Nome, percorso e marker devono concordare; date non valide, marker duplicati e contenuti di un altro giorno non si importano silenziosamente.
- Un giorno vuoto può essere un documento valido con marker e titolo. Un file privo di marker non equivale a una cancellazione.
- Creare il file alla prima modifica salvata del giorno, non per il semplice passaggio della mezzanotte o la visualizzazione di una pagina vuota.
- Usare il `dayId` assegnato dall'app; non ricalcolare le date ricevute secondo il fuso orario del dispositivo. Conservare l'attuale criterio locale per il giorno corrente.
- Le cartelle anno/mese sono organizzative: l'unità di upload, merge e attribuzione resta il giorno.
- Ignorare file estranei; non rinominare o cancellare automaticamente documenti che non rispettano la convenzione.
- Conservare l'esportazione manuale dell'intero quaderno in un unico Markdown.

## 4. Struttura del codice e stato locale

Evitare un nuovo framework generico di sincronizzazione. Separare responsabilità piccole:

| Modulo proposto | Responsabilità |
| --- | --- |
| `notebookDays.ts` | Separare/ricomporre documenti mantenendo marker, titoli, testo e autori; validare il documento giornaliero |
| `oneDriveGraph.ts` | Risoluzione cartelle e shortcut, metadata, paginazione, creazione cartelle, download/upload condizionali, throttling |
| `oneDriveDailyState.ts` | Stato persistente per target/giorno, aggiornamenti serializzati e checkpoint |
| `oneDriveDailySync.ts` | Push/pull giornalieri, recupero modifiche perse, batch parziali e interazione con il repository locale |
| `oneDriveMigration.ts` | Migrazione automatica e riprendibile all’avvio; aggiornamento del target |
| `oneDrive.ts` | Adapter pubblico esclusivamente giornaliero, preceduto dal controllo di migrazione |

I nomi sono indicativi; non creare file vuoti o astrazioni non necessarie solo per aderire alla tabella.

Stato del quaderno: versione dello schema **locale**, identità della cartella e account, ultima riconciliazione, eventuale cursore remoto e stato della migrazione (`pending`, `running`, `blocked`, `complete`). Il riferimento al vecchio file è solo una sorgente di migrazione/recupero, non una seconda modalità di sincronizzazione.

Stato per giorno: `dayId`, `itemId`, eTag remoto, baseline comprensiva degli autori, hash dell'ultimo contenuto caricato, revisione locale, dirty, eventuale cancellazione pendente e ultimo esito. Chiave composta con identità del quaderno: due cartelle con la stessa data non devono condividere baseline o operazioni pendenti.

Persistenza tramite repository locale esistente, con record separati o tabella dedicata. Evitare di riscrivere una mappa contenente tutto lo storico a ogni battuta. Una transazione deve associare l'aggiornamento della nota al suo dirty persistente, oppure la procedura di recupero deve poter ricostruire il dirty dopo un crash tra i due salvataggi.

Propagare gli ID interessati dalle mutazioni: modifica, creazione, eliminazione, import, ripristino, modifiche AI e aggiornamenti provenienti da altre integrazioni. Le operazioni globali possono ricostruire l'indice; la normale digitazione non deve esportare e confrontare tutte le giornate. Dopo un pull OneDrive marcare correttamente Google Drive e Dropbox come modificati senza generare un ciclo di push OneDrive.

Lo stato comune espone ancora un riepilogo del provider. Per OneDrive aggiungere un riferimento esplicito al canale/cartella: non codificare l'identità del quaderno dentro una finta revisione di un file. Un batch è interamente pulito solo se non restano giorni dirty o operazioni pendenti.

## 5. Push e concorrenza

Sequenza per ciascun giorno dirty:

1. Attendere che la bozza di quel giorno sia salvata; acquisire contenuto, autori, revisione locale e generazione del target.
2. Recuperare i metadata del relativo file. Scaricare il contenuto soltanto se la versione remota è cambiata o manca una baseline utilizzabile.
3. Se esiste un file remoto sconosciuto, importarlo o riconciliarlo con una scelta esplicita; non sovrascriverlo perché manca uno stato locale.
4. Eseguire il merge a tre vie tra baseline, locale e remoto. Per la creazione simultanea dello stesso nuovo giorno usare una base semanticamente vuota dopo aver verificato che entrambi i documenti rappresentino quella data.
5. Se contenuto e revisione sono già allineati, saltare l'upload.
6. Caricare l'intero **file giornaliero** tramite HTTPS. Non inviare un diff e non includere gli altri giorni.
7. Proteggere creazione e aggiornamento da scritture concorrenti: creazione senza rinomina automatica; aggiornamento contro la revisione attesa. Su conflitto rileggere e rifare il merge, con tentativi limitati e successivo retry.
8. Persistire l'esito remoto e l'intento di notifica. Pulire il dirty soltanto se la revisione locale acquisita non è avanzata durante l'upload.
9. Applicare eventuali aggiunte remote solo se la bozza non è cambiata; altrimenti conservare una base coerente e accodare la riconciliazione. Non dichiarare integrato testo che l'editor non ha ancora ricevuto.
10. Pubblicare l'evento. Un errore del relay ritenta la notifica, non il caricamento già completato.

Inizialmente usare una coda con concorrenza limitata e comportamento deterministico. Salvare checkpoint per giorno: se un batch fallisce a metà, ritentare i giorni mancanti senza invalidare quelli riusciti. Non promettere una transazione atomica su più file OneDrive.

**Verifica tecnica obbligatoria prima del rilascio:** provare due upload session concorrenti contro la stessa revisione. Non assumere che `If-Match` alla sola creazione della sessione protegga anche il commit finale. Verificare il percorso di commit condizionale supportato dagli account reali e implementarlo dove necessario. Un controllo della versione soltanto dopo la scrittura non impedisce una sovrascrittura già avvenuta. Se questa garanzia non risulta disponibile per un account supportato, risolvere il protocollo prima di dichiarare sicure le aggiunte concorrenti; non sostituire il problema con un fallback silenzioso sul contenuto.

Conservare le regole del merge esistente: cambi indipendenti combinati, aggiunte remote seguite da quelle locali quando competono nello stesso punto, deduplicazione coerente con i test, conflitti sulla stessa riga risolti dall'ultimo writer che riesce a completare il protocollo. Le identità delle righe restano inferite da testo/posizione, non ID permanenti o CRDT.

## 6. Pull mirato, primo accesso e recupero

- A un evento relativo a un giorno, controllare e scaricare soltanto quel file. Coalescere eventi ripetuti per giorno e verificare la revisione effettiva sul provider.
- Applicare il risultato al solo giorno interessato. **Non usare `importMarkdownToDb(..., { replace: true })` con un singolo file**, perché oggi quella modalità sostituisce l'intero quaderno.
- Aggiungere un percorso di import/applicazione giornaliera con protezione della revisione locale, backup e gestione degli autori. Preservare gli altri giorni.
- Se il giorno ha modifiche locali, usare il medesimo merge del push; se ha una bozza, differire l'applicazione a quel giorno. Non bloccare inutilmente il recupero di giorni diversi.
- Al primo collegamento enumerare i documenti validi con paginazione e importare il quaderno per l'uso offline, prioritizzando oggi. Mostrare l'eventuale caricamento dello storico; non dichiarare completa la disponibilità offline prima di averlo acquisito.
- All'avvio, riconnessione, cambio di target e ritorno in primo piano riconciliare l'inventario per recuperare eventi persi, nuovi giorni e cancellazioni.
- Usare cursori delta solo dove funzionano sul drive/cartella condivisa e sui tipi di account supportati. Una delta del drive del destinatario non va assunta come inventario dei discendenti di una cartella condivisa di un altro drive.
- Prevedere enumerazione paginata dei metadata come percorso di recupero. Confrontare eTag e scaricare solo file nuovi/cambiati; invalidare e ricostruire cursori scaduti. Questa scansione avviene su trigger, non con polling continuo.
- Non dedurre cancellazioni da scansioni parziali, errori di rete, autorizzazioni mancanti o pagine non ancora acquisite. Riconciliare modifiche avvenute durante la scansione e verificare individualmente gli elementi apparentemente spariti prima di applicare eliminazioni.

Gli eventi non sono un archivio affidabile di tutte le modifiche: servono a invalidare la cache. Il recupero dal provider resta necessario anche con deduplicazione e outbox.

## 7. Eliminazioni, rinomine e operazioni forzate

- Distinguere giorno vuoto, file malformato e giorno eliminato esplicitamente.
- Propagare una cancellazione locale esplicita del giorno con controllo della revisione remota e conservazione del backup. Non cancellare altri giorni o cartelle.
- Una cancellazione remota confermata elimina il giorno locale solo quando non contiene nuove modifiche locali; in caso contrario applicare la regola di conflitto documentata e conservare il testo locale da riconciliare.
- Registrare localmente cancellazioni pendenti/confermate, così retry e dispositivi offline non ricreano involontariamente giorni eliminati. Un nuovo dispositivo determina l'esistenza dei giorni dall'inventario remoto completo.
- Per una cancellazione non è più possibile autorizzare la pubblicazione leggendo il file eliminato: inviare un'invalidazione dell'inventario sul canale della cartella, autorizzata sulla cartella stessa. I destinatari verificano OneDrive prima di eliminare dati.
- Tracciare gli item per ID. Se un file viene spostato o rinominato fuori dalla convenzione, non trasformarlo automaticamente in un altro giorno e non distruggerne il contenuto; segnalare il documento non riconciliabile.
- Le operazioni forzate devono dichiarare chiaramente l'ambito. Un force push giornaliero non autorizza a eliminare file remoti sconosciuti. Un force pull dell'intero quaderno richiede inventario completo, backup e l'azione esplicita già prevista dalla UI.

## 8. Canale WebSocket del quaderno

Un solo collegamento per istanza attiva al canale identificato dalla cartella radice, non una WebSocket per giorno.

Esempio di evento verificato dal server:

```json
{
  "type": "day-changed",
  "dayId": "2026-10-01",
  "itemId": "identificatore-file",
  "revision": "etag-opaco",
  "sender": "identificatore-istanza"
}
```

Aggiornamenti necessari:

- La sottoscrizione verifica l'accesso alla cartella canonica, quindi rilascia un ticket breve cifrato legato al canale.
- La pubblicazione via POST HTTPS verifica accesso e appartenenza effettiva del file alla gerarchia `anno/mese/giorno` del quaderno. Non fidarsi di cartella, giorno o parent dichiarati dal browser.
- Limitare il relay a metadata verificati. Non includere contenuti, autori, bearer token o URL preautorizzati di download negli eventi o nei log.
- Deduplicare per item/revisione, non tramite una singola revisione globale della cartella. Gli eTag sono opachi: non ordinarli numericamente o lessicograficamente.
- Se la verifica vede una revisione più recente di quella appena caricata dal mittente, notificare anche il mittente, come nel relay attuale.
- Aggiungere eventi di invalidazione dell'inventario per eliminazioni o cambiamenti non rappresentabili come aggiornamento di un file esistente.
- L'outbox persistente deve essere indicizzata per quaderno/item, coalescere aggiornamenti e non perdere due giorni caricati in successione. Gestire cambio account, cambio target, disconnessione e retry senza pubblicare con un contesto errato.
- Conservare hibernation, heartbeat, rinnovo dell'autorizzazione, backoff, pulizia dei listener e recupero tramite messaggio `ready`. Adattare il callback del client per trasportare il giorno, invece dell'attuale callback senza payload.
- Non perdere eventi durante il passaggio inizializzazione/sottoscrizione: sottoscrizione più riconciliazione di recupero devono coprire quella finestra.

Le modifiche da editor esterni non emettono questi eventi. Restano rilevabili tramite riconciliazione all'avvio/ritorno/riconnessione o pull manuale. Le subscription native Microsoft non fanno parte di questa implementazione. Le PWA sospese non hanno garanzia di connessione attiva.

## 9. Blame, editor e notifiche

- Preservare il pulsante autori per giorno, il rendering progressivo e il ritorno all'editor senza perdere testo, posizione o focus.
- Leggere gli autori dalla baseline del singolo giorno, mantenendo fingerprint, autori sconosciuti per testo non attribuibile e gestione delle modifiche esterne.
- Salvare il footer degli autori nello stesso file del giorno; nessun file di blame separato. Non presentare il display name come identità firmata o audit certificato.
- Nelle impostazioni OneDrive usare cartella condivisa o percorso cartella. Un vecchio link a file, recuperato dalle impostazioni o incollato in seguito, attiva la migrazione automatica; non abilita una modalità legacy. Mostrare avanzamento e impedimenti concreti, senza richiedere una conferma iniziale di routine.
- La notifica OneDrive apre le impostazioni selezionando ed espandendo la sezione OneDrive.
- Rimuovere un problema quando la condizione che lo generava è risolta. Una sincronizzazione riuscita di un altro giorno non deve cancellare un errore ancora aperto; una riconnessione del relay non deve mascherare un errore sui file.
- Usare identificatori di problema almeno per target e categoria, con giorno quando pertinente. Aggregare problemi ripetuti senza duplicare notifiche a ogni retry.
- Verificare layout stretto, tap target, nomi lunghi, tastiera, safe area e ripresa della PWA su iOS Safari. Nessuna nuova schermata tecnica deve essere necessaria per la scrittura quotidiana.

## 10. Migrazione automatica all’avvio

Il nuovo client ha **un solo motore di sincronizzazione, giornaliero**. Il codice capace di leggere il monolite serve esclusivamente alla migrazione e al recupero dei dati. Non mantenere push/pull legacy, selettori di formato o doppia scrittura.

### Avvio e interruzioni

1. Dopo il caricamento dello stato locale, eseguire il controllo di migrazione prima di avviare auto-sync, auto-push o sottoscrizioni per il vecchio target. Usare la stessa barriera per sync manuale, attivazione OneDrive e inserimento di un vecchio link nelle impostazioni.
2. Se OneDrive è attivo e il target è un file, avviare automaticamente la migrazione appena rete e autenticazione lo consentono. Per una connessione OneDrive inattiva registrare la necessità di migrazione ed eseguirla all’attivazione, senza caricare nel vecchio account le note attualmente sincronizzate con un altro provider.
3. L’app e la scrittura locale restano disponibili offline o durante un impedimento. Accodare le modifiche locali; la sola sincronizzazione OneDrive resta in attesa. Non ritornare al caricamento del monolite in caso di errore.
4. Persistire il journal locale e riprendere al successivo avvio/riconnessione. Distinguere errori transitori da permessi mancanti: retry con backoff per i primi, notifica con azione concreta per i secondi.

### Destinazione unica e migrazione dei contenuti

1. Risolvere il vecchio target nell’identità canonica `driveId + fileItemId`, anche se arriva da link condivisi diversi. Salvare bozze e backup, leggere la sorgente remota e riconciliarla con le modifiche locali. Se manca una baseline e le copie divergono in modo ambiguo, conservare entrambe e richiedere la scelta necessaria senza sovrascriverne una.
2. Riutilizzare la destinazione già associata a quella sorgente, se presente. Altrimenti creare una **cartella dedicata al quaderno**, nel drive del proprietario e in una posizione su cui l’account abbia i permessi necessari. Non adottare o condividere automaticamente l’intera cartella genitore, che potrebbe contenere altri documenti. Usare un nome deterministico derivato dal nome e dall’ID della sorgente, con creazione senza rinomina automatica e controllo delle collisioni.
3. Per coordinare più dispositivi, aggiungere un piccolo registro di migrazione autenticato nel backend Cloudflare già previsto: sorgente canonica → destinazione canonica, stato e generazione del tentativo. Conservare solo questi metadati, nessun contenuto, token o link di condivisione utilizzabile come credenziale. Non introdurre un `notebook.json` o un manifest remoto.
4. Autorizzare ogni consultazione/aggiornamento del registro tramite Graph. L’accesso al vecchio file da solo non autorizza a dichiarare una destinazione arbitraria: verificare autorità sulla migrazione, relazione sorgente/destinazione e accesso alla cartella. La prima associazione valida non può essere sostituita da un collaboratore. Serializzare l’assegnazione con generazione/lease; un tentativo scaduto non può finalizzare o riassegnare il target. In caso di indisponibilità del registro attendere, senza creare quaderni divergenti in drive personali diversi.
5. Creare un journal locale con snapshot, revisione sorgente, destinazione, stato dei permessi e checkpoint per giorno. Caricare ogni giorno mantenendo gli autori. Se un file giornaliero esiste già, verificarlo e riconciliarlo, senza sovrascritture indiscriminate o copie con nomi automatici.
6. Verificare contenuti e insieme dei giorni, poi ricontrollare sorgente e revisioni locali. Integrare le modifiche intervenute durante la copia e riverificare prima di finalizzare. Recuperare un’interruzione usando gli stessi file e checkpoint.
7. Solo dopo verifica dei contenuti e dell’accesso alla destinazione, aggiornare atomicamente configurazione locale, identità del target, baseline giornaliere e stato della migrazione. Collegare quindi il canale della cartella e avviare la sincronizzazione giornaliera. Una migrazione parziale non deve essere marcata completa.
8. Conservare il vecchio Markdown senza modificarlo o eliminarlo: rimane una copia di recupero, non un archivio che il nuovo client continui a sincronizzare. I dispositivi aggiornati che partono in seguito trovano la destinazione tramite il registro, vi riconciliano le proprie modifiche locali e aggiornano il proprio target senza ricopiare lo snapshot vecchio sopra giorni già aggiornati o eliminati. Le modifiche locali offline si calcolano rispetto alla loro baseline, non trattando tutto il monolite come nuovi inserimenti.

### Sostituzione automatica del link condiviso

- Sostituire **il link nelle impostazioni di Rivolo** con un link valido della nuova cartella. Non modificare testualmente l’URL del file e non promettere che il vecchio URL Microsoft punti ora a una cartella: file e cartella sono risorse distinte.
- Riutilizzare un link appropriato della cartella, oppure ottenerlo tramite le API Graph di condivisione, specificando ruolo e ambito. Un semplice `webUrl` di navigazione non va considerato automaticamente un link condiviso.
- Verificare i permessi della sorgente e della destinazione. Ove Graph e l’account consentano di ricostruire i destinatari e i ruoli esistenti, riportarli sulla sola cartella dedicata senza ampliare l’accesso, rimuovere permessi estranei o inviare inviti/notifiche automatiche. Non assumere che un collaboratore possa elencare tutti i permessi o creare una cartella nel drive del proprietario.
- Non usare un link anonimo o valido per l’intera organizzazione come ripiego per un file condiviso con persone specifiche. Se ambito, destinatari, scadenza o vincoli di accesso non possono essere riprodotti/verificati, richiedere un link cartella già configurato dal proprietario invece di allargare la condivisione.
- Se la migrazione è già conclusa da un altro dispositivo, risolvere la cartella dal registro, verificarne l’accesso e recuperare il link quando consentito. Se l’account può accedere tramite ID ma non leggere/creare il link, usare l’identità canonica verificata come target operativo e mostrare la cartella: non mantenere un vecchio link a file fingendo che rappresenti la destinazione.
- Se manca il diritto di creare la destinazione o accedervi, lasciare le note locali utilizzabili e mostrare una singola notifica che apre OneDrive nelle impostazioni: serve l’intervento del proprietario o il link della cartella. Riprendere automaticamente e rimuovere il problema quando il requisito è soddisfatto.

### Client vecchi e recupero

Un’app già aperta con una versione precedente può ancora scrivere nel monolite: la migrazione del nuovo client non può cambiarne retroattivamente il codice. Pianificare l’aggiornamento/riavvio dei dispositivi collaboranti durante il passaggio finale. Ricontrollare la sorgente prima della finalizzazione; non promettere atomicità contro vecchi client che continuano a scrivere dopo il passaggio e non reintrodurre per questo la doppia sincronizzazione.

Un recupero usa il vecchio file o un backup come sorgente da importare nel formato giornaliero. Non riattiva il motore legacy e non cancella la cartella nuova. Dopo nuove scritture giornaliere, il monolite conservato non è una copia automaticamente aggiornata.

## 11. Sequenza di implementazione e verifiche

Ogni fase deve produrre una modifica piccola e verificabile; non distribuire un client giornaliero prima del relay compatibile.

| Fase | Lavoro | Evidenza di completamento |
| --- | --- | --- |
| 1 | Verificare API su cartelle condivise personali/aziendali, commit condizionali e recupero inventario | Prove riproducibili di accesso, paginazione e race tra due writer; limiti registrati |
| 2 | Codec giornaliero e stato locale versionato | Round-trip di testo/autori; validazione date; isolamento target; nessuna perdita dopo riapertura |
| 3 | Repository giornaliero e dirty per giorno | Modificare oggi non riscrive/confronta lo storico; tutte le vie di mutazione coperte |
| 4 | Adapter cartella, pull/push, cancellazioni e checkpoint | Due client convergono; solo giorni cambiati trasferiti; fallimenti parziali recuperabili |
| 5 | Protocollo eventi di cartella e client mirato | Isolamento canali, controllo appartenenza, evento multi-giorno, catch-up dopo perdita connessione |
| 6 | Migrazione automatica, registro destinazioni, settings e autori | Avvio bloccante solo per sync, ripresa dopo crash, target/link aggiornati; vecchio file conservato |
| 7 | QA integrata, documentazione e distribuzione | Build/lint/test, prova due account e verifica mobile; rollout compatibile |

Test automatici necessari:

- Codec: stesso mese/anni diversi, anno bisestile, Unicode, righe vuote, marker letterali nel testo, footer autori, duplicati e file estranei.
- Stato: migrazione schema locale, crash tra salvataggio e dirty, revisioni avanzate durante l'upload, target/account cambiati durante richieste in corso.
- Merge: modifiche a righe differenti della stessa giornata, conflitti sulla stessa riga, aggiunte concorrenti, creazione contemporanea, cancellazione contro modifica, riscritture estese sempre per righe.
- Trasferimenti: edit di oggi invia solo oggi; giorni precedenti non vengono scaricati se invariati; due giorni dirty con un solo upload fallito; risposta upload persa senza duplicare contenuti.
- Import: applicare un giorno non elimina gli altri; bozza locale mai sostituita; backup ripristinabile; force pull e cambio provider conservano le semantiche dichiarate.
- Relay: accesso negato, file fuori cartella, ticket alterato/scaduto, dupliche, eventi fuori ordine, due giorni consecutivi, evento durante handshake, mittente superato da un upload successivo, delete con invalidazione e outbox dopo crash.
- Migrazione: avvio automatico prima di qualsiasi sync, avvio offline, provider inattivo, sorgente remota più recente, autori conservati, cartella già popolata, interruzione dopo alcuni giorni e tra commit locale/remoto, modifiche durante copia. Due dispositivi devono convergere sulla stessa cartella; un client con journal scaduto non può riassegnarla. Un dispositivo offline non deve ricreare giorni eliminati dopo la migrazione.
- Condivisione: link file sostituito con link cartella valido, link diversi dello stesso file, proprietario/collaboratore/read-only, parent non accessibile, elenco permessi incompleto, creazione link negata, cartella con accesso più ampio, registro alterato o non disponibile. Nessun allargamento dei destinatari, invio automatico di inviti o ripiego sul sync legacy; ripresa e chiusura della notifica dopo risoluzione.
- UI: notifica apre la sezione OneDrive espansa; problema sparisce solo dopo la sua risoluzione; autori per giorno; Google Drive/Dropbox mantengono formato e flussi esistenti.

Prove integrate: due account Microsoft distinti sulla stessa cartella, almeno un caso personale e uno aziendale ove disponibili; scrittura simultanea, offline/online, cambio giorno, modifica di un giorno passato, modifica esterna, ritorno da background iOS/PWA e più schede con un solo proprietario della sincronizzazione. Se account o browser non sono disponibili, registrare quali prove restano non eseguite invece di sostituirle con affermazioni basate sui mock.

Misurare richieste e byte su uno storico realistico: primo collegamento, app inattiva, edit odierno, evento remoto e riconnessione. L'edit normale non deve dipendere dal volume dello storico; il primo caricamento e l'inventario di recupero hanno costi separati. Non imporre soglie inventate o avvisi di dimensione del merge.

Eseguire `npm run build`, `npm run lint` e i test pertinenti a ogni fase; suite completa al termine. Verificare il relay anche nel runtime Cloudflare locale, non soltanto con WebSocket simulati.

## 12. Distribuzione e criteri finali

- Aggiornare README, testi settings, privacy e istruzioni locali per cartella condivisa, metadati del relay e disponibilità offline.
- Pubblicare prima backend/registro di migrazione e protocollo eventi di cartella, poi il client/Pages. Versionare gli endpoint: eventuali vecchi endpoint ancora disponibili durante il rollout non costituiscono un secondo motore di sync nel nuovo client.
- All’avvio il nuovo client migra il target precedente prima di sincronizzare. Dopo l’aggiornamento si usa soltanto il formato giornaliero; errore o migrazione incompleta significano sync in attesa e note locali disponibili. Aggiornare anche privacy/documentazione per i soli metadati del registro di migrazione.
- Separare commit/push e deploy dall'esecuzione di questo piano; questo documento non attesta che siano già avvenuti.

La funzionalità è completa quando: una modifica di oggi carica solo il file di oggi; gli altri client aggiornano quel giorno tramite evento; le aggiunte concorrenti non si perdono nei casi verificati; lo storico resta disponibile offline dopo il caricamento iniziale; autori e bozze sono preservati; la migrazione parte automaticamente, aggiorna target/link dove consentito e conserva l'originale; errori e riprese sono gestiti; Google Drive e Dropbox superano i test di regressione con il loro file unico. Nessun `notebook.json`, nessuna suddivisione mensile e nessun polling continuo aggiunto a OneDrive.

## Riferimenti tecnici

- [Microsoft Graph: upload session, condizioni e commit](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0) — verificare il protocollo concreto sugli account supportati.
- [Microsoft Graph: delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0) — recupero delle variazioni, distinto dagli eventi del relay.
- [Cloudflare: WebSocket e hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — connessioni del canale quaderno.
- [Cloudflare Pages: binding Durable Objects](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects) — Worker esterno e collegamento alle Pages Functions.

- [Microsoft Graph: creare o recuperare un link di condivisione](https://learn.microsoft.com/en-us/graph/api/driveitem-createlink?view=graph-rest-1.0) — il link appartiene allo specifico item; ambito e ruolo devono essere espliciti.
- [Microsoft Graph: elenco dei permessi](https://learn.microsoft.com/en-us/graph/api/driveitem-list-permissions?view=graph-rest-1.0) — la visibilità dei permessi dipende dall’account chiamante; non assumere un elenco completo per ogni collaboratore.


## Stato di implementazione — 1 ottobre 2026

Implementati codec giornaliero e autori, journal SQLite di revisioni/dirty, baseline e outbox per target, adapter Graph cartella, merge per giorno e trasferimenti condizionali, checkpoint e recupero dei fallimenti parziali, protezione delle bozze e commit locali atomici. OneDrive usa il formato giornaliero; Google Drive e Dropbox conservano quello monolitico. Il relay autentica cartelle e appartenenza dei file, isola i canali, deduplica revisioni e recupera eventi persi tramite inventario, senza polling continuo.

La migrazione automatica accetta il vecchio file Markdown, crea una cartella dedicata accanto alla sorgente, conserva originale e backup, suddivide per giorno e riprende dai checkpoint. Il registro coordina destinazione immutabile, lease e generazioni. Il controllo del proprietario riconosce il drive personale o un permesso owner esplicito sul file per l’identità Microsoft dell’account; non usa il solo confronto con il drive personale per una raccolta SharePoint. Una cartella scelta manualmente viene verificata e usata; scegliere il parent del file crea comunque una sottocartella dedicata. Permessi individuali esistenti vengono riprodotti dove verificabili, senza nuovi destinatari e con notifiche disabilitate. Condivisioni non riproducibili o più ampie richiedono intervento del proprietario. La baseline legacy viene salvata prima di un blocco e preservata anche cambiando il percorso. Copie diverse senza baseline verificabile restano soggette alla scelta esplicita, dopo backup di entrambe.

Per gli upload personali viene applicata una condizione nel commit finale della sessione differita. Business/SharePoint usa il contenuto PUT condizionale soltanto dopo una prova sul server con un file temporaneo senza note: revisione errata e superata devono essere rifiutate, come la creazione duplicata. Il file di prova viene rimosso; il mancato rispetto delle condizioni blocca gli upload. Questa verifica concreta evita di assumere il supporto del commit sourceUrl personale per le raccolte aziendali. Il limite di questo endpoint è distinto dalla dimensione del merge.

Evidenze eseguite:

- Suite completa: `npm test`, 54 file e 478 test superati. Copertura di codec/autori, stato SQLite e riapertura, dirty, merge/race, checkpoint, import/bozze, cambi account/target, migrazione e permessi, API/relay, autosync e regressioni degli altri provider.
- `npm run build` e `npm run lint` superati; build delle Pages Functions e del Worker inclusa nella verifica TypeScript. `git diff --check` superato.
- `npm run test:events-runtime` superato in Miniflare con Pages e Worker distinti collegati tramite binding Durable Object esterno: handshake, health, isolamento, deduplica, destinatari e registro/lease. Verificato anche un handshake reale 101 con Wrangler multi-config. Nessuna chiamata Microsoft con credenziali dell’utente in questi controlli.
- `dev:cloud` ora avvia Pages e Worker insieme. Un processo Pages avviato con la configurazione precedente deve essere riavviato; non basta aggiornare il browser. Gli errori di relay non disponibile vengono distinti dai ticket non validi.
- UI verificata nel browser a 320, 375 e 1280 pixel: nessun overflow del pannello con un link lungo, controlli OneDrive da 44 pixel. Il collegamento usato per la prova era soltanto un valore di input, non salvato né autenticato.
- README, privacy, testi delle impostazioni e istruzioni di sviluppo aggiornati.

Verifiche ancora da eseguire prima del rollout: migrazione e scritture concorrenti su account Microsoft reali personali e Business/SharePoint, due account sulla stessa cartella, permessi/gruppi/link dell’ambiente effettivo e comportamento della condizione sul server reale; offline/online e background su iOS Safari/PWA; più schede e misure di richieste/byte su uno storico realistico. I test con fixture non attestano queste prove integrate. L’overlay di attenzione con un account connesso non è stato verificato visivamente nelle prove responsive. Nessun commit, push o deploy è stato eseguito.


### Correzione dal HAR della raccolta SharePoint

Il HAR fornito dall’utente mostra un file Markdown in un drive `documentLibrary`, gruppi SharePoint con ruoli owner/read/write e un link organizzazione edit che identifica anche l’account chiamante. Le richieste completano con 200 ma il controllo locale si interrompe prima della creazione: non è un errore del relay. Il vecchio avviso di baseline restava visibile dopo un successivo errore manuale di autorità.

Il controllo ora distingue proprietà individuale da diritto di scrittura in una raccolta: un writer esplicitamente identificato può tentare la creazione della cartella dedicata nella stessa raccolta e accanto alla sorgente, soggetta all’autorizzazione di Microsoft e alla verifica esatta dei permessi. Non viene dichiarato owner e non può spostare la destinazione nel proprio drive. Sono riconosciuti gli ID dei gruppi SharePoint; i permessi ereditati devono coincidere. Il link organizzazione può essere ricreato soltanto se la sorgente possiede già quel medesimo ambito/ruolo; nessun ripiego organizzazione per sorgenti con destinatari specifici. Link anonimi, scadenze/restrizioni non riproducibili o accessi più ampi bloccano la copia. Gli errori manuali aggiornano anche l’avviso generale, evitando di mostrare un conflitto ormai superato come causa corrente.

Aggiunte regressioni basate sulla forma delle risposte HAR, con identità fittizie: creazione automatica della cartella e dei file giornalieri, conservazione della sorgente, link cartella nuovo, permessi ereditati e stesso scope organizzazione; rifiuto di read-only, identità estranee, drive personale e permessi più ampi. Il HAR non viene copiato nel repository e le credenziali non vengono usate per chiamate live. La copia completa sull’account reale resta da verificare dopo il riavvio dell’app aggiornata.

Verifica dopo la correzione HAR: 54 file e 482 test superati con `npm test -- --maxWorkers=2`; build e lint superati. La prima suite completa in parallelo era terminata con un timeout di 5 secondi nel test preesistente di import/rollback su 10.000 giorni; la riesecuzione con due worker ha superato anche quel test, senza modificarlo né aumentare il timeout.

## Audit del progetto — 2 ottobre 2026, riepilogo chiuso il 5 ottobre

Verificato il branch `feat/onedrive-sync` con test del progetto, prove avversariali indipendenti e confronto con questo piano. Corretto un difetto nel parser delle risposte AI che promuoveva un inserimento annidato in markup malformato a modifica eseguibile della nota. Aggiunte 11 regressioni, compresi streaming e retry.

Esito dopo la correzione: 57 file / 506 test superati, 15 prove QA indipendenti superate, lint e build superati; build MCP e runtime Cloudflare locale superati. Il modulo SQLite WebAssembly è incluso nella precache prodotta. Aggiornati README, istruzioni MCP e testo backup OneDrive; resa versionabile questa cartella dei piani.

Il nuovo controllo visivo è parziale (pannello OneDrive a 320 pixel, browser Zen in finestra privata). Non sostituisce le prove integrate ancora richieste su account Microsoft reali, iOS/PWA e più dispositivi. Dettagli, limiti ed evidenze sono nel [riepilogo delle verifiche](../verification.md). Nessun commit, push o deploy eseguito nell'audit.
