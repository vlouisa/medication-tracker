# Implementation Brief – Medication Tracker v1

## 1. Doel

Bouw een Google Apps Script-applicatie waarmee een gebruiker medicatieschema's vanuit Google Sheets kan vastleggen.

Een medicatieschema wordt automatisch omgezet naar concrete geplande innamemomenten.

Voor ieder innamemoment moet de gebruiker via een mobiele notificatie worden herinnerd en vervolgens kunnen registreren dat de medicatie is ingenomen of toegediend.

De applicatie moet generiek zijn voor verschillende vormen van medicatie, bijvoorbeeld:

- oogdruppels;
- tabletten/pillen;
- zalf;
- injecties;
- andere medicatievormen.

De volledige normale workflow moet vanaf een mobiele telefoon bruikbaar zijn.

Custom spreadsheetmenu's en buttons mogen daarom niet noodzakelijk zijn voor normaal gebruik.

---

## 2. Uitgangspunt: één persoon

Iedere deployment en bijbehorende Google Spreadsheet is gekoppeld aan exact één persoon.

Er zijn daarom geen:

- gebruikersaccounts;
- `UserID`-velden;
- gebruikersspecifieke filters;
- verschillende notificatieontvangers per record.

Alle schedules en intakes in één Spreadsheet behoren impliciet bij dezelfde persoon.

---

## 3. Hoofdconcepten

Maak onderscheid tussen:

### MedicationSchedule

Een `MedicationSchedule` beschrijft een medicatieschema.

Voorbeeld:

```text id="6ob4gk"
Medication:       Dexa
Dosage:           1 druppel
Administration:   rechteroog
StartDate:        2026-09-29
DurationDays:     2
Times:            08:00,14:00,20:00
```

Dit schedule beschrijft:

> Dexa, 1 druppel in het rechteroog, gedurende twee dagen vanaf 29 september, driemaal per dag.

Dit resulteert in zes concrete innamemomenten.

### MedicationIntake

Een `MedicationIntake` vertegenwoordigt één concreet gepland medicatiemoment.

Voor bovenstaand schedule:

```text id="f3pt80"
29-09-2026 08:00
29-09-2026 14:00
29-09-2026 20:00
30-09-2026 08:00
30-09-2026 14:00
30-09-2026 20:00
```

Iedere intake heeft een eigen UUID en eigen lifecycle.

---

## 4. Google Sheets

Gebruik twee tabs:

```text id="zq4w1b"
medication-schedules
medication-intakes
```

`medication-schedules` is primair de invoer- en opdrachtlaag voor de gebruiker.

`medication-intakes` bevat de door het systeem gegenereerde concrete innamemomenten en fungeert als operationeel logboek.

---

## 5. medication-schedules

Gebruik de volgende kolommen:

| Kolom | Owner | Editable | Omschrijving |
|---|---|---|---|
| ID | SYSTEM | Nee | UUID van schedule |
| Medication | USER | Ja | Naam van medicatie |
| Dosage | USER | Ja | Dosering als leesbare tekst |
| Administration | USER | Ja | Wijze/plaats van toediening |
| StartDate | USER | Ja | Eerste dag waarop schema geldt |
| DurationDays | USER | Ja | Aantal dagen inclusief StartDate |
| Times | USER | Ja | Kommagescheiden dagelijkse tijdstippen |
| Status | USER/SYSTEM | Beperkt | Workflowstatus |
| LastError | SYSTEM | Nee | Laatste verwerkingsfout |
| CreatedAt | SYSTEM | Nee | Aanmaakmoment |
| UpdatedAt | SYSTEM | Nee | Laatste wijziging |

`Administration` is vrije tekst.

Voorbeelden:

```text id="s6fn5k"
oraal
rechteroog
linkeroog
beide ogen
huid
linkerarm
```

Maak hier voor v1 geen enum van.

---

## 6. Schedule-statussen

Ondersteun:

```text id="sgsf7p"
DRAFT
READY
GENERATED
ERROR
```

### DRAFT

Het schedule wordt nog ingevoerd of gecontroleerd.

Het systeem verwerkt dit record niet.

### READY

