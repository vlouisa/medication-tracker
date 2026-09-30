# Implementation Brief — Medication Plan Correction, Reconciliation & Schedule History

## 1. Doel

Breid Medication Tracker uit zodat een reeds gegenereerd medicatieplan kan worden gecorrigeerd nadat daarvoor al `medication-intakes` zijn aangemaakt.

De applicatie moet na een correctie:

1. het gewenste innameschema opnieuw bepalen;
2. bestaande intake-records daarmee reconciliëren;
3. historische uitvoering behouden;
4. een onveranderlijke snapshot bewaren van iedere succesvol toegepaste versie van het medicatieplan.

Belangrijke uitgangspunten:

- `medication-schedules` bevat de huidige versie van een plan;
- `medication-schedule-history` bevat de historisch toegepaste versies van een plan;
- `medication-intakes` bevat de afzonderlijke geplande en uitgevoerde innamemomenten;
- een plan mag worden gecorrigeerd;
- reeds geregistreerde werkelijkheid mag door reconciliation niet verloren gaan;
- nog niet uitgevoerde intake-records mogen vervallen wanneer zij niet meer bij het gecorrigeerde plan horen;
- vervallen intake-records worden niet verwijderd maar krijgen status `CANCELLED`;
- een reeds verstuurde reminder blijft bruikbaar, ook wanneer de bijbehorende intake inmiddels `CANCELLED` is;
- gebruik één intake-statusmodel;
- introduceer geen aparte intake-auditlog voor deze feature;
- reconciliation en plan-history moeten idempotent en veilig opnieuw uitvoerbaar zijn.

---

## 2. Achtergrond

In v1 wordt een medicatieplan aangemaakt en verwerkt:

`DRAFT -> READY -> GENERATED`

Bij verwerking worden op basis van onder andere:

- StartDate;
- DurationDays;
- Times;

afzonderlijke `medication-intakes` gegenereerd.

Na generatie kan blijken dat het oorspronkelijke plan een invoerfout bevatte.

Voorbeelden:

- verkeerd tijdstip;
- verkeerde frequentie;
- verkeerde startdatum;
- verkeerde duur;
- verkeerde dosering;
- verkeerde toedieningsinformatie.

Op dit moment bestaat hiervoor geen expliciete correctie- en reconciliation-flow.

Het simpelweg opnieuw genereren van een gewijzigd plan is niet veilig, omdat al bestaande intake-records kunnen bestaan en sommige daarvan mogelijk al `NOTIFIED` of `COMPLETED` zijn.

Daarnaast zou zonder plan-history na een correctie alleen de huidige versie van het plan zichtbaar zijn. Daardoor is later niet meer te verklaren waarom bepaalde intake-records bijvoorbeeld `CANCELLED` zijn.

---

## 3. Domeinmodel

Maak expliciet onderscheid tussen drie concepten.

### 3.1 Medication schedule

Het schedule beschrijft de huidige versie van het bedoelde medicatieplan.

Een correctie betekent:

> dit is het schema zoals het bedoeld was.

Een correctie hoeft daarom niet uitsluitend vanaf het huidige tijdstip te gelden.

### 3.2 Medication schedule history

Schedule history bevat immutable snapshots van de daadwerkelijk toegepaste versies van een medicatieplan.

Het doel hiervan is functionele planversionering.

Het is nadrukkelijk geen generiek technisch audit-framework.

### 3.3 Medication intake

Een intake is een afzonderlijk gepland innamemoment en bevat daarnaast informatie over de verwerking en eventuele daadwerkelijke uitvoering.

Een `COMPLETED` intake bevat geregistreerde werkelijkheid en mag niet automatisch worden verwijderd of overschreven omdat het bovenliggende plan later wordt gecorrigeerd.

---

## 4. Correctie van een gegenereerd plan

Ondersteun een expliciete status waarmee de gebruiker aangeeft dat een bestaand `GENERATED` plan opnieuw verwerkt moet worden.

Voorgestelde status:

`READY_FOR_RECONCILIATION`

Flow:

`GENERATED -> READY_FOR_RECONCILIATION -> GENERATED`

Bij een fout:

`READY_FOR_RECONCILIATION -> ERROR`

De gebruiker:

1. corrigeert de relevante velden van het bestaande plan;
2. zet Status op `READY_FOR_RECONCILIATION`;
3. de reconciliation-processor verwerkt het gewijzigde plan;
4. bij succesvolle verwerking wordt het plan opnieuw `GENERATED`.

Gebruik niet automatisch iedere wijziging aan een `GENERATED` plan als trigger voor reconciliation.

De statuswijziging is de expliciete opdracht van de gebruiker om de gewijzigde gegevens toe te passen.

Als tijdens refinement blijkt dat een andere statusnaam beter aansluit bij de bestaande implementatie, mag die worden voorgesteld.

Behoud in alle gevallen een expliciete user action.

---

## 5. Intake-status CANCELLED

Voeg aan medication-intakes de status toe:

`CANCELLED`

Betekenis:

> dit geplande innamemoment behoorde tot een eerder toegepaste versie van het plan, maar is door een correctie vervallen en wordt niet meer actief door het systeem opgevolgd.

Een `CANCELLED` record:

- wordt niet verwijderd;
- wordt niet genotificeerd;
- wordt niet automatisch door de notification processor opgepakt;
- mag via een reeds bestaande completion-link alsnog `COMPLETED` worden.

`CANCELLED` betekent nadrukkelijk niet:

> de medicatie is niet ingenomen.

---

## 6. Statusovergangen bij reconciliation

Ondersteun minimaal:

`PENDING -> CANCELLED`

`NOTIFIED -> CANCELLED`

Ondersteun niet automatisch:

`COMPLETED -> CANCELLED`

Een `COMPLETED` intake wordt door reconciliation niet gewijzigd.

Daarnaast is via de normale completion-flow toegestaan:

`CANCELLED -> COMPLETED`

Deze overgang kan optreden wanneer de gebruiker een reeds verstuurde reminder bevestigt nadat de intake door reconciliation `CANCELLED` is geworden.

---

## 7. CANCELLED -> COMPLETED

Een `NOTIFIED` intake kan vóór een plancorrectie al als reminder op het apparaat van de gebruiker staan.

Voorbeeld:

`14:00 NOTIFIED`

Daarna wordt het plan gecorrigeerd van 14:00 naar 13:00.

Reconciliation resulteert in:

`14:00 CANCELLED`

en eventueel:

`13:00 PENDING`

De gebruiker kan vervolgens de reeds ontvangen 14:00-reminder gebruiken en bevestigen dat de medicatie daadwerkelijk is ingenomen.

Registreer dan:

`14:00 CANCELLED -> COMPLETED`

Hierbij wint de geregistreerde werkelijkheid van de eerdere cancellation.

Introduceer hiervoor geen tweede statusdimensie.

---

## 8. Geen hard delete

Reconciliation mag bestaande intake-records niet verwijderen.

Een obsolete intake wordt waar toegestaan:

`PENDING -> CANCELLED`

of:

`NOTIFIED -> CANCELLED`

Een `COMPLETED` record blijft intact.

Hierdoor blijft bestaande historie behouden en kunnen eerder verstuurde completion-links blijven functioneren.

---

## 9. Expected schedule opnieuw berekenen

Gebruik voor reconciliation dezelfde domeinlogica waarmee bij initiële generatie de verwachte intake-momenten worden bepaald.

Voorkom twee onafhankelijke implementaties van:

`plan -> expected intake moments`

Initial generation en reconciliation moeten dezelfde logica gebruiken.

Voorbeeld oorspronkelijk:

- StartDate: 30/09/2026
- DurationDays: 2
- Times: 08:00, 14:00, 20:00

Expected:

- 30/09 08:00
- 30/09 14:00
- 30/09 20:00
- 01/10 08:00
- 01/10 14:00
- 01/10 20:00

Na correctie:

`Times = 08:00, 13:00, 20:00`

Expected wordt volledig opnieuw berekend vanuit het gecorrigeerde plan.

---

## 10. Reconciliation

Vergelijk voor het betreffende ScheduleID:

A. alle intake-momenten die volgens het gecorrigeerde plan zouden moeten bestaan;

met:

B. alle bestaande medication-intakes voor het plan.

Classificeer minimaal:

- unchanged;
- missing;
- obsolete;
- completed historical record.

### Unchanged

Een bestaand intake-record komt nog steeds overeen met het gecorrigeerde plan.

