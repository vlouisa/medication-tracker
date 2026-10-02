# Schedule expiry en vervolgplan

Opgesteld: **2026-10-02**. Status: lokaal geïmplementeerd na akkoord; nog niet uitgerold.
Bron: [oorspronkelijke brief](schedule-expiry-original.md), ontvangen op 2026-10-02.

## Doel en besluiten

Herinner aan het naderende of verstreken einde van een toegepast medicatieplan en laat de gebruiker
expliciet kiezen: een nieuw plan klaarzetten of geen nieuw plan nodig. De applicatie geeft geen medisch
advies en verlengt of activeert nooit zelfstandig een plan.

- Bron is uitsluitend de laatste gepubliceerde versie in `medication-schedule-history` (hoogste Version
  met RecordedAt). De huidige schemarij bepaalt alleen of de verwerking is toegestaan: GENERATED en
  een lege ApplicationState. Niet-toegepaste wijzigingen beïnvloeden expiry niet.
- De gebruiker heeft bevestigd dat de vier besproken oudere schema's handmatig van history zijn
  voorzien. Er komt geen aparte backfill-beheeractie. Ontbreekt elders history, dan wordt geen versie
  verzonnen. Beheerstatus meldt ingeschakelde expiry zonder history.
- ExpiryReminderDaysBefore is user-managed: leeg/0 schakelt uit; 1..365 is toegestaan, ook langer dan de
  planduur. Wijzigingen op een toegepast plan lopen via READY_FOR_RECONCILIATION.
- De laatste plandag komt uit MedicationPlan.moments. Alle dagvergelijkingen gebruiken Europe/Brussels
  en kalenderdagen; geen verschuiving met een vast aantal verstreken uren.
- Threshold: laatste plandag minus de voorwaarschuwing. Tot en met laatste plandag +7 zijn reminders
  toegestaan. Vanaf +8 is ReminderStatus EXPIRED, terwijl DecisionStatus OPEN blijft.
- Een volledig gemist window krijgt bij eerste verwerking OPEN/EXPIRED, zonder notificatie.
- Een actuele open beslissing kan ook na de reminderperiode worden afgehandeld.
- Het verstrijken van bestaande reminderperiodes wordt ook verwerkt voor eerdere versies of schema's
  die tijdelijk niet GENERATED zijn. Dit verandert uitsluitend ReminderStatus en legt geen keuze vast.

## Notificaties

Een afzonderlijke trigger `processScheduleExpiryNotifications` controleert iedere vijftien minuten.
`EXPIRY_REMINDER_START_HOUR` bepaalt het eerste lokale verzenduur: standaard 8, toegestane waarden 0..23.
Er is geen garantie op een exact aflevermoment. Een latere trigger mag dezelfde dag alsnog verzenden.

Per schema-versie wordt maximaal één poging per lokale kalenderdag gereserveerd. Onder het gedeelde
scriptlock wordt LastReminderAttemptAt als eerste veld opgeslagen en geflusht, vóór Pushover. Ook bij
een fout of onzekere verzending volgt die dag geen retry. Een onderbreking vóór de netwerkaanroep kan
daardoor een melding overslaan. De volgende dag is opnieuw toegestaan binnen de periode.

Een succesvolle verzending of het openen van een pagina is geen gebruikerskeuze. De beslissing blijft OPEN.
Vóór de laatste plandag luidt het bericht 'loopt bijna af', op de dag zelf 'eindigt vandaag', daarna
'is afgelopen'. PushoverClient blijft uitsluitend transport verzorgen.

## Keuzepagina en vervolgplan

GET `?action=schedule-expiry&id=<UUID>&version=<versie>` leest alleen. Nieuwe mutaties gebruiken POST
met actiegebonden, ondertekende formulierbewijzen. Deze zijn 24 uur geldig en vervangen de bestaande
MYSELF-toegangscontrole niet. Het formuliergeheim wordt uitsluitend tijdens setup aangemaakt.

Oude versies zijn alleen-lezen. Tijdens een aangeboden/onafgeronde correctie zijn keuzes geblokkeerd.
Een nieuwe versie heeft een eigen lifecycle en neemt eerdere beslissingen niet over.

Een nieuw vervolgplan krijgt een nieuwe UUID, DRAFT en een eigen CreatedAt/UpdatedAt. De voorstelvelden
komen uit de bronversie. StartDate is de dag na de laatste plandag bij een keuze vóór of op die dag;
bij een latere keuze blijft StartDate leeg. SourceScheduleID en SourceScheduleVersion leggen de bron vast.
Het plan maakt pas intakes na expliciete aanbieding via READY en succesvolle bestaande planvalidatie.

Geen nieuw plan nodig vraagt expliciete bevestiging. Een handmatig gemaakt plan wordt niet automatisch
herkend of gekoppeld. Eerdere vervolgplannen uit oudere versies worden getoond maar nooit veranderd of
geclaimd; de gebruiker kiest opnieuw. Er bestaat geen reopen-flow voor een afgeronde beslissing.

## Persistence en herstel

