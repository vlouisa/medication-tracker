# Implementation brief — Medication Tracker v1

Dit is de uitvoerbare brief na refinement. De [oorspronkelijke brief](medication-tracker-v1-original.md)
is ongewijzigd bewaard. Bij verschillen gelden de besluiten in dit document.

## Doel en scope

Eén Google Apps Script-deployment en één Spreadsheet bedienen precies één persoon.
De gebruiker voert medicatieschema's in via Google Sheets op Android. Triggers maken concrete
innamemomenten en sturen Pushover-berichten. Een afgeschermde Web App registreert de inname.
Geen gebruikersadministratie, automatische medische beslissingen, voorraad, dashboards of Calendar.
Annulering en automatische MISSED-bepaling vallen buiten v1.

## Gebruikersflow

1. Nieuwe regel in `medication-schedules`, status `DRAFT`.
2. Medication, Dosage, optioneel Administration, StartDate, DurationDays en Times invullen.
3. Na controle `READY` kiezen. Geen custom menu of button nodig.
4. Het systeem kent een UUID toe en genereert alle concrete intakes.
5. Bij succes `GENERATED`; bij fouten `ERROR` met Nederlandse LastError.
6. Gebruiker herstelt invoer en kiest opnieuw `READY`.
7. Pushover-link opent de details; openen wijzigt geen gegevens.
8. De knop **Ingenomen / toegediend** registreert de inname.
9. Opnieuw registreren bewaart de oorspronkelijke CompletedAt en UpdatedAt.

De Web App is uitsluitend toegankelijk voor het Google-account dat de deployment uitvoert
(`access: MYSELF`, `executeAs: USER_DEPLOYING`). Deployment-instellingen horen bij het toegangscontract.

## Sheets

### medication-schedules

`ID, Medication, Dosage, Administration, StartDate, DurationDays, Times, Status,
LastError, CreatedAt, UpdatedAt`

Gebruiker beheert de invoervelden en kiest DRAFT/READY. Systeem beheert UUID, fouten, timestamps
en GENERATED/ERROR. CreatedAt is het eerste systeemverwerkingsmoment, niet het begin van handmatige invoer.
UpdatedAt registreert systeemwijzigingen. Technische velden krijgen beschermingswaarschuwingen.

### medication-intakes

`ID, ScheduleID, Medication, Dosage, Administration, ScheduledAt, Status, NotifiedAt,
CompletedAt, LastError, CreatedAt, UpdatedAt, ReminderCount, LastReminderAt, NotificationBlockedAt`

Alle velden zijn systeembeheerd. De hele tab krijgt een beschermingswaarschuwing.
ReminderCount telt uitsluitend succesvolle extra herinneringen, niet de eerste melding.
LastReminderAt is het laatste succesvolle verzendmoment, inclusief de eerste melding.
NotifiedAt blijft het eerste succesvolle verzendmoment. NotificationBlockedAt voorkomt automatische
technische retries, ook wanneer een uitvoering tijdens verzending wordt afgebroken.

Toegang is headergestuurd. UUID's zijn de identifiers; rijnummers zijn alleen tijdelijke locaties.
Onverwachte of ontbrekende headers worden niet automatisch gemigreerd. Extra kolommen mogen blijven bestaan.

## Validatie en planning

- Medication en Dosage verplicht, Administration optionele vrije tekst.
- Deze drie tekstvelden samen maximaal 700 tekens om notificaties binnen de providerlimiet te houden.
- StartDate is een Sheet-datum of ISO-kalenderdatum, tussen 1900 en 9998.
- DurationDays is een positief geheel getal, inclusief StartDate.
- Times accepteert H:mm/HH:mm; trimmen, normaliseren, sorteren, ontdubbelen.
- Ongeldige of lege tijdsegmenten wijzen het volledige schema af vóór intakewrites.
- Maximaal 2000 intakes per schema als technische uitvoeringsgrens.
- Project en Spreadsheet gebruiken Europe/Brussels.
- Kalenderdagen worden afzonderlijk opgebouwd; geen optelling van 24 uur over klokwisselingen.
- Niet-bestaande lokale tijden wijzen het volledige schema af.
- Bij een dubbel uur wordt de eerste instantie gekozen; er ontstaat één intake.

## Generatie en herstel

Iedere combinatie van dag en tijd krijgt een UUID en snapshot van Medication, Dosage en Administration.
Uniciteit: ScheduleID + ScheduledAt (timestamp). Controleer de exacte verzameling én snapshots.
Een bestaand aantal alleen is onvoldoende bewijs van integriteit.

Het schedule-ID wordt vóór intakewrites opgeslagen. Een SHA-256-vingerafdruk van de genormaliseerde
planning wordt onder `PLAN_<schedule-UUID>` in Script Properties vastgelegd. Zodra intakes bestaan,
moet deze vingerafdruk overeenkomen: conflicterende aanpassingen worden geblokkeerd.
Als nog geen intake bestaat, mag invoer worden aangepast. Fingerprints zijn persistente applicatiedata:
niet wissen bij regulier configuratiebeheer.

