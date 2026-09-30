# Plancorrectie, reconciliation en schedule history

Opgesteld: **2026-09-30**. Status: lokaal geimplementeerd na akkoord; uitrol is een aparte beheerhandeling.
Bron: [oorspronkelijke brief](medication-plan-correction-original.md).

## Doel en gebruikersflow

Een gegenereerd plan kan expliciet worden gecorrigeerd zonder uitgevoerde innames of bestaande links te verliezen.
De gebruiker wijzigt de planvelden en kiest `READY_FOR_RECONCILIATION` in Google Sheets, ook op Android.
De bestaande `processReadySchedules`-trigger verwerkt het schema. Succes wordt `GENERATED`; fouten worden `ERROR`
met `LastError`. Een celwijziging op zichzelf start geen verwerking. Tijdens verwerking niet verder wijzigen.

Na ERROR wordt dezelfde soort opdracht opnieuw aangeboden: `READY` voor eerste generatie,
`READY_FOR_RECONCILIATION` voor correcties. Na gedeeltelijke verwerking moet eerst het aangeboden doelplan worden
hersteld; een ander plan wordt niet met de lopende toepassing gemengd. Een harde onderbreking of het bereiken
van het uitvoeringsbudget laat de aangeboden status staan zodat de volgende trigger kan hervatten.

## Goedgekeurde domeinregels

Functionele identiteit blijft `ScheduleID + ScheduledAt`; de UUID is de identiteit voor registratielinks.
`MedicationPlan.normalize` en `MedicationPlan.moments` worden gedeeld door generatie en reconciliation.
De volledige invoer, klokwisselingen en bestaande intake-integriteit worden gecontroleerd voor intakewrites.
Alle momenten gebruiken de bestaande tijdzone Europe/Brussels.

| Situatie | Verwerking |
|---|---|
| Bestaand PENDING-moment blijft gewenst | UUID behouden; medicatie, dosering en toediening bijwerken |
| Bestaand NOTIFIED-moment blijft gewenst | Snapshot en verzendhistorie behouden, ook voor herhalingen |
| PENDING met NotificationBlockedAt | Snapshot behouden: de vorige poging kan al bezorgd zijn |
| PENDING/NOTIFIED-moment vervalt | CANCELLED; geen verwijdering of reset van verzendgegevens |
| COMPLETED of CompletedAt gevuld | Volledig behouden, ook bij gedeeltelijk opgeslagen completion |
| Ontbrekend gewenst moment vanaf het starttijdstip | Nieuwe PENDING-intake met UUID |
| Ontbrekend gewenst moment voor het starttijdstip | Overslaan bij reconciliation; het plan zelf staat volledig in history |
| CANCELLED-moment wordt opnieuw gewenst en ligt vanaf het starttijdstip | Zelfde UUID reactiveren; NOTIFIED als NotifiedAt bestaat, anders PENDING |
| CANCELLED-moment in het verleden wordt opnieuw gewenst | CANCELLED behouden |

Het starttijdstip wordt duurzaam bewaard en verandert niet bij retries. Precies op de grens geldt als niet verstreken.
Reactivatie behoudt notificatietellers, tijdstippen en blokkeringen. Een niet-geblokkeerde PENDING-reactivatie krijgt
de nieuwe snapshot; een NOTIFIED-reactivatie behoudt de oude snapshot. Er ontstaan geen dubbele functionele sleutels.

Initiële generatie behoudt het eerdere gedrag voor momenten in het verleden. Een correctie met dezelfde
genormaliseerde inhoud maakt geen extra history-versie. A -> B -> A levert wel drie toegepaste versies op.
SKIPPED/MISSED blijven gereserveerd; reconciliation stopt bij deze onverwachte statussen voor handmatig onderzoek.

## Completion en notificaties

`CANCELLED` krijgt geen meldingen. Bestaande NOTIFIED-intakes blijven volgens de ingestelde limiet en interval
herinneringen krijgen; dit verduidelijkt de afwijkende passage in de oorspronkelijke brief.
Notificaties vereisen `GENERATED` en een lege `ApplicationState`.

Een oude link opent ook een CANCELLED-intake. De pagina vermeldt dat het geplande moment is vervallen en laat
registratie van een daadwerkelijke inname toe. GET schrijft niets. Bevestigen geeft `CANCELLED -> COMPLETED`;
ScheduledAt blijft gelijk. Herhaalde registratie behoudt het eerste CompletedAt. Een eventueel nieuw vervangend
moment wordt niet automatisch voltooid. Er is geen medische interpretatie van de relatie tussen beide innames.

## Architectuur en herstel

- `IntakeReconciliation` berekent wijzigingen zonder Google-services of side effects.
- `ScheduleService` selecteert aangeboden schema's en isoleert fouten per schema.
- `ScheduleApplication` past het doelplan toe en bewaakt herstel en history.
- `SheetStore` verzorgt headergestuurde reads/writes en het hervatten van nieuwe rijen.
- `ProcessingSupport.locked` wordt gedeeld met completion en notificaties.

Het nieuwe system-managed scheduleveld `ApplicationState` bevat JSON: toepassings-UUID, history-UUID,
doelplan, hash, modus, versie, starttijdstip, fase en hooguit een nog af te maken intake. De cel bevat geen secrets.
Het volledige plan past binnen een Sheet-cel; het wordt niet in de kleiner begrensde Script Properties opgeslagen.
Geen extra statusdimensie op intakes of intake-auditlog.