De gebruiker geeft hiermee aan dat het schedule compleet is en verwerkt mag worden.

### GENERATED

Alle verwachte intake-records zijn succesvol gegenereerd.

Deze status wordt door het systeem gezet.

### ERROR

Het schedule kon niet succesvol worden verwerkt.

`LastError` bevat de reden.

Deze status wordt door het systeem gezet.

---

## 7. Statusovergangen

De gebruiker initieert:

```text id="24vw0v"
DRAFT → READY
ERROR → READY
```

Het systeem beheert:

```text id="ewf2j3"
READY → GENERATED
READY → ERROR
```

Normale flow:

```text id="n6d8cf"
DRAFT
  ↓
READY
  ↓
GENERATED
```

Foutscenario:

```text id="34k9dy"
DRAFT
  ↓
READY
  ↓
ERROR
  ↓ correctie gebruiker
READY
  ↓
GENERATED
```

De mobiele Sheet-interface moet erop gericht zijn dat de gebruiker eenvoudig de relevante user-transities kan uitvoeren.

---

## 8. Mobiele invoerworkflow

De gebruiker moet vanuit Google Sheets op Android:

1. een nieuwe schedule-regel kunnen aanmaken;
2. deze als `DRAFT` kunnen invoeren;
3. medicatiegegevens kunnen invullen;
4. de invoer kunnen controleren;
5. `Status` op `READY` kunnen zetten.

Daarna is geen verdere handmatige actie nodig voor schedule-generation.

Een time-driven trigger verwerkt het schedule.

---

## 9. UUID's

Schedules en intakes gebruiken UUID's.

Gebruik:

```javascript id="5k3tcm"
Utilities.getUuid()
```

Als een `READY` schedule nog geen ID heeft, kent het systeem tijdens verwerking automatisch een UUID toe.

Iedere intake krijgt een eigen UUID.

De gebruiker hoeft UUID's nooit zelf in te voeren.

---

## 10. DurationDays

`DurationDays` is inclusief `StartDate`.

Voor:

```text id="h7v3ic"
StartDate = 2026-09-29
DurationDays = 1
```

geldt alleen:

```text id="64hyjq"
2026-09-29
```

Voor:

```text id="p35i3g"
StartDate = 2026-09-29
DurationDays = 2
```

geldt:

```text id="2g5nlu"
2026-09-29
2026-09-30
```

Conceptueel:

```javascript id="vrq92w"
for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
  const date = addDays(startDate, dayOffset);
}
```

---

## 11. Times

`Times` bevat één of meerdere dagelijkse tijdstippen.

Voorbeeld:

```text id="92tmmn"
08:00,14:00,20:00
```

Bij parsing:

- whitespace trimmen;
- ieder tijdstip valideren;
- normaliseren naar `HH:mm`;
- dubbele waarden verwijderen.

Bijvoorbeeld:

```text id="m1u6ka"
08:00, 14:00, 14:00, 20:00
```

wordt:

```text id="8h0m9j"
08:00
14:00
20:00
```

Als één opgegeven tijdstip ongeldig is, mag het schedule niet gedeeltelijk worden verwerkt.

Voor:

```text id="j80m2m"
08:00,foo,20:00
```

gaat het volledige schedule naar `ERROR`.

---

## 12. Schedule-validatie

Een `READY` schedule vereist minimaal:

```text id="c7fwav"
Medication
Dosage
StartDate
DurationDays
Times
```

`Administration` is optioneel.

Valideer minimaal:

```text id="2rxufx"
DurationDays > 0
```

en dat minimaal één geldig tijdstip aanwezig is.

Bij een validatiefout:

```text id="ajqkza"
Status = ERROR
LastError = <bruikbare foutmelding>
UpdatedAt = now
```

Bijvoorbeeld:

```text id="prv5pd"
Invalid time value: foo
```

---

## 13. Intake-generation

Voor iedere combinatie van:

```text id="yuyycb"
dag × tijdstip
```

moet één `MedicationIntake` worden gegenereerd.

Voor:

```text id="c0mqzu"
DurationDays = 2
Times = 08:00,14:00,20:00
```

zijn dat:

```text id="e6k12g"
2 × 3 = 6 intakes
```

