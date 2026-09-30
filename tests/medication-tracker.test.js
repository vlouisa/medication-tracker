const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./helpers');

function generated(changes = {}) {
  const h = harness();
  h.addSchedule({ DurationDays: 1, Times: '14:00', ...changes });
  h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED');
  return h;
}

test('two days and three distinct times produce six UUID snapshots', () => {
  const h = harness();
  h.addSchedule({ Times: '8:00, 14:00,14:00,20:00' });
  h.context.processReadySchedules();
  const intakes = h.records('intakes');
  assert.equal(intakes.length, 6);
  assert.equal(new Set(intakes.map(i => i.ID)).size, 6);
  assert.ok(intakes.every(i => i.Medication === 'Dexa' && i.Administration === 'rechteroog' && i.Status === 'PENDING'));
  assert.equal(intakes[0].ScheduledAt.toISOString(), '2026-09-29T06:00:00.000Z');
  assert.equal(intakes[5].ScheduledAt.toISOString(), '2026-09-30T18:00:00.000Z');
});

test('DRAFT and blank status are ignored', () => {
  const h = harness();
  h.addSchedule({ Status: 'DRAFT' }); h.addSchedule({ Status: '' });
  h.context.processReadySchedules();
  assert.equal(h.records('intakes').length, 0);
  assert.ok(h.records('schedules').every(s => s.ID === ''));
});

for (const changes of [{ Times: '08:00,foo,20:00' }, { Times: '08:00,' }, { Times: '24:00' },
  { Times: '08:60' }, { DurationDays: 1.5 }, { DurationDays: 0 }, { StartDate: '2026-02-30' },
  { Medication: ' ' }, { Dosage: '' }, { DurationDays: 2001 }]) {
  test(`invalid schedule writes no intakes: ${JSON.stringify(changes)}`, () => {
    const h = harness(); h.addSchedule(changes); h.context.processReadySchedules();
    assert.equal(h.records('intakes').length, 0);
    assert.equal(h.records('schedules')[0].Status, 'ERROR');
    assert.ok(h.records('schedules')[0].LastError);
    assert.ok(h.records('schedules')[0].CreatedAt instanceof h.Date);
  });
}

test('a bad record does not stop a valid record', () => {
  const h = harness(); h.addSchedule({ Times: 'foo' }); h.addSchedule();
  h.context.processReadySchedules();
  assert.equal(h.records('intakes').length, 6);
  assert.equal(h.records('schedules')[1].Status, 'GENERATED');
});

