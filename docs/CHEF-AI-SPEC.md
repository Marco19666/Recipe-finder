# Chef-AI — specifica funzionale v1.1

## Obiettivo

Chef-AI è una pagina indipendente collegata dalla home di Recipe Finder. Ogni modalità di ingresso produce la stessa ricetta strutturata e alimenta un solo motore di guida passo passo.

## Modalità di ingresso

Prima versione:
1. Ricerca con il motore di Recipe Finder e selezione di una ricetta.
2. Caricamento di un file di ricetta.
3. Inserimento manuale in campi dedicati.
4. Richiesta di una ricetta generata dall'AI.

Seconda fase:
5. Caricamento di una fotografia e riconoscimento OCR.

## Pipeline unica

1. Acquisizione della ricetta.
2. Standardizzazione AI in background nello schema `chef-ai-recipe.schema.json`.
3. Validazione strutturale e audit AI obbligatorio di completezza e coerenza.
4. Presentazione dei rilievi: l'AI segnala lacune, contraddizioni e possibili correzioni senza modificarle di nascosto.
5. L'utente conferma, corregge o accetta le proposte; i problemi bloccanti devono essere risolti prima di iniziare.
6. Scelta del numero di porzioni desiderato.
7. Ricalcolo delle quantità che possono essere scalate in modo lineare.
8. Richiesta di conferma manuale per ingredienti o quantità che non possono essere scalati in sicurezza.
9. Avvio della guida passo passo.

## Campi della ricetta standard

- Nome della ricetta.
- Porzioni originali e porzioni richieste dall'utente.
- Tempi di preparazione, cottura e totale.
- Ingredienti strutturati con nome, quantità, unità e regola di scalatura.
- Attrezzatura.
- Passaggi ordinati con istruzione, timer, temperatura e modalità di cottura.
- Stato di validazione e problemi rilevati.
- Rapporto di completezza AI con categoria, gravità, descrizione, evidenza nella ricetta, azione suggerita e stato di risoluzione.

Non vengono aggiunti campi generici di identificazione o note. Il nome resta il titolo operativo necessario a riconoscere la ricetta.

## Audit AI obbligatorio di completezza

L'AI deve confrontare l'elenco ingredienti con tutti i passaggi e verificare almeno:
- Ingredienti citati nel procedimento ma assenti dall'elenco.
- Ingredienti elencati ma mai utilizzati, segnalando che potrebbero essere guarnizioni o elementi facoltativi anziché dichiararli automaticamente errori.
- Quantità o unità mancanti, vaghe o incoerenti.
- Passaggi mancanti o salti logici (ad esempio un ingrediente che risulta già cotto senza una fase di cottura descritta).
- Tempi, temperature e modalità di cottura mancanti quando necessari, oppure contraddittori.
- Attrezzatura essenziale non indicata.
- Sequenza non eseguibile, istruzioni ambigue e contraddizioni tra ingredienti, dosi e procedimento.

Ogni rilievo deve indicare categoria, gravità, descrizione, evidenza testuale e correzione suggerita. L'AI non deve inventare dati né applicare automaticamente correzioni sostanziali. Deve distinguere errori certi da possibili omissioni e semplici suggerimenti. I problemi bloccanti richiedono una decisione dell'utente prima di avviare la guida; gli avvisi non bloccanti possono essere confermati o ignorati consapevolmente.

## Regole di integrità

- Non inventare quantità, ingredienti, tempi, temperature o attrezzature mancanti.
- I dati non disponibili restano null e generano un avviso di validazione.
- Distinguere i dati espliciti della fonte dalle eventuali proposte dell'AI.
- Non dichiarare pronta una ricetta con problemi bloccanti.
- Le istruzioni di sicurezza alimentare non vanno dedotte da dati incompleti.
- Conservare il risultato standardizzato e riutilizzarlo: non richiamare l'AI se la ricetta non è cambiata.
- Le porzioni richieste sono una scelta dell'utente e non vanno presunte dall'AI.
- Non scalare automaticamente ingredienti marcati `manual_review` o `not_scaled`.
- I tempi e le temperature non si moltiplicano automaticamente in proporzione alle porzioni.

## Stati di lavorazione

- `da_elaborare`
- `in_elaborazione`
- `da_verificare`
- `pronta`
- `errore`

## Contenimento dei token

- Una sola elaborazione iniziale per standardizzare la ricetta.
- Riutilizzo della ricetta standardizzata memorizzata.
- Guida ordinaria, timer e navigazione gestiti senza chiamate AI.
- Domande all'assistente AI solo su richiesta dell'utente.
- Per la chat, inviare ricetta e stato corrente con memoria sintetica, non l'intera cronologia.
- Cronologia completa consultabile separatamente dalla memoria inviata al modello.

## Fuori dalla prima versione

Il caricamento fotografico con OCR è previsto per una seconda fase e non deve condizionare lo schema comune.
