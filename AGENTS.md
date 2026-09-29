# Implementation Brief – Medication Schedule & Intake Tracker

## 1. Doel

Bouw een Google Apps Script-applicatie waarmee medicatieschema's vanuit Google Sheets kunnen worden vastgelegd, automatisch kunnen worden omgezet naar concrete innamemomenten en waarbij de gebruiker via mobiele notificaties wordt herinnerd aan een innamemoment.

De applicatie moet generiek zijn voor verschillende vormen van medicatie, bijvoorbeeld:

- oogdruppels;
- tabletten/pillen;
- zalf;
- injecties;
- andere medicatievormen.

Google Sheets is de administratieve bron van waarheid.

De gebruiker moet de applicatie volledig vanaf mobiel kunnen gebruiken. De oplossing mag daarom niet afhankelijk zijn van custom menus, buttons of andere desktop-specifieke Google Sheets-functionaliteit.

Gebruik hiervoor een statusgestuurde workflow:

`DRAFT → READY → GENERATED`

Een time-driven Apps Script-trigger verwerkt records die op `READY` staan.

---

# 2. Single-user uitgangspunt

Iedere deployment van de applicatie en de bijbehorende Google Spreadsheet is gebonden aan exact één persoon.

De applicatie ondersteunt geen multi-user medicatieregistratie.

Daarom zijn niet nodig:

- UserID op schedules;
- UserID op intakes;
- gebruikersaccounts;
- filtering per gebruiker;
- autorisatie tussen verschillende gebruikers;
- verschillende Pushover-ontvangers per record.

Alle schedules, intakes en notificaties in één Spreadsheet behoren impliciet bij dezelfde persoon.

Als de applicatie voor een andere persoon gebruikt moet worden, krijgt die persoon een eigen Spreadsheet/deployment/configuratie.

Introduceer geen multi-user abstracties "voor later".

---

# 3. Functionele architectuur

Maak onderscheid tussen twee hoofdconcepten:

## MedicationSchedule

Een `MedicationSchedule` beschrijft een voorschrift/schema.

Voorbeeld:

> Dexa  
> 1 druppel  
> rechteroog  
> vanaf 29-09-2026  
> gedurende 2 dagen  
> om 08:00, 14:00 en 20:00

Dit schedule genereert zes concrete innamemomenten.

## MedicationIntake

Een `MedicationIntake` vertegenwoordigt één concreet gepland medicatiemoment.

Voor bovenstaand schedule:

- 29-09-2026 08:00
- 29-09-2026 14:00
- 29-09-2026 20:00
- 30-09-2026 08:00
- 30-09-2026 14:00
- 30-09-2026 20:00

Iedere intake heeft een eigen UUID en eigen status.

---

# 4. Google Sheets

Gebruik minimaal twee tabs:

`medication-schedules`

`medication-intakes`

Gebruik exacte, vaste kolomnamen zodat Apps Script niet afhankelijk is van kolomposities.

Maak expliciet onderscheid tussen:

- `USER`-kolommen: door gebruiker te wijzigen;
- `SYSTEM`-kolommen: uitsluitend door de applicatie te beheren.

Technische kolommen moeten waar mogelijk met Google Sheets Protected Ranges worden beschermd tegen onbedoelde handmatige wijzigingen.

Omdat de eigenaar van een persoonlijke Spreadsheet protections uiteindelijk zelf kan wijzigen of verwijderen, zijn deze protections bedoeld als bescherming tegen gebruikersfouten en niet als security boundary.

---

# 5. Tab: medication-schedules

Gebruik de volgende kolommen:

| Kolom | Owner | Editable | Omschrijving |
|---|---|---|---|
| ID | SYSTEM | Nee | UUID van schedule |
| Medication | USER | Ja | Naam van medicatie |
| Dosage | USER | Ja | Dosering als leesbare tekst |
| Administration | USER | Ja | Wijze/plaats van toediening |
| StartDate | USER | Ja | Eerste dag waarop schema geldt |
| DurationDays | USER | Ja | Aantal dagen, inclusief StartDate |
| Times | USER | Ja | Kommagescheiden lijst van tijdstippen |
| Status | USER/SYSTEM | Beperkt | Workflowstatus |
| LastError | SYSTEM | Nee | Laatste verwerkingsfout |
| CreatedAt | SYSTEM | Nee | Aanmaakmoment |
| UpdatedAt | SYSTEM | Nee | Laatste wijziging |

Voorbeeld:

```text
ID:               <UUID>
Medication:       Dexa
Dosage:           1 druppel
Administration:   rechteroog
StartDate:        2026-09-29
DurationDays:     2
Times:            08:00,14:00,20:00
Status:           READY
LastError:
CreatedAt:         ...
UpdatedAt:         ...
```

`Administration` wordt bewust als vrije tekst behandeld.

Maak hier in eerste instantie geen enum van.

Daardoor kunnen bijvoorbeeld waarden worden gebruikt als:

```text
oraal
rechteroog
linkeroog
beide ogen
huid
linkerarm
```

zonder wijzigingen in de applicatie.

---

# 6. Schedule-statussen

Ondersteun:

```text
DRAFT
READY
GENERATED
ERROR
```

## DRAFT

Het schedule wordt nog ingevoerd of gewijzigd.

Automatische verwerking negeert het record.

## READY

Het schedule is compleet en mag verwerkt worden.

De automatische trigger pakt deze records op.

## GENERATED

Alle verwachte `MedicationIntake`-records zijn succesvol aangemaakt.

Deze status wordt uitsluitend door het systeem gezet.

## ERROR

Het schedule kon niet volledig worden verwerkt.

`LastError` bevat een bruikbare foutmelding.

Deze status wordt uitsluitend door het systeem gezet.

---

# 7. Toegestane schedule-statusovergangen

Maak onderscheid tussen user- en system-transities.

De gebruiker mag functioneel alleen initiëren:

```text
DRAFT → READY
ERROR → READY
```

Het systeem beheert:

```text
READY → GENERATED
READY → ERROR
```

De normale flow is:

```text
DRAFT
  ↓ user
READY
  ↓ system
GENERATED
```

Bij een fout:

```text
DRAFT
  ↓ user
READY
  ↓ system
ERROR
  ↓ user, na correctie
READY
  ↓ system
GENERATED
```

De gebruiker mag niet handmatig een schedule op `GENERATED` zetten.

De gebruiker mag ook niet handmatig een fout simuleren door `ERROR` te selecteren.

Richt de Sheet/data-validatie zo in dat de normale mobiele gebruikersinteractie primair gericht is op `DRAFT` en `READY`.

De applicatie moet statusovergangen daarnaast zelf valideren; vertrouw niet uitsluitend op Sheet-validatie.

---

# 8. Mobiele workflow

De gebruiker moet een nieuw schedule volledig vanuit de mobiele Google Sheets-app kunnen invoeren.

Workflow:

```text
1. Nieuwe regel invoeren
2. Status = DRAFT
3. Gegevens invullen/controleren
4. Status wijzigen naar READY
5. Apps Script-trigger verwerkt schedule
6. Intake-records worden gegenereerd
7. Schedule krijgt status GENERATED
```

Er is geen handmatige knop of custom menu nodig.

Bij een fout:

```text
1. Schedule krijgt ERROR
2. LastError wordt gevuld
3. Gebruiker corrigeert de invoer
4. Gebruiker zet status opnieuw op READY
5. Trigger probeert verwerking opnieuw
```

---

# 9. UUID's

Gebruik UUID's voor zowel schedules als intakes.

Gebruik Apps Script:

```javascript
Utilities.getUuid()
```

Als een schedule met status `READY` nog geen ID heeft, wordt tijdens verwerking automatisch een UUID toegekend.

De gebruiker voert UUID's nooit zelf in.