Behoud het record.

### Missing

Een verwacht intake-moment bestaat nog niet.

Maak een nieuw intake-record aan wanneer de regels voor verleden/toekomst dit toestaan.

### Obsolete

Een bestaand niet-voltooid intake-record hoort niet meer bij het gecorrigeerde plan.

Zet:

`PENDING -> CANCELLED`

of:

`NOTIFIED -> CANCELLED`

### Completed historical record

Een bestaand `COMPLETED` intake-record hoort volgens het gecorrigeerde plan niet meer bij het gewenste schema.

Behoud het record ongewijzigd.

---

## 11. Functionele identiteit

Gebruik bij reconciliation dezelfde functionele identiteit die reeds voor idempotente generatie wordt gebruikt.

Uitgangspunt:

`ScheduleID + ScheduledAt`

Controleer tijdens refinement of de huidige implementatie dit daadwerkelijk als functionele identiteit gebruikt.

Pas dit niet stilzwijgend aan wanneer de bestaande implementatie inmiddels een ander contract gebruikt.

---

## 12. Snapshotgegevens van intakes

Medication-intakes bevatten snapshots van relevante plangegevens, waaronder bijvoorbeeld:

- Medication;
- Dosage;
- Administration.

Een correctie kan ook uitsluitend snapshotgegevens wijzigen zonder `ScheduledAt` te veranderen.

### PENDING

Voor een bestaande `PENDING` intake die nog steeds bij hetzelfde geplande moment hoort:

update de snapshots naar de gecorrigeerde plangegevens.

### NOTIFIED

Voor `NOTIFIED` records moet conservatief worden omgegaan met snapshotwijzigingen omdat reeds een notificatie met de oude informatie kan zijn verstuurd.

Tijdens refinement moet expliciet worden bepaald of:

- de bestaande snapshot behouden blijft;
- of de snapshot wordt bijgewerkt.

Maak deze keuze niet impliciet in de implementatie.

### COMPLETED

Wijzig snapshots van `COMPLETED` records niet automatisch.

### CANCELLED

Een `CANCELLED` record hoeft niet automatisch bijgewerkt te worden naar nieuwe plangegevens.

---

## 13. Verleden en toekomst

Gebruik niet als algemene regel:

> correcties gelden alleen vanaf nu.

Het gecorrigeerde plan beschrijft het schema zoals het bedoeld was en mag daarom ook verwachte momenten in het verleden veranderen.

Voorbeeld:

Oorspronkelijk:

`08:00 COMPLETED`
`14:00 PENDING`
`20:00 PENDING`

Correctie:

`09:00`
`13:00`
`20:00`

De 08:00 `COMPLETED` intake blijft bestaan.

De obsolete 14:00 intake kan `CANCELLED` worden.

Het 13:00 moment ontbreekt volgens het gecorrigeerde plan.

Tijdens refinement moet expliciet worden bepaald wat er gebeurt wanneer een nieuw expected moment inmiddels in het verleden ligt.

Maak hiervoor geen stilzwijgende aanname.

---

# Schedule History

## 14. Nieuw tabblad medication-schedule-history

Introduceer een nieuw tabblad:

`medication-schedule-history`

Dit tabblad bevat immutable snapshots van iedere succesvol toegepaste versie van een medication schedule.

Doel:

- kunnen reconstrueren welke versie van een plan daadwerkelijk actief is geweest;
- kunnen verklaren waarom intake-records door latere reconciliation zijn gewijzigd of gecancelled;
- planwijzigingen inzichtelijk houden zonder een generiek audit-framework te introduceren.

---

## 15. History is version history, geen technisch auditlog

Behandel `medication-schedule-history` als functionele planversionering.

Registreer niet:

- iedere celwijziging;
- iedere DRAFT-wijziging;
- mislukte invoerpogingen;
- statuspolling;
- trigger-runs;
- technische events;
- afzonderlijke property changes.

De historie bevat uitsluitend versies van plannen die daadwerkelijk succesvol door de applicatie zijn toegepast.

---

## 16. Wanneer ontstaat een history-versie?

Maak een history-snapshot wanneer een plan succesvol wordt toegepast.

Minimaal:

### Eerste generatie

Wanneer:

`READY -> GENERATED`

