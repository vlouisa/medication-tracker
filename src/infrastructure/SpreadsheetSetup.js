var SpreadsheetSetup = (function () {
  function protect_(sheet, range, description) {
    var type = range ? SpreadsheetApp.ProtectionType.RANGE : SpreadsheetApp.ProtectionType.SHEET;
    var existing = sheet.getProtections(type).find(function (item) { return item.getDescription() === description; });
    var protection = existing || (range || sheet).protect().setDescription(description);
    if (range && existing) protection.setRange(range);
    // De eigenaar kan altijd aanpassen; waarschuwingen beschermen tegen ongelukken.
    protection.setWarningOnly(true);
  }

  function configure_(sheet, required, isSchedule) {
    if (sheet.getMaxColumns() < required.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), required.length - sheet.getMaxColumns());
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, required.length).setValues([required]);
    var schema = SheetStore.headers(sheet, required);
    if (sheet.getMaxRows() < 1000) sheet.insertRowsAfter(sheet.getMaxRows(), 1000 - sheet.getMaxRows());
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, schema.names.length).setFontWeight('bold');
    required.forEach(function (name) {
      var range = sheet.getRange(2, schema.map[name] + 1, sheet.getMaxRows() - 1);
      if (name === 'StartDate') range.setNumberFormat('yyyy-mm-dd');
      else if (/At$/.test(name)) range.setNumberFormat('dd-mm-yyyy hh:mm');
      else if (name === 'DurationDays' || name === 'ReminderCount') range.setNumberFormat('0');
      else range.setNumberFormat('@');
      if (isSchedule && ['ID', 'LastError', 'CreatedAt', 'UpdatedAt'].indexOf(name) !== -1) {
        protect_(sheet, range, 'Medication Tracker: ' + name);
      }
    });
    if (!isSchedule) { protect_(sheet, null, 'Medication Tracker: intakes'); return; }
    var status = sheet.getRange(2, schema.map.Status + 1, sheet.getMaxRows() - 1);
    status.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['DRAFT', 'READY', 'GENERATED', 'ERROR'], true).setAllowInvalid(false).build());
    sheet.getRange(1, schema.map.Status + 1).setNote('Kies DRAFT tijdens invoer en READY om aan te bieden. GENERATED en ERROR worden door het systeem gezet. Wijzig geen aangeboden of gegenereerd schema.');
    sheet.getRange(1, schema.map.Times + 1).setNote('Dagelijkse tijden, bijvoorbeeld 08:00,14:00,20:00.');
    sheet.getRange(2, schema.map.StartDate + 1, sheet.getMaxRows() - 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    sheet.getRange(2, schema.map.DurationDays + 1, sheet.getMaxRows() - 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).build());
  }

  function run() {
    return ProcessingSupport.locked(function () {
      var config = Config.get();
      var book = SpreadsheetApp.openById(config.spreadsheetId);
      var definitions = [
        { name: config.scheduleSheet, headers: Config.scheduleHeaders(), schedule: true },
        { name: config.intakeSheet, headers: Config.intakeHeaders(), schedule: false }
      ];
      // Eerst beide bestaande tabs controleren; afwijkingen niet automatisch migreren.
      definitions.forEach(function (definition) {
        var sheet = book.getSheetByName(definition.name);
        if (sheet && sheet.getLastRow()) SheetStore.headers(sheet, definition.headers);
      });
      if (book.getSpreadsheetTimeZone() !== config.timezone) {
        var hasData = definitions.some(function (definition) {
          var sheet = book.getSheetByName(definition.name);
          return sheet && sheet.getLastRow() > 1;
        });
        if (hasData) throw new Error('Bestaande data met afwijkende timezone: controleer datums voordat u de timezone wijzigt.');
        book.setSpreadsheetTimeZone(config.timezone);
      }
      definitions.forEach(function (definition) {
        configure_(book.getSheetByName(definition.name) || book.insertSheet(definition.name), definition.headers, definition.schedule);
      });
      SpreadsheetApp.flush();
      return { configured: true };
    });
  }

  function installTriggers() {
    return ProcessingSupport.locked(function () {
      SheetStore.read('schedules');
      SheetStore.read('intakes');
      Config.pushover();
      Config.webUrl();
      var entries = [ ['processReadySchedules', 5], ['processPendingIntakeNotifications', 1] ];
      var triggers = ScriptApp.getProjectTriggers();
      entries.forEach(function (entry) {
        var matching = triggers.filter(function (trigger) {
          return trigger.getHandlerFunction() === entry[0] && trigger.getEventType() === ScriptApp.EventType.CLOCK;
        });
        if (!matching.length) ScriptApp.newTrigger(entry[0]).timeBased().everyMinutes(entry[1]).create();
        matching.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
      });
      return { installed: true };
    });
  }

  return { run: run, installTriggers: installTriggers };
})();
