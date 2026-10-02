var ManagementStore = (function () {
  function definition_(kind) {
    var names = Config.tableNames();
    var definitions = {
      schedules: { name: names.schedules, headers: Config.scheduleHeaders() },
      intakes: { name: names.intakes, headers: Config.intakeHeaders() },
      history: { name: names.history, headers: Config.historyHeaders() },
      expiry: { name: names.expiry, headers: Config.expiryHeaders() }
    };
    if (!Object.prototype.hasOwnProperty.call(definitions, kind)) throw new Error('Onbekende tabel.');
    return definitions[kind];
  }

  /**
   * Controleert de actieve container zonder afhankelijkheid van overige configuratie of tijdzones.
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet} De geconfigureerde, geopende Spreadsheet.
   * @throws {Error} Bij een ontbrekende property, ontbrekende container of verkeerde Spreadsheet.
   */
  function assertTarget() {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    var book = SpreadsheetApp.getActiveSpreadsheet();
    if (!id || !id.trim()) throw new Error('SPREADSHEET_ID ontbreekt. Stel deze in via de projectinstellingen.');
    if (!book || book.getId() !== id.trim()) throw new Error('Open de geconfigureerde Spreadsheet om deze beheeractie uit te voeren.');
    return book;
  }

  /**
   * Leest een tabel voor diagnose, ook als overige configuratie onjuist is. Schrijft niets.
   * @param {'schedules'|'intakes'|'history'} kind Te lezen tabel.
   * @returns {Object[]} Headergestuurde records; _row is alleen een tijdelijke selectielocatie.
   * @throws {Error} Bij ontbrekende tab/headers, dubbele UUIDs of een verkeerde container.
   */
  function read(kind) {
    var definition = definition_(kind);
    var sheet = assertTarget().getSheetByName(definition.name);
    if (!sheet) throw new Error('Tab ontbreekt: ' + definition.name + '. Voer Spreadsheet inrichten / bijwerken uit.');
    var schema;
    try { schema = SheetStore.headers(sheet, definition.headers); }
    catch (error) { throw new Error('Controleer ontbrekende of dubbele headers in ' + definition.name + '.'); }
    if (sheet.getLastRow() < 2) return [];
    var ids = new Set();
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.names.length).getValues().map(function (values, index) {
      var record = { _row: index + 2 };
      Object.keys(schema.map).forEach(function (key) { record[key] = values[schema.map[key]]; });
      return record;
    }).filter(function (record) {
      return Object.keys(schema.map).some(function (key) { return record[key] !== ''; });
    }).map(function (record) {
      if (record.ID && ids.has(record.ID)) throw new Error('Dubbele UUIDs in ' + definition.name + '. Onderzoek de technische gegevens.');
      if (record.ID) ids.add(record.ID);
      return record;
    });
  }

  /**
   * @returns {{kind: string, id: string}} UUID van het record op de geselecteerde enkele gegevensrij.
   * @throws {Error} Bij verkeerde tab, meerdere rijen, headerselectie of een record zonder UUID.
   */
  function selection() {
    assertTarget();
    var ranges = SpreadsheetApp.getActiveRangeList();
    if (ranges && ranges.getRanges().length !== 1) throw new Error('Selecteer precies één gegevensrij.');
    var range = SpreadsheetApp.getActiveRange();
    if (!range || range.getNumRows() !== 1 || range.getRow() < 2) throw new Error('Selecteer precies één gegevensrij.');
    var name = range.getSheet().getName();
    var kind = ['schedules', 'intakes', 'history', 'expiry'].find(function (value) { return definition_(value).name === name; });
    if (!kind) throw new Error('Selecteer een rij in een Medication Tracker-tab.');
    var record = read(kind).find(function (item) { return item._row === range.getRow(); });
    if (!record || !record.ID) throw new Error('Deze rij heeft nog geen UUID. Bied een nieuw schema eerst via READY aan.');
    return { kind: kind, id: String(record.ID) };
  }

  /**
   * Selecteert het record op UUID, ook wanneer rijen intussen zijn verplaatst. Schrijft geen celwaarden.
   * @param {'schedules'|'intakes'|'history'} kind Doeltabel.
   * @param {string} id Record-UUID.
   * @returns {void}
   * @throws {Error} Bij een onbekende UUID of verkeerde container.
   */
  function select(kind, id) {
    var book = assertTarget();
    var record = read(kind).find(function (item) { return item.ID === id; });
    if (!record) throw new Error('Record niet gevonden. Vernieuw het overzicht.');
    var sheet = book.getSheetByName(definition_(kind).name);
    book.setActiveSheet(sheet);
    sheet.getRange(record._row, 1, 1, sheet.getLastColumn()).activate();
  }

  /**
   * Verwijdert credentials uit tekst voordat beheerresultaten naar de browser gaan.
   * @param {*} value Tekst uit een record of foutmelding.
   * @returns {string} Begrensde tekst zonder ingestelde Pushover-credentials.
   */
  function safeText(value) {
    var text = String(value === undefined || value === null ? '' : value);
    var props = PropertiesService.getScriptProperties();
    ['PUSHOVER_API_TOKEN', 'PUSHOVER_USER_KEY', 'EXPIRY_FORM_SECRET'].map(function (key) { return props.getProperty(key); })
      .filter(Boolean).sort(function (a, b) { return b.length - a.length; }).forEach(function (secret) {
        [secret, secret.trim(), encodeURIComponent(secret), encodeURIComponent(secret.trim())].filter(Boolean)
          .forEach(function (part) { text = text.split(part).join('[verwijderd]'); });
      });
    return text.slice(0, 2000);
  }

  return { assertTarget: assertTarget, read: read, selection: selection, select: select, safeText: safeText };
})();