succesvol is afgerond, ontstaat:

`Version 1`

### Succesvolle reconciliation

Wanneer:

`READY_FOR_RECONCILIATION -> GENERATED`

succesvol is afgerond, ontstaat de volgende versie:

`Version N + 1`

Een mislukte generation of reconciliation maakt geen nieuwe history-versie.

Een wijziging in de Sheet terwijl het plan nog niet opnieuw is toegepast maakt eveneens geen nieuwe versie.

---

## 17. Betekenis van een history-versie

Een history-record betekent:

> deze versie van het medicatieplan is door de applicatie succesvol toegepast.

Daarmee bevat history alleen betekenisvolle domeintoestanden.

Voorbeeld:

| ScheduleID | Version | Medication | Dosage | StartDate | DurationDays | Times |
|---|---:|---|---|---|---:|---|
| abc | 1 | Dexa | 1 druppel | 30/09 | 7 | 08:00,14:00,20:00 |
| abc | 2 | Dexa | 1 druppel | 30/09 | 7 | 08:00,13:00,20:00 |

Hieruit is zichtbaar dat het 14:00-moment uit versie 1 later is vervangen door 13:00 in versie 2.

---

## 18. History-schema

Definieer het definitieve schema tijdens refinement op basis van het bestaande schedule-model.

Neem minimaal op:

- ID;
- ScheduleID;
- Version;
- Medication;
- Dosage;
- Administration;
- StartDate;
- DurationDays;
- Times;
- RecordedAt.

### ID

Gebruik een UUID voor het history-record.

### ScheduleID

Verwijst naar het oorspronkelijke medication schedule.

### Version

Oplopend versienummer per ScheduleID:

`1, 2, 3, ...`

### Planvelden

Bewaar een snapshot van alle functionele planvelden die nodig zijn om de toegepaste versie te reconstrueren.

### RecordedAt

Tijdstip waarop deze planversie succesvol is toegepast.

Controleer tijdens refinement welke aanvullende functionele schedulevelden inmiddels in de actuele implementatie bestaan en in de snapshot thuishoren.

Kopieer niet automatisch technische velden zoals `LastError` of tijdelijke processing-statussen naar history.

---

## 19. Immutable history

Bestaande records in `medication-schedule-history` worden nooit door normale applicatielogica gewijzigd of verwijderd.

Nieuwe planversie:

→ nieuwe history-row.

Geen update van de vorige versie.

Het history-tabblad is system-managed en wordt waar praktisch beschermd tegen handmatige wijzigingen.

---

## 20. Idempotentie van history

History creation moet idempotent zijn.

Een retry van dezelfde generation of reconciliation mag niet meerdere identieke planversies creëren.

Voorbeeld:

reconciliation past versie 2 toe maar verwerking wordt door een technische fout opnieuw gestart.

Het resultaat mag niet zijn:

`Version 1`
`Version 2`
`Version 3`

waar versie 2 en 3 inhoudelijk dezelfde application van dezelfde reconciliation zijn.

Tijdens refinement moet worden bepaald hoe een succesvol toegepaste versie technisch betrouwbaar wordt geïdentificeerd.

Vertrouw niet uitsluitend op "hoogste version + 1" zonder rekening te houden met retries/concurrency.

---

## 21. Atomiciteit tussen reconciliation en history

Een schedule mag pas als succesvol `GENERATED` worden beschouwd wanneer:

- de relevante intake-reconciliation succesvol is afgerond;
- de bijbehorende schedule-history-versie correct is vastgelegd.

Voorkom waar mogelijk situaties waarbij:

- intakes versie 2 representeren;
- maar history alleen versie 1 bevat;

of andersom.

Omdat Google Sheets geen database-transacties biedt, ontwerp deze verwerking retry-safe en idempotent.

Gebruik waar nodig `LockService`.

---

# Intake lifecycle

## 22. Notification processor

`CANCELLED` mag nooit worden genotificeerd.

Conceptueel:

`PENDING -> notification -> NOTIFIED`

maar:

`CANCELLED -> geen actie`

`NOTIFIED -> geen nieuwe notificatie`

`COMPLETED -> geen actie`

Controleer bestaande notification filtering/query-logica.

Een reeds verstuurde notificatie kan uiteraard niet worden teruggehaald wanneer de intake later `CANCELLED` wordt.

