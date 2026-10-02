# Designreview: application- en use-case-laag

Datum: 2026-10-02

Scope: `src/application/`, met relevante entrypoints, domeinregels en infrastructuur als context.

Dit is een statische designbeoordeling. Er is geen applicatiecode gewijzigd en er zijn geen tests of productieacties uitgevoerd. De aanbevelingen zijn nog niet geïmplementeerd.

## Algemene beoordeling

De application/use-case-laag heeft een goede, pragmatische basis. De services vertegenwoordigen herkenbare gebruikersacties en processen, terwijl belangrijke domeinregels apart staan. Het advies is vooral om bestaande grenzen en herstelcontracten duidelijker te maken. Een nieuwe architectuur is hiervoor niet nodig.

## Wat al goed is

- **Dunne entrypoints.** De [trigger-entrypoints](../../src/entrypoints/triggers/Triggers-entrypoint.js) delegeren direct aan application-services. Daardoor staat de verwerking op een herkenbare plek.
- **Scheiding tussen regels en uitvoering.** [CompletionService](../../src/application/CompletionService.js) laat `IntakeRules.completion` bepalen welke wijziging toegestaan is en verzorgt zelf locking en opslag. Dit is een duidelijk voorbeeld van hoe de application-laag hoort te werken.
- **Bewuste omgang met gedeeltelijke verwerking.** [ScheduleApplication](../../src/application/ScheduleApplication.js) bewaart voortgang en gereserveerde UUID's, publiceert historie na intakecontrole en verwijdert herstelgegevens pas na afronding. Die complexiteit heeft een concrete reden en moet behouden blijven.
- **Veilige notificatieflow.** [NotificationService](../../src/application/NotificationService.js) legt vóór verzending een blokkering vast. Ook wordt onderscheid gemaakt tussen een geaccepteerd bericht en een volledig opgeslagen resultaat.
- **Passende modules.** Het IIFE-patroon met expliciete publieke functies past bij deze Apps Script-applicatie. Extra serviceclasses, interfaces of dependency-injectioncontainers zouden momenteel weinig toevoegen.

## Verbeteradviezen

### 1. [Hoog] Maak de fasen van planverwerking duidelijker zichtbaar

**Probleem:** in [ScheduleApplication.apply](../../src/application/ScheduleApplication.js) staan herstelvalidatie, intake-updates, intakecreatie, volledigheidscontrole en publicatie in één functie.

**Waarom:** een wijziging aan deze flow vereist kennis van vrijwel alle herstelvoorwaarden en de exacte writevolgorde. Daardoor is dit het gevoeligste onderdeel voor onderhoud.

**Advies:** benoem enkele samenhangende stappen met interne helpers, bijvoorbeeld `validateApplicationState_`, `applyIntakeChanges_` en `publishApplication_`. Houd de hoofdflow en writevolgorde zichtbaar. Documenteer per fase wat al duurzaam opgeslagen is en wat bij hervatten opnieuw mag gebeuren.

**Pattern:** geen nieuw pattern nodig. De bestaande journal-aanpak is zinvol; een algemeen workflowframework of klassiek State-pattern zou extra complexiteit introduceren.

### 2. [Middel] Verduidelijk het gedeelde expiry-contract

**Probleem:** [ScheduleExpiryService](../../src/application/ScheduleExpiryService.js) exposeert naast use-cases ook `context`, `stateFor`, `ensure` en `assertActionable`. [ScheduleContinuationService](../../src/application/ScheduleContinuationService.js) gebruikt deze bouwstenen om zelf een workflow samen te stellen.

**Waarom:** de juiste aanroepvolgorde en lockvoorwaarden zijn daarmee verdeeld over twee modules. Vooral `ensure` vereist dat de caller al het gedeelde scriptlock bezit.

