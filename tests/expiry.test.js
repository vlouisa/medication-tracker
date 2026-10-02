const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers');

function generated(changes = {}) {
  const h = harness();
  h.addSchedule({ DurationDays: 3, Times: '08:00,20:00', ExpiryReminderDaysBefore: 2, ...changes });
  h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED');
  h.id = h.records('schedules')[0].ID;
  return h;
}
function process(h) { return h.context.ScheduleExpiryService.processPending(); }
function choose(h, resolution = 'CONTINUATION_CREATED', version = 1) {
  return h.context.ScheduleContinuationService.resolve(h.id, version, resolution);
}
function snapshot(h) {
  return JSON.stringify({ tables: Object.fromEntries(Object.entries(h.sheets).map(([name, sheet]) => [name, sheet.data])), props: [...h.props] });
}
function correct(h, changes) {
  h.edit('schedules', h.id, { ...changes, Status: 'READY_FOR_RECONCILIATION' });
  h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED', h.records('schedules')[0].LastError);
}

test('expiry validation preserves legacy plan JSON for disabled values and rejects invalid values', () => {
  const h = harness(); const row = h.addSchedule();
  const normalize = value => h.context.MedicationPlan.normalize({ ...row, ExpiryReminderDaysBefore: value }, row.StartDate, 2000);
  const legacy = JSON.stringify(normalize(undefined));
  for (const value of ['', ' ', 0, '0', null]) assert.equal(JSON.stringify(normalize(value)), legacy);
  for (const value of [-1, 366, 1.5, true, [], {}, 'abc']) assert.throws(() => normalize(value), /ExpiryReminder/);
  assert.equal(normalize(365).expiryReminderDaysBefore, 365);
});

test('setup expiry formula avoids locale separators and follows reordered columns beyond Z', () => {
  const h = harness();
  const formulas = [];
  const builder = h.context.SpreadsheetApp.newDataValidation;
  h.context.SpreadsheetApp.newDataValidation = () => {
    const rule = builder();
    rule.requireFormulaSatisfied = function (formula) {
      assert.doesNotMatch(formula, /[,;]/);
      formulas.push(formula); return this;
    };
    return rule;
  };
  h.context.setupSpreadsheet();
  assert.equal(formulas[0], '=(($M2="")+ISNUMBER($M2)*($M2>=0)*($M2<=365)*($M2=INT($M2)))>0');
  const sheet = h.sheets['medication-schedules'];
  const index = sheet.data[0].indexOf('ExpiryReminderDaysBefore');
  sheet.data[0].splice(index, 1);
  while (sheet.data[0].length < 27) sheet.data[0].push('Extra' + sheet.data[0].length);
  sheet.data[0].push('ExpiryReminderDaysBefore');
  h.context.setupSpreadsheet(); h.context.setupSpreadsheet();
  assert.match(formulas[1], /\$AB2/); assert.equal(formulas[1], formulas[2]);
});

test('window uses shared moments, handles one intake, early threshold and calendar DST', () => {
  const h = generated({ DurationDays: 1, Times: '03:30', StartDate: '2026-03-29', ExpiryReminderDaysBefore: 30 });
  const ctx = h.context.ScheduleExpiryService.context(h.id, 1);
  assert.equal(ctx.window.lastDate, '2026-03-29'); assert.equal(ctx.window.threshold, '2026-02-27');
  assert.equal(ctx.window.endDate, '2026-04-05');
  assert.equal(h.context.ScheduleExpiryRules.shift('2026-10-25', 7), '2026-11-01');
  assert.equal(h.context.ScheduleExpiryRules.continuationStart('2026-03-29', '2026-03-29'), '2026-03-30');
  assert.equal(h.context.ScheduleExpiryRules.continuationStart('2026-03-29', '2026-03-30'), '');
});

test('before threshold no lifecycle, disabled legacy schedules unchanged', () => {
  const h = generated({ DurationDays: 10 }); const before = snapshot(h);
  process(h); assert.equal(snapshot(h), before); assert.equal(h.sent.length, 0);
  const disabled = generated({ ExpiryReminderDaysBefore: '' }); const saved = snapshot(disabled);
  process(disabled); assert.equal(snapshot(disabled), saved);
});

