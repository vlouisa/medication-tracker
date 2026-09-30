var SpreadsheetSetup = (function () {
  function statusStyle_(sheet, column, status, color) {
    // De vaste markering maakt uitsluitend onze eigen regel herkenbaar bij herhaalde setup.
    var marker = 'Medication Tracker: ' + status;
    var formula = '=AND(INDIRECT(ADDRESS(ROW(),COLUMN()))="' + status + '",N("' + marker + '")=0)';
    var rules = sheet.getConditionalFormatRules().filter(function (rule) {
      var condition = rule.getBooleanCondition();
      return !condition || condition.getCriteriaValues().indexOf(formula) === -1;
    });
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(color)
      .setRanges([sheet.getRange(2, column, sheet.getMaxRows() - 1)]).build());
    sheet.setConditionalFormatRules(rules);
  }

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
      else if (name === 'DurationDays' || name === 'ReminderCount' || name === 'Version') range.setNumberFormat('0');
      else range.setNumberFormat('@');
      if (isSchedule && ['ID', 'LastError', 'CreatedAt', 'UpdatedAt', 'ApplicationState'].indexOf(name) !== -1) {
        protect_(sheet, range, 'Medication Tracker: ' + name);
      }
    });
    if (!isSchedule) {
      if (required.indexOf('Version') === -1) {
        statusStyle_(sheet, schema.map.Status + 1, 'CANCELLED', '#eeeeee');
        sheet.getRange(1, schema.map.Status + 1).setNote('CANCELLED: vervallen door plancorrectie; een bestaande link kan daadwerkelijke inname nog registreren.');
      }
      protect_(sheet, null, required.indexOf('Version') === -1 ? 'Medication Tracker: intakes' : 'Medication Tracker: history');
      return;
    }
    statusStyle_(sheet, schema.map.Status + 1, 'READY_FOR_RECONCILIATION', '#fff2cc');
    var status = sheet.getRange(2, schema.map.Status + 1, sheet.getMaxRows() - 1);
    status.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['DRAFT', 'READY', 'GENERATED', 'READY_FOR_RECONCILIATION', 'ERROR'], true).setAllowInvalid(false).build());
    sheet.getRange(1, schema.map.Status + 1).setNote('Kies READY voor eerste generatie. Corrigeer een gegenereerd plan en kies READY_FOR_RECONCILIATION. Wijzig geen plan tijdens verwerking. Na ERROR: herstel invoer en bied met dezelfde verwerkingsstatus opnieuw aan.');
    sheet.getRange(1, schema.map.Times + 1).setNote('Dagelijkse tijden, bijvoorbeeld 08:00,14:00,20:00.');
    sheet.getRange(2, schema.map.StartDate + 1, sheet.getMaxRows() - 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    sheet.getRange(2, schema.map.DurationDays + 1, sheet.getMaxRows() - 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).build());
  }

  /**
   * Configureert tabs, opmaak, validatie en waarschuwingsbeveiliging onder het scriptlock.
   * Controleert bestaande headers vooraf; wijzigt de tijdzone alleen als de doeltabs geen data bevatten.
   * @returns {{configured: boolean}|{busy: boolean}} {configured: true}, of {busy: true} bij een bezet lock.
   * @throws {Error} Bij ongeldige headers, bestaande data met afwijkende tijdzone of configuratie-/schrijffouten.
   */
  function run() {
    return ProcessingSupport.locked(function () {
      var config = Config.get();
      var book = SpreadsheetApp.openById(config.spreadsheetId);
      var definitions = [
        { name: config.scheduleSheet, headers: Config.scheduleHeaders(), schedule: true },
        { name: config.intakeSheet, headers: Config.intakeHeaders(), schedule: false },
        { name: config.historySheet, headers: Config.historyHeaders(), schedule: false }
      ];
      // Eerst beide bestaande tabs controleren; afwijkingen niet automatisch migreren.
      definitions.forEach(function (definition) {
        var sheet = book.getSheetByName(definition.name);
        if (sheet && sheet.getLastRow()) SheetStore.headers(sheet, definition.schedule ?
          definition.headers.filter(function (name) { return name !== 'ApplicationState'; }) : definition.headers);
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
        var existing = book.getSheetByName(definition.name);
        if (definition.schedule && existing && existing.getLastRow()) {
          var schema = SheetStore.headers(existing, []);
          if (!Object.prototype.hasOwnProperty.call(schema.map, 'ApplicationState')) {
            var column = existing.getLastColumn() + 1;
            if (column > existing.getMaxColumns()) existing.insertColumnsAfter(existing.getMaxColumns(), 1);
            existing.getRange(1, column).setValue('ApplicationState');
          }
        }
        configure_(book.getSheetByName(definition.name) || book.insertSheet(definition.name), definition.headers, definition.schedule);
      });
      SpreadsheetApp.flush();
      return { configured: true };
    });
  }

  /**
   * Controleert configuratie en tabellen en beheert kloktriggers van het uitvoerende account.
   * Maakt ontbrekende triggers aan (schema's: vijf minuten, notificaties: een minuut),
   * verwijdert duplicaten en behoudt per handler de eerste bestaande kloktrigger.
   * @returns {{installed: boolean}|{busy: boolean}} {installed: true}, of {busy: true} bij een bezet lock.
   * @throws {Error} Bij ongeldige configuratie/tabellen of fouten in triggerbeheer.
   */
  function installTriggers() {
    return ProcessingSupport.locked(function () {
      SheetStore.read('schedules');
      SheetStore.read('intakes');
      SheetStore.read('history');
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
