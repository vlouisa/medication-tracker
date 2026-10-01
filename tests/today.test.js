const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers');

function generated() {
  const h = harness(); h.addSchedule(); h.context.processReadySchedules(); return h;
}

test('today groups and sorts planned moments without writes or notifications', () => {
  const h = generated(); const rows = h.records('intakes');
  h.edit('intakes', rows[0].ID, { Status: 'COMPLETED', CompletedAt: new h.Date() });
  h.edit('intakes', rows[1].ID, { Status: 'CANCELLED' });
  const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sheet]) => [name, sheet.data])));
  const before = snapshot();
  h.beforeWrite = () => { throw new Error('Unexpected write'); };
  const result = h.context.getTodayOverview();
  assert.equal(result.records.length, 3);
  assert.equal(result.counts.open, 1); assert.equal(result.counts.completed, 1); assert.equal(result.counts.cancelled, 1);
  assert.equal(result.records[2].label, 'Later vandaag');
  assert.equal(result.records[0].completedAt, '29-09-2026 14:00');
  assert.equal(snapshot(), before); assert.equal(h.sent.length, 0);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('partial completion takes precedence and registration keeps the original timestamp', () => {
  const h = generated(); const row = h.records('intakes')[0];
  const completedAt = new h.Date('2026-09-29T09:00:00Z');
  h.edit('intakes', row.ID, { CompletedAt: completedAt });
  assert.equal(h.context.getTodayOverview().records[0].group, 'completed');
  h.context.completeIntake(row.ID); h.context.completeIntake(row.ID);
  assert.equal(h.records('intakes')[0].CompletedAt.getTime(), completedAt.getTime());
  assert.equal(h.context.getTodayOverview().counts.completed, 1);
});

test('selection follows planned day, changes after midnight and ignores completion day', () => {
  const h = generated(); const row = h.records('intakes')[0];
  h.edit('intakes', row.ID, { CompletedAt: new h.Date('2026-09-30T08:00:00Z'), Status: 'COMPLETED' });
  h.now = Date.parse('2026-09-29T21:59:59Z');
  assert.equal(h.context.getTodayOverview().counts.completed, 1);
  h.now = Date.parse('2026-09-29T22:00:00Z');
  const result = h.context.getTodayOverview();
  assert.equal(result.date, '2026-09-30'); assert.equal(result.counts.completed, 0);
  assert.equal(result.records.length, 3);
});

test('local day includes both repeated hours at winter time and excludes adjacent dates', () => {
  const h = generated(); const rows = h.records('intakes');
  const moments = ['2026-10-24T21:59:59Z', '2026-10-24T22:00:00Z', '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z'];
  rows.forEach((row, i) => h.edit('intakes', row.ID, { ScheduledAt: new h.Date(moments[i]) }));
  h.now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(h.context.getTodayOverview().records.length, 4);
  h.now = Date.parse('2026-03-29T12:00:00Z');
  const spring = ['2026-03-28T22:59:59Z', '2026-03-28T23:00:00Z', '2026-03-29T00:30:00Z',
    '2026-03-29T01:30:00Z', '2026-03-29T21:59:59Z', '2026-03-29T22:00:00Z'];
  rows.forEach((row, i) => h.edit('intakes', row.ID, { ScheduledAt: new h.Date(spring[i]) }));
  assert.equal(h.context.getTodayOverview().records.length, 4);
});

test('empty day, invalid records and read failure are distinct and errors are safe', () => {
  const h = harness(); assert.equal(h.context.getTodayOverview().records.length, 0);
  h.addSchedule(); h.context.processReadySchedules(); const rows = h.records('intakes');
  h.edit('intakes', rows[0].ID, { ScheduledAt: 'broken' });
  h.edit('intakes', rows[1].ID, { Status: 'UNKNOWN' });
  const result = h.context.getTodayOverview();
  assert.equal(result.invalid, 2); assert.equal(result.records.length, 1);
  h.context.SheetStore.read = () => { throw new Error('private diagnostic'); };
  assert.throws(() => h.context.getTodayOverview(), error => /niet worden geladen/.test(error.message) && !/private/.test(error.message));
});