Gebruik het verwachte aantal tevens als integriteitscontrole voordat het schedule op `GENERATED` wordt gezet.

---

## 14. medication-intakes

Gebruik de volgende kolommen:

| Kolom | Owner | Editable | Omschrijving |
|---|---|---|---|
| ID | SYSTEM | Nee | UUID van intake |
| ScheduleID | SYSTEM | Nee | UUID van oorspronkelijke schedule |
| Medication | SYSTEM | Nee | Snapshot medicatienaam |
| Dosage | SYSTEM | Nee | Snapshot dosering |
| Administration | SYSTEM | Nee | Snapshot toediening |
| ScheduledAt | SYSTEM | Nee | Gepland datum/tijdstip |
| Status | SYSTEM | Nee | Intake-status |
| NotifiedAt | SYSTEM | Nee | Eerste succesvolle notificatie |
| CompletedAt | SYSTEM | Nee | Werkelijk registratiemoment |
| LastError | SYSTEM | Nee | Eventuele fout |
| CreatedAt | SYSTEM | Nee | Aanmaakmoment |
| UpdatedAt | SYSTEM | Nee | Laatste wijziging |

De gebruiker hoeft deze tab tijdens normaal gebruik niet handmatig te wijzigen.

---

## 15. Snapshot-data

Kopieer bij generation:

```text id="y3c9h0"
Medication
Dosage
Administration
```

van het schedule naar iedere intake.

Een bestaande intake blijft daardoor een registratie van hetgeen op het moment van generation gepland was.

Latere wijzigingen aan een schedule veranderen bestaande intakes niet automatisch.

---

## 16. Intake-statussen

Ondersteun:

```text id="yad9kn"
PENDING
NOTIFIED
COMPLETED
SKIPPED
MISSED
```

### PENDING

Het innamemoment staat gepland en er is nog geen succesvolle notificatie verstuurd.

### NOTIFIED

De notificatie is succesvol verstuurd.

`NotifiedAt` is gevuld.

### COMPLETED

De gebruiker heeft geregistreerd dat de medicatie is ingenomen/toegediend.

`CompletedAt` is gevuld.

### SKIPPED

De gebruiker heeft bewust geregistreerd dat het innamemoment is overgeslagen.

Ondersteuning vanuit de mobiele interactie mag eventueel in een vervolgstap worden toegevoegd.

### MISSED

Het innamemoment is verlopen zonder succesvolle registratie.

Automatische `MISSED`-bepaling hoeft in v1 nog niet geïmplementeerd te worden zolang geen concrete termijn daarvoor is vastgesteld.

---

## 17. Idempotente generation

Het opnieuw verwerken van een schedule mag geen dubbele intakes veroorzaken.

Gebruik functioneel de combinatie:

```text id="3ch09j"
ScheduleID + ScheduledAt
```

als uniqueness-regel.

Voor ieder benodigd innamemoment:

```text id="b4u9fa"
bestaat intake?
    ja  → behouden
    nee → aanmaken
```

Hierdoor moet ook gedeeltelijk mislukte generation veilig opnieuw uitgevoerd kunnen worden.

Voorbeeld:

Er horen zes intakes te bestaan.

Drie zijn tijdens een eerdere execution al succesvol aangemaakt.

Bij retry worden uitsluitend de drie ontbrekende intakes aangemaakt.

Daarna bestaan zes intakes en kan het schedule naar `GENERATED`.

---

## 18. Schedule processor

Implementeer een trigger-entrypoint, bijvoorbeeld:

```javascript id="pqz5k9"
processReadySchedules()
```

Deze:

1. zoekt `READY` schedules;
2. verwerkt ieder schedule afzonderlijk;
3. valideert het schedule;
4. kent indien nodig een UUID toe;
5. parseert `Times`;
6. bepaalt alle benodigde `ScheduledAt`-waarden;
7. controleert bestaande intakes;
8. maakt ontbrekende intakes aan;
9. controleert het uiteindelijke aantal;
10. zet het schedule op `GENERATED`;
11. wist een oude `LastError`;
12. werkt `UpdatedAt` bij.

Een fout in één schedule mag verwerking van andere schedules niet stoppen.