Herstel vult uitsluitend ontbrekende intakes aan. Bestaande UUID's en lifecyclegegevens blijven behouden.
Een schedule wordt pas GENERATED nadat alle verwachte intakes bestaan en de invoer opnieuw is gecontroleerd.
Een onvolledig schedule activeert geen notificaties. Een harde onderbreking kan READY laten staan;
de volgende uitvoering kan dan veilig aanvullen. Een afgehandelde fout vereist ERROR → READY.

Een GENERATED-schema wordt niet automatisch opnieuw gegenereerd. Wijziging/verwijdering is geen
annulering van bestaande intakes. Aangeboden of gegenereerde schema's mogen niet handmatig worden aangepast.

## Notificaties en herhalingen

- Selectie: PENDING of een verschuldigde NOTIFIED, zonder CompletedAt of verzendblokkering.
- Het gekoppelde schedule moet GENERATED zijn.
- Eerste melding zodra ScheduledAt is bereikt; triggervertraging is mogelijk.
- Standaard **3 extra herinneringen**, telkens **20 minuten na de laatste succesvolle melding**.
- Configuratie: REMINDER_REPEAT_COUNT (standaard 3; 0–100), REMINDER_INTERVAL_MINUTES (standaard 20; 1–10080).
- De eerste melding krijgt de tekst “Tijd voor uw medicatie.”, ook bij triggervertraging of na uitval.
  Herhalingen krijgen de tekst “Gemiste herinnering: nog geen inname geregistreerd.”
- Iedere melding bevat de oorspronkelijke geplande datum/tijd en een registratielink.
- Na uitval maximaal één melding per intake per uitvoering; geen inhaalreeks.
- Na completion stoppen meldingen; na het maximum blijft de status NOTIFIED en blijft registratie mogelijk.
- HTTP 200 plus Pushover-status 1 geldt als geaccepteerd. Dit bewijst niet dat de telefoon het bericht heeft getoond.

**Geen technische retries in v1.** Vóór de API-aanroep wordt een blokkering opgeslagen en geflusht.
Succesgegevens worden opgeslagen vóór de blokkering wordt gewist. Bij fout/onderbreking blijft de
blokkering staan. Dit kan een melding missen, maar voorkomt blind opnieuw verzenden bij onzekere uitkomst.
Het eerdere briefcriterium voor automatische retries is daarmee vervangen door zichtbare, handmatig
onderzoekbare fouten. Er is geen automatische deblokkering of beheerknop in v1.

## Statusovergangen

- Schedule: gebruiker DRAFT → READY en ERROR → READY; systeem READY → GENERATED/ERROR.
- Intake: PENDING → NOTIFIED, PENDING/NOTIFIED → COMPLETED.
- COMPLETED → COMPLETED is een no-op.
- Herhalingen behouden NOTIFIED.
- SKIPPED en MISSED zijn gereserveerd en worden in v1 niet geproduceerd of automatisch omgezet.

## Architectuur en concurrency

Broncode staat onder src/domain, src/application, src/infrastructure en src/entrypoints.
Services gebruiken IIFE-modules met expliciet publiek return-object. Geen Node-API's in runtimecode.
Alle schrijvende flows gebruiken één scriptlock; notificaties houden de lock tijdens verzending vast.
Lock-timeout veroorzaakt geen recordfout. Locks voorkomen geen handmatige Sheet-bewerkingen:
invoer wordt opnieuw gecontroleerd en alleen systeemvelden worden bijgewerkt.

Technische logs bevatten gebeurtenisnamen en UUID's, geen credentials, berichtinhoud of links.
Gebruikersfouten staan in LastError. Verwerking is per record geïsoleerd.

## Setup en configuratie

Script Properties: SPREADSHEET_ID, WEB_APP_URL, PUSHOVER_USER_KEY, PUSHOVER_API_TOKEN;
optioneel REMINDER_REPEAT_COUNT en REMINDER_INTERVAL_MINUTES. Geen secrets in broncode.
setupSpreadsheet is herhaalbaar, overschrijft geen operationele data en migreert geen afwijkende headers.
Een bestaande afwijkende timezone met operationele data vereist eerst handmatige controle.
installMedicationTriggers maakt schedule-verwerking elke vijf minuten en notificatieverwerking elke minuut.
Per uitvoering maximaal 25 verwerkte schedules/verzendpogingen en een tijdsbudget van vier minuten.

## Verificatie en acceptatie

De oorspronkelijke AC1–AC16 gelden met de bovenstaande wijzigingen voor completion en verzendfouten.
Extra criteria: bevroren planning, exacte integriteitscontrole, geen meldingen voor onvolledige schedules,
geen automatische technische retry, drie extra meldingen na twintig minuten, stoppen na registratie,
geen GET-mutatie, accountbeperking, DST-beleid, veilige herhaalde setup en triggerinstallatie.

Lokale tests gebruiken uitsluitend vervangers voor Apps Script-services en externe API's.
Een echte Android/Sheets/Pushover/Web App-ketentest vereist een afzonderlijk geautoriseerde testdeployment.
Zie [beheer en ingebruikname](../medication-tracker-setup.md).
