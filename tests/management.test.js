const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers');

function generated() {
  const h = harness(); h.addSchedule({ Times: '14:00', DurationDays: 1 });
  h.context.processReadySchedules(); return h;
}

function unchanged(h) {
  return JSON.stringify({ sheets: Object.fromEntries(Object.entries(h.sheets).map(([name, sheet]) => [name, sheet.data])),
    props: [...h.props], sent: h.sent, triggers: h.triggers.length });
}

test('onOpen only builds menu and all referenced handlers exist', () => {
  const h = harness(); h.props.clear();
  h.beforeWrite = () => { throw new Error('Unexpected write'); };
  const before = unchanged(h); h.context.onOpen();
  assert.equal(unchanged(h), before);
  assert.equal(h.menus[0].name, 'Medication Tracker');
  function check(menu) { menu.items.forEach(item => item.items ? check(item) : assert.equal(typeof h.context[item.handler], 'function')); }
  check(h.menus[0]);
});

test('status independently reports configuration, timezone and table failures without writes', () => {
  const h = generated();
  h.props.set('REMINDER_INTERVAL_MINUTES', 'invalid'); h.props.delete('PUSHOVER_API_TOKEN');
  h.book.timezone = 'UTC'; delete h.sheets['medication-schedule-history'];
  const before = unchanged(h);
  const report = h.context.getManagementReport('status');
  assert.equal(unchanged(h), before);
  for (const label of ['Herinneringsinstellingen', 'Pushover-configuratie', 'Spreadsheet-tijdzone', 'Tabel: history']) {
    assert.notEqual(report.checks.find(c => c.label === label).level, 'goed');
  }
  assert.equal(report.checks.find(c => c.label === 'Tabel: intakes').level, 'goed');
  assert.ok(report.checks.find(c => c.label === 'Kloktriggers'));
  assert.equal(report.checks.find(c => c.label === 'Verschuldigde meldingen').level, 'niet controleerbaar');
});

test('wrong spreadsheet cannot expose record data or execute any action', () => {
  const h = generated(); h.book.id = 'different';
  const before = unchanged(h);
  const report = h.context.getManagementReport('status');
  assert.equal(report.records.length, 0);
  assert.throws(() => h.context.getManagementReport('record', 'intakes', h.records('intakes')[0].ID), /geconfigureerde/);
  for (const action of ['manageSetupSpreadsheet', 'manageInstallTriggers', 'manageProcessSchedules', 'manageProcessNotifications']) h.context[action]();
  assert.equal(unchanged(h), before);
  assert.ok(h.dialogs.every(args => args.length === 1));
});

test('missing spreadsheet property still permits status and help without reading records', () => {
  const h = harness(); h.props.delete('SPREADSHEET_ID');
  const report = h.context.getManagementReport('status');
  assert.equal(report.records.length, 0);
  assert.match(report.checks[0].detail, /SPREADSHEET_ID/);
  assert.equal(h.context.getManagementReport('help').title, 'Help en herstel');
  h.context.showManagementStatus(); assert.ok(h.sidebar);
});

test('status distinguishes due, blocked, invalid records and incomplete history', () => {
  const h = generated(); h.addSchedule({ Times: '14:00', DurationDays: 1 }); h.context.processReadySchedules();
  h.edit('intakes', h.records('intakes')[1].ID, { NotificationBlockedAt: new h.Date(), LastError: 'blocked' });
  const history = h.sheets['medication-schedule-history'];
  history.data[1][history.data[0].indexOf('RecordedAt')] = '';
  const report = h.context.getManagementReport('status');
  assert.match(report.checks.find(c => c.label === 'Verschuldigde meldingen').detail, /1 verzendbaar.*1 geblokkeerd/);
  assert.ok(report.records.some(r => r.heading === 'Verzendblokkering'));
  assert.ok(report.records.some(r => r.heading === 'Onvolledige history-rij'));
});