Bij een fout:

```text id="4l2qls"
Status = ERROR
LastError = <melding>
UpdatedAt = now
```

---

## 19. Schedule-trigger

Gebruik een installable time-driven Apps Script-trigger voor:

```javascript id="d0n56q"
processReadySchedules()
```

Een interval van ongeveer 1–5 minuten is voldoende.

De exacte frequentie moet niet bepalend zijn voor correcte businesslogica.

---

## 20. Notificatieprocessor

Implementeer notificatieverwerking afzonderlijk van schedule-generation.

Bijvoorbeeld:

```javascript id="zzhq5c"
processPendingIntakeNotifications()
```

Selecteer intakes waarvoor:

```text id="oxjgg7"
Status = PENDING
ScheduledAt <= now
```

Verstuur vervolgens een mobiele notificatie.

Pas na succesvolle verzending:

```text id="r5zj6d"
Status = NOTIFIED
NotifiedAt = now
UpdatedAt = now
LastError = leeg
```

Bij een technische fout blijft de intake retrybaar en wordt `LastError` gevuld.

---

## 21. Pushover

Gebruik Pushover als notificatieprovider voor v1.

Gebruik `UrlFetchApp` voor de API-integratie.

Configuratie:

```text id="ucq4i7"
PUSHOVER_USER_KEY
PUSHOVER_API_TOKEN
```

wordt via Script Properties aangeleverd.

Er is één Pushover-ontvanger per deployment.

---

## 22. Notificatie-inhoud

Een notificatie bevat minimaal:

- medicatienaam;
- dosering;
- eventueel toediening;
- gepland tijdstip;
- mogelijkheid om het innamemoment te registreren.

Voorbeeld:

```text id="4foywp"
Medicatie

Dexa
1 druppel
rechteroog

Gepland: 14:00
```

Of:

```text id="83ejc3"
Medicatie

Paracetamol
2 × 500 mg
oraal

Gepland: 14:00
```

---

## 23. Completion via Web App

De gebruiker moet vanuit de Pushover-notificatie een intake als uitgevoerd kunnen registreren.

Gebruik hiervoor een Apps Script Web App.

De notificatie bevat een completion-URL, conceptueel:

```text id="0jwhhh"
https://<web-app>/exec?action=complete&id=<INTAKE_UUID>
```

Centraliseer het genereren van deze URL, bijvoorbeeld:

```javascript id="a71e8z"
createCompletionUrl(intake)
```

Configureer de Web App URL via Script Properties/configuratie.

---

## 24. Web App endpoint

Implementeer:

```javascript id="ffuujb"
doGet(e)
```

Ondersteun minimaal:

```text id="rzftzc"
action=complete
id=<INTAKE_UUID>
```

Zoek de intake op UUID.

Bij succesvolle registratie:

```text id="2dqq47"
Status = COMPLETED
CompletedAt = now
UpdatedAt = now
```

Toon vervolgens een eenvoudige mobielvriendelijke bevestiging, bijvoorbeeld:

```text id="chxbyw"
✓ Geregistreerd

Dexa
1 druppel
rechteroog

Gepland: 14:00
```

Er is voor v1 geen uitgebreide Web App-interface nodig.

---

## 25. Idempotente completion

Het meerdere keren openen van dezelfde completion-link mag geen dubbele registratie veroorzaken.

Als de intake al `COMPLETED` is:

- wijzig `CompletedAt` niet;
- retourneer geen fout;
- toon dat de intake al geregistreerd was.

Bijvoorbeeld:

```text id="40p6rt"
✓ Was al geregistreerd

Geregistreerd om 14:04
```

---

## 26. Completion-link security

Gebruik de intake-UUID in plaats van een Sheet-rijnummer.

Ontwerp URL-generation zodanig dat later eventueel een token/signature kan worden toegevoegd zonder de rest van de applicatie te herschrijven.

Een aanvullende signature/token is geen vereiste voor de eerste implementatie.

---

## 27. Concurrency

Houd rekening met overlappende trigger-executions.

Gebruik waar nodig Apps Script `LockService` rond kritieke generation/verwerking.

