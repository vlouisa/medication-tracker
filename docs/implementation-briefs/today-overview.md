# Implementation Brief — Vandaag-overzicht

Opgesteld: 2026-10-01. Status: uitgerold op **2026-10-01**, bevestigd door de gebruiker.

## Doel en akkoord

Een mobiel dagoverzicht van geplande, open, ingenomen en geannuleerde innamemomenten.
Het oorspronkelijke voorstel is goedgekeurd: toegang via de bestaande registratiepagina en het
Spreadsheet-menu, inclusief handmatig versturen van een Pushover-link. Automatische dagelijkse
overzichtsmeldingen vallen buiten deze versie.

## Gedrag

- De vaste Web App-route `?action=today` toont steeds de huidige dag in `Europe/Brussels`.
- Selectie gebeurt op de geplande datum (`ScheduledAt`), niet op de datum van registratie.
- Open: PENDING of NOTIFIED zonder CompletedAt. Ingenomen: COMPLETED of een geldige CompletedAt.
  Geannuleerd: CANCELLED zonder CompletedAt. Een gedeeltelijk opgeslagen registratie telt dus als ingenomen.
- Chronologische kaarten tonen tijd, medicatie, dosering, toedieningswijze en status; bij inname ook registratietijd.
- Tellingen en filters: Alles, Open, Ingenomen, Geannuleerd. Open momenten krijgen het label
  'Nog niet geregistreerd' of 'Later vandaag'.
- Registreren verloopt via de bestaande intakepagina met dezelfde locks, UUIDs en idempotentie.
  De link 'Naar Vandaag' blijft voor en na registratie zichtbaar, ook bij een geannuleerd moment.
- Vernieuwen en terugkeren naar de pagina lezen opnieuw; na middernacht wordt de nieuwe dag geselecteerd.
- Een leesfout wordt geen lege dag. Onleesbare records leveren een waarschuwing; een mislukte
  verversing laat het eerdere overzicht staan met een melding dat het verouderd kan zijn.
- Het menu biedt 'Vandaag-overzicht openen…' en 'Vandaag-link naar telefoon sturen…'. De laatste
  actie vraagt bevestiging en verzendt zonder automatische retry. Bij een onzekere uitkomst kan
  het bericht toch zijn aangekomen; nogmaals handmatig versturen kan een extra bericht opleveren.

## Architectuur en data

TodayService leest via SheetStore, gebruikt LocalTime en levert een JSON-geschikt paginamodel.
Today.html toont dit via een alleen-lezen Web App-callback. De service stelt ook het handmatige
linkbericht samen; PushoverClient verzorgt uitsluitend het transport.

Geen nieuwe Sheet-kolommen, properties, statussen of triggers. De huidige MYSELF-toegang blijft
behouden: ook op de telefoon moet het bijbehorende Google-account worden gebruikt.
Het overzicht genereert geen intakes en wijzigt geen operationele gegevens.

## Acceptatie en verificatie

Controleer daggrenzen en klokwisselingen, statusgroepen en tellingen, gedeeltelijke registraties,
plancorrecties, lege dagen, foutmeldingen, veilige tekstweergave, filters en opnieuw laden.
Bestaande notificatie- en registratietests blijven slagen. Controleer na uitrol handmatig de
mobiele weergave, Google-login en navigatie vanuit een medicatiemelding. Een echte verzendtest
vereist expliciete toestemming.

## Uitrol

Voer `clasp push` uit en werk de bestaande Web App-deployment bij naar een nieuwe versie,
met behoud van de bestaande URL. Heropen de Spreadsheet voor de menuopties.
Voor deze uitbreiding is geen setup of Sheet-migratie nodig.