test('reconciliation keeps cancelled and replacement moments visible', () => {
  const h = generated(); const schedule = h.records('schedules')[0];
  h.edit('schedules', schedule.ID, { Times: '08:00,14:00,21:00', Status: 'READY_FOR_RECONCILIATION' });
  h.context.processReadySchedules();
  const result = h.context.getTodayOverview();
  assert.equal(result.counts.cancelled, 1); assert.equal(result.records.length, 4);
  assert.equal(result.records.at(-1).scheduled, '29-09-2026 21:00');
});

test('routes preserve completion links and reject duplicate action parameters', () => {
  const h = generated(); const id = h.records('intakes')[0].ID;
  h.context.doGet({ parameter: { action: 'today' } });
  assert.equal(h.rendered.name, 'entrypoints/web/Today');
  h.context.doGet({ parameter: { action: 'complete', id } });
  assert.equal(h.rendered.model.id, id); assert.match(h.rendered.todayUrl, /\?action=today$/);
  h.context.doGet({ parameter: { action: 'today' }, parameters: { action: ['today', 'complete'] } });
  assert.ok(h.rendered.error);
});

test('manual link send requires confirmation and correct spreadsheet, with no intake changes', () => {
  const h = generated(); const before = JSON.stringify(h.records('intakes'));
  h.context.showTodayLink(); assert.match(h.rendered.url, /\?action=today$/);
  h.confirmation = 'NO'; h.context.manageSendTodayLink(); assert.equal(h.sent.length, 0);
  h.confirmation = 'YES'; h.context.manageSendTodayLink(); assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].options.payload.url_title, 'Open Vandaag');
  assert.match(h.sent[0].options.payload.url, /\?action=today$/);
  assert.equal(JSON.stringify(h.records('intakes')), before);
  h.locked = true; h.context.manageSendTodayLink(); assert.equal(h.sent.length, 1); h.locked = false;
  h.book.id = 'wrong'; h.context.manageSendTodayLink(); assert.equal(h.sent.length, 1);
});

test('uncertain manual send is not retried automatically', () => {
  const h = harness(); h.onFetch = () => { throw new Error('Network timeout'); };
  h.context.manageSendTodayLink(); assert.equal(h.sent.length, 1);
  assert.match(h.dialogs.at(-1)[0], /onbekend/);
});

test('mobile view renders safe text, filters, preserves data on failure and refreshes on return', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/entrypoints/web/Today.html'), 'utf8');
  class Element {
    constructor() { this.children = []; this.events = {}; this.textContent = ''; this.disabled = false; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.events[name] = fn; }
    set innerHTML(value) { throw new Error('Unsafe rendering'); }
  }
  const nodes = Object.fromEntries(['date', 'counts', 'refresh', 'filter', 'feedback', 'updated', 'warning', 'records'].map(id => [id, new Element()]));
  nodes.filter.value = 'all';
  const events = {}; const h = generated(); let fail = false; let calls = 0;
  h.edit('intakes', h.records('intakes')[0].ID, { Medication: '<img src=x onerror=alert(1)>' });
  const run = { withSuccessHandler(fn) { this.success = fn; return this; }, withFailureHandler(fn) { this.failure = fn; return this; },
    getTodayOverview() { calls++; if (fail) this.failure(); else this.success(h.context.getTodayOverview()); } };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => nodes[id], createElement: () => new Element() },
    window: { addEventListener: (name, fn) => { events[name] = fn; } }, google: { script: { run } }
  });
  assert.equal(nodes.records.children.length, 3);
  assert.match(nodes.records.children[0].children[0].textContent, /<img/);
  assert.match(nodes.records.children[0].children.at(-1).href, /action=complete&id=/);
  nodes.filter.value = 'completed'; nodes.filter.events.change(); assert.equal(nodes.records.children.length, 1);
  assert.match(nodes.records.children[0].textContent, /Geen momenten/);
  fail = true; nodes.refresh.events.click(); assert.match(nodes.feedback.textContent, /verouderd/);
  assert.equal(nodes.refresh.disabled, false);
  fail = false; h.now = Date.parse('2026-09-29T22:00:00Z'); events.pageshow();
  assert.equal(nodes.date.textContent, '30-09-2026'); assert.equal(calls, 3);
});