Iedere intake krijgt altijd een eigen UUID.

Een intake bewaart daarnaast de UUID van het oorspronkelijke schedule.

Gebruik nooit Sheet-rijnummers als functionele identifiers.

---

# 10. DurationDays

`DurationDays` is inclusief `StartDate`.

Voor:

```text
StartDate = 2026-09-29
DurationDays = 2
```

zijn de geldige dagen:

```text
2026-09-29
2026-09-30
```

Niet:

```text
2026-10-01
```

Conceptueel:

```javascript
for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
  const date = addDays(startDate, dayOffset);
}
```

---

# 11. Times

`Times` bevat één of meerdere tijdstippen.

Voorbeeld:

```text
08:00,14:00,20:00
```

Trim whitespace bij parsing.

Valideer ieder tijdstip.

Gebruik intern een consistente `HH:mm`-representatie.

Dubbele tijdstippen binnen hetzelfde schedule mogen niet leiden tot dubbele intakes.

Bijvoorbeeld:

```text
08:00,14:00,14:00,20:00
```

wordt behandeld als:

```text
08:00
14:00
20:00
```

Een ongeldig tijdstip mag niet stilzwijgend worden genegeerd.

---

# 12. Genereren van MedicationIntakes

Voor iedere combinatie van:

```text
dag × tijdstip
```

moet precies één `MedicationIntake` bestaan.

Voor:

```text
DurationDays = 2
Times = 08:00,14:00,20:00
```

moeten exact:

```text
2 × 3 = 6
```

intakes bestaan.

Gebruik deze berekening ook als integriteitscontrole voordat een schedule op `GENERATED` wordt gezet.

---

# 13. Tab: medication-intakes

Gebruik:

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
| LastError | SYSTEM | Nee | Eventuele technische fout |
| CreatedAt | SYSTEM | Nee | Aanmaakmoment |
| UpdatedAt | SYSTEM | Nee | Laatste wijziging |

De volledige `medication-intakes`-tab is in principe system-managed.

De gebruiker hoeft tijdens normaal gebruik geen intakegegevens rechtstreeks in deze tab te wijzigen.

Gebruik deze tab als logboek/audit trail van de daadwerkelijk gegenereerde medicatiemomenten.

Bescherm de system-managed kolommen/tab waar mogelijk met Protected Ranges.

---

# 14. Snapshot van schedule-data

Bewaar bewust:

```text
Medication
Dosage
Administration
```

op iedere intake.

Een eenmaal gegenereerde intake mag niet afhankelijk zijn van latere wijzigingen in het oorspronkelijke schedule.

Voorbeeld:

Als een schedule oorspronkelijk bevat:

```text
Medication = Dexa
Dosage = 1 druppel
Administration = rechteroog
```

dan blijven bestaande intakes die gegevens behouden, ook als het schedule later zou worden gewijzigd.

---

# 15. Intake-statussen

Ondersteun minimaal:

```text
PENDING
NOTIFIED
COMPLETED
SKIPPED
MISSED
```

## PENDING

De intake staat gepland maar er is nog geen notificatie verstuurd.

## NOTIFIED

De notificatie voor dit innamemoment is succesvol verstuurd.

`NotifiedAt` is gevuld.

## COMPLETED

De gebruiker heeft aangegeven dat de medicatie is toegediend/ingenomen.

`CompletedAt` is gevuld.

## SKIPPED

De gebruiker heeft bewust aangegeven deze dosis over te slaan.

## MISSED

Het innamemoment is verlopen zonder succesvolle registratie.

Automatische `MISSED`-logica hoeft alleen geïmplementeerd te worden als hiervoor een duidelijke configureerbare termijn wordt gebruikt.

Anders mag deze status voorbereid maar nog niet automatisch toegepast worden.

---

# 16. Idempotente schedule generation

Schedule-verwerking moet idempotent zijn.

Een schedule mag nooit dubbele intake-records veroorzaken doordat:

- een trigger tweemaal draait;
- verwerking halverwege faalt;
- Apps Script opnieuw wordt gestart;
- een eerdere verwerking gedeeltelijk is uitgevoerd;
- twee executions elkaar overlappen.

Gebruik functioneel minimaal deze unieke combinatie:

```text
ScheduleID + ScheduledAt
```

Voordat een intake wordt aangemaakt:

```text
Bestaat ScheduleID + ScheduledAt?
    JA  → niet opnieuw aanmaken
    NEE → intake met nieuwe UUID aanmaken
```

Een gedeeltelijk mislukte generatie moet daardoor veilig opnieuw uitgevoerd kunnen worden.

---

# 17. Schedule-verwerking

Maak een functie die door een time-driven trigger wordt aangeroepen.

Bijvoorbeeld:

```javascript
processReadySchedules()
```

Deze functie:

1. zoekt schedules met `Status = READY`;
2. verwerkt ieder schedule geïsoleerd;
3. valideert de invoer;
4. genereert indien nodig een Schedule UUID;
5. parseert en valideert `Times`;
6. verwijdert dubbele tijdstippen;
7. berekent alle benodigde `ScheduledAt`-momenten;
8. controleert per moment of de intake al bestaat;
9. maakt ontbrekende intakes aan;
10. controleert of het verwachte aantal intakes aanwezig is;
11. zet het schedule op `GENERATED`;
12. wist een eventuele oude `LastError`;
13. werkt `UpdatedAt` bij.

Bij een fout:

```text
Status = ERROR
LastError = <duidelijke foutmelding>
UpdatedAt = now
```

Voorkom dat één foutief schedule de verwerking van andere `READY` schedules blokkeert.

---

# 18. Validatie

Een `READY` schedule mag alleen verwerkt worden wanneer minimaal geldig zijn:

```text
Medication
Dosage
StartDate
DurationDays
Times
```

`Administration` mag optioneel zijn.

Valideer minimaal:

```text
DurationDays > 0
```

Er moet minimaal één geldig tijdstip zijn.

Voorbeeld:

```text
DurationDays = 0
```

leidt tot:

```text
ERROR
```

Een waarde als:

```text
08:00,foo,20:00
```

mag niet gedeeltelijk worden verwerkt.

Het volledige schedule gaat naar `ERROR`.

Gebruik een bruikbare foutmelding, bijvoorbeeld:

```text
Invalid time value: foo
```

---

# 19. Trigger voor schedule generation

Gebruik een installable time-driven Apps Script-trigger.

Deze roept periodiek aan:

```javascript
processReadySchedules()
```

Een interval van ongeveer 1–5 minuten is voldoende.

De businesslogica mag niet afhankelijk zijn van de exacte triggerfrequentie.

Voorkom dat de trigger handmatige user-interfacefunctionaliteit nodig heeft.

---

# 20. Notificatieverwerking

Maak notificatieverwerking los van schedule generation.

Bijvoorbeeld:

```javascript
processPendingIntakeNotifications()
```

Deze functie zoekt intakes waarvoor:

```text
Status = PENDING
ScheduledAt <= now
```

en verstuurt daarvoor een mobiele notificatie.

Na succesvolle verzending:

```text
Status = NOTIFIED
NotifiedAt = now
UpdatedAt = now
LastError = leeg
```

Bij een technische fout mag de intake niet ten onrechte als `NOTIFIED` worden gemarkeerd.

De intake blijft retrybaar.

Sla de relevante fout op in:

```text
LastError
```

---

# 21. Pushover-integratie

Gebruik Pushover als notificatieprovider.

Isoleer de Pushover-integratie van de overige businesslogica.

Bijvoorbeeld:

```text
PushoverNotificationService
```

Gebruik `UrlFetchApp` voor API-calls.

Sla credentials niet op in:

- Sheets;
- broncode;
- logs.

Gebruik Apps Script Script Properties.

Bijvoorbeeld:

```text
PUSHOVER_USER_KEY
PUSHOVER_API_TOKEN
```

Omdat één app/Spreadsheet altijd aan één persoon gekoppeld is, is er precies één geconfigureerde Pushover-ontvanger per deployment.

Er is geen recipient/user-ID nodig op schedules of intakes.

---

# 22. Inhoud notificatie

Een notificatie bevat voldoende informatie om te weten wat er moet gebeuren.

Bijvoorbeeld:

```text
Medicatie

Dexa
1 druppel
rechteroog

Gepland: 08:00
```

Of:

```text
Medicatie

Paracetamol
2 × 500 mg
oraal

Gepland: 14:00
```

Gebruik geen medicatiespecifieke businesslogica om het notificatietype te bepalen.

Druppels, pillen, zalf enzovoort worden technisch hetzelfde behandeld.

---

# 23. Registreren via notificatie

De gebruiker moet vanuit de mobiele notificatie gemakkelijk kunnen aangeven dat het innamemoment is uitgevoerd.

Gebruik hiervoor een Apps Script Web App endpoint.

De notificatie bevat een completion-URL waarin minimaal de intake-UUID wordt opgenomen.

Conceptueel:

```text
https://<apps-script-webapp>/exec?action=complete&id=<INTAKE_UUID>
```

Gebruik nooit het rijnummer van Google Sheets als identifier.

---

# 24. Web App endpoint

Implementeer bijvoorbeeld:

```javascript
doGet(e)
```

Ondersteun minimaal:

```text
action=complete
id=<UUID>
```

Zoek de intake uitsluitend op basis van UUID.

Bij succesvolle registratie:

```text
Status = COMPLETED
CompletedAt = now
UpdatedAt = now
```

Toon daarna een eenvoudige mobielvriendelijke bevestigingspagina:

```text
✓ Geregistreerd

Dexa
1 druppel
rechteroog

Gepland: 08:00
```

De pagina hoeft geen uitgebreide applicatie-interface te worden.

---

# 25. Idempotente completion

Completion moet eveneens idempotent zijn.

Als de gebruiker tweemaal dezelfde completion-link opent, mag dit geen dubbele registratie of fout veroorzaken.

Als de intake al:

```text
COMPLETED
```

is, toon bijvoorbeeld:

```text
✓ Was al geregistreerd

Geregistreerd om 08:04
```

Wijzig `CompletedAt` in dat geval niet.

De oorspronkelijke registratie blijft leidend.

---

# 26. Security completion-links

Gebruik nooit voorspelbare Sheet-rijnummers of soortgelijke identifiers.

De UUID maakt eenvoudig raden al aanzienlijk moeilijker.

Centraliseer URL-generatie:

```javascript
createCompletionUrl(intake)
```

Zet de Web App URL niet verspreid als hard-coded string in de applicatie.

Gebruik configuratie/Script Properties.

Ontwerp dit zodanig dat later eventueel een aanvullende token/signature aan completion-links kan worden toegevoegd zonder de rest van de applicatie te herschrijven.

---

# 27. Concurrency

Houd rekening met overlappende Apps Script-triggers.

Gebruik waar nodig:

```javascript
LockService
```

rond kritieke verwerking van schedules en intake-records.

Het systeem moet voorkomen dat twee gelijktijdige executions dezelfde intake creëren.

Idempotentie blijft daarnaast verplicht.

`LockService` is geen vervanging voor de uniqueness-check op:

```text
ScheduleID + ScheduledAt
```

---

# 28. Datum en tijd

Gebruik één centrale timezone.

Gebruik bij voorkeur de timezone van het Google Apps Script-project/Spreadsheet.

Voorkom impliciete UTC-conversies waardoor een intake op een verkeerde dag of tijd terechtkomt.

Een `ScheduledAt` representeert een lokaal medicatiemoment.

Bijvoorbeeld:

```text
2026-09-29 08:00
Europe/Amsterdam
```

moet daadwerkelijk als 08:00 lokale tijd worden behandeld.

