# Medication Tracker — inrichting en beheer

## Voorbereiding

De app is lokaal geïmplementeerd. Uploaden, deployen, triggers installeren en live testen zijn
afzonderlijke handelingen; ze worden niet door lokale tests uitgevoerd.

1. Gebruik één Apps Script-project en één Spreadsheet voor één persoon.
2. Configureer clasp met `rootDir: src` indien clasp wordt gebruikt. Commit geen lokale deploymentconfiguratie.
3. Upload de broncode alleen na expliciete opdracht. Houd bij upload de HTML-bestandsnaam
   `entrypoints/web/Completion` aan; WebApp-entrypoint.js verwijst naar die Apps Script-bestandsnaam.
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
Voor een plancorrectie: wijzig de planvelden van een GENERATED-schema en kies `READY_FOR_RECONCILIATION`.
De bestaande trigger past het plan toe en legt een versie vast in `medication-schedule-history`.
Vervallen momenten krijgen CANCELLED; uitgevoerde innames blijven behouden. Nieuwe momenten in het verleden
worden bij correcties niet aangemaakt. Een apart commando om een heel plan te stoppen is niet toegevoegd.

Wijzig aangeboden schema's niet tijdens verwerking. Bij ERROR na gedeeltelijke correctie herstelt u het
aangeboden doelplan en kiest u opnieuw READY_FOR_RECONCILIATION. `ApplicationState` is uitsluitend voor het
systeem: niet wissen of bewerken. Een gevulde ApplicationState blokkeert notificaties voor het schema.

Het eerste Pushover-bericht bevat een link. Open deze, controleer de gegevens en druk op
Ingenomen / toegediend nadat de medicatie daadwerkelijk is gebruikt. Alleen openen registreert niets.
Zonder registratie volgen standaard drie extra berichten, steeds twintig minuten na de vorige succesvolle melding.
Een oude link blijft bruikbaar wanneer het moment inmiddels CANCELLED is. De pagina toont dan dat het moment
vervallen is; bevestig alleen een daadwerkelijk uitgevoerde inname. Dit registreert niet automatisch een
eventueel nieuw vervangend moment.

## Beheermenu in de desktopbrowser

Het gekoppelde Apps Script-project voegt bij het openen van de Spreadsheet het menu **Medication Tracker** toe.
Open **Beheerstatus** voor configuratie, tijdzones, tabellen, zichtbare triggers en operationele problemen.
Dit leest alleen gegevens. Credentials worden niet getoond en er worden geen testberichten verstuurd.

Selecteer één gegevensrij en kies **Geselecteerd record inspecteren** of **Planhistorie bekijken**.
Het zijpaneel blijft bij vernieuwen hetzelfde record op UUID tonen. **Selecteer rij** zoekt de actuele rijlocatie op.

Onder **Verwerking** kunnen aangeboden schema's of verschuldigde notificaties direct worden verwerkt.
Notificatieverwerking kan echte berichten versturen. Onder **Inrichting** staan setup en triggerinstallatie.
Deze acties vragen eerst bevestiging en gebruiken dezelfde locks en regels als de normale verwerking.
ERROR-schema's worden niet automatisch opnieuw aangeboden; verzendblokkeringen worden niet gewist.

De resultaatmelding toont afgeronde, mislukte, overgeslagen en nog niet afgeronde kandidaten.
Bij een fout kunnen deelstappen al uitgevoerd zijn. Gebruik Beheerstatus en recordinspectie voor vervolgacties.
Een aanwezige trigger bewijst geen recente succesvolle uitvoering. Triggerinformatie betreft alleen het huidige account.

Na upload: heropen de Spreadsheet. Autoriseer de nieuwe scope voor het zijpaneel indien gevraagd.
Voor uitsluitend dit menu is geen nieuwe Web App-deployment of setup nodig; de eerdere upgrade naar
plancorrecties heeft wel eigen uitrolvereisten. De normale mobiele bediening via Sheet-statussen blijft beschikbaar.
Zie de [beheerbrief](implementation-briefs/management-menu.md) voor de volledige scope.

## Vandaag op uw telefoon

Open vanuit een normale medicatiemelding de registratiepagina en kies **Naar Vandaag**.
Het overzicht toont de geplande momenten van vandaag, met filters voor open, ingenomen en
geannuleerd. Via een moment opent u de bestaande registratiepagina. De link blijft ook na
registratie beschikbaar. Voor dagelijks gebruik hoeft u de Spreadsheet niet te openen.