test('reprocessing preserves IDs and existing completion', () => {
  const h = generated(); const schedule = h.records('schedules')[0]; const intake = h.records('intakes')[0];
  h.context.completeIntake(intake.ID);
  const completed = h.records('intakes')[0].CompletedAt.getTime();
  h.edit('schedules', schedule.ID, { Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('intakes').length, 1);
  assert.equal(h.records('intakes')[0].ID, intake.ID);
  assert.equal(h.records('intakes')[0].CompletedAt.getTime(), completed);
});

test('partial generation recovers missing records and rejects changed planning', () => {
  const h = harness(); h.addSchedule();
  let failed = false;
  h.beforeWrite = (sheet, row) => {
    if (sheet.name === 'medication-intakes' && row === 5 && !failed) { failed = true; throw new Error('Simulated interruption'); }
  };
  h.context.processReadySchedules(); h.beforeWrite = null;
  const originalIds = h.records('intakes').map(i => i.ID);
  assert.equal(originalIds.length, 3);
  const schedule = h.records('schedules')[0];
  assert.equal(schedule.Status, 'ERROR');
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
  h.edit('schedules', schedule.ID, { DurationDays: 3, Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'ERROR'); assert.equal(h.records('intakes').length, 3);
  h.edit('schedules', schedule.ID, { DurationDays: 2, Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED'); assert.equal(h.records('intakes').length, 6);
  assert.deepEqual(h.records('intakes').slice(0, 3).map(i => i.ID), originalIds);
});

test('equal count with wrong timestamp is not accepted', () => {
  const h = generated(); const intake = h.records('intakes')[0];
  h.edit('intakes', intake.ID, { ScheduledAt: new h.Date('2026-09-29T13:00:00Z') });
  h.edit('schedules', intake.ScheduleID, { Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'ERROR');
});

test('calendar days preserve local time over spring and autumn changes', () => {
  const spring = generated({ StartDate: '2026-03-28', DurationDays: 3, Times: '08:00' });
  const s = spring.records('intakes');
  assert.equal(s[1].ScheduledAt - s[0].ScheduledAt, 23 * 3600000);
  const autumn = generated({ StartDate: '2026-10-24', DurationDays: 3, Times: '08:00' });
  const a = autumn.records('intakes');
  assert.equal(a[1].ScheduledAt - a[0].ScheduledAt, 25 * 3600000);
});

test('nonexistent local time rejects entire generation; repeated hour chooses first', () => {
  const h = harness(); h.addSchedule({ StartDate: '2026-03-29', Times: '01:30,02:30,03:30' });
  h.context.processReadySchedules(); assert.equal(h.records('intakes').length, 0);
  assert.equal(h.records('schedules')[0].Status, 'ERROR');
  const a = generated({ StartDate: '2026-10-25', Times: '02:30' });
  assert.equal(a.records('intakes')[0].ScheduledAt.toISOString(), '2026-10-25T00:30:00.000Z');
});

test('month and year boundaries are calendar days', () => {
  const h = generated({ StartDate: '2026-12-31', DurationDays: 2 });
  assert.equal(h.records('intakes')[1].ScheduledAt.toISOString(), '2027-01-01T13:00:00.000Z');
});

test('first notification and exactly three repeats spaced by twenty minutes', () => {
  const h = generated(); h.context.processPendingIntakeNotifications();
  const first = h.records('intakes')[0].NotifiedAt.getTime();
  assert.equal(h.sent.length, 1);
  for (let i = 0; i < 3; i++) {
    h.now += 19 * 60000; h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, i + 1);
    h.now += 60000; h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, i + 2);
  }
  h.now += 86400000; h.context.processPendingIntakeNotifications();
  assert.equal(h.sent.length, 4);
  const intake = h.records('intakes')[0];
  assert.equal(intake.ReminderCount, 3); assert.equal(intake.Status, 'NOTIFIED');
  assert.equal(intake.NotifiedAt.getTime(), first);
  assert.match(h.sent[1].options.payload.message, /Gemiste herinnering/);
  assert.match(h.sent[1].options.payload.message, /29-09-2026 14:00/);
});

test('repeat count and interval are configurable, including zero', () => {
  const h = generated(); h.props.set('REMINDER_REPEAT_COUNT', '1'); h.props.set('REMINDER_INTERVAL_MINUTES', '5');
  h.context.processPendingIntakeNotifications(); h.now += 300000; h.context.processPendingIntakeNotifications();
  h.now += 300000; h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 2);
  const zero = generated(); zero.props.set('REMINDER_REPEAT_COUNT', '0');
  zero.context.processPendingIntakeNotifications(); zero.now += 86400000;
  zero.context.processPendingIntakeNotifications(); assert.equal(zero.sent.length, 1);
});

test('downtime produces one overdue notification, no burst of repetitions', () => {
  const h = generated(); h.now += 86400000;
  h.context.processPendingIntakeNotifications(); h.context.processPendingIntakeNotifications();
  assert.equal(h.sent.length, 1); assert.match(h.sent[0].options.payload.message, /Gemiste herinnering/);
  h.now += 86400000; h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 2);
});

for (const failure of ['network', '500', 'invalid-body', 'status-zero']) {
  test(`technical ${failure} error remains blocked on subsequent trigger`, () => {
    const h = generated(); h.onFetch = () => {
      if (failure === 'network') throw new Error('fake network failure');
      return { getResponseCode: () => failure === '500' ? 500 : 200,
        getContentText: () => failure === 'invalid-body' ? '<html>' : '{"status":0}' };
    };
    h.context.processPendingIntakeNotifications(); h.now += 3600000; h.context.processPendingIntakeNotifications();
    const intake = h.records('intakes')[0];
    assert.equal(h.sent.length, 1); assert.equal(intake.Status, 'PENDING');
    assert.ok(intake.NotificationBlockedAt); assert.ok(intake.LastError); assert.equal(intake.NotifiedAt, '');
  });
}

test('failed repeat keeps first notification and does not consume successful repeat count', () => {
  const h = generated(); h.context.processPendingIntakeNotifications(); h.now += 1200000;
  h.onFetch = () => { throw new Error('offline'); };
  h.context.processPendingIntakeNotifications(); h.now += 1200000; h.context.processPendingIntakeNotifications();
  const intake = h.records('intakes')[0];
  assert.equal(h.sent.length, 2); assert.equal(intake.Status, 'NOTIFIED'); assert.equal(intake.ReminderCount, 0);
});

test('write failure after accepted notification prevents duplicate technical attempt', () => {
  const h = generated();
  h.beforeWrite = (sheet, row, col) => {
    if (sheet.name === 'medication-intakes' && row > 1 && sheet.data[0][col - 1] === 'NotifiedAt') throw new Error('storage failure');
  };
  h.context.processPendingIntakeNotifications(); h.beforeWrite = null;
  h.now += 1200000; h.context.processPendingIntakeNotifications();
  assert.equal(h.sent.length, 1); assert.ok(h.records('intakes')[0].NotificationBlockedAt);
});

test('failed preflight write sends nothing', () => {
  const h = generated();
  h.beforeWrite = (sheet, row, col) => {
    if (sheet.name === 'medication-intakes' && row > 1 && sheet.data[0][col - 1] === 'NotificationBlockedAt') throw new Error('storage failure');
  };
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
});

test('completion is idempotent and cancels all subsequent reminders', () => {
  const h = generated(); h.context.processPendingIntakeNotifications(); const id = h.records('intakes')[0].ID;
  h.now += 60000; h.context.completeIntake(id);
  const first = h.records('intakes')[0]; h.now += 86400000;
  const result = h.context.completeIntake(id); h.context.processPendingIntakeNotifications();
  assert.equal(result.already, true); assert.equal(h.sent.length, 1);
  assert.equal(h.records('intakes')[0].CompletedAt.getTime(), first.CompletedAt.getTime());
  assert.equal(h.records('intakes')[0].UpdatedAt.getTime(), first.UpdatedAt.getTime());
});

test('partial completion write preserves original time on retry and suppresses reminders', () => {
  const h = generated(); const id = h.records('intakes')[0].ID;
  let fail = true;
  h.beforeWrite = (sheet, row, col, value) => {
    if (fail && sheet.name === 'medication-intakes' && value === 'COMPLETED') { fail = false; throw new Error('interrupted'); }
  };
  assert.throws(() => h.context.completeIntake(id));
  const completedAt = h.records('intakes')[0].CompletedAt.getTime();
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
  h.now += 60000; h.context.completeIntake(id);
  assert.equal(h.records('intakes')[0].CompletedAt.getTime(), completedAt);
});

test('GET is read-only, including repeated opening; malformed links produce error page', () => {
  const h = generated(); const id = h.records('intakes')[0].ID;
  h.context.doGet({ parameter: { action: 'complete', id } });
  assert.equal(h.rendered.model.completed, false); assert.equal(h.records('intakes')[0].Status, 'PENDING');
  h.context.doGet({ parameter: { action: 'complete', id: 'not-a-uuid' } }); assert.ok(h.rendered.error);
  h.context.doGet({ parameter: { action: 'complete', id }, parameters: { id: [id, id] } }); assert.ok(h.rendered.error);
});

test('SKIPPED and MISSED are not completed or notified', () => {
  for (const status of ['SKIPPED', 'MISSED']) {
    const h = generated(); const id = h.records('intakes')[0].ID;
    h.edit('intakes', id, { Status: status });
    assert.throws(() => h.context.completeIntake(id)); h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
  }
});

test('script lock prevents competing generation, notification and completion', () => {
  const h = harness(); h.addSchedule(); h.locked = true;
  h.context.processReadySchedules(); assert.equal(h.records('intakes').length, 0);
  h.locked = false; h.context.processReadySchedules(); h.locked = true;
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
  assert.throws(() => h.context.completeIntake(h.records('intakes')[0].ID));
});

test('completion competing with send does not downgrade completed status', () => {
  const h = generated(); const id = h.records('intakes')[0].ID;
  h.onFetch = () => {
    assert.throws(() => h.context.completeIntake(id));
    return { getResponseCode: () => 200, getContentText: () => '{"status":1}' };
  };
  h.context.processPendingIntakeNotifications(); h.context.completeIntake(id);
  h.now += 1200000; h.context.processPendingIntakeNotifications();
  assert.equal(h.sent.length, 1); assert.equal(h.records('intakes')[0].Status, 'COMPLETED');
});

test('setup and trigger installation are repeatable and preserve operational data', () => {
  const h = generated(); const before = JSON.stringify(h.records('intakes'));
  h.context.setupSpreadsheet(); h.context.setupSpreadsheet();
  assert.equal(JSON.stringify(h.records('intakes')), before);
  assert.equal(h.sheets['medication-schedules'].protections.length, 4);
  assert.equal(h.sheets['medication-intakes'].protections.length, 1);
  h.context.installMedicationTriggers(); h.context.installMedicationTriggers();
  assert.equal(h.triggers.length, 2); assert.deepEqual(h.triggers.map(t => t.minutes), [5, 1]);
});

test('headers may be reordered and extra columns survive generation', () => {
  const h = harness(); const sheet = h.sheets['medication-schedules'];
  sheet.data[0].reverse(); sheet.data[0].push('Notes');
  h.addSchedule({ Notes: 'keep me' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Notes, 'keep me'); assert.equal(h.records('intakes').length, 6);
});

test('duplicate UUIDs and missing headers stop processing', () => {
  const h = generated(); const sheet = h.sheets['medication-intakes']; sheet.data.push(sheet.data[1].slice());
  assert.throws(() => h.records('intakes'), /Dubbele UUID/);
  const other = harness(); other.sheets['medication-schedules'].data[0][0] = 'wrong';
  assert.throws(() => other.context.setupSpreadsheet(), /Ontbrekende Sheet-header/);
});

test('timezone mismatch with existing data is not silently changed', () => {
  const h = generated(); h.book.timezone = 'UTC';
  assert.throws(() => h.context.setupSpreadsheet(), /afwijkende timezone/);
  assert.equal(h.book.timezone, 'UTC');
});

test('snapshot values are escaped against Sheet formulas', () => {
  const h = harness(); const values = [];
  h.beforeWrite = (sheet, row, col, value) => { if (sheet.name === 'medication-intakes' && row > 1) values.push(value); };
  h.addSchedule({ Medication: '=1+1' }); h.context.processReadySchedules();
  assert.ok(values.includes("'=1+1")); assert.equal(h.records('intakes')[0].Medication, '=1+1');
});

test('missing credentials fail before any attempt or notification', () => {
  const h = generated(); h.props.delete('PUSHOVER_API_TOKEN');
  assert.throws(() => h.context.processPendingIntakeNotifications(), /PUSHOVER_API_TOKEN/);
  assert.equal(h.sent.length, 0); assert.equal(h.records('intakes')[0].NotificationBlockedAt, '');
});

test('manifest limits Web App to the deploying Google account', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/appsscript.json'), 'utf8'));
  assert.equal(manifest.webapp.access, 'MYSELF'); assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.timeZone, 'Europe/Brussels');
});

