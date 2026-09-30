/**
 * Expliciete beheerhandeling: configureert tabs, validatie en opmaak van de Spreadsheet.
 * @returns {{configured: boolean}|{busy: boolean}} Resultaat van SpreadsheetSetup.run.
 * @throws {Error} Bij configuratie-, structuur-, tijdzone- of schrijffouten.
 */
function setupSpreadsheet() {
  return SpreadsheetSetup.run();
}

/**
 * Expliciete beheerhandeling: installeert ontbrekende triggers en verwijdert duplicaten voor dit account.
 * @returns {{installed: boolean}|{busy: boolean}} Resultaat van SpreadsheetSetup.installTriggers.
 * @throws {Error} Bij ongeldige configuratie/tabellen of fouten in triggerbeheer.
 */
function installMedicationTriggers() {
  return SpreadsheetSetup.installTriggers();
}
