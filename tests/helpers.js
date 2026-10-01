const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function formatDate(date, timezone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  if (pattern === 'yyyy-MM-dd') return day;
  if (pattern === 'yyyy-MM-dd HH:mm') return `${day} ${time}`;
  if (pattern === 'dd-MM-yyyy HH:mm') return `${parts.day}-${parts.month}-${parts.year} ${time}`;
  if (pattern === 'Z') {
    const local = Date.parse(`${day}T${time}:${parts.second}Z`);
    const minutes = Math.round((local - date.getTime()) / 60000);
    return `${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  }
  throw new Error(`Unexpected format: ${pattern}`);
}

class Range {
  constructor(sheet, row, col, height = 1, width = 1) { Object.assign(this, { sheet, row, col, height, width }); }
  getNumRows() { return this.height; }
  getRow() { return this.row; }
  getSheet() { return this.sheet; }
  activate() { this.sheet.harness.activeRange = this; return this; }
  getValues() {
    return Array.from({ length: this.height }, (_, r) => Array.from({ length: this.width }, (_, c) =>
      this.sheet.data[this.row - 1 + r]?.[this.col - 1 + c] ?? ''));
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((value, c) => {
      this.sheet.harness.beforeWrite?.(this.sheet, this.row + r, this.col + c, value);
      this.sheet.data[this.row - 1 + r] ??= [];
      this.sheet.data[this.row - 1 + r][this.col - 1 + c] =
        typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
    }));
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setDataValidation() { return this; }
  setNote() { return this; }
  protect() { return this.sheet.protection('RANGE', this); }
}

class Sheet {
  constructor(name, harness) {
    Object.assign(this, { name, harness, data: [], maxRows: 1000, maxCols: 26, protections: [], rules: [] });
  }
  getRange(...args) { return new Range(this, ...args); }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, count) { this.maxRows += count; }
  insertColumnsAfter(_, count) { this.maxCols += count; }
  setFrozenRows() {}
  getConditionalFormatRules() { return this.rules.slice(); }
  setConditionalFormatRules(rules) { this.rules = rules; }
  getProtections(type) { return this.protections.filter(p => p.type === type); }
  protect() { return this.protection('SHEET'); }
  protection(type, range) {
    const value = { type, range, description: '', getDescription() { return this.description; },
      setDescription(text) { this.description = text; return this; },
      setRange(value) { this.range = value; }, setWarningOnly() {} };
    this.protections.push(value);
    return value;
  }
}

function harness() {
  const h = { now: Date.parse('2026-09-29T12:00:00Z'), sheets: {}, sent: [], logs: [],
    props: new Map([['SPREADSHEET_ID', 'test-spreadsheet'], ['WEB_APP_URL', 'https://script.google.com/macros/s/test-deployment/exec'],
      ['PUSHOVER_USER_KEY', 'fake-user'], ['PUSHOVER_API_TOKEN', 'fake-token']]), triggers: [], locked: false };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [h.now])); }
    static now() { return h.now; }
  }
  h.Date = ClockDate;
  h.book = { id: 'test-spreadsheet', getId() { return this.id; }, timezone: 'Europe/Brussels', getSpreadsheetTimeZone() { return this.timezone; },
    setActiveSheet(sheet) { h.activeSheet = sheet; },
    setSpreadsheetTimeZone(value) { this.timezone = value; },
    getSheetByName(name) { return h.sheets[name] || null; },
    insertSheet(name) { return h.sheets[name] = new Sheet(name, h); } };
  const validation = { requireValueInList() { return this; }, setAllowInvalid() { return this; },
    requireDate() { return this; }, requireNumberGreaterThan() { return this; }, build() { return this; } };
  h.dialogs = []; h.menus = []; h.confirmation = 'YES';
  function menu(name) {
    return { name, items: [], addItem(label, handler) { this.items.push({ label, handler }); return this; },
      addSeparator() { return this; }, addSubMenu(child) { this.items.push(child); return this; },
      addToUi() { h.menus.push(this); } };
  }
  h.ui = { ButtonSet: { YES_NO: 'YES_NO', OK: 'OK' }, Button: { YES: 'YES', NO: 'NO' }, createMenu: menu,
    alert: (...args) => { h.dialogs.push(args); h.onAlert?.(args); return h.confirmation; },
    showSidebar: output => { h.sidebar = output; } };
  h.context = vm.createContext({ Date: ClockDate, console: { error: value => h.logs.push(value) },
    Utilities: { formatDate, getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => crypto.createHash('sha256').update(value).digest(),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => h.props.get(key) ?? null,
      setProperty: (key, value) => h.props.set(key, value) }) },
    Session: { getScriptTimeZone: () => 'Europe/Brussels' },
    SpreadsheetApp: { openById: () => h.book, getActiveSpreadsheet: () => h.book,
      getActiveRange: () => h.activeRange || null,
      getActiveRangeList: () => h.activeRange ? { getRanges: () => h.selectedRanges || [h.activeRange] } : null,
      getUi: () => h.ui, flush: () => h.onFlush?.(),
      ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' }, newDataValidation: () => validation,
      newConditionalFormatRule: () => ({ whenFormulaSatisfied(formula) { this.formula = formula; return this; },
        setBackground(color) { this.color = color; return this; }, setRanges(ranges) { this.ranges = ranges; return this; },
        build() { return { formula: this.formula, color: this.color, ranges: this.ranges,
          getBooleanCondition: () => ({ getCriteriaValues: () => [this.formula] }) }; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (h.locked) return false; h.locked = true; return true; },
      releaseLock: () => { h.locked = false; } }) },
    UrlFetchApp: { fetch: (url, options) => {
      h.sent.push({ url, options });
      if (h.onFetch) return h.onFetch(url, options);
      return { getResponseCode: () => 200, getContentText: () => '{"status":1}' };
    } },
    ScriptApp: { EventType: { CLOCK: 'CLOCK' }, getProjectTriggers: () => h.triggers.slice(),
      deleteTrigger: item => { h.triggers.splice(h.triggers.indexOf(item), 1); },
      newTrigger: handler => ({ timeBased() { return this; }, everyMinutes(minutes) { this.minutes = minutes; return this; },
        create() { h.triggers.push({ getHandlerFunction: () => handler, getEventType: () => 'CLOCK', minutes: this.minutes }); } }) },
    HtmlService: { createTemplateFromFile: name => ({ evaluate() {
      h.rendered = { name, model: this.model, error: this.error, mode: this.mode, kind: this.kind, id: this.id,
        todayUrl: this.todayUrl, url: this.url };
      return { setTitle() { return this; }, addMetaTag() { return this; } };
    } }) }
  });
  function load(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) load(file);
      else if (entry.name.endsWith('.js')) vm.runInContext(fs.readFileSync(file, 'utf8'), h.context, { filename: file });
    }
  }
  load(path.join(__dirname, '..', 'src'));
  h.context.setupSpreadsheet();
  h.addSchedule = (changes = {}) => {
    const row = { Medication: 'Dexa', Dosage: '1 druppel', Administration: 'rechteroog', StartDate: '2026-09-29',
      DurationDays: 2, Times: '08:00,14:00,20:00', Status: 'READY', ...changes };
    const sheet = h.sheets['medication-schedules'];
    sheet.data.push(sheet.data[0].map(header => row[header] ?? ''));
    return row;
  };
  h.records = kind => h.context.SheetStore.read(kind);
  h.edit = (kind, id, changes) => h.context.SheetStore.patch(kind, h.context.SheetStore.find(kind, id), changes);
  return h;
}

module.exports = { harness };