Nieuwe schedulekolommen: ExpiryReminderDaysBefore, SourceScheduleID, SourceScheduleVersion.
Nieuwe historykolom: ExpiryReminderDaysBefore. Bestaande history blijft leeg voor dit veld.

Nieuw system-managed tabblad `medication-schedule-expiry`:

```text
ID, ScheduleID, ScheduleVersion, DecisionStatus, ReminderStatus, LastReminderAttemptAt,
ResolvedAt, Resolution, ContinuationScheduleID, CreatedAt, UpdatedAt, LastError, ResolutionState
```

Een stabiele UUID afgeleid van schema + versie maakt het aanmaken van expiry-state hervatbaar,
zelfs als alleen de eerste ID-write is opgeslagen. CreatedAt publiceert de volledig geïnitialiseerde state.

Bij een keuze wordt eerst ResolutionState geschreven: oorspronkelijke keuze, keuzetijdstip en bij
continuation de gereserveerde UUID plus het volledige voorstel. Daarna wordt de DRAFT hervatbaar
opgeslagen, met ID eerst en Status als laatste. Pas na teruglezen worden de resolutionvelden geschreven;
DecisionStatus RESOLVED komt als laatste. Het herstelbewijs blijft bewaard en wordt niet naar de browser
gestuurd. ContinuationScheduleID blijft leeg totdat een vervolgplan volledig bestaat.

Een identieke retry behoudt UUID en ResolvedAt; een conflicterende keuze wordt afgewezen. Een al
gepubliceerd vervolgplan wordt niet overschreven, ook als de gebruiker het inmiddels heeft bewerkt.
Onderbreking over middernacht verandert het eerder gereserveerde startdatumvoorstel niet.

Bij een onvoltooide keuze herhaalt de gebruiker dezelfde actie vanuit de actuele herinneringslink.
Rond deze keuze af voordat u het bronplan corrigeert. Een inmiddels oude link krijgt ook bij een
onafgeronde keuze geen schrijfrechten terug. Handmatige wijzigingen aan systeemvelden en automatisch
herstel van daardoor ontstane inconsistenties vallen buiten scope.

Uitgeschakelde expiry ontbreekt in de genormaliseerde JSON, zodat bestaande hashes en oude
ApplicationState-records geldig blijven. Leeg en 0 zijn inhoudelijk gelijk. Alleen positieve expiry
maakt onderdeel uit van de hash. Een inhoudelijke wijziging creëert een history-versie, ook wanneer
intakes ongewijzigd blijven.

## Architectuur

- Domain: MedicationPlan-validatie en ScheduleExpiryRules voor datums, eligibility en keuzes.
- Application: ScheduleHistory deelt gepubliceerde versieselectie; ScheduleExpiryService verwerkt
  reminders; ScheduleContinuationService behandelt expliciete keuzes; MedicationNotification maakt berichten.
- Infrastructure: SheetStore verzorgt hervatbare writes; Config en SpreadsheetSetup verzorgen schema
  en configuratie; ExpiryFormToken beschermt de POST-formulieren.
- Entrypoints: dunne kloktrigger en GET/POST-routing met de mobiele ScheduleExpiry.html.
- Beheerstatus en inspectie tonen expiry-configuratie, trigger, fouten, open/verlopen beslissingen en
  onafgeronde afhandeling zonder ruwe herstelgegevens of geheimen te tonen.

## Tests

Lokale tests dekken de oorspronkelijke acceptatiecriteria, inclusief klokwisselingen, dag +7/+8,
oude links, dagelijkse poginglimiet, notificatiefouten, expliciete bevestiging, idempotentie,
tegenstrijdige keuzes en onderbrekingen bij iedere write/flush van de beslisflow. Migratietests
controleren behoud van operationele cellen, oude hashes en onafgeronde history-publicatie.
Er worden geen echte Sheets of notificaties gebruikt.

## Uitrol

Setup gebruikt voor de expiry-invoer een validatieformule zonder argumentscheidingen. De eerdere
formule met komma's werd tijdens de gemelde uitrol door Sheets afgewezen. Na upload van de correctie
kan setup opnieuw worden uitgevoerd; reeds toegevoegde kolommen en operationele gegevens blijven behouden.

1. Upload via clasp push tijdens een beheerd uitrolmoment.
2. Voer setupSpreadsheet uit: bekende nieuwe kolommen en de expiry-tab worden toegevoegd, plus
   een formuliergeheim in Script Properties. Er worden geen beslissingen of vervolgplannen gemaakt.
3. Werk de bestaande Web App-deployment bij naar een nieuwe versie, met dezelfde URL en MYSELF-toegang.
4. Voer installMedicationTriggers uit voor de extra trigger; bestaande triggers blijven behouden.
5. Schakel expiry per schema in door de volledige invoer te controleren en READY_FOR_RECONCILIATION
   aan te bieden. Bestaande lege configuratie blijft uitgeschakeld.
6. Controleer na aparte toestemming in een testomgeving mobiele login, POST, Pushover en herstel.

Geen productiehandelingen of deployment maken deel uit van de lokale implementatie.