Centraliseer datum/tijd-functionaliteit waar zinvol.

---

# 29. Logging

Log technische gebeurtenissen compact en zonder secrets.

Bijvoorbeeld:

```text
Schedule generated: <schedule UUID>, 6 intakes
Notification sent: <intake UUID>
Intake completed: <intake UUID>
Schedule generation failed: <schedule UUID>
```

Log nooit:

```text
PUSHOVER_USER_KEY
PUSHOVER_API_TOKEN
```

Gebruik `LastError` in de Sheet voor fouten die voor de gebruiker relevant zijn.

---

# 30. Bescherming van system-managed data

Implementeer waar mogelijk een setup/init-functie die de Sheet-structuur en protections kan configureren.

Bijvoorbeeld:

```javascript
setupSpreadsheet()
protectSystemColumns()
```

Bescherm in `medication-schedules` minimaal:

```text
ID
LastError
CreatedAt
UpdatedAt
```

`Status` is gedeeltelijk user-managed en vereist daarom aparte behandeling.

Bescherm in `medication-intakes` bij voorkeur de volledige datazone tegen normale handmatige wijzigingen.

De protections zijn bedoeld om accidentele wijzigingen te voorkomen.

Businesslogica mag niet aannemen dat protected ranges absoluut niet gewijzigd kunnen worden.

Valideer daarom technische gegevens ook tijdens verwerking.

---

# 31. Code-structuur

Voorkom één groot `Code.gs`-bestand.

Splits verantwoordelijkheden logisch.

Mogelijke structuur:

```text
Config.gs

MedicationScheduleRepository.gs
MedicationIntakeRepository.gs

MedicationScheduleService.gs
MedicationIntakeService.gs

ScheduleGenerator.gs

NotificationService.gs
PushoverNotificationService.gs

WebAppController.gs

TriggerFunctions.gs

DateUtils.gs
SheetUtils.gs
```

De exacte bestandsnamen mogen aansluiten op bestaande projectconventies.

Belangrijker is een duidelijke scheiding tussen:

```text
Sheet persistence
businesslogica
schedule generation
notification provider
web endpoint
trigger entrypoints
configuratie
```

Voorkom tegelijkertijd onnodige abstractielagen voor deze relatief kleine applicatie.

---

# 32. Repository-laag

Voorkom verspreide directe Sheet-calls door businesslogica.

Centraliseer toegang tot:

```text
medication-schedules
```

in een `MedicationScheduleRepository`.

Centraliseer toegang tot:

```text
medication-intakes
```

in een `MedicationIntakeRepository`.

Businesslogica moet bijvoorbeeld kunnen werken met:

```javascript
scheduleRepository.findReady()
```

en:

```javascript
intakeRepository.exists(scheduleId, scheduledAt)
```

zonder te hoeven weten in welke kolom een waarde staat.

Gebruik headers om kolommen te identificeren.

Gebruik geen hard-coded kolomnummers als functionele contracten.

---

# 33. Configuratie

Centraliseer technische configuratie.

Denk minimaal aan:

```text
SCHEDULE_SHEET_NAME
INTAKE_SHEET_NAME
TIMEZONE
WEB_APP_URL
PUSHOVER_USER_KEY
PUSHOVER_API_TOKEN
```

Secrets horen in Script Properties.

Niet-geheime constanten mogen in code/config staan.

Configuratie is deployment-breed omdat iedere deployment bij exact één persoon hoort.

---

# 34. Eerste scope

Implementeer in de eerste versie:

- single-user deployment;
- invoer schedules via Google Sheets;
- onderscheid USER/SYSTEM-kolommen;
- bescherming technische kolommen;
- `DRAFT`;
- `READY`;
- `GENERATED`;
- `ERROR`;
- gecontroleerde statusovergangen;
- UUID's;
- `DurationDays`;
- meerdere dagelijkse tijdstippen;
- automatische intake-generation;
- snapshot van schedule-data;
- idempotente generation;
- `PENDING`;
- Pushover-notificatie;
- `NOTIFIED`;
- registreren via Web App;
- `COMPLETED`;
- `CompletedAt`;
- foutregistratie;
- time-driven triggers;
- concurrencybescherming;
- idempotente completion.