test('intake writes respect reordered and whitespace-padded headers', () => {
  const h = harness(); const sheet = h.sheets['medication-intakes'];
  sheet.data[0] = sheet.data[0].reverse().map(header => ` ${header} `);
  h.addSchedule(); h.context.processReadySchedules();
  assert.equal(h.records('intakes').length, 6);
  assert.equal(h.records('schedules')[0].Status, 'GENERATED');
  assert.equal(h.records('intakes')[0].Medication, 'Dexa');
});

test('duplicate functional intake keys fail integrity validation', () => {
  const h = generated({ Times: '14:00,20:00' }); const intakes = h.records('intakes');
  h.edit('intakes', intakes[1].ID, { ScheduledAt: intakes[0].ScheduledAt });
  h.edit('schedules', intakes[0].ScheduleID, { Status: 'READY' }); h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'ERROR'); assert.equal(h.records('intakes').length, 2);
});

test('changed dosage and missing fingerprint cannot regenerate frozen schedules', () => {
  for (const mode of ['dosage', 'fingerprint']) {
    const h = generated(); const id = h.records('schedules')[0].ID;
    if (mode === 'fingerprint') h.props.delete(`PLAN_${id}`);
    h.edit('schedules', id, mode === 'dosage' ? { Dosage: '2 druppels', Status: 'READY' } : { Status: 'READY' });
    h.context.processReadySchedules();
    assert.equal(h.records('schedules')[0].Status, 'ERROR'); assert.equal(h.records('intakes')[0].Dosage, '1 druppel');
  }
});

