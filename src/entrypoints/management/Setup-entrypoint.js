/** Expliciete beheerhandeling: wijzigt de geconfigureerde Spreadsheet. */
function setupSpreadsheet() {
  return SpreadsheetSetup.run();
}

/** Expliciete beheerhandeling: installeert ontbrekende triggers voor dit account. */
function installMedicationTriggers() {
  return SpreadsheetSetup.installTriggers();
}