---

# 35. Buiten scope eerste versie

Niet nodig voor de eerste implementatie:

- meerdere gebruikers;
- UserID's;
- gebruikersaccounts;
- verschillende notification recipients;
- uitgebreide mobiele webinterface;
- medische doseringsadviezen;
- automatische interpretatie van voorschriften;
- koppeling met apotheek of huisarts;
- voorraadbeheer;
- pushnotificaties via een eigen mobiele app;
- statistische dashboards;
- automatische aanpassing van schema's;
- Google Calendar-integratie.

Introduceer geen multi-user architectuur of andere abstraheringen uitsluitend voor hypothetisch toekomstig gebruik.

---

# 36. Belangrijke businessregel

De applicatie registreert uitsluitend het door de gebruiker opgegeven schema.

De applicatie mag nooit zelfstandig:

- doseringen bepalen;
- medicatietijden wijzigen;
- een behandelingsduur wijzigen;
- ontbrekende medicatie-instructies aanvullen.

Het systeem is een registratie- en herinneringssysteem, geen medisch beslissingssysteem.

---

# 37. Voorbeeldscenario

De gebruiker maakt mobiel een regel aan in `medication-schedules`:

```text
Medication:       Dexa
Dosage:           1 druppel
Administration:   rechteroog
StartDate:        2026-09-29
DurationDays:     2
Times:            08:00,14:00,20:00
Status:           DRAFT
```

De technische velden worden niet door de gebruiker ingevuld.

Na controle zet de gebruiker:

```text
DRAFT → READY
```

De schedule-trigger verwerkt het record.

Indien nog niet aanwezig genereert het systeem:

```text
ID = <UUID>
CreatedAt = ...
UpdatedAt = ...
```

Vervolgens ontstaan zes system-managed intake-records:

```text
29-09-2026 08:00 PENDING
29-09-2026 14:00 PENDING
29-09-2026 20:00 PENDING
30-09-2026 08:00 PENDING
30-09-2026 14:00 PENDING
30-09-2026 20:00 PENDING
```

Iedere intake heeft:

```text
eigen UUID
dezelfde ScheduleID
snapshot Medication
snapshot Dosage
snapshot Administration
```

Na succesvolle generatie:

```text
Schedule.Status = GENERATED
```

Om bijvoorbeeld 14:00:

```text
PENDING
↓
Pushover notification
↓
NOTIFIED
```

De gebruiker opent vanuit de notificatie de completion-link:

```text
NOTIFIED
↓
COMPLETED
```

Het systeem registreert:

```text
CompletedAt = werkelijk registratiemoment
```

De gebruiker hoeft hiervoor de `medication-intakes`-tab niet te wijzigen.

---

# 38. Voorbeeld foutscenario

De gebruiker voert in:

```text
Medication:       Dexa
Dosage:           1 druppel
StartDate:        2026-09-29
DurationDays:     2
Times:            08:00,foo,20:00
Status:           READY
```

De trigger detecteert het ongeldige tijdstip.

Het systeem genereert geen gedeeltelijk schema en zet:

```text
Status = ERROR
LastError = Invalid time value: foo
```

De gebruiker corrigeert:

```text
Times = 08:00,14:00,20:00
```

en zet:

```text
ERROR → READY
```

De volgende trigger verwerkt het schedule opnieuw.

Bij succes:

```text
Status = GENERATED
LastError = leeg
```

---

# 39. Acceptatiecriteria

## AC1 – Mobiele schedule-invoer

Een gebruiker kan volledig vanuit Google Sheets op Android een schedule invoeren en van `DRAFT` naar `READY` zetten zonder Apps Script-menu of knop.

