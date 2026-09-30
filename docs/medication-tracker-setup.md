# Medication Tracker — inrichting en beheer

## Voorbereiding

De app is lokaal geïmplementeerd. Uploaden, deployen, triggers installeren en live testen zijn
afzonderlijke handelingen; ze worden niet door lokale tests uitgevoerd.

1. Gebruik één Apps Script-project en één Spreadsheet voor één persoon.
2. Configureer clasp met `rootDir: src` indien clasp wordt gebruikt. Commit geen lokale deploymentconfiguratie.
3. Upload de broncode alleen na expliciete opdracht. Houd bij upload de HTML-bestandsnaam
   `entrypoints/Completion` aan; WebApp.js verwijst naar die Apps Script-bestandsnaam.
4. Stel Script Properties in via de Apps Script-projectinstellingen:

| Property | Betekenis |
|---|---|
| SPREADSHEET_ID | ID van de bijbehorende Spreadsheet |
| PUSHOVER_USER_KEY | Ontvangersleutel; geheim |
| PUSHOVER_API_TOKEN | Applicatietoken; geheim |
| WEB_APP_URL | De URL van de afgeschermde deployment, eindigend op `/exec` |
| REMINDER_REPEAT_COUNT | Optioneel: 3; maximaal 100, 0 schakelt herhalingen uit |
| REMINDER_INTERVAL_MINUTES | Optioneel: 20; minimaal 1, maximaal 10080 |

5. Voer `setupSpreadsheet()` expliciet uit. Dit maakt tabs, headers, opmaak, validatie en
   beschermingswaarschuwingen. De projecttimezone is Europe/Brussels. De setup stelt de Spreadsheet
   op die timezone in als er nog geen operationele gegevens in de applicatietabs zijn.
6. Deploy als Web App met **uitvoeren als jezelf** en toegang **alleen jezelf**.
   Het manifest specificeert MYSELF / USER_DEPLOYING; controleer dit ook in de deploymentinterface.
   Kies nooit “iedereen” voor deze uitvoering. De toegangsbeperking wordt door Apps Script afgedwongen.
7. Sla de deployment-URL op als WEB_APP_URL.
8. Installeer de triggers met `installMedicationTriggers()` vanuit hetzelfde account. Herhalen maakt
   geen extra triggers voor dat account. Gebruik geen tweede account voor triggerinstallatie.

Inloggen op het eigen Google-account kan nodig zijn als Pushover een andere browser opent.
De normale flow na inrichting is volledig mobiel; initiële autorisatie en deployment zijn beheerhandelingen.

## Dagelijks gebruik

Maak een DRAFT-regel, vul de gegevens in en kies READY. Laat READY-regels tijdens verwerking ongemoeid.
Bij ERROR staat de oorzaak in LastError. Corrigeer invoer en kies READY als er nog geen intakes bestaan;
na gedeeltelijke generatie moet de oorspronkelijke planning worden hersteld.
Verander of verwijder GENERATED-schema's niet om medicatie te stoppen: annuleren is geen v1-functie.

Het eerste Pushover-bericht bevat een link. Open deze, controleer de gegevens en druk op
Ingenomen / toegediend nadat de medicatie daadwerkelijk is gebruikt. Alleen openen registreert niets.
Zonder registratie volgen standaard drie extra berichten, steeds twintig minuten na de vorige succesvolle melding.

## Verzendfouten

Een gevulde NotificationBlockedAt stopt automatisch verzenden voor die intake. LastError meldt de fout
of een onderbroken poging. De blokkering wordt vóór de netwerkaanroep gezet en pas na volledig opgeslagen
succesgegevens gewist. Bij een onderbreking kan een bericht wel of niet zijn afgeleverd.

Er is bewust geen automatische technische retry of deblokkeerknop. Onderzoek een blokkering voordat
technische gegevens handmatig worden aangepast: deblokkeren kan een dubbel bericht veroorzaken.
Een bestaande geldige link kan de intake nog steeds voltooien. Als nog geen bericht/link bestaat,
kan de eigenaar de intake-UUID gebruiken in `WEB_APP_URL?action=complete&id=<UUID>` om dezelfde
afgeschermde bevestigingspagina te openen.

Wis geen PLAN_-properties: deze bewaken bevroren schema's. Een ontbrekende fingerprint bij bestaande
intakes blokkeert herstel. Verwijder nooit bestaande intakes om een foutmelding te omzeilen.

## Lokale tests

Gebruik Node.js 22 of nieuwer en `npm test`, of `node --test tests/*.test.js`.
Er zijn geen npm-dependencies nodig. De tests gebruiken geen netwerk en geen echte Google/Pushover-diensten.

## Mobiele acceptatie na aparte toestemming

- Gebruik een test-Spreadsheet en herkenbare testmedicatie, geen echte medicatiewijzigingen.
- Controleer invoer en statuskeuze op Android zonder custom menu.
- Controleer exacte generatie, ongeldige tijden en herstel zonder dubbele intakes.
- Controleer Pushover-ontvangst en de drie herhalingen; tijdelijk korter testinterval mag via properties.
- Controleer dat openen van de link niets registreert en de knop wel.
- Controleer dubbel klikken, herladen en oorspronkelijke CompletedAt.
- Controleer dat uitgelogd/ander Google-account geen intakedetails kan lezen of wijzigen.
- Controleer dat completion verdere meldingen stopt.
- Controleer setup/triggerinstallatie opnieuw zonder dataverlies of extra triggers.
- Herstel de gewenste reminderconfiguratie na de test.

Apps Script-triggers en pushbezorging garanderen geen exact aflevermoment. Per uitvoering worden
maximaal 25 meldingen verstuurd; grote achterstanden lopen over meerdere uitvoeringen.

## Geraadpleegde contracten

- [Apps Script Web App-toegang](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Apps Script locks](https://developers.google.com/apps-script/reference/lock/lock-service)
- [Pushover API](https://pushover.net/api)