---

## 23. Web App completion

De Web App moet completion ondersteunen voor minimaal:

`NOTIFIED -> COMPLETED`

en:

`CANCELLED -> COMPLETED`

Voor `CANCELLED -> COMPLETED`:

- registreer status `COMPLETED`;
- registreer `CompletedAt` volgens het bestaande contract;
- wijzig `ScheduledAt` niet.

Een `COMPLETED` intake blijft idempotent.

Opnieuw openen van dezelfde completion-link:

- verandert de status niet;
- overschrijft de oorspronkelijke `CompletedAt` niet.

---

## 24. Geen intake-auditlog

Introduceer voor deze feature geen:

`medication-intake-history`

of generiek intake-auditlog.

De bestaande intake bevat reeds operationeel relevante informatie zoals:

- ScheduledAt;
- Status;
- NotifiedAt;
- CompletedAt.

Voor deze feature bestaat geen concrete functionele behoefte om iedere intake-statusovergang historisch vast te leggen.

Accepteer daarom bewust dat bijvoorbeeld:

`NOTIFIED -> CANCELLED -> COMPLETED`

uiteindelijk zichtbaar kan zijn als:

`Status = COMPLETED`

zonder dat permanent wordt opgeslagen dat de intake tussentijds `CANCELLED` is geweest.

Introduceer geen extra infrastructuur uitsluitend om die tussenstatus te bewaren.

---

## 25. CANCELLED-records en latere reconciliation

Een volgende reconciliation moet rekening houden met eerder gecancelde records.

Voorbeeld:

1. 14:00 bestaat;
2. plan wordt gewijzigd naar 13:00;
3. 14:00 wordt `CANCELLED`;
4. gebruiker corrigeert het plan later weer terug naar 14:00.

Tijdens refinement moet expliciet worden bepaald of:

- het bestaande `CANCELLED` record opnieuw `PENDING` wordt;

of:

- het `CANCELLED` record blijft bestaan en een nieuw intake-record wordt gemaakt.

Voorkeur:

hergebruik/reactiveer het bestaande `CANCELLED` record wanneer dit veilig en eenduidig kan en het record nooit `COMPLETED` is geweest.

Voorkom meerdere actieve records voor dezelfde functionele identiteit.

---

# Betrouwbaarheid

## 26. Idempotentie

Reconciliation moet volledig idempotent zijn.

Wanneer hetzelfde gecorrigeerde plan meerdere keren wordt verwerkt:

- ontstaan geen dubbele actieve intakes;
- worden geen extra CANCELLED-records gemaakt;
- worden COMPLETED-records niet gewijzigd;
- ontstaan geen dubbele history-versies;
- blijven correcte records behouden;
- eindigt het plan opnieuw in dezelfde geldige toestand.

---

## 27. Partial failure

Reconciliation kan meerdere mutaties vereisen.

Bijvoorbeeld:

- 2 records annuleren;
- 3 records behouden;
- 2 nieuwe records maken;
- 1 history-snapshot schrijven;
- schedule-status bijwerken.

Wanneer verwerking halverwege faalt, moet een volgende run veilig verder kunnen gaan of dezelfde gewenste toestand opnieuw kunnen realiseren.

Vertrouw niet uitsluitend op de schedule-status als bewijs dat verwerking volledig is afgerond.

---

## 28. Concurrency

Houd rekening met overlap tussen:

- notification processing;
- reconciliation;
- Web App completion;
- generation;
- meerdere trigger-runs.

Gebruik waar nodig `LockService` rond kritieke read-modify-write-operaties.

Locking vervangt idempotentie niet.

Besteed specifiek aandacht aan:

1. intake is `NOTIFIED`;
2. reconciliation besluit dat deze obsolete is;
3. gebruiker bevestigt tegelijkertijd de intake.

Als de gebruiker de intake bevestigt, moet de uiteindelijke toestand `COMPLETED` kunnen worden.

Reconciliation mag een inmiddels `COMPLETED` intake niet daarna opnieuw `CANCELLED` maken.

`COMPLETED` heeft voor reconciliation voorrang boven cancellation.

---

## 29. Validatie vóór reconciliation

Voer dezelfde planvalidatie uit als bij initiële generatie.