test('daily attempts use local date and configurable start hour, not elapsed 24 hours', () => {
  const h = generated(); h.now = Date.parse('2026-09-29T05:59:00Z');
  process(h); assert.equal(h.sent.length, 0);
  h.now = Date.parse('2026-09-29T20:30:00Z'); process(h); process(h); assert.equal(h.sent.length, 1);
  h.now = Date.parse('2026-09-30T06:00:00Z'); process(h); assert.equal(h.sent.length, 2);
  assert.equal(h.records('expiry')[0].DecisionStatus, 'OPEN');
  h.props.set('EXPIRY_REMINDER_START_HOUR', '24'); assert.throws(() => process(h), /EXPIRY/);
});

test('daily expiry attempts remain distinct across winter DST and trigger delay', () => {
  const h = generated({ StartDate: '2026-10-24', DurationDays: 3 });
  h.now = Date.parse('2026-10-24T20:00:00Z'); process(h);
  h.now = Date.parse('2026-10-25T07:00:00Z'); process(h); process(h);
  assert.equal(h.sent.length, 2);
});

test('day plus seven sends, day plus eight expires while leaving decision open and actionable', () => {
  const h = generated(); h.now = Date.parse('2026-10-08T08:00:00Z'); process(h);
  assert.equal(h.sent.length, 1); assert.equal(h.records('expiry')[0].ReminderStatus, 'ACTIVE');
  h.now = Date.parse('2026-10-09T08:00:00Z'); process(h);
  assert.equal(h.sent.length, 1);
  assert.equal(h.records('expiry')[0].ReminderStatus, 'EXPIRED'); assert.equal(h.records('expiry')[0].DecisionStatus, 'OPEN');
  choose(h, 'NO_CONTINUATION'); assert.equal(h.records('expiry')[0].DecisionStatus, 'RESOLVED');
  const late = generated(); late.now = Date.parse('2026-10-20T08:00:00Z'); process(late);
  assert.equal(late.records('expiry')[0].ReminderStatus, 'EXPIRED'); assert.equal(late.sent.length, 0);
});

test('old versions and paused schemas also expire their open reminder periods without resolution', () => {
  const h = generated(); process(h);
  correct(h, { DurationDays: 4, ExpiryReminderDaysBefore: 3 }); process(h);
  h.edit('schedules', h.id, { Status: 'ERROR' });
  h.now = Date.parse('2026-10-12T10:00:00Z'); const sent = h.sent.length;
  process(h);
  assert.equal(h.sent.length, sent); assert.equal(h.records('expiry').length, 2);
  for (const row of h.records('expiry')) {
    assert.equal(row.ReminderStatus, 'EXPIRED'); assert.equal(row.DecisionStatus, 'OPEN'); assert.equal(row.Resolution, '');
  }
});

