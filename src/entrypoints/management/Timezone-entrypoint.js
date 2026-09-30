function checkTimezones() {
  const id = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  const spreadsheet = SpreadsheetApp.openById(id);

  console.log('Project: ' + Session.getScriptTimeZone());
  console.log('Spreadsheet: ' + spreadsheet.getSpreadsheetTimeZone());
}

function setSpreadsheetTimezoneToBrussels() {
  const id = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  const spreadsheet = SpreadsheetApp.openById(id);

  spreadsheet.setSpreadsheetTimeZone('Europe/Brussels');
  SpreadsheetApp.flush();

  console.log('Spreadsheet: ' + spreadsheet.getName());
  console.log('Tijdzone: ' + spreadsheet.getSpreadsheetTimeZone());
}