Een ongeldig gecorrigeerd plan mag geen gedeeltelijke reconciliation uitvoeren.

Conceptueel:

1. lees plan;
2. valideer volledig;
3. bereken volledig expected schema;
4. bepaal reconciliation;
5. pas reconciliation toe;
6. schrijf succesvolle history-versie;
7. rond schedule-verwerking af.

Bij validatiefout:

`READY_FOR_RECONCILIATION -> ERROR`

en schrijf een bruikbare `LastError`.

Bestaande intake-records blijven in dat geval ongemoeid.

Er ontstaat geen nieuwe history-versie.

---

# Spreadsheet en architectuur

## 30. User workflow

De correctie moet bruikbaar blijven vanuit Google Sheets op Android.

Geen afhankelijkheid van:

- custom menus;
- desktop-only dialogs;
- custom buttons.

Verwachte flow:

1. gebruiker opent `medication-schedules`;
2. corrigeert planvelden;
3. zet Status op `READY_FOR_RECONCILIATION`;
4. trigger verwerkt wijziging;
5. intakes worden gereconcilieerd;
6. nieuwe history-versie wordt vastgelegd;
7. schedule wordt `GENERATED`.

Bij fout:

`Status = ERROR`

`LastError = <duidelijke foutmelding>`

---

## 31. System-managed data

Planvelden die user-managed zijn blijven wijzigbaar.

Technische/system-managed velden blijven waar mogelijk beschermd.

`medication-intakes` wordt door de applicatie beheerd.

`medication-schedule-history` is volledig system-managed.

De gebruiker hoeft intakes of history niet handmatig aan te passen voor normale plancorrecties.

---

## 32. setupSpreadsheet()

Werk `setupSpreadsheet()` gericht bij voor:

- nieuwe schedule-status;
- `CANCELLED`;
- eventuele aangepaste data validation;
- conditional formatting;
- protections;
- nieuw tabblad `medication-schedule-history`;
- history headers en relevante formatting.

`setupSpreadsheet()` moet veilig opnieuw uitvoerbaar blijven en bestaande operationele data niet overschrijven.

---

## 33. Logging

Log minimaal voldoende informatie om reconciliation technisch te kunnen volgen:

- ScheduleID;
- schedule version;
- aantal expected moments;
- aantal unchanged;
- aantal created;
- aantal cancelled;
- aantal completed records preserved;
- aantal reactivated indien van toepassing;
- history creation;
- foutmelding bij failure.

Log geen secrets.

Voorkom onnodig loggen van medicatie-inhoud wanneer identifiers voldoende zijn voor technische diagnose.

---

## 34. Architectuur

Volg `AGENTS.md`.

Plaats:

- expected-schedule-berekening en reconciliation-regels zoveel mogelijk in domain/application;
- planversionering als functioneel concept in domain/application;
- Sheet reads/writes in infrastructure;
- trigger-entrypoints in entrypoints.

Voorkom één grote reconciliation-functie waarin domeinregels, history, Sheet-access en triggerafhandeling door elkaar lopen.

Gebruik het bestaande IIFE-servicepatroon waar dit aansluit bij de repository.

Introduceer geen generiek audit-framework.

---

## 35. Hergebruik bestaande generatie

Refactor bestaande generatie alleen waar nodig om dezelfde plan-to-intake-berekening door generation en reconciliation te gebruiken.

Behoud bestaand v1-gedrag voor:

`DRAFT -> READY -> GENERATED`

Breid initiële generatie alleen zover uit als nodig om bij succesvolle generatie `Version 1` in schedule history vast te leggen.

Maak geen brede architectuurrefactor als onderdeel van deze feature.

---

## 36. Backwards compatibility

Bestaande reeds gegenereerde schedules en intakes moeten geldig blijven.

Omdat bestaande schedules mogelijk vóór introductie van schedule-history al `GENERATED` zijn, moet tijdens refinement expliciet worden bepaald hoe hiermee wordt omgegaan.

Voorkom een zware datamigratie wanneer die niet noodzakelijk is.

Een mogelijke aanpak is lazy initialization:

- bestaand GENERATED plan zonder history krijgt bij de eerste relevante verwerking een initiële history-versie;

maar kies dit pas na inspectie van de actuele repository en dataflow.

