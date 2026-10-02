# Implementation brief — Schedule expiry reminder en vervolgplan

## Doel

Breid Medication Tracker uit met een expiry-flow voor medicatieplannen.

Wanneer een medicatieplan zijn einde nadert, moet Medication Tracker de gebruiker eraan herinneren om expliciet een keuze te maken:

1. **Nieuw plan klaarzetten**
2. **Geen nieuw plan nodig**

Zolang geen keuze is gemaakt, blijft Medication Tracker maximaal één keer per lokale kalenderdag herinneren.

De reminders starten een configureerbaar aantal kalenderdagen vóór het einde van het plan en stoppen uiterlijk **7 kalenderdagen na de laatste geplande dag**.

Het automatisch stoppen van reminders geldt nadrukkelijk niet als gebruikersbeslissing. Wanneer geen keuze is gemaakt, blijft de expiry decision administratief `OPEN`.

De applicatie doet geen medische interpretatie en bepaalt nooit zelfstandig dat medicatie moet worden voortgezet.

Een bestaand plan wordt vanuit deze feature nooit verlengd of aangepast.

---

# Kernregels

> Een aflopend medicatieplan kan via deze feature nooit worden verlengd. Wanneer vervolg gewenst is, ontstaat altijd een nieuw medicatieplan met een nieuwe UUID en status `DRAFT`.

> Zolang geen expliciete keuze is gemaakt, wordt maximaal één expiry reminder per lokale kalenderdag geprobeerd.

> Reminders stoppen uiterlijk 7 kalenderdagen na de laatste geplande dag.

> Het stoppen van reminders betekent niet dat de applicatie heeft besloten dat geen vervolgplan nodig is.

> Een expiry decision wordt alleen door een expliciete gebruikersactie `RESOLVED`.

---

# Functionele flow

```text
Plan A
  ↓
expiry threshold bereikt
  ↓
DecisionStatus = OPEN
ReminderStatus = ACTIVE
  ↓
dagelijkse reminder
  ↓
┌─────────────────────────────┐
│ Nieuw plan klaarzetten      │
│ Geen nieuw plan nodig       │
└─────────────────────────────┘
        │
        ├── Nieuw plan
        │      ↓
        │   Plan B / DRAFT
        │      ↓
        │   RESOLVED
        │
        └── Geen nieuw plan
               ↓
            RESOLVED
```

Wanneer geen keuze wordt gemaakt:

```text
OPEN + ACTIVE
      ↓
dagelijkse reminder
      ↓
laatste plandag
      ↓
dag +1 t/m dag +7
      ↓
geen keuze
      ↓
OPEN + EXPIRED
```

---

# Scope

De uitbreiding omvat:

1. configureerbare voorwaarschuwing vóór het einde van een plan;
2. automatische bepaling van de laatste geplande dag;
3. expiry-state per toegepaste schedule-versie;
4. maximaal één reminderpoging per lokale kalenderdag;
5. dagelijkse reminders zolang geen keuze is gemaakt;
6. automatische stop van reminders 7 kalenderdagen na afloop;
7. expliciete keuze:
   - nieuw plan klaarzetten;
   - geen nieuw plan nodig;
8. Web App-pagina voor die keuze;
9. voorbereiding van een nieuw `DRAFT`-plan;
10. koppeling tussen bronplan en vervolgplan;
11. bescherming tegen dubbele vervolgplannen;
12. correct gedrag rond oude schedule-versies;
13. veilige verwerking van notificatiefouten en onzekere side effects;
14. behoud van bestaand plan, intakes en historie.

Niet in scope:

- bestaand plan verlengen;
- automatisch voortzetten van medicatie;
- voorraadbeheer;
- receptintegratie;
- automatische bestellingen;
- apotheekintegratie;
- medisch advies;
- automatisch activeren van vervolgplannen;
- automatisch genereren van vervolg-intakes.

---

# Terminologie

Gebruik functioneel:

```text
schedule expiry
```

of:

```text
schedule ending
```

Gebruik niet zonder aanvullende gegevens:

```text
prescription expiry
```

Medication Tracker beheert medicatieplannen, geen recepten.

Een expiry reminder betekent:

> Het einde van deze medicatieserie nadert of is bereikt en er is nog geen expliciete keuze gemaakt over een vervolgplan.

---

# Schedule-configuratie

Breid `medication-schedules` uit met:

```text
ExpiryReminderDaysBefore
```

Dit veld is user-managed.

Betekenis:

```text
Aantal kalenderdagen vóór de laatste geplande dag
waarop expiry reminders mogen beginnen.
```

Voorbeelden:

```text
7 -> zeven dagen vooraf
3 -> drie dagen vooraf
0 -> reminders uitgeschakeld
leeg -> reminders uitgeschakeld
```

Validatie:

- leeg toegestaan;
- `0` toegestaan;
- anders positief geheel getal;
- negatieve waarden ongeldig;
- technische bovengrens bijvoorbeeld `365`.

`ExpiryReminderDaysBefore` maakt onderdeel uit van het genormaliseerde medicatieplan.

---

# Schedule history

Breid `medication-schedule-history` uit met:

```text
ExpiryReminderDaysBefore
```

Deze configuratie hoort bij de toegepaste planversie en wordt daarom opgenomen in de immutable history-snapshot.

Bestaande history-records mogen voor dit veld leeg blijven.

---

# Bepalen van het einde van een plan

Gebruik dezelfde domeinlogica waarmee concrete innamemomenten worden bepaald.

Conceptueel:

```text
moments = MedicationPlan.moments(plan)

lastScheduledAt = max(moments)

lastScheduledDate =
    lokale kalenderdatum(lastScheduledAt)
```

Introduceer geen tweede implementatie die onafhankelijk opnieuw rekent op basis van:

- `StartDate`;
- `DurationDays`;
- `Times`;
- timezone;
- DST.

---

# Expiry threshold

De eerste reminder wordt verschuldigd vanaf:

```text
expiryThresholdDate =
    lastScheduledDate
    - ExpiryReminderDaysBefore kalenderdagen
```

Gebruik kalenderdaglogica.

Gebruik niet:

```text
days * 24 * 60 * 60 * 1000
```

Het bestaande timezone- en DST-beleid blijft leidend.

---

# Reminder stopdatum

De laatste kalenderdag waarop een reminder mag worden geprobeerd is:

```text
reminderEndDate =
    lastScheduledDate + 7 kalenderdagen
```

Voorbeeld:

```text
laatste plandag: 14/10

reminder toegestaan:
...
14/10
15/10
16/10
17/10
18/10
19/10
20/10
21/10

vanaf 22/10:
geen automatische reminders meer
```

---

# Expiry-state

Expiry-state hoort bij:

```text
ScheduleID + ScheduleVersion
```

Gebruik geen Sheet-rijnummer als identiteit.

Modelleer minimaal:

```text
DecisionStatus
ReminderStatus
LastReminderAttemptAt
ResolvedAt
Resolution
ContinuationScheduleID
```

Eventueel aanvullende technische velden wanneer nodig voor veilige notificatieverwerking.

Mogelijke waarden:

```text
DecisionStatus:
OPEN
RESOLVED
```

```text
ReminderStatus:
ACTIVE
EXPIRED
```

```text
Resolution:
CONTINUATION_CREATED
NO_CONTINUATION
```

`ContinuationScheduleID` is alleen gevuld wanneer:

```text
Resolution = CONTINUATION_CREATED
```

---

# Betekenis van states

## OPEN + ACTIVE

Er is nog geen keuze gemaakt.

Dagelijkse reminders zijn toegestaan.

---

## RESOLVED

De gebruiker heeft expliciet gekozen.

Geen verdere expiry reminders.

---

## OPEN + EXPIRED

Er is geen keuze gemaakt, maar de reminderperiode is verstreken.

Geen verdere automatische reminders.

Dit betekent nadrukkelijk niet:

```text
NO_CONTINUATION
```

De applicatie verzint geen gebruikersbeslissing.

---

# Aanmaken van expiry-state

Expiry-state mag lazy worden aangemaakt.

Er hoeft dus niet direct bij iedere succesvolle schedule-generatie een expiry-record te ontstaan.

De state kan worden aangemaakt zodra de actuele schedule-versie voor het eerst binnen het expiry-window valt.

Wanneer reminders zijn uitgeschakeld:

```text
ExpiryReminderDaysBefore = leeg of 0
```

hoeft geen actieve expiry lifecycle te ontstaan.

---

# Selectie voor expiry processing

Een schedule-versie komt in aanmerking wanneer:

```text
Schedule Status == GENERATED
ExpiryReminderDaysBefore > 0
ApplicationState leeg
DecisionStatus == OPEN
ReminderStatus == ACTIVE
```

en:

```text
today >= expiryThresholdDate
today <= reminderEndDate
```

Alle vergelijkingen gebruiken lokale kalenderdagen.

---

# Dagelijkse reminder

Zolang:

```text
DecisionStatus == OPEN
ReminderStatus == ACTIVE
```

wordt maximaal één reminderpoging per lokale kalenderdag toegestaan.