test('inspection redacts credentials and explains pending application without exposing raw JSON', () => {
  const h = generated(); const schedule = h.records('schedules')[0];
  h.edit('schedules', schedule.ID, { Status: 'ERROR', LastError: 'fake-token fake-user',
    ApplicationState: JSON.stringify({ mode: 'reconciliation', plan: { medication: 'Dexa' }, privateExtra: 'never-show' }) });
  const before = unchanged(h);
  const report = h.context.getManagementReport('record', 'schedules', schedule.ID);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /fake-token|fake-user|never-show/);
  assert.match(text, /READY_FOR_RECONCILIATION/);
  assert.equal(unchanged(h), before);
});

test('selection validates one data row and navigation resolves moved record by UUID', () => {
  const h = generated(); const sheet = h.sheets['medication-intakes'];
  h.activeRange = sheet.getRange(1, 1); h.context.showManagementRecord();
  assert.equal(h.sidebar, undefined);
  h.activeRange = sheet.getRange(2, 1, 2); assert.throws(() => h.context.ManagementStore.selection(), /één/);
  h.activeRange = sheet.getRange(2, 1);
  h.selectedRanges = [sheet.getRange(2, 1), sheet.getRange(4, 1)];
  assert.throws(() => h.context.ManagementStore.selection(), /één/); h.selectedRanges = null;
  h.context.showManagementRecord();
  const id = h.rendered.id;
  sheet.data.splice(1, 0, []);
  h.context.selectManagementRecord('intakes', id);
  assert.equal(h.activeRange.getRow(), 3);
  assert.equal(h.context.getManagementReport('record', 'intakes', id).records[0].id, id);
  assert.throws(() => h.context.selectManagementRecord('intakes', 'unknown'), /niet gevonden/);
  assert.throws(() => h.context.selectManagementRecord('constructor', id), /Onbekende tabel/);
});

test('history compares published versions and omits incomplete rows', () => {
  const h = generated(); const schedule = h.records('schedules')[0];
  h.edit('schedules', schedule.ID, { Dosage: '2 druppels', Status: 'READY_FOR_RECONCILIATION' });
  h.context.processReadySchedules();
  const before = unchanged(h);
  const report = h.context.getManagementReport('history', 'intakes', h.records('intakes')[0].ID);
  assert.equal(report.records.length, 2);
  assert.equal(report.records[1].fields.find(f => f.label === 'Gewijzigd').value, 'Dosering');
  assert.equal(unchanged(h), before);
  const sheet = h.sheets['medication-schedule-history'];
  sheet.data[2][sheet.data[0].indexOf('RecordedAt')] = '';
  assert.equal(h.context.getManagementReport('history', 'schedules', schedule.ID).records.length, 1);
});

test('cancelled confirmations perform no writes, send no messages and create no triggers', () => {
  const h = generated(); h.confirmation = 'NO'; const before = unchanged(h);
  for (const action of ['manageSetupSpreadsheet', 'manageInstallTriggers', 'manageProcessSchedules', 'manageProcessNotifications']) h.context[action]();
  assert.equal(unchanged(h), before);
  assert.equal(h.dialogs.length, 4);
});

test('target is rechecked after confirmation and no lock is held while asking', () => {
  const h = generated();
  h.onAlert = args => {
    assert.equal(h.locked, false);
    if (args[2] === 'YES_NO') h.book.id = 'changed-during-dialog';
  };
  h.context.manageProcessNotifications(); assert.equal(h.sent.length, 0);
});

test('manual notification processing preserves cancellation and blocks and reports actual outcomes', () => {
  const h = generated(); h.context.manageProcessNotifications();
  assert.equal(h.sent.length, 1);
  assert.match(h.dialogs.at(-1)[1], /Afgerond: 1.*\nMislukt: 0/);
  h.context.manageProcessNotifications(); assert.equal(h.sent.length, 1);
  h.edit('intakes', h.records('intakes')[0].ID, { Status: 'CANCELLED' });
  h.now += 86400000; h.context.manageProcessNotifications(); assert.equal(h.sent.length, 1);
});

test('batch summaries distinguish failed sends, busy locks and unfinished schedules', () => {
  const h = generated(); h.onFetch = () => { throw new Error('Network failure'); };
  let result = h.context.NotificationService.processPending();
  assert.equal(result.failed, 1); assert.equal(result.processed, 0);
  const other = generated(); other.locked = true;
  result = other.context.NotificationService.processPending();
  assert.equal(result.busy, true); assert.equal(result.remaining, 1);
  const schedule = harness(); schedule.addSchedule(); schedule.locked = true;
  result = schedule.context.ScheduleService.processReady();
  assert.equal(result.busy, true); assert.equal(result.processed, 0); assert.equal(result.remaining, 1);
  schedule.locked = false;
  result = schedule.context.ScheduleService.processReady(); assert.equal(result.processed, 1);
});