Werk waar nodig gericht bij:

- validation;
- conditional formatting;
- status dropdowns;
- `setupSpreadsheet()`;
- notification filters;
- Web App completion.

---

## 37. Out of scope

Niet onderdeel van deze wijziging:

- handmatig wijzigen van COMPLETED intake-historie;
- intake-audit/history;
- generiek audit-framework;
- logging van iedere Sheet-celwijziging;
- volledige event sourcing;
- tweede intake-statusdimensie zoals `PlanState`;
- gebruikersaccounts;
- multi-user;
- medische interpretatie van een correctie;
- automatisch bepalen welk medicatieschema medisch juist is;
- voorschrift-/apotheekintegratie;
- dashboards;
- voorraadbeheer;
- automatische medische waarschuwingen;
- advies over dosering of frequentie.

De applicatie voert uitsluitend het door de gebruiker ingevoerde plan uit.

---

# Acceptance criteria

## 38. Reconciliation

De feature is minimaal gereed wanneer:

1. Een `GENERATED` plan kan worden gewijzigd en expliciet voor reconciliation worden aangeboden.

2. Het gecorrigeerde plan volledig wordt gevalideerd vóór intake-mutaties.

3. Expected intake moments met dezelfde domeinlogica als initiële generatie worden berekend.

4. Ongewijzigde intake-records behouden blijven.

5. Ontbrekende intake-records volgens de vastgestelde regels worden aangemaakt.

6. Obsolete `PENDING` intakes `CANCELLED` worden.

7. Obsolete `NOTIFIED` intakes `CANCELLED` mogen worden.

8. `COMPLETED` intakes niet automatisch worden verwijderd, gecancelled of herschreven.

9. `CANCELLED` intakes nooit worden genotificeerd.

10. Een bestaande completion-link voor een `CANCELLED` intake bruikbaar blijft.

11. Bevestiging resulteert in:

   `CANCELLED -> COMPLETED`

12. `CompletedAt` correct wordt geregistreerd.

13. Herhaald openen van de completion-link idempotent blijft.

14. Reconciliation idempotent is.

15. Een partial failure veilig opnieuw verwerkt kan worden.

16. Geen dubbele actieve intake-records ontstaan.

17. Een `COMPLETED` intake niet door een latere/racende reconciliation opnieuw `CANCELLED` kan worden.

---

## 39. Schedule history

Schedule history is minimaal gereed wanneer:

1. `medication-schedule-history` bestaat.

2. Iedere history-row een immutable snapshot van een succesvol toegepaste planversie representeert.

3. De eerste succesvolle generatie resulteert in `Version 1`.

4. Iedere succesvolle inhoudelijke reconciliation resulteert in een volgende versie.

5. DRAFT-wijzigingen geen history-record creëren.

6. Mislukte generation/reconciliation geen history-record creëert.

7. Retries geen dubbele history-versies veroorzaken.

8. History minimaal ScheduleID, Version, relevante planvelden en RecordedAt bevat.

9. Bestaande history-records niet door normale applicatielogica worden gewijzigd.

10. Het history-tabblad system-managed is.

11. Geen intake-history/audit wordt geïntroduceerd.

---

## 40. Belangrijke testsituaties

### Scenario A — toekomstig PENDING moment vervalt

Voor:

`14:00 PENDING`

Correctie:

`14:00 -> 13:00`

Na reconciliation:

`14:00 CANCELLED`
`13:00 PENDING`

14:00 wordt niet meer genotificeerd.

Er ontstaat een nieuwe schedule-history-versie.

### Scenario B — reeds genotificeerd moment vervalt

Voor:

`14:00 NOTIFIED`

Correctie naar 13:00.

Na reconciliation:

`14:00 CANCELLED`

Gebruiker bevestigt bestaande reminder.

Resultaat:

`14:00 COMPLETED`

met correcte `CompletedAt`.

### Scenario C — COMPLETED moment vervalt volgens nieuw plan

Voor:

`14:00 COMPLETED`

Correctie naar 13:00.

Na reconciliation blijft:

`14:00 COMPLETED`

### Scenario D — dubbele reconciliation

Voer dezelfde reconciliation opnieuw uit.

Resultaat:

- geen duplicate intakes;
- geen extra cancellations;
- geen duplicate history-versie;
- dezelfde eindtoestand.