De reminder wordt bij voorkeur aan het begin van de dag verwerkt.

Functioneel geldt:

> maximaal één expiry-notification attempt per lokale kalenderdag.

Een periodieke trigger mag hiervoor vaker draaien.

De implementatie hoeft niet afhankelijk te zijn van één exacte dagelijkse trigger om bijvoorbeeld 08:00.

---

# Daggrens

Baseer remindereligibility op kalenderdatum en niet op verstreken uren.

Voorbeeld:

```text
02/10 08:05 -> poging
02/10 10:00 -> geen nieuwe poging
02/10 18:00 -> geen nieuwe poging
03/10 08:15 -> nieuwe poging toegestaan
```

Gebruik dus niet:

```text
24 uur sinds vorige reminder
```

Dit voorkomt afwijkingen door:

- Apps Script-triggervertraging;
- zomer-/wintertijd;
- afwijkende verzendtijd op de vorige dag.

---

# Notificatiefout of onzekere verzenduitkomst

Een expiry notification is een externe side effect.

Wanneer op een kalenderdag één verzendpoging is gedaan, wordt die dag geen tweede automatische poging gedaan.

Dit geldt ook wanneer:

- Pushover een fout retourneert;
- de uitvoering wordt onderbroken;
- niet betrouwbaar kan worden vastgesteld of de push al is afgeleverd.

Conceptueel:

```text
08:00 attempt

succes / fout / onzeker

→ vandaag geen tweede attempt
```

De volgende kalenderdag mag opnieuw worden geprobeerd zolang:

```text
DecisionStatus == OPEN
ReminderStatus == ACTIVE
```

De expiry decision zelf blijft bij een notificatiefout altijd `OPEN`.

---

# Scheiding reminder en beslissing

Een succesvolle notification verandert nooit:

```text
OPEN -> RESOLVED
```

Ook het openen van de Web App-link verandert niets.

Alleen een expliciete gebruikerskeuze mag de expiry decision resolveren.

---

# Reminderperiode beëindigen

Wanneer:

```text
today > reminderEndDate
```

en:

```text
DecisionStatus == OPEN
```

wordt:

```text
ReminderStatus = EXPIRED
```

De decision blijft:

```text
DecisionStatus = OPEN
```

Er volgen daarna geen automatische reminders meer.

---

# Notification inhoud

Gebruik een afzonderlijk expiry notification-type.

Bijvoorbeeld:

```javascript
MedicationNotification.expiry(...)
```

Conceptueel vóór afloop:

```text
Medicatieschema loopt bijna af

Het schema voor <Medication> loopt binnenkort af.
Geef aan of een nieuw plan moet worden klaargezet.
```

Na afloop:

```text
Medicatieschema is afgelopen

Het schema voor <Medication> is afgelopen.
Er is nog geen keuze gemaakt over een eventueel vervolgplan.
```

Vermijd medisch sturende teksten zoals:

```text
Bestel nu medicatie.
```

```text
U moet deze medicatie blijven gebruiken.
```

```text
Maak direct een nieuw plan.
```

---

# Web App-link

Een expiry notification bevat een link naar de Web App.

Bijvoorbeeld:

```text
?action=schedule-expiry
&id=<ScheduleUUID>
&version=<Version>
```

De exacte routing mag aansluiten op de bestaande Web App-implementatie.

GET:

- leest gegevens;
- toont informatie;
- schrijft niets;
- maakt geen plan;
- verandert geen expiry-state;
- verandert geen intake.

Alle muterende acties gebruiken POST.

---

# Oude reminder-link

Een reminder-link hoort bij één specifieke:

```text
ScheduleID + ScheduleVersion
```

Wanneer de gebruiker een link opent van een versie die inmiddels niet meer de actuele toegepaste versie is:

- toon dat de reminder bij een eerdere planversie hoort;
- toon eventueel relevante read-only gegevens;
- sta vanuit die oude versie geen expiry-keuze meer toe;
- maak geen continuation aan;
- wijzig geen state.

De gebruiker moet een keuze maken vanuit de actuele schedule-versie.

---

# Expiry-pagina

Toon minimaal:

```text
Medicatie
Dosering
Toediening
Laatste geplande datum
```

en een duidelijke melding dat een keuze nodig is.

Beschikbare acties:

```text
Nieuw plan klaarzetten
Geen nieuw plan nodig
```

Alleen openen of sluiten verandert niets.

---

# Actie — Nieuw plan klaarzetten

Deze actie maakt altijd een nieuw medication schedule.

Het bestaande plan wordt alleen gelezen.

Het bestaande plan wordt niet:

- gewijzigd;
- verlengd;
- opnieuw gegenereerd;
- gereactiveerd;
- via reconciliation aangepast.

---

# Nieuw vervolgplan

Maak een nieuwe regel in:

```text
medication-schedules
```

met:

```text
nieuwe UUID
Status = DRAFT
```

Kopieer als voorstel:

```text
Medication
Dosage
Administration
DurationDays
Times
ExpiryReminderDaysBefore
```

Neem niet over:

```text
ID
Status
LastError
CreatedAt
UpdatedAt
ApplicationState
expiry state
notification state
```

---

# StartDate vervolgplan

De voorgestelde `StartDate` hangt af van het moment waarop de gebruiker kiest.

## Bronplan is nog niet verlopen

Wanneer de keuze plaatsvindt op of vóór:

```text
lastScheduledDate
```

dan wordt als voorstel gebruikt:

```text
lastScheduledDate + 1 kalenderdag
```

Voorbeeld:

```text
Plan A eindigt 14/10

keuze op 10/10

Plan B / DRAFT
StartDate = 15/10
```

---

## Bronplan is al verlopen

Wanneer:

```text
today > lastScheduledDate
```

wordt geen StartDate voorgesteld.

Het nieuwe `DRAFT` krijgt:

```text
StartDate = leeg
```

De gebruiker moet de datum expliciet invullen voordat het plan succesvol naar `READY` kan worden verwerkt.

Voorbeeld:

```text
Plan A eindigt 14/10

keuze op 18/10

Plan B / DRAFT
StartDate = leeg
```

De applicatie probeert niet te raden of:

- de medicatie pas later beschikbaar kwam;
- de gebruiker vergeten was te reageren;
- er een bewuste behandelonderbreking was.

Er wordt geen plan met terugwerkende kracht voorgesteld.

---

# Handmatig al een vervolgplan aangemaakt

Medication Tracker probeert niet automatisch vast te stellen of een handmatig bestaand plan het vervolg is van het aflopende plan.

Er wordt bijvoorbeeld niet gematcht op:

```text
zelfde Medication
zelfde Dosage
datum ongeveer aansluitend
```

Dat zou giswerk zijn.

Wanneer de gebruiker zelf al een nieuw plan heeft aangemaakt, kan de expiry-flow expliciet worden afgehandeld met:

```text
Geen nieuw plan nodig
```

---

# Geen automatische voortzetting

Een nieuw vervolgplan blijft altijd:

```text
DRAFT
```

totdat de gebruiker expliciet:

```text
READY
```

kiest.

Pas daarna gebruikt Medication Tracker de bestaande generatieflow.

`Nieuw plan klaarzetten` maakt dus nooit rechtstreeks intakes aan.

---

# Bronrelatie

Leg duurzaam vast:

```text
SourceScheduleID
SourceScheduleVersion
```

op het nieuwe vervolgplan.

Deze velden geven aan:

- uit welk schedule het plan is voortgekomen;
- op welke toegepaste versie de continuation gebaseerd was.

Deze gegevens hebben een provenance/auditfunctie.

---

# Idempotentie continuation

Herhaald uitvoeren van:

```text
Nieuw plan klaarzetten
```

voor dezelfde:

```text
SourceScheduleID + SourceScheduleVersion
```

mag maximaal één vervolgplan opleveren.

Conceptueel:

```text
eerste POST
  ↓
Plan B aangemaakt

tweede POST
  ↓
Plan B teruggevonden
  ↓
geen Plan C
```

Gebruik duurzame persistence.

Geen in-memory idempotentie.

---

# Veilige write-volgorde continuation

De write-volgorde is verplicht:

1. controleer expiry decision;
2. controleer of al continuation bestaat;
3. reserveer/genereer nieuwe schedule UUID;
4. schrijf het nieuwe `DRAFT`-plan duurzaam weg;
5. controleer dat het vervolgplan bestaat;
6. pas daarna:
   ```text
   DecisionStatus = RESOLVED
   Resolution = CONTINUATION_CREATED
   ContinuationScheduleID = <UUID>
   ResolvedAt = now
   ```

Een gedeeltelijke write mag nooit leiden tot:

```text
RESOLVED
```

zonder bestaand vervolgplan.

---

# Actie — Geen nieuw plan nodig

Deze actie:

- maakt geen nieuw plan;
- wijzigt het bronplan niet;
- wijzigt geen intakes;
- registreert:

```text
DecisionStatus = RESOLVED
Resolution = NO_CONTINUATION
ResolvedAt = now
```

Daarna stoppen reminders.

---

# Bevestiging bij Geen nieuw plan nodig

Voor:

```text
Geen nieuw plan nodig
```

moet een expliciete bevestiging worden gevraagd.

Bijvoorbeeld:

> Er wordt geen vervolgplan klaargezet en de dagelijkse herinneringen stoppen. Doorgaan?

Alleen na expliciete bevestiging wordt de decision resolved.

---

# Immutable resolution

Een resolved expiry decision is immutable.

Wanneer bijvoorbeeld:

```text
Resolution = NO_CONTINUATION
```

is geregistreerd, mag vanuit dezelfde expiry decision later niet alsnog:

```text
CONTINUATION_CREATED
```

worden gekozen.

Andersom geldt hetzelfde.

Bij een vergissing kan de gebruiker altijd handmatig een nieuw medicatieplan maken.

Er wordt geen aparte reopen-flow toegevoegd.

---

# Idempotentie Geen nieuw plan nodig

Herhaalde identieke POST:

```text
NO_CONTINUATION
```

is een no-op.

De oorspronkelijke:

```text
ResolvedAt
```

blijft behouden.

---

# Conflicterende tweede keuze

Wanneer de decision reeds is resolved en daarna een andere keuze wordt aangeboden, moet deze worden afgewezen of read-only als reeds afgehandeld worden getoond.

Voorbeeld:

```text
eerste keuze:
NO_CONTINUATION

latere poging:
CONTINUATION_CREATED
```

mag niet stilzwijgend worden uitgevoerd.

---

# Nieuwe schedule-versie na eerdere expiry decision

Iedere succesvol toegepaste schedule-versie krijgt een eigen expiry lifecycle.

Conceptueel:

```text
Schedule A
Version 1
ExpiryDecision = ...

correctie

Schedule A
Version 2
ExpiryDecision = eigen lifecycle
```

State van versie 1 wordt niet automatisch overgenomen door versie 2.

---

# Vervolg-DRAFT bestaat uit eerdere versie

Scenario:

```text
Plan A version 1
eindigt 14/10

→ Plan B DRAFT aangemaakt

daarna correctie

Plan A version 2
eindigt 16/10
```

Plan B wordt niet automatisch aangepast.

Version 2 krijgt een eigen expiry decision.

Wanneer expiry van version 2 wordt geopend:

- meld dat al een vervolg-DRAFT bestaat dat vanuit een eerdere planversie is aangemaakt;
- claim of wijzig dat vervolgplan niet automatisch;
- laat de gebruiker opnieuw expliciet kiezen:
  - nieuw plan klaarzetten;
  - geen nieuw plan nodig.

Medication Tracker neemt niet automatisch aan dat het eerdere vervolg-DRAFT nog correct aansluit.

---

# Correctie van bronplan na aanmaken vervolg-DRAFT

Een bestaand vervolg-DRAFT is vanaf creatie een zelfstandig plan.

Wanneer het bronplan later via reconciliation verandert:

- wordt StartDate van het vervolgplan niet aangepast;
- worden andere velden niet aangepast;
- wordt het vervolgplan niet verwijderd;
- blijft het `DRAFT` totdat de gebruiker zelf handelt.

Geen stille synchronisatie tussen bron- en vervolgplan.

---

# Reconciliation van bronplan

De bestaande:

```text
READY_FOR_RECONCILIATION
```

blijft bedoeld voor correcties van een bestaand plan.

De expiry-feature gebruikt reconciliation nooit om een plan te verlengen.

Een gebruiker kan bijvoorbeeld wel een fout in `DurationDays` herstellen via de normale correctieflow.

Dat is een andere use-case.

---

# Wijziging ExpiryReminderDaysBefore

Een wijziging van:

```text
ExpiryReminderDaysBefore
```

op een bestaand `GENERATED` plan verloopt via:

```text
READY_FOR_RECONCILIATION
```

Wanneer hierdoor de genormaliseerde planinhoud wijzigt:

- ontstaat een nieuwe history-versie;
- hoeven intakes niet per se te veranderen;
- ontstaat voor die nieuwe versie een eigen expiry lifecycle.

Een planwijziging hoeft dus niet altijd intakewijzigingen te veroorzaken.

---

# ExpiryReminderDaysBefore groter dan planduur

Dit is toegestaan.

Voorbeeld:

```text
plan duurt 5 dagen
ExpiryReminderDaysBefore = 30
```

De threshold ligt dan vóór de startdatum.

Zodra de planversie actief is en de huidige datum al binnen het geldige reminderwindow ligt, kan een expiry lifecycle ontstaan.

Dit is geen validatiefout.

---

# Plan met één intake

Een plan met één geldig innamemoment is toegestaan.