Bewaar de Vandaag-link als bladwijzer; hij toont altijd de huidige dag. Gebruik op de telefoon
hetzelfde Google-account als voor de afgeschermde Web App. Vanuit het Spreadsheet-menu kunt u
het overzicht openen of na bevestiging een Pushover-link naar uw telefoon sturen.
Er worden geen automatische dagelijkse overzichtsmeldingen verstuurd.

Vandaag volgt de geplande datum in Europe/Brussels. Een gisteren gepland moment dat vandaag
is geregistreerd valt buiten dit overzicht. Gebruik **Vernieuwen** om wijzigingen op te halen;
bij een mislukte verversing kunnen de eerder getoonde gegevens verouderd zijn.

Voor deze uitbreiding zijn **clasp push en een nieuwe versie van de bestaande Web App-deployment**
nodig. Behoud de URL en heropen de Spreadsheet voor de menuopties. Geen nieuwe setup of migratie nodig.
Zie de [implementation brief](implementation-briefs/today-overview.md).

## Verzendfouten

Een gevulde NotificationBlockedAt stopt automatisch verzenden voor die intake. LastError meldt de fout
of een onderbroken poging. De blokkering wordt vóór de netwerkaanroep gezet en pas na volledig opgeslagen
succesgegevens gewist. Bij een onderbreking kan een bericht wel of niet zijn afgeleverd.

Er is bewust geen automatische technische retry of deblokkeerknop. Onderzoek een blokkering voordat
technische gegevens handmatig worden aangepast: deblokkeren kan een dubbel bericht veroorzaken.
Een bestaande geldige link kan de intake nog steeds voltooien. Als nog geen bericht/link bestaat,
kan de eigenaar de intake-UUID gebruiken in `WEB_APP_URL?action=complete&id=<UUID>` om dezelfde
afgeschermde bevestigingspagina te openen.

Wis geen PLAN_-properties: deze bewaken generatie en de laatst toegepaste planning. Een ontbrekende fingerprint
kan herstel van bestaande gegevens blokkeren. Verwijder nooit bestaande intakes om een foutmelding te omzeilen.

## Upgrade naar plancorrecties en history

Deze upgrade wijzigt zowel Sheets als Web App-code. Voer onderstaande beheerhandelingen alleen expliciet uit,
bij voorkeur eerst op een test-Spreadsheet en tijdens een beheerd uitrolmoment zonder gelijktijdig gebruik.

1. Upload de nieuwe broncode. `clasp push` alleen actualiseert de bestaande Web App-versie niet.
2. Voer `setupSpreadsheet()` uit: ApplicationState wordt aan bestaande scheduleheaders toegevoegd en de
   history-tab wordt aangemaakt. Operationele records blijven behouden; onbekende schemafouten worden niet gerepareerd.
3. Werk de bestaande Web App-deployment bij naar een nieuwe versie, met dezelfde URL en toegangsinstellingen.
   Dit is nodig voor CANCELLED -> COMPLETED via eerder verzonden links.
4. Controleer in een testomgeving correctie, statuskleuren, history en registratie via een oude link.
   De bestaande generatie- en notificatietriggers kunnen blijven bestaan.

Historie begint voor bestaande plannen bij hun eerste succesvolle correctie; oudere versies ontbreken bewust.
Een history-rij zonder RecordedAt is een onderbroken write en nog geen gepubliceerde versie. Bied het oorspronkelijke
doelplan opnieuw aan met dezelfde verwerkingsstatus; de toepassing maakt dezelfde rij af. Een gepubliceerde rij is
immutable. Bewerk ApplicationState, intakes en history niet handmatig voor normale correcties.

Zie de [uitgewerkte brief](implementation-briefs/medication-plan-correction.md) voor herstelregels en uitzonderingen.

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
- Corrigeer een toekomstig moment; controleer CANCELLED, nieuwe intake en precies een extra history-versie.
- Bevestig een eerder verzonden link na annulering; controleer COMPLETED met behouden ScheduledAt.
- Bied dezelfde correctie opnieuw aan; controleer dat geen extra intakes of history-versies ontstaan.
- Herstel de gewenste reminderconfiguratie na de test.

Apps Script-triggers en pushbezorging garanderen geen exact aflevermoment. Per uitvoering worden
maximaal 25 meldingen verstuurd; grote achterstanden lopen over meerdere uitvoeringen.

## Geraadpleegde contracten

- [Apps Script Web App-toegang](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Apps Script locks](https://developers.google.com/apps-script/reference/lock/lock-service)
- [Apps Script conditionele opmaak](https://developers.google.com/apps-script/reference/spreadsheet/conditional-format-rule-builder)
- [Pushover API](https://pushover.net/api)
