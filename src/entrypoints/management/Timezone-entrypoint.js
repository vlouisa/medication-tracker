/**
 * Leest project- en Spreadsheet-tijdzone en schrijft beide naar het uitvoeringslog.
 * @returns {void}
 * @throws {Error} Als de Spreadsheet uit SPREADSHEET_ID niet kan worden geopend.
 */
function checkTimezones() {
  const id = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  const spreadsheet = SpreadsheetApp.openById(id);

  console.log('Project: ' + Session.getScriptTimeZone());
  console.log('Spreadsheet: ' + spreadsheet.getSpreadsheetTimeZone());
}

/**
 * Expliciete beheerhandeling: wijzigt de Spreadsheet-tijdzone naar Europe/Brussels en flusht.
 * Controleert bestaande datums niet; de beheerder moet de gevolgen voor aanwezige data vooraf beoordelen.
 * @returns {void}
 * @throws {Error} Als de Spreadsheet niet kan worden geopend of gewijzigd.
 */
function setSpreadsheetTimezoneToBrussels() {
  const id = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  const spreadsheet = SpreadsheetApp.openById(id);

  spreadsheet.setSpreadsheetTimeZone('Europe/Brussels');
  SpreadsheetApp.flush();

  console.log('Spreadsheet: ' + spreadsheet.getName());
  console.log('Tijdzone: ' + spreadsheet.getSpreadsheetTimeZone());
}