test('template branches compile, escape plan text and omit forms for old or resolved versions', () => {
  const h = generated();
  const file = fs.readFileSync(path.join(__dirname, '../src/entrypoints/web/ScheduleExpiry.html'), 'utf8');
  function render(model) {
    let source = 'var output = "";'; let offset = 0;
    for (const match of file.matchAll(/<\?([=!]?)([\s\S]*?)\?>/g)) {
      source += 'output += ' + JSON.stringify(file.slice(offset, match.index)) + ';';
      source += match[1] ? 'output += escapeHtml(' + match[2] + ');' : match[2];
      offset = match.index + match[0].length;
    }
    source += 'output += ' + JSON.stringify(file.slice(offset)) + '; output;';
    return vm.runInNewContext(source, { model, error: '', url: 'https://example.test/exec', todayUrl: 'https://example.test/exec?action=today',
      continuationToken: 'test-token', noContinuationToken: 'test-token',
      escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') });
  }
  const model = h.context.ScheduleExpiryService.inspect(h.id, 1); model.medication = '<script>bad</script>';
  let result = render(model); assert.equal((result.match(/<form /g) || []).length, 2);
  assert.match(result, /&lt;script>/); assert.doesNotMatch(result, /<script>bad/);
  result = render({ ...model, pending: true, pendingChoice: 'NO_CONTINUATION' });
  assert.equal((result.match(/<form /g) || []).length, 1);
  assert.doesNotMatch(render({ ...model, current: false, canChoose: false }), /<form /);
  assert.doesNotMatch(render({ ...model, resolved: true, canChoose: false, resolution: 'NO_CONTINUATION' }), /<form /);
});

for (const failure of ['http', 'network', 'result-write', 'reservation-flush']) {
  test('one attempt per day despite ' + failure, () => {
    const h = generated();
    if (failure === 'http') h.onFetch = () => ({ getResponseCode: () => 500, getContentText: () => '{"status":0}' });
    if (failure === 'network') h.onFetch = () => { throw new Error('Unknown outcome'); };
    if (failure === 'result-write') h.beforeWrite = (sheet, row, col, value) => {
      if (sheet.name.endsWith('-expiry') && sheet.data[0][col - 1] === 'LastError' && value === '' && h.sent.length) throw new Error('Write failed');
    };
    if (failure === 'reservation-flush') h.onFlush = () => {
      if (h.records('expiry').some(row => row.LastReminderAttemptAt)) throw new Error('Uncertain flush');
    };
    process(h); h.onFlush = null; h.beforeWrite = null; const attempts = h.sent.length;
    process(h); assert.equal(h.sent.length, attempts); assert.equal(h.records('expiry')[0].DecisionStatus, 'OPEN');
    h.now += 86400000; process(h); assert.equal(h.sent.length, attempts + 1);
  });
}

test('shared lock blocks sending and choices and invalid records do not stop other schedules', () => {
  const h = generated(); h.locked = true;
  assert.equal(process(h).busy, true); assert.throws(() => choose(h), /andere verwerking/);
  assert.equal(h.sent.length, 0); assert.equal(h.records('expiry').length, 0);
  h.locked = false;
  h.addSchedule({ DurationDays: 1, ExpiryReminderDaysBefore: 2 }); h.context.processReadySchedules();
  const history = h.sheets['medication-schedule-history']; history.data[1][history.data[0].indexOf('Times')] = 'invalid';
  const result = process(h); assert.equal(result.failed, 1); assert.equal(h.sent.length, 1);
});

test('expiry reads history despite unapplied sheet edits, and missing history is not synthesized', () => {
  const h = generated(); h.edit('schedules', h.id, { DurationDays: 99, Medication: 'Unapplied', ExpiryReminderDaysBefore: 0 });
  process(h); assert.equal(h.sent.length, 1); assert.doesNotMatch(h.sent[0].options.payload.message, /Unapplied/);
  assert.equal(h.context.ScheduleExpiryService.inspect(h.id, 1).lastDate, '2026-10-01');
  const missing = generated(); missing.sheets['medication-schedule-history'].data.splice(1);
  process(missing); assert.equal(missing.records('expiry').length, 0); assert.equal(missing.sent.length, 0);
  assert.ok(missing.context.ManagementService.status().records.some(row => row.heading === 'Expiry zonder toegepaste history-versie'));
});

test('new history version has own lifecycle and old GET and POST cannot mutate', () => {
  const h = generated(); process(h); choose(h);
  const draft = JSON.stringify(h.records('schedules')[1]);
  correct(h, { ExpiryReminderDaysBefore: 3 });
  const before = snapshot(h);
  const old = h.context.ScheduleExpiryService.inspect(h.id, 1);
  assert.equal(old.current, false); assert.equal(old.canChoose, false);
  assert.throws(() => choose(h, 'NO_CONTINUATION', 1), /eerdere/); assert.equal(snapshot(h), before);
  process(h); assert.equal(h.records('expiry').length, 2);
  assert.equal(h.context.ScheduleExpiryService.inspect(h.id, 2).previous.length, 1);
  choose(h, 'CONTINUATION_CREATED', 2);
  assert.equal(h.records('schedules').length, 3); assert.equal(JSON.stringify(h.records('schedules')[1]), draft);
});

test('GET is read-only, including before state creation, resolved and expired pages', () => {
  const h = generated(); const before = snapshot(h);
  h.context.doGet({ parameter: { action: 'schedule-expiry', id: h.id, version: '1' } });
  assert.equal(h.rendered.model.canChoose, true); assert.ok(h.rendered.continuationToken);
  assert.equal(snapshot(h), before); assert.equal(h.sent.length, 0);
  h.now = Date.parse('2026-10-10T12:00:00Z'); const late = snapshot(h);
  h.context.doGet({ parameter: { action: 'schedule-expiry', id: h.id, version: '1' } });
  assert.equal(h.rendered.model.expired, true); assert.equal(snapshot(h), late);
});

test('POST requires token, action binding, unambiguous parameters and explicit no-continuation confirmation', () => {
  const h = generated();
  const token = h.context.ExpiryFormToken.issue(h.id, 1, 'NO_CONTINUATION');
  const params = { action: 'no-continuation', id: h.id, version: '1', token, confirmed: 'YES' };
  const before = snapshot(h);
  for (const changed of [{ token: '' }, { action: 'create-continuation' }, { confirmed: '' }, { version: '2' }]) {
    h.context.doPost({ parameter: { ...params, ...changed } }); assert.equal(snapshot(h), before);
  }
  h.context.doPost({ parameter: params, parameters: { id: [h.id, h.id] } }); assert.equal(snapshot(h), before);
  h.context.doPost({ parameter: params }); assert.equal(h.records('expiry')[0].Resolution, 'NO_CONTINUATION');
  const resolved = snapshot(h); h.context.doPost({ parameter: params }); assert.equal(snapshot(h), resolved);
  assert.doesNotMatch(h.logs.join(''), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('expired form tokens reject POST and GET action names never resolve', () => {
  const h = generated(); const token = h.context.ExpiryFormToken.issue(h.id, 1, 'CONTINUATION_CREATED');
  h.now += 86400001; const before = snapshot(h);
  h.context.doPost({ parameter: { action: 'create-continuation', id: h.id, version: '1', token } });
  h.context.doGet({ parameter: { action: 'create-continuation', id: h.id, version: '1', token } });
  assert.equal(snapshot(h), before);
});

test('continuation before/on expiry copies proposal only, keeps source and intakes and is immutable', () => {
  const h = generated(); h.now = Date.parse('2026-10-01T12:00:00Z');
  const source = JSON.stringify(h.records('schedules')[0]), intakes = JSON.stringify(h.records('intakes'));
  choose(h); const draft = h.records('schedules')[1];
  assert.equal(draft.Status, 'DRAFT'); assert.equal(draft.StartDate, '2026-10-02'); assert.notEqual(draft.ID, h.id);
  assert.equal(draft.SourceScheduleID, h.id); assert.equal(draft.SourceScheduleVersion, 1);
  assert.equal(draft.ExpiryReminderDaysBefore, 2); assert.equal(draft.ApplicationState, ''); assert.equal(draft.LastError, '');
  const before = snapshot(h); h.now += 60000; choose(h); assert.equal(snapshot(h), before);
  assert.throws(() => choose(h, 'NO_CONTINUATION'), /andere keuze/);
  assert.equal(JSON.stringify(h.records('schedules')[0]), source); assert.equal(JSON.stringify(h.records('intakes')), intakes);
  h.context.processReadySchedules(); assert.equal(h.records('intakes').length, 6);
});

test('late continuation has blank date and generates only after explicit valid READY', () => {
  const h = generated(); h.now = Date.parse('2026-10-02T10:00:00Z'); choose(h);
  const draft = h.records('schedules')[1]; assert.equal(draft.StartDate, '');
  h.edit('schedules', draft.ID, { Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[1].Status, 'ERROR'); assert.equal(h.records('intakes').length, 6);
  h.edit('schedules', draft.ID, { StartDate: '2026-10-03', Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[1].Status, 'GENERATED'); assert.equal(h.records('intakes').length, 12);
});

test('no-continuation is immutable and does not infer linkage to a manually created plan', () => {
  const h = generated(); h.addSchedule({ Status: 'DRAFT' }); choose(h, 'NO_CONTINUATION');
  const before = snapshot(h); h.now += 60000; choose(h, 'NO_CONTINUATION');
  assert.equal(snapshot(h), before); assert.throws(() => choose(h), /andere keuze/);
  process(h); assert.equal(h.sent.length, 0); assert.equal(h.records('schedules').length, 2);
});

for (const resolution of ['CONTINUATION_CREATED', 'NO_CONTINUATION']) {
  test('every decision write and flush can be interrupted and resumed: ' + resolution, () => {
    for (const boundary of ['write', 'flush']) {
      const counter = generated(); let count = 0;
      if (boundary === 'write') counter.beforeWrite = () => { count++; }; else counter.onFlush = () => { count++; };
      choose(counter, resolution);
      for (let failAt = 1; failAt <= count; failAt++) {
        const h = generated(); let seen = 0;
        const fail = () => { if (++seen === failAt) throw new Error('Interrupted'); };
        if (boundary === 'write') h.beforeWrite = fail; else h.onFlush = fail;
        assert.throws(() => choose(h, resolution));
        h.beforeWrite = null; h.onFlush = null;
        const reserved = h.records('expiry')[0];
        if (reserved?.DecisionStatus === 'RESOLVED' && resolution === 'CONTINUATION_CREATED') {
          assert.equal(h.records('schedules')[1].Status, 'DRAFT');
        }
        choose(h, resolution);
        assert.equal(h.records('expiry').length, 1, boundary + failAt);
        assert.equal(h.records('expiry')[0].DecisionStatus, 'RESOLVED');
        assert.equal(h.records('expiry')[0].Resolution, resolution);
        assert.equal(h.records('schedules').length, resolution === 'CONTINUATION_CREATED' ? 2 : 1);
      }
    }
  });
}

test('pending journal blocks opposite choice and preserves original draft across midnight', () => {
  const h = generated(); h.now = Date.parse('2026-10-01T21:59:00Z');
  h.beforeWrite = (sheet, row, col, value) => { if (sheet.name === 'medication-schedules' && row === 3 && value === 'DRAFT') throw new Error('Interrupted'); };
  assert.throws(() => choose(h)); h.beforeWrite = null;
  const state = h.records('expiry')[0]; const journal = JSON.parse(state.ResolutionState);
  assert.throws(() => choose(h, 'NO_CONTINUATION'), /andere keuze/);
  h.now = Date.parse('2026-10-02T08:00:00Z'); choose(h);
  assert.equal(h.records('schedules')[1].StartDate, '2026-10-02');
  assert.equal(h.records('schedules')[1].ID, journal.draft.ID);
  assert.equal(h.records('expiry')[0].ResolvedAt.toISOString(), journal.at);
});

test('expiry initialization resumes every partial write without duplicate states or daily sends', () => {
  const counter = generated(); let count = 0; counter.beforeWrite = () => { count++; }; process(counter);
  for (let failAt = 1; failAt <= count; failAt++) {
    const h = generated(); let seen = 0;
    h.beforeWrite = () => { if (++seen === failAt) throw new Error('Interrupted'); };
    process(h); h.beforeWrite = null; process(h); process(h);
    assert.equal(h.records('expiry').length, 1); assert.ok(h.sent.length <= 1);
    assert.equal(h.records('expiry')[0].DecisionStatus, 'OPEN');
  }
});

test('expiry-only reconciliation versions history without touching intakes and blank equals zero', () => {
  const h = generated({ ExpiryReminderDaysBefore: '' }); const before = JSON.stringify(h.records('intakes'));
  correct(h, { ExpiryReminderDaysBefore: 0 }); assert.equal(h.records('history').length, 1);
  correct(h, { ExpiryReminderDaysBefore: 5 }); assert.equal(h.records('history').length, 2);
  assert.equal(h.records('history')[1].ExpiryReminderDaysBefore, 5);
  assert.equal(JSON.stringify(h.records('intakes')), before);
});

test('setup migrates legacy headers without changing existing cells or creating lifecycles', () => {
  const h = generated({ ExpiryReminderDaysBefore: '' });
  for (const name of ['medication-schedules', 'medication-schedule-history']) {
    const sheet = h.sheets[name];
    for (const column of ['ExpiryReminderDaysBefore', 'SourceScheduleID', 'SourceScheduleVersion']) {
      const index = sheet.data[0].indexOf(column); if (index >= 0) sheet.data.forEach(row => row.splice(index, 1));
    }
  }
  delete h.sheets['medication-schedule-expiry'];
  const before = JSON.parse(snapshot(h)).tables; const hash = h.props.get('PLAN_' + h.id);
  h.context.setupSpreadsheet(); h.context.setupSpreadsheet();
  for (const [name, data] of Object.entries(before)) assert.equal(JSON.stringify(h.sheets[name].data.map(row => row.slice(0, data[0].length))), JSON.stringify(data));
  assert.equal(h.records('expiry').length, 0); assert.equal(h.sent.length, 0); assert.equal(h.props.get('PLAN_' + h.id), hash);
  h.edit('schedules', h.id, { Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED'); assert.equal(h.records('history').length, 1);
});

test('legacy incomplete application resumes with its original hash and published history', () => {
  const h = harness(); h.addSchedule({ ExpiryReminderDaysBefore: '', DurationDays: 1 });
  h.beforeWrite = (sheet, row, col, value) => { if (sheet.name === 'medication-schedules' && value === 'GENERATED') throw new Error('Interrupted'); };
  h.context.processReadySchedules(); h.beforeWrite = null;
  h.id = h.records('schedules')[0].ID;
  const state = JSON.parse(h.records('schedules')[0].ApplicationState);
  assert.equal(state.plan.expiryReminderDaysBefore, undefined);
  const history = h.sheets['medication-schedule-history'];
  const column = history.data[0].indexOf('ExpiryReminderDaysBefore'); history.data.forEach(row => row.splice(column, 1));
  h.context.setupSpreadsheet(); h.edit('schedules', h.id, { Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED'); assert.equal(h.records('history').length, 1);
});

test('in-progress source blocks expiry POST, while management explains pending decisions without journal contents', () => {
  const h = generated(); process(h);
  h.edit('schedules', h.id, { Status: 'READY_FOR_RECONCILIATION' });
  const before = snapshot(h); assert.throws(() => choose(h), /verwerkt/); process(h); assert.equal(snapshot(h), before);
  const record = h.records('expiry')[0]; h.edit('expiry', record.ID, { ResolutionState: '{"private":"never-show"}' });
  assert.doesNotMatch(JSON.stringify(h.context.ManagementService.inspect('expiry', record.ID)), /never-show/);
  assert.ok(h.context.ManagementService.status().records.some(row => row.heading === 'Onafgeronde expiry-verwerking'));
});

test('expiry page asks explicit confirmation and cancellation prevents submission', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/entrypoints/web/ScheduleExpiry.html'), 'utf8');
  const form = { id: 'no-continuation', addEventListener: (_, fn) => { form.submit = fn; } };
  const confirmed = { value: '' }, button = { disabled: false }, feedback = {};
  let accept = false;
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { querySelectorAll: selector => selector === 'form' ? [form] : [button], getElementById: id => id === 'confirmed' ? confirmed : feedback },
    window: { confirm: () => accept, addEventListener() {} }
  });
  let cancelled = false; form.submit({ preventDefault() { cancelled = true; } });
  assert.equal(cancelled, true); assert.equal(confirmed.value, ''); assert.equal(button.disabled, false);
  accept = true; form.submit({ preventDefault() { assert.fail(); } });
  assert.equal(confirmed.value, 'YES'); assert.equal(button.disabled, true);
});