Locking vervangt de idempotente uniqueness-controle niet.

---

## 28. Datum, tijd en timezone

Gebruik:

```text id="oj5uep"
Europe/Amsterdam
```

als project-timezone.

`ScheduledAt` representeert een lokaal medicatiemoment.

Een gepland moment:

```text id="8a3igj"
2026-09-29 08:00
```

moet dus daadwerkelijk 08:00 Nederlandse lokale tijd betekenen.

Voorkom ongewenste impliciete UTC-conversies.

---

## 29. Bescherming van technische kolommen

De gebruiker mag technische/system-managed gegevens niet tijdens normaal gebruik hoeven wijzigen.

Configureer waar praktisch Google Sheets Protected Ranges.

Bescherm in `medication-schedules` minimaal:

```text id="2dv25g"
ID
LastError
CreatedAt
UpdatedAt
```

`Status` vereist aparte behandeling omdat zowel gebruiker als systeem deze kolom gebruikt.

Bescherm `medication-intakes` waar praktisch volledig tegen accidentele handmatige wijzigingen.

Deze protections zijn bescherming tegen gebruikersfouten en geen security boundary.

---

## 30. Spreadsheet-setup

Implementeer bij voorkeur een expliciete setupfunctie, bijvoorbeeld:

```javascript id="tlwgvf"
setupSpreadsheet()
```

Deze mag onder andere:

- ontbrekende tabs aanmaken;
- correcte headers aanmaken;
- relevante data-validatie instellen;
- protections instellen;
- kolomformattering voor datum/tijd instellen.

De setupfunctie moet veilig opnieuw uitvoerbaar zijn waar dat redelijkerwijs mogelijk is en bestaande operationele data niet zonder expliciete reden overschrijven.

---

## 31. Configuratie

Voorzie centrale configuratie voor minimaal:

```text id="3wj7qp"
SCHEDULE_SHEET_NAME
INTAKE_SHEET_NAME
TIMEZONE
WEB_APP_URL
PUSHOVER_USER_KEY
PUSHOVER_API_TOKEN
```

Niet-geheime applicatieconfiguratie mag in code staan.

Secrets en deployment-specifieke gevoelige configuratie worden via Script Properties aangeleverd.

---

## 32. Eerste scope

v1 omvat:

- schedule-invoer via Google Sheets;
- Android-vriendelijke statusgestuurde workflow;
- `DRAFT`;
- `READY`;
- `GENERATED`;
- `ERROR`;
- UUID's;
- `DurationDays`;
- meerdere dagelijkse tijdstippen;
- validatie;
- automatische intake-generation;
- snapshot-data;
- idempotente generation;
- `PENDING`;
- Pushover-notificaties;
- `NOTIFIED`;
- completion via Apps Script Web App;
- `COMPLETED`;
- `CompletedAt`;
- foutregistratie;
- time-driven triggers;
- concurrencybescherming;
- bescherming van technische kolommen.

---

## 33. Buiten scope v1

Niet nodig:

- meerdere gebruikers;
- gebruikersaccounts;
- `UserID`;
- verschillende notificatieontvangers;
- uitgebreide mobiele Web App;
- eigen mobiele applicatie;
- voorraadbeheer;
- koppeling met huisarts of apotheek;
- automatische interpretatie van voorschriften;
- Google Calendar-integratie;
- dashboards/statistieken;
- automatische wijziging van medicatieschema's;
- automatische `MISSED`-bepaling zonder nader bepaalde termijn.

---

## 34. Medische verantwoordelijkheid

De applicatie voert uitsluitend het door de gebruiker ingevoerde schema uit.

De applicatie bepaalt niet zelfstandig:

- welke medicatie gebruikt moet worden;
- welke dosering nodig is;
- hoe vaak medicatie moet worden gebruikt;
- hoe lang medicatie gebruikt moet worden;
- wanneer een schema medisch gewijzigd moet worden.

Het systeem is uitsluitend een registratie- en herinneringssysteem.

---

## 35. Voorbeeld happy flow

De gebruiker voert in:

```text id="7s2l1d"
Medication:       Dexa
Dosage:           1 druppel
Administration:   rechteroog
StartDate:        2026-09-29
DurationDays:     2
Times:            08:00,14:00,20:00
Status:           DRAFT
```