Voor expiry geldt:

```text
lastScheduledDate =
datum van dat ene moment
```

Geen speciaal gedrag nodig.

---

# Plan zonder geldige momenten

Een plan dat geen geldige momenten kan genereren hoort via de bestaande planvalidatie niet succesvol `GENERATED` te worden.

Expiry-processing probeert dit niet te repareren.

---

# Handmatige Sheet-manipulatie

Directe handmatige mutaties van system-managed gegevens vallen buiten het normale applicatiecontract.

Voorbeelden:

- verwijderen van expiry-state;
- aanpassen van expiry statusvelden;
- verwijderen van continuation-records;
- wijzigen van `SourceScheduleID`;
- wijzigen van history;
- verwijderen van een vervolg-DRAFT nadat de expiry decision reeds resolved is.

De applicatie hoeft zulke inconsistenties niet automatisch te herstellen, tenzij daar expliciet herstelgedrag voor is ontworpen.

User-managed planvelden blijven uiteraard wel via het bestaande Sheet-contract bewerkbaar.

---

# Architectuur

Behoud de bestaande indeling:

```text
src/
├── domain/
├── application/
├── infrastructure/
└── entrypoints/
```

De bestaande codebase gebruikt deze domeingerichte scheiding al.

---

# Domain

Domeinlogica bevat onder andere:

```text
lastScheduledDate bepalen
expiryThresholdDate bepalen
reminderEndDate bepalen
daily reminder eligibility bepalen
continuation StartDate voorstel bepalen
expiry state transitions valideren
```

Deze logica is onafhankelijk van:

```text
SpreadsheetApp
UrlFetchApp
PropertiesService
```

Hergebruik waar mogelijk:

```text
MedicationPlan.normalize
MedicationPlan.moments
```

De bestaande reconciliation gebruikt deze planninglogica al als gedeelde bron voor planmomenten.

---

# Application

Introduceer bijvoorbeeld:

```text
ScheduleExpiryService
```

Verantwoordelijkheden:

- actuele schedule-versie bepalen;
- expiry-state laden of initialiseren;
- threshold bepalen;
- dagelijkse eligibility bepalen;
- reminder-window bewaken;
- notifications samenstellen;
- attempt-state registreren;
- `ReminderStatus = EXPIRED` zetten wanneer nodig.

Voor continuation:

```text
ScheduleContinuationService
```

Verantwoordelijkheden:

- bronplan laden;
- actuele versie controleren;
- expiry decision controleren;
- bestaand vervolgplan detecteren;
- vervolg-DRAFT samenstellen;
- vervolgplan duurzaam opslaan;
- expiry decision resolveren.

---

# Infrastructure

Infrastructure verzorgt:

```text
Sheet reads/writes
Pushover
locks
Script Properties
technische persistence
```

`SheetStore` bevat geen expiry- of continuation-beslissingen.

De bestaande architectuur houdt Sheet-persistence en externe integraties bewust buiten het domeinmodel.

---

# Entrypoints

Introduceer bijvoorbeeld:

```text
processScheduleExpiryNotifications()
```

Het entrypoint bevat geen domeinlogica en roept uitsluitend application-services aan.

Web App-routing ondersteunt bijvoorbeeld:

```text
GET  action=schedule-expiry

POST action=create-continuation

POST action=no-continuation
```

GET blijft read-only.

---

# Persistence expiry-state

Expiry-state moet per:

```text
ScheduleID + ScheduleVersion
```

kunnen worden opgeslagen.

Een apart system-managed tabblad heeft de voorkeur boven versiegebonden velden op `medication-schedules`.

Bijvoorbeeld:

```text
medication-schedule-expiry
```

Conceptuele headers:

```text
ID
ScheduleID
ScheduleVersion
DecisionStatus
ReminderStatus
LastReminderAttemptAt
ResolvedAt
Resolution
ContinuationScheduleID
CreatedAt
UpdatedAt
```

Eventueel aanvullende technische velden wanneer nodig voor veilige verzendafhandeling.

UUID als recordidentiteit.

Geen Sheet-rijnummers als functionele identifiers.

---

# Concurrency

Gebruik dezelfde gedeelde scriptlock-strategie als bestaande schrijvende flows.

Bescherm minimaal:

- expiry-state creatie;
- daily attempt-registratie;
- resolution;
- continuation-aanmaak;
- duplicate continuation-detectie.

Overlappende executions mogen niet leiden tot:

- twee reminders op één dag;
- twee expiry-records voor dezelfde schedule-versie;
- twee vervolgplannen;
- conflicterende resolutions.

---

# Setup-migratie