### Scenario E — completion en reconciliation tegelijk

Een `NOTIFIED` intake wordt ongeveer tegelijkertijd:

- obsolete verklaard;
- bevestigd.

Uiteindelijke toestand:

`COMPLETED`

Een latere reconciliation mag deze niet terugzetten naar `CANCELLED`.

### Scenario F — oude completion-link tweemaal

`CANCELLED -> COMPLETED`

Open dezelfde URL opnieuw.

Resultaat:

- status blijft COMPLETED;
- oorspronkelijke CompletedAt blijft behouden.

### Scenario G — plan meerdere keren corrigeren

Version 1:

`08:00,14:00,20:00`

Version 2:

`08:00,13:00,20:00`

Version 3:

`08:00,13:00,19:00`

History bevat exact drie toegepaste planversies.

### Scenario H — ongeldige correctie

Plan wordt gewijzigd naar ongeldige invoer en aangeboden voor reconciliation.

Resultaat:

- Status = ERROR;
- relevante LastError;
- bestaande intakes blijven ongemoeid;
- geen nieuwe history-versie.

---

# Refinement

## 41. Verplichte refinement-vragen vóór implementatie

Gebruik `feature-refinement` vóór implementatie.

Laat minimaal expliciet beantwoorden:

1. Welke bestaande services/functions verzorgen momenteel planvalidatie en intake-generation?

2. Wordt `(ScheduleID, ScheduledAt)` daadwerkelijk als functionele intake-identiteit gebruikt?

3. Welke schedule- en intake-statussen bestaan exact?

4. Wat gebeurt er wanneer een correctie een nieuw expected moment in het verleden introduceert?

5. Wat gebeurt er met een `NOTIFIED` intake waarvan alleen snapshotgegevens veranderen?

6. Hoe wordt concurrency tussen completion en reconciliation veilig afgehandeld?

7. Hoe wordt gegarandeerd dat `COMPLETED` niet daarna opnieuw `CANCELLED` wordt?

8. Wordt een eerder `CANCELLED` record gereactiveerd wanneer hetzelfde ScheduledAt later opnieuw onderdeel van het plan wordt?

9. Is `READY_FOR_RECONCILIATION` de beste statusnaam?

10. Welke exacte velden uit het actuele schedule-model moeten in `medication-schedule-history` worden opgenomen?

11. Hoe wordt history-versioning idempotent gemaakt bij retries?

12. Hoe wordt partial failure tussen intake-reconciliation en history-writing veilig hersteld?

13. Hoe worden bestaande GENERATED schedules zonder history behandeld?

14. Welke wijzigingen zijn nodig aan `setupSpreadsheet()`, validation, protections en conditional formatting?

15. Welke bestaande tests kunnen worden uitgebreid en welke nieuwe tests zijn noodzakelijk?

16. Kan dit zonder onnodige abstractielagen of generiek audit-framework worden geïmplementeerd?

Refinement mag eenvoudiger of veiliger oplossingen voorstellen, maar mag de kernprincipes niet zonder expliciete beslissing wijzigen:

- behoud van COMPLETED historie;
- expliciete reconciliation;
- geen hard delete;
- CANCELLED wordt niet genotificeerd;
- CANCELLED -> COMPLETED is toegestaan;
- één intake-statusmodel;
- immutable schedule version history;
- geen intake-audit;
- idempotentie.

---

## 42. Implementatievolgorde

Na refinement bij voorkeur:

1. actuele repository en statuscontracten inspecteren;
2. expected-schedule-berekening controleren/refactoren waar noodzakelijk;
3. schedule-history model en persistence ontwerpen;
4. `CANCELLED` en reconciliation-status toevoegen;
5. reconciliation-service implementeren;
6. history-writing integreren;
7. Sheet infrastructure aanpassen;
8. notification filtering aanpassen;
9. Web App completion uitbreiden met `CANCELLED -> COMPLETED`;
10. concurrency/idempotentie/partial recovery afhandelen;
11. `setupSpreadsheet()` en protections/validation/formatting bijwerken;
12. bestaande en nieuwe tests uitvoeren;
13. relevante end-to-end scenario's testen.

Voer geen productie-side-effects uit zonder expliciete toestemming.