test('schedule correction after validation error succeeds and clears LastError', () => {
  const h = harness(); h.addSchedule({ Times: 'foo' }); h.context.processReadySchedules();
  const sheet = h.sheets['medication-schedules'];
  sheet.data[1][sheet.data[0].indexOf('Times')] = '14:00';
  sheet.data[1][sheet.data[0].indexOf('Status')] = 'READY';
  h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED'); assert.equal(h.records('schedules')[0].LastError, '');
});

test('native Sheet date uses Brussels calendar day', () => {
  const h = harness(); h.addSchedule({ StartDate: new h.Date('2026-09-28T22:00:00Z'), DurationDays: 1, Times: '08:00' });
  h.context.processReadySchedules();
  assert.equal(h.records('intakes')[0].ScheduledAt.toISOString(), '2026-09-29T06:00:00.000Z');
});

test('one failed send does not stop other due intakes', () => {
  const h = generated({ Times: '08:00,14:00' });
  h.onFetch = () => {
    if (h.sent.length === 1) throw new Error('offline');
    return { getResponseCode: () => 200, getContentText: () => '{"status":1}' };
  };
  h.context.processPendingIntakeNotifications();
  assert.equal(h.sent.length, 2); assert.equal(h.records('intakes')[1].Status, 'NOTIFIED');
});

