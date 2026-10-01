---

name: implement-feature
description: Implementeer een feature of codewijziging in MQT Gig Sync binnen de bestaande architectuur. Gebruik deze skill wanneer de gebruiker vraagt functionaliteit te bouwen, wijzigen, repareren of implementeren.
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Implement feature

Implementeer de gevraagde wijziging gericht binnen de bestaande repository.

## Onderzoek

Bepaal vóór implementatie welke bestaande code relevant is.

Inspecteer waar nodig:

* de relevante implementatie;
* callers en afhankelijkheden;
* configuratie;
* datacontracten;
* bestaande tests;
* externe MQT-librarycontracten;
* relevante side effects.

Gebruik de daadwerkelijke implementatie als primaire bron voor bestaand gedrag; vertrouw niet uitsluitend op comments of JSDoc.

Onderzoek alleen repositoryonderdelen die nodig zijn voor de wijziging.

## Implementatie

Kies de kleinste oplossing die aan de requirements voldoet.

Tijdens implementatie:

* behoud bestaand gedrag buiten de gevraagde wijziging;
* hergebruik bestaande componenten en infrastructuur waar passend;
* volg de architectuur en stijl van het geraakte domein;
* behoud publieke interfaces waar mogelijk;
* wijzig alleen bestanden die voor de taak nodig zijn;
* vermijd niet-gerelateerde refactoring;
* introduceer geen nieuwe infrastructuur wanneer bestaande componenten het probleem voldoende ondersteunen.

Wanneer tijdens implementatie een grotere architectuur-, schema- of contractwijziging noodzakelijk blijkt die niet uit de opdracht volgt, leg de impact eerst aan de gebruiker voor.

## Tests

Voeg bij gewijzigd gedrag waar praktisch gerichte unit-tests toe of pas bestaande tests aan.

Gebruik voor het ontwerpen en uitvoeren van tests de daarvoor beschikbare test-skill.

## Verificatie

Controleer na implementatie waar relevant:

* gewijzigde code;
* callers;
* publieke contracten;
* configuratiereferenties;
* globale en stringgebaseerde referenties;
* tests.

Voer veilige relevante tests uit.

## Uitroladvies

Bepaal na iedere wijziging expliciet of een Web App-deployment nodig is. Controleer hiervoor de geraakte entrypoints en hun afhankelijkheden, inclusief gedeelde services, HTML, configuratie en het manifest.

* Alleen lokale documentatie gewijzigd: geen `clasp push` of Web App-deployment nodig.
* Alleen gedrag van triggers, het Spreadsheet-menu of de sidebar gewijzigd: `clasp push` volstaat. Vermeld waar nodig dat de Spreadsheet opnieuw moet worden geopend of autorisatie nodig is.
* Gedrag van de gedeployde Web App gewijzigd, direct of via gedeelde code: naast `clasp push` is een nieuwe versie van de bestaande Web App-deployment nodig. Behoud de bestaande URL, zodat links in eerdere notificaties blijven werken.

Vermeld eventuele aanvullende setup- of migratiestappen apart. Maak onderscheid tussen de huidige wijziging en eerdere wijzigingen die mogelijk nog niet zijn gedeployd; neem niet aan dat de remote versie gelijk is aan de lokale code.

Dit advies geeft geen toestemming om `clasp push` of een deployment uit te voeren; daarvoor blijft een expliciete opdracht van de gebruiker nodig.

## Resultaat

Rapporteer na afronding kort:

* wat is gewijzigd;
* welke bestanden zijn gewijzigd;
* welke tests zijn uitgevoerd;
* welke relevante tests niet zijn uitgevoerd en waarom;
* of `clasp push` volstaat, ook een Web App-deployment nodig is, of geen uitrol nodig is, met een korte reden;
* eventuele resterende risico's of benodigde handmatige verificatie.
