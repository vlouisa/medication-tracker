var SheetStore = (function () {
  /**
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet} De geconfigureerde Spreadsheet.
   * @throws {Error} Bij configuratie-/toegangsfouten of een afwijkende project- of Spreadsheet-tijdzone.
   */
  function spreadsheet() {
    var config = Config.get();
    var book = SpreadsheetApp.openById(config.spreadsheetId);
    if (book.getSpreadsheetTimeZone() !== config.timezone || Session.getScriptTimeZone() !== config.timezone) {
      throw new Error('Project en Spreadsheet moeten timezone Europe/Brussels gebruiken.');
    }
    return book;
  }

  /**
   * Leest headers uit rij 1; extra kolommen zijn toegestaan.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet Te controleren tab.
   * @param {string[]} required Verplichte headernamen.
   * @returns {{names: string[], map: Object<string, number>}} Getrimde namen en nulgebaseerde kolomindices.
   * @throws {Error} Bij dubbele of ontbrekende verplichte headers.
   */
  function headers(sheet, required) {
    var values = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
      .map(function (value) { return String(value).trim(); });
    var map = Object.create(null);
    values.forEach(function (value, index) {
      var name = String(value).trim();
      if (!name) return;
      if (Object.prototype.hasOwnProperty.call(map, name)) throw new Error('Dubbele Sheet-header: ' + name);
      map[name] = index;
    });
    required.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(map, name)) throw new Error('Ontbrekende Sheet-header: ' + name);
    });
    return { names: values, map: map };
  }

  function table_(kind) {
    var config = Config.get();
    var definitions = { schedules: [config.scheduleSheet, Config.scheduleHeaders()],
      intakes: [config.intakeSheet, Config.intakeHeaders()], history: [config.historySheet, Config.historyHeaders()],
      expiry: [config.expirySheet, Config.expiryHeaders()] };
    var definition = definitions[kind];
    if (!definition) throw new Error('Onbekende tabel.');
    var name = definition[0];
    var sheet = spreadsheet().getSheetByName(name);
    if (!sheet) throw new Error('Ontbrekende tab: ' + name + '. Voer setupSpreadsheet uit.');
    return { sheet: sheet, schema: headers(sheet, definition[1]) };
  }

  /**
   * Leest niet-lege records op headernaam; celwaarden behouden hun Apps Script-type.
   * @param {'schedules'|'intakes'|'history'} kind Te lezen tabel; history zonder RecordedAt is nog niet gepubliceerd.
   * @returns {Object[]} Records met _row als tijdelijke, eengebaseerde rijlocatie; gebruik ID als identifier.
   * @throws {Error} Bij ongeldige tabelstructuur, dubbele IDs of een intake zonder ID.
   */
  function read(kind) {
    var table = table_(kind);
    if (table.sheet.getLastRow() < 2) return [];
    var rows = table.sheet.getRange(2, 1, table.sheet.getLastRow() - 1, table.schema.names.length).getValues();
    var ids = new Set();
    return rows.map(function (values, index) {
      var record = { _row: index + 2 };
      Object.keys(table.schema.map).forEach(function (name) { record[name] = values[table.schema.map[name]]; });
      return record;
    }).filter(function (record) {
      return Object.keys(table.schema.map).some(function (name) { return record[name] !== ''; });
    }).map(function (record) {
      if (record.ID) {
        if (ids.has(record.ID)) throw new Error('Dubbele UUID in ' + kind + '. Herstel de technische gegevens.');
        ids.add(record.ID);
      } else if (kind !== 'schedules') {
        throw new Error('Record zonder UUID. Herstel de technische gegevens.');
      }
      return record;
    });
  }

  /**
   * @param {'schedules'|'intakes'|'history'} kind Te doorzoeken tabel.
   * @param {string} id UUID van het record.
   * @returns {Object} Actueel record, inclusief tijdelijke _row.
   * @throws {Error} Als het record ontbreekt of de tabel niet kan worden gelezen.
   */
  function find(kind, id) {
    var record = read(kind).find(function (item) { return item.ID === id; });
    if (!record) throw new Error('Record niet gevonden.');
    return record;
  }

  function safeValue_(value) {
    // Voorkomt dat snapshots en foutmeldingen als formules worden uitgevoerd.
    return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value;
  }

  /**
   * Zoekt de actuele rij opnieuw en schrijft uitsluitend opgegeven velden, in sleutelvolgorde.
   * Schrijft strings veilig als tekst en flusht de wijzigingen. Writes zijn niet atomair.
   * De aanroeper verzorgt het lock; alleen voor een schema zonder ID wordt _row gebruikt.
   * @param {'schedules'|'intakes'} kind Doeltabel.
   * @param {Object} record Eerder gelezen record met ID of tijdelijke _row.
   * @param {Object} changes Headernamen met nieuwe celwaarden.
   * @returns {Object} Opnieuw gelezen record aangevuld met changes.
   * @throws {Error} Bij een ontbrekend/gewijzigd record, onbekend veld of lees-/schrijffout; eerdere writes kunnen behouden zijn.
   */
  function patch(kind, record, changes) {
    if (kind === 'history') throw new Error('History kan niet worden gewijzigd.');
    var current = record.ID ? find(kind, record.ID) : read(kind).find(function (item) { return item._row === record._row; });
    if (!current || (!record.ID && current.ID)) throw new Error('Record gewijzigd tijdens verwerking.');
    var table = table_(kind);
    Object.keys(changes).forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(table.schema.map, name)) throw new Error('Onbekend veld: ' + name);
      table.sheet.getRange(current._row, table.schema.map[name] + 1).setValue(safeValue_(changes[name]));
    });
    SpreadsheetApp.flush();
    return Object.assign({}, current, changes);
  }

  /**
   * Voegt intakes in een batch toe en flusht; ontbrekende velden worden lege cellen.
   * De aanroeper verzorgt het lock en controleert UUIDs en dubbele innamemomenten.
   * @param {Object[]} records Intakes met Sheet-veldnamen; een lege lijst doet niets.
   * @returns {void}
   * @throws {Error} Bij lees-/schrijffouten; controleer opgeslagen records voordat opnieuw wordt toegevoegd.
   */
  function appendIntakes(records) {
    if (!records.length) return;
    var table = table_('intakes');
    var values = records.map(function (record) {
      return table.schema.names.map(function (name) {
        return safeValue_(Object.prototype.hasOwnProperty.call(record, name) ? record[name] : '');
      });
    });
    var start = table.sheet.getLastRow() + 1;
    var extra = start + values.length - 1 - table.sheet.getMaxRows();
    if (extra > 0) table.sheet.insertRowsAfter(table.sheet.getMaxRows(), extra);
    table.sheet.getRange(start, 1, values.length, table.schema.names.length).setValues(values);
    SpreadsheetApp.flush();
  }

  /**
   * Schrijft een history-snapshot onder het lock van de aanroeper. ID wordt eerst gereserveerd,
   * RecordedAt als laatste geschreven. Alleen een onvolledige rij met dezelfde ID wordt hervat.
   * @param {Object} record Snapshot met vooraf duurzaam opgeslagen ID en RecordedAt.
   * @returns {void}
   * @throws {Error} Bij een conflicterende snapshot of schrijffout; een retry gebruikt dezelfde ID.
   */
  function appendHistory(record) {
    var table = table_('history');
    var existing = read('history').find(function (item) { return item.ID === record.ID; });
    if (existing && existing.RecordedAt) {
      Config.historyHeaders().forEach(function (key) {
        var actual = existing[key], wanted = record[key];
        if (key === 'ExpiryReminderDaysBefore') { actual = actual || ''; wanted = wanted || ''; }
        if (key === 'StartDate') { actual = LocalTime.dateText(actual); wanted = LocalTime.dateText(wanted); }
        if (actual instanceof Date) actual = actual.getTime();
        if (wanted instanceof Date) wanted = wanted.getTime();
        if (actual !== wanted) throw new Error('History-snapshot conflicteert met de toepassing.');
      });
      return;
    }
    var row = existing ? existing._row : table.sheet.getLastRow() + 1;
    if (row > table.sheet.getMaxRows()) table.sheet.insertRowsAfter(table.sheet.getMaxRows(), 1);
    table.sheet.getRange(row, table.schema.map.ID + 1).setValue(record.ID);
    Config.historyHeaders().filter(function (key) { return key !== 'ID' && key !== 'RecordedAt'; })
      .concat(['RecordedAt']).forEach(function (key) {
        table.sheet.getRange(row, table.schema.map[key] + 1).setValue(safeValue_(record[key] === undefined ? '' : record[key]));
      });
    SpreadsheetApp.flush();
  }

  /**
   * Hervat het invoegen van uitsluitend de intake die in ApplicationState is vastgelegd.
   * Reserveert eerst de UUID; schrijft de status als laatste. Aanroeper houdt het scriptlock.
   * @param {Object} record Volledige nieuwe intake met duurzaam opgeslagen UUID en Date-velden.
   * @returns {void}
   * @throws {Error} Bij een conflicterend bestaand record of schrijffout.
   */
  function insertIntake(record) {
    var table = table_('intakes');
    var existing = read('intakes').find(function (item) { return item.ID === record.ID; });
    if (existing && (existing.CompletedAt || existing.Status === 'COMPLETED')) return;
    if (existing && existing.ScheduleID && existing.ScheduleID !== record.ScheduleID) {
      throw new Error('Intake-UUID behoort tot een ander schema.');
    }
    var row = existing ? existing._row : table.sheet.getLastRow() + 1;
    if (row > table.sheet.getMaxRows()) table.sheet.insertRowsAfter(table.sheet.getMaxRows(), 1);
    table.sheet.getRange(row, table.schema.map.ID + 1).setValue(record.ID);
    Object.keys(record).filter(function (key) { return key !== 'ID' && key !== 'Status'; })
      .concat(['Status']).forEach(function (key) {
        table.sheet.getRange(row, table.schema.map[key] + 1).setValue(safeValue_(record[key]));
      });
    SpreadsheetApp.flush();
  }

  /**
   * Voegt een vooraf geïdentificeerd expiry-record of vervolgplan hervatbaar toe.
   * Schrijft ID eerst en de publicatiemarkering als laatste. Gepubliceerde rijen blijven ongewijzigd.
   * Aanroeper houdt het scriptlock en controleert identiteit en inhoud van het teruggelezen record.
   * @param {'expiry'|'schedules'} kind Doeltabel.
   * @param {Object} record Volledige beginwaarden met duurzame UUID.
   * @returns {Object} Teruggelezen record; CreatedAt publiceert expiry, Status publiceert een vervolgplan.
   * @throws {Error} Bij ongeldige tabel of opslagfout; dezelfde UUID gebruiken bij hervatten.
   */
  function insertReserved(kind, record) {
    if (kind !== 'expiry' && kind !== 'schedules') throw new Error('Ongeldige gereserveerde invoeging.');
    var marker = kind === 'expiry' ? 'CreatedAt' : 'Status';
    var existing = read(kind).find(function (item) { return item.ID === record.ID; });
    if (existing && existing[marker]) return existing;
    var table = table_(kind);
    var row = existing ? existing._row : table.sheet.getLastRow() + 1;
    if (row > table.sheet.getMaxRows()) table.sheet.insertRowsAfter(table.sheet.getMaxRows(), 1);
    var keys = Object.keys(record).filter(function (key) { return key !== 'ID' && key !== marker; });
    ['ID'].concat(keys, [marker]).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(table.schema.map, key)) throw new Error('Onbekend veld: ' + key);
      table.sheet.getRange(row, table.schema.map[key] + 1).setValue(safeValue_(record[key]));
    });
    SpreadsheetApp.flush();
    return find(kind, record.ID);
  }

  return { spreadsheet: spreadsheet, headers: headers, read: read, find: find, insertReserved: insertReserved,
    patch: patch, appendIntakes: appendIntakes, appendHistory: appendHistory, insertIntake: insertIntake };
})();