test('notifications are bounded per run and remaining work continues', () => {
  const h = generated({ StartDate: '2026-09-01', DurationDays: 26 });
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 25);
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 26);
});

test('pre-send flush failure prevents network side effect and leaves block', () => {
  const h = generated(); h.onFlush = () => { throw new Error('flush failed'); };
  h.context.processPendingIntakeNotifications(); h.onFlush = null;
  assert.equal(h.sent.length, 0); assert.ok(h.records('intakes')[0].NotificationBlockedAt);
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
});

test('lock is released after failed work', () => {
  const h = harness();
  assert.throws(() => h.context.ProcessingSupport.locked(() => { throw new Error('failure'); }));
  assert.equal(h.locked, false);
});

test('missing schedule does not send orphaned intake', () => {
  const h = generated(); h.sheets['medication-schedules'].data.splice(1);
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
});

test('no credentials or provider responses appear in logs or LastError', () => {
  const h = generated(); h.onFetch = () => { throw new Error('fake-token fake-user provider details'); };
  h.context.processPendingIntakeNotifications();
  const output = `${h.logs.join('\n')} ${h.records('intakes')[0].LastError}`;
  assert.doesNotMatch(output, /fake-token|fake-user|provider details/);
});

test('provider rejection shows HTTP and invalid field names without response contents', () => {
  const h = generated();
  h.onFetch = () => ({ getResponseCode: () => 400,
    getContentText: () => JSON.stringify({ status: 0, user: 'invalid', errors: ['fake-user fake-token'] }) });
  h.context.processPendingIntakeNotifications();
  const error = h.records('intakes')[0].LastError;
  assert.match(error, /HTTP 400/); assert.match(error, /Ongeldige velden: user/);
  assert.doesNotMatch(error, /fake-user|fake-token/);
});

