var SheetStore = (function () {
  function spreadsheet() {
    var config = Config.get();
    var book = SpreadsheetApp.openById(config.spreadsheetId);
    if (book.getSpreadsheetTimeZone() !== config.timezone || Session.getScriptTimeZone() !== config.timezone) {
      throw new Error('Project en Spreadsheet moeten timezone Europe/Brussels gebruiken.');
    }
    return book;
  }

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
    var schedule = kind === 'schedules';
    var name = schedule ? config.scheduleSheet : config.intakeSheet;
    var sheet = spreadsheet().getSheetByName(name);
    if (!sheet) throw new Error('Ontbrekende tab: ' + name + '. Voer setupSpreadsheet uit.');
    return { sheet: sheet, schema: headers(sheet, schedule ? Config.scheduleHeaders() : Config.intakeHeaders()) };
  }

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
      } else if (kind === 'intakes') {
        throw new Error('Intake zonder UUID. Herstel de technische gegevens.');
      }
      return record;
    });
  }

  function find(kind, id) {
    var record = read(kind).find(function (item) { return item.ID === id; });
    if (!record) throw new Error('Record niet gevonden.');
    return record;
  }

  function safeValue_(value) {
    // Voorkomt dat snapshots en foutmeldingen als formules worden uitgevoerd.
    return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value;
  }

  /** Werkt uitsluitend opgegeven velden bij; rijnummers zijn tijdelijke locaties. */
  function patch(kind, record, changes) {
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

  return { spreadsheet: spreadsheet, headers: headers, read: read, find: find,
    patch: patch, appendIntakes: appendIntakes };
})();