Breid `medication-schedules` uit met minimaal:

```text
ExpiryReminderDaysBefore
SourceScheduleID
SourceScheduleVersion
```

Breid `medication-schedule-history` uit met:

```text
ExpiryReminderDaysBefore
```

Maak indien gekozen:

```text
medication-schedule-expiry
```

aan als system-managed tabblad.

`setupSpreadsheet()`:

- behoudt bestaande operationele data;
- dupliceert geen headers;
- maakt geen continuation-plannen;
- verstuurt geen notifications;
- creëert geen fictieve expiry decisions;
- is herhaalbaar.

---

# Bestaande plannen

Bestaande plannen hebben initieel:

```text
ExpiryReminderDaysBefore = leeg
```

Daarvoor ontstaan geen expiry reminders.

Geen automatische default invullen op bestaande plannen.

---

# Tests

## Domein

Test minimaal:

- correct bepalen van `lastScheduledDate`;
- threshold;
- reminderEndDate;
- DST-overgang;
- threshold vóór StartDate;
- `ExpiryReminderDaysBefore = 0`;
- lege waarde;
- negatieve waarde;
- bovengrens;
- plan met één intake;
- continuation StartDate vóór afloop;
- continuation zonder StartDate ná afloop.

---

## Daily expiry reminder

Test:

```text
02/10 eerste execution -> attempt
02/10 volgende execution -> geen attempt
03/10 -> opnieuw toegestaan
```

Test ook:

- triggervertraging;
- DST;
- foutieve Pushover-response;
- onzekere side effect;
- lockconflict.

---

## Reminder stop

Test:

```text
lastScheduledDate + 7
```

=> reminder toegestaan.

Test:

```text
lastScheduledDate + 8
```

=> geen reminder.

Controleer:

```text
ReminderStatus = EXPIRED
DecisionStatus = OPEN
```

---

## Oude versie-link

Test:

```text
version 1 reminderlink
version 2 inmiddels actief
```

Resultaat:

- read-only waarschuwing;
- geen continuation;
- geen resolution;
- geen wijziging aan versie 1 of versie 2.

---

## Continuation vóór afloop

Test:

```text
today <= lastScheduledDate
```

Resultaat:

```text
nieuw plan
Status = DRAFT
StartDate = lastScheduledDate + 1 dag
```

---

## Continuation ná afloop

Test:

```text
today > lastScheduledDate
```

Resultaat:

```text
nieuw plan
Status = DRAFT
StartDate = leeg
```

---

## Continuation idempotentie

Test:

```text
zelfde SourceScheduleID
zelfde SourceScheduleVersion
create-continuation twee keer
```

Resultaat:

```text
exact één vervolgplan
```

---

## Resolution

Test:

```text
Nieuw plan klaarzetten
```

=> `RESOLVED / CONTINUATION_CREATED`.

Test:

```text
Geen nieuw plan nodig
```

=> `RESOLVED / NO_CONTINUATION`.

---

## Conflicterende resolution

Test:

```text
eerst NO_CONTINUATION
daarna CONTINUATION_CREATED
```

Resultaat:

- tweede actie afgewezen;
- bestaande resolution onveranderd.

---

## Continuation write interruption

Test onderbreking tussen:

```text
DRAFT opslaan
```

en:

```text
expiry RESOLVED schrijven
```

Retry moet:

- bestaand vervolgplan vinden;
- geen tweede plan maken;
- expiry alsnog correct resolveren.

---

## Vervolgplan uit eerdere versie

Test:

```text
version 1 -> Plan B DRAFT
version 2 -> nieuwe expiry lifecycle
```

Controleer:

- Plan B niet automatisch aangepast;
- version 2 krijgt eigen decision;
- Web App kan melden dat eerder continuation bestaat;
- geen automatische reuse;
- gebruiker kiest expliciet.

---

## Handmatige inconsistenties

Geen automatische hersteltests vereist voor handmatig gewijzigde system-managed Sheet-data.

Dat gedrag valt buiten het normale applicatiecontract.

---

# Acceptatiecriteria

## AC1

Expiry-state hoort altijd bij exact één:

```text
ScheduleID + ScheduleVersion
```

## AC2

De eerste reminder wordt niet eerder verschuldigd dan `ExpiryReminderDaysBefore` kalenderdagen vóór de laatste geplande dag.

## AC3

Maximaal één expiry notification attempt per lokale kalenderdag.

## AC4

Een notification, succesvolle bezorging of openen van de link resolved de decision niet.

## AC5

De gebruiker moet expliciet kiezen tussen:

```text
Nieuw plan klaarzetten
```