test('authorization errors are identified without exposing original exception', () => {
  const h = generated(); h.onFetch = () => { throw new Error('Required permissions: script.external_request fake-token'); };
  h.context.processPendingIntakeNotifications();
  const error = h.records('intakes')[0].LastError;
  assert.match(error, /onvoldoende autorisatie/); assert.doesNotMatch(error, /fake-token/);
});

test('accepted send followed by storage error is reported separately', () => {
  const h = generated();
  h.beforeWrite = (sheet, row, col) => {
    if (sheet.name === 'medication-intakes' && row > 1 && sheet.data[0][col - 1] === 'NotifiedAt') throw new Error('write failed');
  };
  h.context.processPendingIntakeNotifications();
  assert.match(h.records('intakes')[0].LastError, /geaccepteerd, maar het opslaan/);
  assert.equal(h.sent.length, 1);
});

test('null JSON response reports invalid response and keeps notification blocked', () => {
  const h = generated(); h.onFetch = () => ({ getResponseCode: () => 502, getContentText: () => 'null' });
  h.context.processPendingIntakeNotifications();
  assert.match(h.records('intakes')[0].LastError, /HTTP 502.*geen geldig JSON-object/);
  assert.ok(h.records('intakes')[0].NotificationBlockedAt);
});

test('provider errors explain rejection while stripping credentials and URLs', () => {
  const h = generated();
  h.onFetch = () => ({ getResponseCode: () => 400, getContentText: () => JSON.stringify({ status: 0,
    errors: ['user has no active devices; fake-user fake-token https://example.com/private-link'] }) });
  h.context.processPendingIntakeNotifications();
  const error = h.records('intakes')[0].LastError;
  assert.match(error, /Reden: user has no active devices/);
  assert.doesNotMatch(error, /fake-user|fake-token|example.com|private-link/);
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 1);
});

test('malformed provider error lists are ignored and individual messages are bounded', () => {
  const h = generated();
  h.onFetch = () => ({ getResponseCode: () => 400, getContentText: () => JSON.stringify({ status: 0,
    errors: [null, { token: 'fake-token' }, 'invalid message '.repeat(100)] }) });
  h.context.processPendingIntakeNotifications();
  const error = h.records('intakes')[0].LastError;
  assert.match(error, /Reden: invalid message/); assert.ok(error.length < 400);
  assert.doesNotMatch(error, /fake-token/);
});

test('initial and repeated notifications use text form fields and default normal priority', () => {
  const h = generated();
  h.context.processPendingIntakeNotifications();
  h.now += 20 * 60000;
  h.context.processPendingIntakeNotifications();
  assert.equal(h.sent.length, 2);
  for (const request of h.sent) {
    assert.equal(request.options.method, 'post');
    assert.equal(Object.hasOwn(request.options.payload, 'priority'), false);
    assert.ok(Object.values(request.options.payload).every(value => typeof value === 'string'));
    assert.ok(request.options.payload.message);
    assert.match(request.options.payload.url, /\/exec\?action=complete&id=/);
  }
  assert.equal(h.records('intakes')[0].Status, 'NOTIFIED');
  assert.equal(h.records('intakes')[0].ReminderCount, 1);
});