test('manual schedule processing keeps ERROR untouched and installation remains repeatable', () => {
  const h = harness(); h.addSchedule({ Times: 'invalid' }); h.context.manageProcessSchedules();
  assert.match(h.dialogs.at(-1)[1], /Mislukt: 1/);
  const before = unchanged(h); h.context.manageProcessSchedules(); assert.equal(unchanged(h), before);
  h.context.manageInstallTriggers(); h.context.manageInstallTriggers(); assert.equal(h.triggers.length, 2);
});

test('setup busy result is shown as busy instead of success', () => {
  const h = harness(); h.locked = true; h.context.manageSetupSpreadsheet();
  assert.match(h.dialogs.at(-1)[0], /andere verwerking/);
});

test('status continues when one table has missing headers and bounds the problem list', () => {
  const h = harness();
  for (let i = 0; i < 105; i++) h.addSchedule({ Status: 'ERROR', ID: 'record-' + i });
  h.sheets['medication-intakes'].data[0][0] = 'missing-id';
  const report = h.context.getManagementReport('status');
  assert.equal(report.records.length, 100);
  assert.ok(report.notes.some(note => /105 recordproblemen/.test(note)));
  assert.equal(report.checks.find(c => c.label === 'Tabel: intakes').level, 'niet controleerbaar');
  assert.equal(report.checks.find(c => c.label === 'Tabel: history').level, 'goed');
});

test('batch reports match limits and records skipped after a state change', () => {
  const h = harness();
  for (let i = 0; i < 26; i++) h.addSchedule({ Times: '14:00', DurationDays: 1 });
  const first = h.context.ScheduleService.processReady();
  assert.equal(first.processed, 25); assert.equal(first.remaining, 1);
  h.context.ScheduleService.processReady();
  const sent = h.context.NotificationService.processPending();
  assert.equal(sent.processed, 25); assert.equal(sent.remaining, 1);
  const other = generated();
  other.edit('schedules', other.records('schedules')[0].ID, { Status: 'ERROR' });
  const skipped = other.context.NotificationService.processPending();
  assert.equal(skipped.skipped, 1); assert.equal(skipped.processed, 0); assert.equal(other.sent.length, 0);
});

test('sidebar script loads, renders text safely, refreshes and navigates by captured UUID', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/entrypoints/management/Management.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.events = {}; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(name, handler) { this.events[name] = handler; }
    set innerHTML(value) { throw new Error('Untrusted HTML insertion'); }
  }
  const nodes = Object.fromEntries(['refresh', 'feedback', 'report', 'title'].map(id => [id, new Element(id)]));
  let selected, refreshes = 0;
  const report = { title: 'Inspectie', notes: [], checks: [], records: [{ heading: 'Record', kind: 'intakes', id: 'stable-id',
    fields: [{ label: 'Medicatie', value: '<img src=x onerror=alert(1)>' }] }] };
  const run = { withSuccessHandler(fn) { this.success = fn; return this; }, withFailureHandler(fn) { this.failure = fn; return this; },
    getManagementReport(mode, kind, id) { assert.equal(id, 'stable-id'); refreshes++; this.success(report); },
    selectManagementRecord(kind, id) { selected = [kind, id]; this.success(true); } };
  vm.runInNewContext(script, { document: { getElementById: id => nodes[id], createElement: tag => new Element(tag),
    body: { dataset: { mode: 'record', kind: 'intakes', id: 'stable-id' } } }, google: { script: { run } } });
  const section = nodes.report.children[0];
  assert.equal(section.children[1].children[1].textContent, '<img src=x onerror=alert(1)>');
  section.children[2].events.click(); assert.deepEqual(selected, ['intakes', 'stable-id']);
  nodes.refresh.events.click(); assert.equal(refreshes, 2); assert.equal(nodes.refresh.disabled, false);
});