en:

```text
Geen nieuw plan nodig
```

## AC6

Reminders lopen maximaal tot en met 7 kalenderdagen na de laatste geplande dag.

## AC7

Na die periode wordt:

```text
ReminderStatus = EXPIRED
```

terwijl:

```text
DecisionStatus = OPEN
```

blijft.

## AC8

De applicatie mag nooit automatisch aannemen dat geen vervolgplan nodig is.

## AC9

`Nieuw plan klaarzetten` maakt altijd een nieuw schedule met een nieuwe UUID.

## AC10

Het nieuwe schedule heeft altijd:

```text
Status = DRAFT
```

## AC11

Het bronplan wordt nooit door deze flow verlengd of aangepast.

## AC12

Bestaande intakes van het bronplan worden niet gewijzigd.

## AC13

Wanneer continuation wordt gekozen vóór of op de laatste geplande dag, wordt als StartDate de volgende kalenderdag voorgesteld.

## AC14

Wanneer continuation wordt gekozen nadat het bronplan al is verlopen, blijft StartDate leeg.

## AC15

De gebruiker moet in dat geval zelf een StartDate invoeren voordat het vervolgplan succesvol gegenereerd kan worden.

## AC16

Het vervolgplan genereert pas intakes na expliciete:

```text
DRAFT -> READY
```

## AC17

Een handmatig reeds aangemaakt vervolgplan wordt niet automatisch gedetecteerd of gekoppeld.

## AC18

Herhaald continuation uitvoeren voor dezelfde bronversie maakt maximaal één vervolgplan.

## AC19

Een vervolgplan moet duurzaam bestaan voordat de expiry decision als `RESOLVED / CONTINUATION_CREATED` wordt opgeslagen.

## AC20

`Geen nieuw plan nodig` vereist expliciete bevestiging.

## AC21

Een resolved expiry decision is immutable.

## AC22

Een oude reminder-link van een niet-actuele schedule-versie mag geen muterende expiry-acties meer uitvoeren.

## AC23

Een nieuwe schedule-versie krijgt een eigen expiry lifecycle.

## AC24

Een vervolg-DRAFT uit een eerdere schedule-versie wordt bij een latere versie niet automatisch aangepast, hergebruikt of geclaimd.

## AC25

Een notificatiefout of onzekere verzenduitkomst leidt niet tot een tweede automatische attempt op dezelfde kalenderdag.

## AC26

De volgende kalenderdag mag opnieuw worden geprobeerd zolang de decision `OPEN` en reminders `ACTIVE` zijn.

## AC27

`ExpiryReminderDaysBefore` maakt onderdeel uit van schedule history.

## AC28

Een wijziging van `ExpiryReminderDaysBefore` op een bestaand plan verloopt via de bestaande reconciliation-flow.

## AC29

Bestaande plannen zonder expiry-configuratie veranderen functioneel niet.

## AC30

Handmatige mutaties van system-managed Sheet-data vallen buiten het normale applicatiecontract.

## AC31

Setup is herhaalbaar en behoudt bestaande operationele data.

## AC32

Alle schrijvende flows respecteren de bestaande lock-, herstel- en side-effectregels.

---

# Buiten scope

Bewaar voor eventuele latere uitbreidingen:

```text
PrescriptionValidUntil
RepeatsRemaining
QuantityRemaining
Pharmacy
PrescriptionID
AutomaticReorder
StockManagement
```

Wanneer later echte receptinformatie wordt gemodelleerd, behandel dan afzonderlijk:

```text
schedule expiry
```

en:

```text
prescription expiry
```

Het aflopen van een medicatieplan betekent niet automatisch dat een recept verloopt.

---

# Gewenste eindtoestand

```text
                   Plan A
                     ↓
              expiry threshold
                     ↓
            OPEN + ACTIVE
                     ↓
              dagelijkse reminder
                     ↓
       ┌─────────────┴─────────────┐
       │                           │
       ▼                           ▼
Nieuw plan                    Geen nieuw plan
klaarzetten                       nodig
       │                           │
       ▼                           ▼
Plan B / DRAFT               RESOLVED
       │
       ▼
RESOLVED
```

Zonder keuze:

```text
OPEN + ACTIVE
      ↓
dagelijkse reminders
      ↓
laatste plandag
      ↓
dag +1 t/m dag +7
      ↓
geen keuze
      ↓
OPEN + EXPIRED
```

De expiry-flow ondersteunt daarmee tijdige opvolging van een aflopend medicatieplan zonder ooit zelfstandig te beslissen dat medicatie moet worden voortgezet of dat een bestaand plan verlengd moet worden.