Na controle:

```text id="26xpkv"
DRAFT → READY
```

De schedule processor genereert:

```text id="dzktv6"
29-09-2026 08:00 PENDING
29-09-2026 14:00 PENDING
29-09-2026 20:00 PENDING
30-09-2026 08:00 PENDING
30-09-2026 14:00 PENDING
30-09-2026 20:00 PENDING
```

Daarna:

```text id="hrkyz3"
Schedule.Status = GENERATED
```

Op een gepland tijdstip:

```text id="kjk1gc"
PENDING
   ↓ Pushover succesvol
NOTIFIED
```

De gebruiker registreert via de notificatielink:

```text id="k1rt6d"
NOTIFIED
   ↓
COMPLETED
```

en:

```text id="vzh7ge"
CompletedAt = werkelijk registratiemoment
```

---

## 36. Voorbeeld foutflow

Input:

```text id="a3z4fi"
Medication:       Dexa
Dosage:           1 druppel
StartDate:        2026-09-29
DurationDays:     2
Times:            08:00,foo,20:00
Status:           READY
```

Resultaat:

```text id="nt9pq9"
Status = ERROR
LastError = Invalid time value: foo
```

Er worden geen gedeeltelijke intakes gegenereerd vanwege deze validatiefout.

De gebruiker corrigeert:

```text id="qcz7u2"
Times = 08:00,14:00,20:00
```

en zet:

```text id="3z8s2d"
ERROR → READY
```

De volgende verwerking probeert het schedule opnieuw te genereren.

Bij succes:

```text id="7efypx"
Status = GENERATED
LastError = leeg
```

---

## 37. Acceptatiecriteria

### AC1 – Mobiele invoer

Een schedule kan volledig vanuit Google Sheets op Android worden ingevoerd en aangeboden voor verwerking zonder custom menu of button.

### AC2 – UUID

Schedules en intakes krijgen unieke UUID's zonder handmatige invoer.

### AC3 – DurationDays

`DurationDays = 1` genereert uitsluitend innamemomenten op `StartDate`.

### AC4 – Generation

```text id="a5kicr"
DurationDays = 2
Times = 08:00,14:00,20:00
```

genereert exact zes intakes.

### AC5 – Dubbele tijden

```text id="azkjcq"
08:00,14:00,14:00,20:00
```

genereert drie innamemomenten per dag.

### AC6 – Ongeldige tijd

Een ongeldig tijdstip veroorzaakt `ERROR` en geen gedeeltelijke generation voor die validatiefout.

### AC7 – Idempotentie

Het opnieuw verwerken van hetzelfde schedule veroorzaakt geen dubbele intakes.

### AC8 – Partial recovery

Als drie van zes benodigde intakes al bestaan, worden uitsluitend de drie ontbrekende records aangemaakt.

### AC9 – Snapshot

Een gegenereerde intake bevat zijn eigen snapshot van Medication, Dosage en Administration.

### AC10 – Notificatie

Een verschuldigde `PENDING` intake kan succesvol via Pushover worden verstuurd en wordt daarna `NOTIFIED`.

### AC11 – Notification failure

Een mislukte notificatie wordt niet als succesvol gemarkeerd en blijft herstelbaar/retrybaar.

### AC12 – Completion

Een geldige completion-link zet de betreffende intake op `COMPLETED` en vult `CompletedAt`.

### AC13 – Dubbele completion

Een tweede request voor een reeds voltooide intake wijzigt de oorspronkelijke `CompletedAt` niet.

### AC14 – Technische kolommen

Technische kolommen hoeven niet door de gebruiker te worden ingevuld en zijn waar praktisch beschermd tegen accidentele wijziging.

### AC15 – Single-user

De implementatie bevat geen `UserID` of andere onnodige multi-userconstructies.

### AC16 – End-to-end mobiel

De normale gebruiksflow kan worden uitgevoerd via:

```text id="shtrgm"
Google Sheets Android
        ↓
Apps Script
        ↓
Pushover
        ↓
Apps Script Web App
```

zonder desktopafhankelijke interactie.