Verwerkingsvolgorde onder het scriptlock:

1. Valideer het volledige plan en bepaal het verwachte schema en de wijzigingsset.
2. Leg ApplicationState duurzaam vast voordat intakes veranderen.
3. Werk bestaande intakes bij en voeg ontbrekende toe. Controleer het uitvoeringsbudget tussen records.
4. Lees de eindtoestand opnieuw en controleer dat geen benodigde mutaties ontbreken.
5. Bewaar de fase `history` en het toepassingstijdstip in ApplicationState.
6. Leg de history-snapshot vast; werk de planvingerafdruk bij.
7. Zet het schema op GENERATED en wis daarna ApplicationState.

Nieuwe intake-UUIDs staan voor de write in ApplicationState. In de doeltabel wordt eerst die UUID gereserveerd,
daarna worden velden geschreven en als laatste Status. Een retry maakt een onvolledige rij met dezelfde UUID af.
Een ondertussen uitgevoerde intake wordt nooit overschreven. Gedeeltelijke wijzigingen van bestaande intakes
worden opnieuw uit het doelplan berekend. Een bezet lock stopt de batch zonder recordfout.

Completion tussen twee pogingen heeft voorrang: reconciliation leest opnieuw onder hetzelfde lock en behoudt
COMPLETED en CompletedAt. Locks blokkeren geen handmatige Sheet-edits; het plan wordt daarom tijdens verwerking
en voor afronding opnieuw gecontroleerd. Technische velden en history mogen niet handmatig worden gewijzigd.

## Schedule history

Nieuw system-managed tabblad: `medication-schedule-history`.

```text
ID, ScheduleID, Version, Medication, Dosage, Administration,
StartDate, DurationDays, Times, ApplicationID, RecordedAt
```

Planvelden zijn genormaliseerd, StartDate is yyyy-MM-dd en Times is een komma-gescheiden lijst van HH:mm.
ID en ApplicationID zijn UUIDs. Version loopt per schema vanaf 1 op. RecordedAt is het moment waarop de
intake-eindtoestand is gecontroleerd. Geen LastError of tijdelijke schedule-status in de snapshot.

Een snapshot wordt alleen geschreven nadat de intakeverwerking succesvol is gecontroleerd. ID wordt eerst
gereserveerd; RecordedAt wordt als laatste geschreven en markeert de gepubliceerde, onveranderlijke snapshot.
Bij een schrijffout kan tijdelijk een onvolledige history-rij zonder RecordedAt zichtbaar zijn. Dit is geen
gepubliceerde versie. Alleen deze rij wordt bij een retry afgemaakt; gepubliceerde rijen worden nooit gewijzigd.
De algemene SheetStore.patch weigert history-writes.

Als history al is gepubliceerd maar de laatste schedule-write faalt, blijft die ene versie bestaan en rondt
de retry dezelfde toepassing af. Deze precisering is noodzakelijk omdat Sheets geen transacties heeft.
Een fout tijdens validatie of intakeverwerking publiceert geen history. ApplicationID en de opgeslagen UUIDs
voorkomen dubbele versies bij hervatten; alleen 'hoogste versie + 1' is niet voldoende.

Bestaande plannen van voor deze uitbreiding blijven geldig. Hun eerdere toestand wordt niet achteraf verzonnen:
de eerste succesvolle correctie is versie 1 van de vastgelegde historie. Nieuwe plannen krijgen versie 1 bij
hun eerste generatie. DRAFT-wijzigingen worden niet vastgelegd.

## Setup en uitrol

`setupSpreadsheet` voegt uitsluitend de bekende nieuwe schedulekolom ApplicationState toe, maakt de history-tab
en stelt bescherming, statuskeuze, notities, datum-/nummeropmaak en statuskleuren in. Bestaande kolommen en data
blijven behouden. Andere ontbrekende verplichte headers blijven fouten. Herhaalde setup dupliceert geen regels.

Voor uitrol: broncode uploaden, setup uitvoeren en de bestaande Web App-deployment op een nieuwe versie zetten,
zodat bestaande links dezelfde URL behouden. Doe dit in een beheerd uitrolmoment; oude Web App-code kent CANCELLED
niet. Geen nieuwe trigger nodig. Zie [beheerhandleiding](../medication-tracker-setup.md).

## Verificatie

Lokale tests gebruiken uitsluitend de Apps Script-mocks en doen geen externe writes. Ze dekken de oorspronkelijke
v1-flow, scenario's A-H uit de brief, snapshots, verleden/toekomst, reactiveren, dubbel aanbieden, legacy-data,
gedeeltelijke intake/history/statuswrites, completion tijdens herstel, lockconflicten en setupmigratie.
Technische logs gebruiken eventcodes, UUIDs, versie en aantallen; geen medicatie-inhoud of ruwe providerantwoorden.
`schedule_application_batch` beschrijft de nog benodigde mutaties van die poging; bij herstel zijn dit geen
cumulatieve aantallen van alle eerdere pogingen. `schedule_applied` bevestigt de afgeronde toepassing.
Apps Script-uitrol, Android-weergave en echte Pushover-bezorging moeten afzonderlijk in een testomgeving worden geverifieerd.