**Advies:** documenteer eerst expliciet welke functies use-cases zijn en welke gedeelde bouwstenen. Als deze samenwerking verder groeit, overweeg dan één kleine expiry-lifecyclemodule voor de gedeelde context en statebewaking. Laat de externe use-casefuncties intact.

**Pattern:** een kleine gedeelde module overwegen; nu geen brede facade of nieuwe servicelaag toevoegen.

### 3. [Middel] Scherm technische beheerdiagnostiek beter af

**Probleem:** [ManagementService.status](../../src/application/ManagementService.js) gebruikt rechtstreeks `Session`, `ScriptApp` en een Spreadsheet-object. Dezelfde functie leest gegevens, beoordeelt problemen en bouwt het rapport.

**Waarom:** de application-service moet hierdoor ook Google-specifieke trigger- en Spreadsheetdetails kennen.

**Advies:** laat infrastructuurfuncties eenvoudige waarden teruggeven, zoals de projecttijdzone, Spreadsheet-tijdzone en aantallen kloktriggers. Houd de beoordeling en rapportopbouw in `ManagementService`. Splits eventueel de configuratiechecks en recorddiagnoses in enkele interne helpers.

**Pattern:** de bestaande adaptergrens uitbreiden is voldoende; geen interface per Google-service nodig.

### 4. [Middel] Maak batchresultaten explicieter

**Probleem:** de batchservices bieden dezelfde resultaatvelden, maar hanteren verschillende limieten:

- [ScheduleService](../../src/application/ScheduleService.js) begrenst het aantal kandidaten;
- [NotificationService](../../src/application/NotificationService.js) begrenst verzendpogingen;
- [ScheduleExpiryService](../../src/application/ScheduleExpiryService.js) begrenst `processed + failed`.

Ook retourneert notificatieverwerking intern zowel `false` als `{ succeeded: boolean }`.

**Waarom:** vergelijkbare contracten suggereren dezelfde betekenis, terwijl bijvoorbeeld `batchSize` per proces anders werkt.

**Advies:** documenteer per service wat de limiet en tellingen betekenen. Gebruik intern bij voorkeur expliciete uitkomsten zoals `processed`, `skipped` en `failed`, zoals de andere processors al doen. Behoud bestaand batchgedrag tenzij een functionele wijziging expliciet wordt gevraagd.

**Pattern:** geen generieke batchrunner nodig. De verschillen tussen de workflows rechtvaardigen voorlopig afzonderlijke loops.

### 5. [Middel] Houd tijdelijke rijselectie binnen de infrastructuur

**Probleem:** [ScheduleService.processOne_](../../src/application/ScheduleService.js) zoekt schema's zonder UUID via `_row` en kent daarmee een technische Sheet-locatie.

**Waarom:** de application-laag moet nu begrijpen hoe een nog niet geïdentificeerd record opnieuw wordt gevonden.

**Advies:** verplaats dit naar een gerichte storefunctie voor het opnieuw lezen en identificeren van een nieuw schema. Behoud de UUID als functionele identiteit. Het tijdelijke gebruik van een rijnummer is hier op zichzelf begrijpelijk; vooral de plaats ervan kan beter.

**Pattern:** de bestaande storegrens gebruiken; geen nieuw pattern nodig.

## Aanbevolen volgorde

1. Maak de herstelworkflow van `ScheduleApplication` beter leesbaar, met behoud van writevolgorde en hervatbaarheid.
2. Verduidelijk het gedeelde expiry-contract en de lockvoorwaarden.
3. Pak batchcontracten en infrastructuurdetails aan.

Behoud de huidige modules en domeinscheiding. Introduceer geen abstraheringen uitsluitend voor uniformiteit.

## Gebruikte skill en bijzonderheden

Gebruikte lokale skill voor deze beoordeling: [code-design-advisor](../../skills/code-design-advisor/SKILL.md).

De beoordeling is gebaseerd op broncode-inspectie; er is geen onafhankelijke review door een tweede agent uitgevoerd.
