# AGENTS.md

## Project

Deze repository bevat de Google Apps Script-applicatie voor **Medication Tracker**.

Google Sheets is de administratieve bron voor medicatieschema's en geplande innamemomenten. De applicatie genereert innamemomenten vanuit medicatieschema's, verstuurt notificaties en registreert de uitvoering van innamemomenten.

Iedere deployment en bijbehorende Google Spreadsheet is gekoppeld aan één persoon.

Beschouw de repository als bron van waarheid voor actuele structuur en gedrag.

---

## Kernregels

Behoud bestaand gedrag tenzij de gevraagde wijziging dit expliciet verandert.

Wijzig geen niet-gerelateerde code, publieke contracten, Sheet-schema's of statusovergangen als onderdeel van een andere wijziging.

Introduceer geen nieuwe architectuurpatronen uitsluitend voor uniformiteit.

Introduceer geen multi-userfunctionaliteit zonder expliciete functionele noodzaak.

---

## Runtime

Dit is een **Google Apps Script V8**-project.

De Apps Script-broncode en `appsscript.json` bevinden zich onder `src/`. Beschouw `src/` als de root van de Apps Script-applicatie.

Ga er niet vanuit dat Node.js- of browser-API's tijdens de Apps Script-runtime beschikbaar zijn.

Globale entrypoints kunnen door Apps Script bij naam worden aangeroepen, bijvoorbeeld vanuit geïnstalleerde triggers of als Web App-entrypoint.

Mappen vormen binnen Apps Script geen JavaScript-namespaces.

Voor geïsoleerde unit-tests kan lokale Node.js-tooling worden toegevoegd of gebruikt wanneer dat voor de taak relevant is.

---

## Architectuur

De applicatie gebruikt een domeingerichte architectuur.

De Apps Script-broncode onder `src/` wordt primair ingedeeld naar architecturale verantwoordelijkheid:

```text
src/
├── domain/
├── application/
├── infrastructure/
├── entrypoints/
└── appsscript.json
```

Gebruik de mappen als volgt:

- `domain/` — domeinmodellen, domeinregels en logica die onafhankelijk van Google Sheets, triggers en externe API's kan bestaan;
- `application/` — use-cases en services die domeinlogica orkestreren;
- `infrastructure/` — technische implementaties voor onder andere Google Sheets, notificaties, Script Properties en andere externe systemen;
- `entrypoints/` — globale Apps Script-entrypoints voor triggers en Web App-verkeer die application-services aanroepen.

Maak binnen deze hoofdmappen alleen submappen wanneer daar een concrete functionele of technische reden voor bestaat.

Introduceer geen mappen of abstractielagen uitsluitend voor toekomstige uitbreidingen of architecturale symmetrie.

Houd domeinlogica waar mogelijk onafhankelijk van Google Apps Script-services zoals `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService` en `LockService`.

Sheet-persistence, notificaties en andere externe integraties horen niet thuis in het domeinmodel.

Services gebruiken een IIFE-gebaseerd modulepatroon met een expliciet publiek return-object. Afhankelijkheden worden via globale namen gebruikt, tenzij de bestaande implementatie voor het betreffende onderdeel bewust een ander patroon hanteert.

De mapstructuur is uitsluitend een indeling van de lokale broncode. Mappen vormen binnen Google Apps Script geen JavaScript-namespaces of modulegrenzen.

Technische logging en voor de gebruiker relevante foutregistratie worden gescheiden gehouden.

---

## Sheets en gegevensbeheer

Google Sheets bevat operationele data en vormt een belangrijk applicatiecontract.

Gebruik headergestuurde toegang tot Sheet-data.

Centraliseer configuratiewaarden wanneer meerdere onderdelen daarvan afhankelijk zijn.

Wijzigingen aan Sheet-headers, statussen en statusovergangen zijn potentieel breaking.

Respecteer het onderscheid tussen user-managed en system-managed gegevens.

Gebruik UUID's als functionele identifiers. Gebruik Sheet-rijnummers niet als persistente of externe identifiers.

Datum- en tijdwaarden kunnen verschillende betekenissen hebben. Controleer de bestaande semantiek en timezone voordat datum- of tijdlogica wordt gewijzigd.

---

## Side effects en foutafhandeling

Behoud bij verwerking waar mogelijk isolatie per record.

Houd rekening met externe side effects op Sheets, notificaties, externe API's, Web App-verwerking, caches en andere persistente toestand.

Introduceer retrygedrag alleen nadat risico's op dubbele side effects zijn geanalyseerd.

Houd rekening met overlappende trigger-executions en voorkom dat retries of concurrency leiden tot dubbele persistente side effects.

---

## Secrets

Hardcode, log, commit of toon nooit credentials, API-keys, OAuth-tokens of andere secrets.

Gebruik veilige configuratiemechanismen zoals Script Properties.

Lees, toon, kopieer of wijzig `.clasprc.json` niet.

Neem echte credentials niet op in tests, fixtures, prompts, documentatie of foutmeldingen.

---

## Veilig testen

Voer nooit zonder expliciete toestemming tests of diagnostische functies uit die mogelijk productiegegevens of externe toestand wijzigen, waaronder Sheets, notificaties, externe API's, Web App-data, caches of andere persistente toestand.

Een functie met `test` in de naam is niet automatisch veilig. Inspecteer bij twijfel eerst de test en zijn afhankelijkheden.

---

## Git en deployment

Voer geen `git commit`, `git push`, `clasp push`, `clasp deploy`, `clasp redeploy` of andere remote- of deploymenthandeling uit zonder expliciete opdracht van de gebruiker.

---

## Codestijl

Volg de stijl van bestaande bestanden wanneer die aanwezig is. Gebruik anders de onderstaande conventies als uitgangspunt.

Belangrijke conventies:

- Engelse identifiers;
- JavaScript-bestanden die globale Apps Script-entrypoints definiëren, hebben een bestandsnaam die eindigt op `-entrypoint.js` (bijvoorbeeld `WebApp-entrypoint.js`);
- voornamelijk Nederlandse comments en JSDoc;
- `camelCase` voor functies en variabelen;
- `PascalCase` voor klassen;
- `UPPER_SNAKE_CASE` voor constanten en statussen;
- afsluitende `_` voor interne helperfuncties waar dit patroon wordt gebruikt;
- JSDoc voor relevante publieke contracten en foutvoorwaarden.

### Functiedocumentatie

Gebruik Nederlandse JSDoc bij publieke modulefuncties en globale Apps Script-entrypoints. Documenteer interne helpers wanneer hun gedrag of voorwaarden niet vanzelfsprekend zijn.

- Beschrijf de verantwoordelijkheid van de functie en gebruik `@param`, `@returns` en waar relevant `@throws` met passende types.
- Benoem relevante voorwaarden en side effects, zoals Sheet-writes, notificaties, locks, tijdzones, idempotentie en mogelijke gedeeltelijke verwerking.
- Houd de documentatie in overeenstemming met de implementatie: voeg bij nieuwe functies passende JSDoc toe en werk die bij wanneer een functiecontract verandert.
- Houd de uitleg beknopt; herhaal geen vanzelfsprekende implementatiedetails.

Voer geen formatting-only wijzigingen uit in bestanden die niet bij de taak betrokken zijn.

---

## Reporting

Wanneer je een taak uitvoert:

- vermeld aan het einde welke lokale skills je hebt gebruikt;
- vermeld alleen skills die je daadwerkelijk hebt ingelezen/toegepast;
- als geen skill is gebruikt, vermeld dat expliciet;
- noem kort relevante bijzonderheden, zoals mislukte commando's, retries, ontbrekende tooling of een independent review.