## AC2 – System-managed kolommen

De gebruiker hoeft technische velden zoals:

```text
ID
LastError
CreatedAt
UpdatedAt
```

niet in te voeren.

Deze worden door het systeem beheerd en waar mogelijk tegen accidentele handmatige wijzigingen beschermd.

## AC3 – Intake-tab

`medication-intakes` wordt volledig door de applicatie beheerd en hoeft tijdens normaal gebruik niet handmatig gewijzigd te worden.

## AC4 – Intake generation

Een schedule van:

```text
DurationDays = 2
Times = 08:00,14:00,20:00
```

genereert exact zes intake-records.

## AC5 – UUID

Schedule en iedere intake hebben geldige, unieke UUID's.

## AC6 – Inclusieve startdatum

`DurationDays = 1` genereert uitsluitend intakes op `StartDate`.

## AC7 – Idempotentie

Het tweemaal verwerken van hetzelfde schedule genereert geen dubbele intakes.

## AC8 – Herstel na gedeeltelijke fout

Als drie van zes intakes al bestaan, maakt een retry uitsluitend de drie ontbrekende intakes aan.

Daarna mag het schedule `GENERATED` worden.

## AC9 – Ongeldig schedule

Een ongeldig `READY` schedule krijgt:

```text
ERROR
```

met een bruikbare `LastError`.

Andere geldige schedules worden wel verwerkt.

## AC10 – Notification

Een `PENDING` intake waarvan:

```text
ScheduledAt <= now
```

resulteert in maximaal één succesvolle eerste notificatie en daarna:

```text
NOTIFIED
```

## AC11 – Completion

Een geldige completion-link zet de intake op:

```text
COMPLETED
```

en vult:

```text
CompletedAt
```

## AC12 – Dubbele completion

Een tweede completion-request wijzigt de oorspronkelijke `CompletedAt` niet.

## AC13 – Geen secrets

Pushover-credentials staan niet in Sheets, broncode of logs.

## AC14 – Single user

Er bestaan geen UserID's of multi-userconstructies in schedules of intakes.

Eén deployment/Spreadsheet representeert exact één persoon.

## AC15 – Status ownership

De gebruiker initieert alleen:

```text
DRAFT → READY
ERROR → READY
```

Het systeem beheert:

```text
READY → GENERATED
READY → ERROR
```

## AC16 – Mobiel bruikbaar

De volledige normale workflow kan worden uitgevoerd vanuit:

```text
Google Sheets Android
+
Pushover
+
Apps Script Web App
```

zonder afhankelijkheid van desktopfunctionaliteit.

---

# 40. Implementatieprincipes

Houd de implementatie klein en gericht.

Vermijd onnodige frameworks, abstractielagen en toekomstige multi-userarchitectuur.

Gebruik bestaande Google Apps Script-functionaliteit waar mogelijk.

Scheiding van verantwoordelijkheden is belangrijk, maar voorkom enterprise-overengineering voor een kleine persoonlijke applicatie.

Prioriteiten zijn:

1. correcte registratie;
2. geen dubbele intakes;
3. betrouwbare notificaties;
4. eenvoudige mobiele bediening;
5. bescherming tegen accidentele wijzigingen;
6. begrijpelijke code;
7. eenvoudige uitbreidbaarheid.

Inspecteer na implementatie expliciet de edge cases rond:

- datum/tijd;
- `DurationDays`;
- dubbele tijden;
- dubbele triggers;
- gedeeltelijke schedule-generation;
- retries na `ERROR`;
- overlappende executions;
- dubbele completion-requests;
- handmatig gewijzigde technische gegevens;
- notification failures.

De Sheet is de administratieve bron van waarheid.

`medication-schedules` is primair de invoer- en opdrachtlaag voor de gebruiker.

`medication-intakes` is het door het systeem beheerde operationele logboek.

Pushover en de Apps Script Web App vormen de mobiele interactielaag voor concrete innamemomenten.