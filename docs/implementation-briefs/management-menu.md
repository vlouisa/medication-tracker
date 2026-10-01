# Beheer via custom menu

Opgesteld: **2026-10-01**. Status: uitgerold op **2026-10-01**, bevestigd door de gebruiker.
Het Apps Script-project is volgens de beheerder aan de Spreadsheet gekoppeld.

## Doel en scope

Maak diagnose en bestaande beheerhandelingen bereikbaar via het menu **Medication Tracker** in de desktopbrowser.
Dagelijks mobiel gebruik via Sheet-statussen en registratielinks blijft beschikbaar. Geen nieuwe Sheet-kolommen,
statusovergangen, herstelalgoritmen of persistente registratie van laatste succesvolle trigger-runs.

## Menu

| Optie | Gedrag |
|---|---|
| Beheerstatus | Onafhankelijke controles van configuratie, tijdzones, tabellen, triggers en operationele problemen |
| Geselecteerd record inspecteren | Velden, status, fout en hersteladvies voor één UUID; aangeboden doelplan bij onafgeronde verwerking |
| Planhistorie bekijken | Gepubliceerde versies van het geselecteerde schema of gekoppelde intake/history-rij, met gewijzigde planvelden |
| Verwerking → Aangeboden schema's nu verwerken | Bevestiging, daarna bestaande ScheduleService met dezelfde limieten en locks |
| Verwerking → Verschuldigde notificaties nu verwerken | Bevestiging voor echte verzending, daarna bestaande NotificationService |
| Inrichting → Spreadsheet inrichten / bijwerken | Bevestiging, daarna bestaande setup |
| Inrichting → Ontbrekende triggers installeren | Bevestiging, daarna bestaande installatie voor het huidige account |
| Help en herstel | Beknopte instructies zonder writes |

`onOpen` voegt alleen het menu toe. Het voert geen diagnostiek, setup, externe verzoeken of verwerking uit.
Voor acties worden doel-Spreadsheet en configuratie via de bestaande services gecontroleerd.
Bevestigingsdialogen staan buiten het scriptlock. Na bevestiging wordt de container opnieuw gecontroleerd;
de uitvoerende services verkrijgen hun bestaande locks en lezen records opnieuw.

## Diagnostiek

Checks leveren **goed**, **aandacht nodig** of **niet controleerbaar** op. Een fout in een property of tabel
verhindert de andere checks niet. Als de geopende Spreadsheet niet bij SPREADSHEET_ID hoort, worden geen
recordgegevens gelezen en geen acties uitgevoerd. Configuratiecontroles tonen nooit de credentialwaarden.

Het statusrapport toont maximaal 100 recordproblemen: schemafouten, onafgeronde toepassingen,
verzendblokkeringen en onvolledige history-rijen. Verschuldigde meldingen worden ingedeeld in verzendbaar
volgens recordregels, geblokkeerd en ongeldig. Configuratie en tijdzones moeten daarnaast geldig zijn.
Dit is een momentopname zonder lock; gegevens kunnen tijdens het lezen veranderen.

Credentialaanwezigheid bewijst geen geldigheid bij Pushover. Een correct URL-formaat bewijst geen bereikbare
Web App of juiste deploymentversie. Triggerinspectie ziet uitsluitend triggers van het huidige account;
het interval en het succes van recente runs worden niet als vastgesteld gepresenteerd.

## Selectie, historie en weergave

Inspectie vereist precies één gegevensrij uit een applicatietab en een aanwezige UUID. Een header, lege rij,
meerdere rijen of een selectie uit een andere tab wordt afgewezen. Het paneel houdt de geselecteerde UUID vast;
vernieuwen blijft hetzelfde record inspecteren. Navigatie zoekt de huidige rij opnieuw op UUID.

Een history-overzicht toont maximaal de laatste 100 gepubliceerde versies. De eerste daarvan wordt waar mogelijk
nog vergeleken met zijn voorganger. Onvolledige history-rijen worden alleen als probleem gerapporteerd, niet als versie.
Bij oudere plannen kan de geschiedenis pas bij de eerste correctie beginnen.

Sheet-tekst wordt in het paneel via textContent gerenderd. Datums worden server-side omgezet naar tekst; het
rapport bevat geen Apps Script-objecten. Ingestelde Pushover-credentials worden ook uit fout- en recordtekst
verwijderd. Lange veldteksten worden begrensd. Ruwe ApplicationState wordt niet naar de browser gestuurd.

## Architectuur

- `Management-entrypoint.js`: globaal onOpen-entrypoint, menuhandlers, bevestiging en paneelcallbacks.
- `Management.html`: één zijpaneel voor status, recordinspectie, historie en help.
- `ManagementService`: diagnose en rapportmodellen, zonder writes.
- `ManagementStore`: containercontrole, headergestuurde diagnose-reads en UUID-navigatie, onafhankelijk van
  ongeldige herinneringsinstellingen of tijdzones die de normale verwerking blokkeren.
- `Config.tableNames`: gedeelde tabelnamen, ook beschikbaar bij ongeldige Script Properties.
- Bestaande verwerkingsservices leveren een aanvullend batchresultaat: processed, failed, skipped, remaining, busy.

Processed telt afgeronde schema's of volledig geregistreerde verzendingen. Remaining telt onafgeronde/nog niet
behandelde kandidaten van de batch. Skipped telt kandidaten die bij hercontrole niet meer in aanmerking komen.
Failed kan ook betekenen dat een externe actie al heeft plaatsgevonden maar opslag daarna faalde.
Deze resultaten zijn geen leveringsbevestiging op de telefoon en geen persistente uitvoeringshistorie.

## Buiten deze versie

Geen automatische heraanbieding van ERROR, geen reset van ApplicationState of verzendblokkeringen, geen
testnotificatie, geen wijzigingsformulier voor herinneringsinstellingen en geen directe tijdzonewijzigingsknop.
Deze opties vereisen afzonderlijke functionele keuzes; de bestaande beschermingen blijven gelden.

## Uitrol en verificatie

Upload de broncode naar het bestaande gekoppelde project en heropen de Spreadsheet. Het manifest krijgt de
scope `script.container.ui`; bij gebruik van het zijpaneel kan opnieuw autorisatie nodig zijn. Deze toevoeging
vereist geen schema-upgrade en geen nieuwe Web App-versie voor het menu zelf. Eerdere nog niet uitgerolde
plancorrecties behouden wel hun eigen setup- en deploymentvereisten.

Lokale tests dekken menuhandlers, onafhankelijke diagnostiek, credentials, selectie op UUID, historie,
annuleren, containerwissel tijdens bevestiging, locks en batchresultaten. Live verificatie van menu,
zijpaneel, autorisatie en echte beheeracties gebeurt apart in een test-Spreadsheet na toestemming.

## Geraadpleegde Apps Script-contracten

- [Custom menus](https://developers.google.com/apps-script/guides/menus)
- [UI, zijpanelen en locks tijdens dialogen](https://developers.google.com/apps-script/reference/base/ui)
- [Accountgebonden geïnstalleerde triggers](https://developers.google.com/apps-script/guides/triggers/installable)
