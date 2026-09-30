/** Verwerkt uitsluitend aangeboden READY-schema's. */
function processReadySchedules() {
  ScheduleService.processReady();
}

/** Verstuurt eerste meldingen en maximaal het ingestelde aantal herhalingen. */
function processPendingIntakeNotifications() {
  NotificationService.processPending();
}

/** Expliciete beheerhandeling: wijzigt de geconfigureerde Spreadsheet. */
function setupSpreadsheet() {
  return SpreadsheetSetup.run();
}

/** Expliciete beheerhandeling: installeert ontbrekende triggers voor dit account. */
function installMedicationTriggers() {
  return SpreadsheetSetup.installTriggers();
}

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