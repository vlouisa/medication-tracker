const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers');

function generated(changes = {}) {
  const h = harness();
  h.addSchedule({ Times: '15:00,16:00', DurationDays: 1, ...changes });
  h.context.processReadySchedules();
  assert.equal(h.records('schedules')[0].Status, 'GENERATED');
  return h;
}

function correct(h, changes = {}) {
  h.edit('schedules', h.records('schedules')[0].ID, { ...changes, Status: 'READY_FOR_RECONCILIATION' });
  h.context.processReadySchedules();
}

function successful(h) {
  const schedule = h.records('schedules')[0];
  assert.equal(schedule.Status, 'GENERATED', schedule.LastError);
  assert.equal(schedule.ApplicationState, '');
}

test('correction cancels obsolete intakes, creates future moments and records immutable versions', () => {
  const h = generated();
  const [old, unchanged] = h.records('intakes');
  const originalHistory = JSON.stringify(h.records('history')[0]);
  correct(h, { Times: '14:30,16:00' }); successful(h);
  const records = h.records('intakes');
  assert.equal(records.find(i => i.ID === old.ID).Status, 'CANCELLED');
  assert.deepEqual(records.find(i => i.ID === unchanged.ID), unchanged);
  assert.equal(records.length, 3);
  assert.equal(records[2].Status, 'PENDING');
  assert.equal(JSON.stringify(h.records('history')[0]), originalHistory);
  assert.deepEqual(h.records('history').map(r => r.Version), [1, 2]);
  const before = JSON.stringify(records);
  correct(h); successful(h);
  assert.equal(JSON.stringify(h.records('intakes')), before);
  assert.equal(h.records('history').length, 2);
});

test('cancelled reminder links remain readable and completion preserves original scheduled time', () => {
  const h = generated({ Times: '14:00' });
  h.context.processPendingIntakeNotifications();
  const intake = h.records('intakes')[0];
  correct(h, { Times: '15:00' }); successful(h);
  h.context.doGet({ parameter: { action: 'complete', id: intake.ID } });
  assert.equal(h.rendered.model.cancelled, true);
  assert.equal(h.records('intakes')[0].Status, 'CANCELLED');
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 1);
  h.context.completeIntake(intake.ID);
  const completed = h.records('intakes')[0];
  h.now += 60000; h.context.completeIntake(intake.ID);
  assert.deepEqual(h.records('intakes')[0], completed);
  assert.equal(completed.ScheduledAt.getTime(), intake.ScheduledAt.getTime());
  assert.equal(completed.Status, 'COMPLETED');
  assert.equal(h.records('intakes')[1].Status, 'PENDING');
});

test('completed and partially completed intakes are preserved by corrections', () => {
  const h = generated();
  const [first, second] = h.records('intakes');
  h.context.completeIntake(first.ID);
  h.edit('intakes', second.ID, { CompletedAt: new h.Date() });
  const before = JSON.stringify(h.records('intakes'));
  correct(h, { Times: '17:00', Dosage: '2 druppels' }); successful(h);
  assert.equal(JSON.stringify(h.records('intakes').slice(0, 2)), before);
  h.context.completeIntake(second.ID);
  assert.equal(h.records('intakes')[1].Status, 'COMPLETED');
});

test('pending snapshots update while notified and uncertain-send snapshots remain unchanged', () => {
  const h = generated({ Times: '14:00,15:00,16:00' });
  h.context.processPendingIntakeNotifications();
  const [notified, pending, blocked] = h.records('intakes');
  h.edit('intakes', blocked.ID, { NotificationBlockedAt: new h.Date() });
  correct(h, { Dosage: '2 druppels', Administration: 'linkeroog' }); successful(h);
  assert.equal(h.context.SheetStore.find('intakes', notified.ID).Dosage, '1 druppel');
  assert.equal(h.context.SheetStore.find('intakes', pending.ID).Dosage, '2 druppels');
  assert.equal(h.context.SheetStore.find('intakes', blocked.ID).Dosage, '1 druppel');
});

test('correction omits new past moments but retains existing past execution and future moments', () => {
  const h = generated({ Times: '08:00,15:00' });
  h.context.completeIntake(h.records('intakes')[0].ID);
  correct(h, { Times: '09:00,14:00,16:00' }); successful(h);
  const times = h.records('intakes').map(i => h.context.LocalTime.display(i.ScheduledAt).slice(-5));
  assert.deepEqual(times, ['08:00', '15:00', '14:00', '16:00']);
  assert.equal(h.records('history')[1].Times, '09:00,14:00,16:00');
});

test('returning to an earlier plan reactivates same UUID and adds a new version', () => {
  const h = generated({ Times: '15:00' });
  const id = h.records('intakes')[0].ID;
  correct(h, { Times: '16:00' });
  correct(h, { Times: '15:00', Dosage: '2 druppels' }); successful(h);
  const restored = h.context.SheetStore.find('intakes', id);
  assert.equal(restored.Status, 'PENDING'); assert.equal(restored.Dosage, '2 druppels');
  assert.equal(h.records('intakes').length, 2);
  assert.deepEqual(h.records('history').map(r => r.Version), [1, 2, 3]);
});

test('reactivation preserves notified snapshots, counters and uncertain-send blocks', () => {
  const h = generated({ Times: '15:00' });
  const intake = h.records('intakes')[0];
  h.edit('intakes', intake.ID, { Status: 'NOTIFIED', NotifiedAt: new h.Date(), LastReminderAt: new h.Date(),
    ReminderCount: 2, NotificationBlockedAt: new h.Date() });
  correct(h, { Times: '16:00' });
  correct(h, { Times: '15:00', Dosage: '2 druppels' }); successful(h);
  const restored = h.records('intakes')[0];
  assert.equal(restored.Status, 'NOTIFIED'); assert.equal(restored.ReminderCount, 2);
  assert.equal(restored.Dosage, '1 druppel'); assert.ok(restored.NotificationBlockedAt);
});

test('cancelled past moments remain cancelled when reintroduced', () => {
  const h = generated({ Times: '08:00' });
  correct(h, { Times: '16:00' }); correct(h, { Times: '08:00' }); successful(h);
  assert.equal(h.records('intakes').length, 2);
  assert.ok(h.records('intakes').every(i => i.Status === 'CANCELLED'));
});

test('invalid correction changes no intakes and adds no history', () => {
  const h = generated(); const before = JSON.stringify(h.records('intakes'));
  correct(h, { Times: '25:00' });
  assert.equal(h.records('schedules')[0].Status, 'ERROR');
  assert.equal(h.records('schedules')[0].ApplicationState, '');
  assert.equal(JSON.stringify(h.records('intakes')), before);
  assert.equal(h.records('history').length, 1);
});

test('legacy schedules start history on first successful correction without invented earlier versions', () => {
  const h = generated(); h.sheets['medication-schedule-history'].data.splice(1);
  correct(h, { Times: '17:00' }); successful(h);
  assert.equal(h.records('history').length, 1);
  assert.equal(h.records('history')[0].Version, 1);
  assert.equal(h.records('history')[0].Times, '17:00');
});

for (const stage of ['cancel', 'insert', 'snapshot', 'history', 'history-published', 'generated', 'clear']) {
  test(`partial ${stage} write recovers without duplicate intakes or history`, () => {
    const h = generated();
    let failed = false;
    h.beforeWrite = (sheet, row, col, value) => {
      if (row < 2) return;
      const header = sheet.data[0][col - 1];
      const fail = stage === 'cancel' && header === 'Status' && value === 'CANCELLED' ||
        stage === 'insert' && sheet.name === 'medication-intakes' && row === 4 && header === 'Dosage' ||
        stage === 'snapshot' && sheet.name === 'medication-intakes' && row === 3 && header === 'Dosage' ||
        stage === 'history' && sheet.name === 'medication-schedule-history' && row === 3 && header === 'Dosage' ||
        stage === 'generated' && sheet.name === 'medication-schedules' && header === 'Status' && value === 'GENERATED' ||
        stage === 'clear' && header === 'ApplicationState' && value === '';
      if (fail && !failed) { failed = true; throw new Error('Simulated write failure'); }
    };
    h.onFlush = () => {
      if (stage === 'history-published' && !failed && h.records('history').some(r => r.Version === 2 && r.RecordedAt)) {
        failed = true; throw new Error('Simulated flush failure');
      }
    };
    correct(h, { Times: '14:30,16:00', Dosage: '2 druppels' });
    assert.equal(failed, true);
    assert.equal(h.records('schedules')[0].Status, 'ERROR');
    h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
    h.beforeWrite = null; h.onFlush = null;
    h.now += 86400000;
    correct(h); successful(h);
    assert.equal(h.records('intakes').length, 3);
    assert.equal(h.records('intakes')[2].Status, 'PENDING');
    assert.deepEqual(h.records('history').map(r => r.Version), [1, 2]);
    assert.equal(new Set(h.records('intakes').map(i => i.ScheduledAt.getTime())).size, 3);
  });
}

test('completion between failed reconciliation and retry wins over cancellation', () => {
  const h = generated(); const intake = h.records('intakes')[0];
  h.beforeWrite = (sheet, row, col, value) => {
    if (sheet.name === 'medication-intakes' && sheet.data[0][col - 1] === 'Status' && value === 'CANCELLED') {
      throw new Error('Interrupted cancellation');
    }
  };
  correct(h, { Times: '17:00' }); h.beforeWrite = null;
  h.context.completeIntake(intake.ID);
  const completed = h.context.SheetStore.find('intakes', intake.ID);
  correct(h); successful(h);
  assert.deepEqual(h.context.SheetStore.find('intakes', intake.ID), completed);
});

test('manual change during a paused application is rejected until target plan is restored', () => {
  const h = generated();
  h.beforeWrite = (sheet, row, col, value) => {
    if (sheet.name === 'medication-intakes' && value === 'CANCELLED') throw new Error('Interrupted');
  };
  correct(h, { Times: '17:00' }); h.beforeWrite = null;
  correct(h, { Times: '18:00' });
  assert.equal(h.records('schedules')[0].Status, 'ERROR');
  assert.equal(h.records('history').length, 1);
  correct(h, { Times: '17:00' }); successful(h);
});

test('shared lock prevents overlapping reconciliation and completion', () => {
  const h = generated(); h.locked = true;
  correct(h, { Times: '17:00' });
  assert.equal(h.records('history').length, 1);
  assert.throws(() => h.context.completeIntake(h.records('intakes')[0].ID), /Registreren is niet gelukt/);
  h.locked = false; h.context.processReadySchedules(); successful(h);
});

test('setup migrates only new schedule column and preserves existing rows and custom headers', () => {
  const h = generated(); const sheet = h.sheets['medication-schedules'];
  const index = sheet.data[0].indexOf('ApplicationState');
  sheet.data.forEach(row => row.splice(index, 1));
  sheet.data[0].push('Notes'); sheet.data[1].push('keep');
  const before = JSON.stringify(sheet.data);
  delete h.sheets['medication-schedule-history'];
  h.context.setupSpreadsheet(); h.context.setupSpreadsheet();
  assert.equal(sheet.data[0].filter(name => name === 'ApplicationState').length, 1);
  assert.equal(h.records('schedules')[0].Notes, 'keep');
  assert.equal(JSON.stringify(sheet.data.map(row => row.slice(0, JSON.parse(before)[0].length))), before);
  assert.equal(h.records('history').length, 0);
});

test('setup replaces its status rules and preserves unrelated conditional formatting', () => {
  const h = harness();
  const sheet = h.sheets['medication-intakes'];
  const custom = { getBooleanCondition: () => null };
  sheet.rules.push(custom);
  h.context.setupSpreadsheet(); h.context.setupSpreadsheet();
  assert.equal(sheet.rules.length, 2);
  assert.equal(sheet.rules[0], custom);
  assert.match(sheet.rules[1].formula, /CANCELLED/);
  assert.equal(h.sheets['medication-schedules'].rules.length, 1);
});

test('execution budget yields and resumes with the original cutoff and application identity', () => {
  const h = generated({ Times: '15:00' });
  let advanced = false;
  h.beforeWrite = (sheet, row, col, value) => {
    if (!advanced && sheet.name === 'medication-intakes' && value === 'CANCELLED') {
      advanced = true; h.now += 86400000;
    }
  };
  correct(h, { Times: '14:30,16:00' });
  const schedule = h.records('schedules')[0];
  assert.equal(schedule.Status, 'READY_FOR_RECONCILIATION');
  const state = JSON.parse(schedule.ApplicationState);
  assert.equal(h.records('history').length, 1);
  h.beforeWrite = null; h.context.processReadySchedules(); successful(h);
  assert.equal(h.records('intakes').length, 3);
  assert.equal(h.records('history')[1].ApplicationID, state.id);
});

test('unfinished GENERATED state still blocks notifications until history finalization completes', () => {
  const h = generated({ Times: '14:00' });
  h.beforeWrite = (sheet, row, col, value) => {
    if (sheet.name === 'medication-schedules' && (value === '' && sheet.data[0][col - 1] === 'ApplicationState' ||
        value === 'ERROR')) throw new Error('Interrupted finalization');
  };
  correct(h, { Dosage: '2 druppels' });
  assert.equal(h.records('schedules')[0].Status, 'GENERATED');
  assert.ok(h.records('schedules')[0].ApplicationState);
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 0);
  h.beforeWrite = null; h.context.processReadySchedules(); successful(h);
  h.context.processPendingIntakeNotifications(); assert.equal(h.sent.length, 1);
  assert.equal(h.records('history').length, 2);
});

test('reordered history and intake headers still recover partial writes by UUID', () => {
  const h = harness();
  h.sheets['medication-intakes'].data[0].reverse();
  h.sheets['medication-schedule-history'].data[0].reverse();
  h.addSchedule({ Times: '15:00', DurationDays: 1 });
  let failed = false;
  h.beforeWrite = (sheet, row, col) => {
    if (!failed && sheet.name === 'medication-intakes' && row > 1 && sheet.data[0][col - 1] === 'Dosage') {
      failed = true; throw new Error('Interrupted');
    }
  };
  h.context.processReadySchedules(); h.beforeWrite = null;
  const id = h.records('intakes')[0].ID;
  h.edit('schedules', h.records('schedules')[0].ID, { Status: 'READY' });
  h.context.processReadySchedules(); successful(h);
  assert.equal(h.records('intakes')[0].ID, id);
  assert.equal(h.records('intakes').length, 1);
  assert.equal(h.records('history')[0].Version, 1);
});

test('published history cannot be patched and draft or invalid requests publish no version', () => {
  const h = generated();
  assert.throws(() => h.edit('history', h.records('history')[0].ID, { Dosage: 'changed' }), /History/);
  h.addSchedule({ Status: 'DRAFT' });
  h.context.processReadySchedules();
  assert.equal(h.records('history').length, 1);
});

test('every individual correction write can fail once and resume to the same final plan', () => {
  const countHarness = generated(); let writes = 0;
  countHarness.edit('schedules', countHarness.records('schedules')[0].ID,
    { Times: '14:30,16:00', Dosage: '2 druppels', Status: 'READY_FOR_RECONCILIATION' });
  countHarness.beforeWrite = () => { writes++; };
  countHarness.context.processReadySchedules(); successful(countHarness);
  for (let failAt = 1; failAt <= writes; failAt++) {
    const h = generated(); let seen = 0;
    // Count only processing writes, not the user action that offers the correction.
    h.edit('schedules', h.records('schedules')[0].ID,
      { Times: '14:30,16:00', Dosage: '2 druppels', Status: 'READY_FOR_RECONCILIATION' });
    h.beforeWrite = () => { if (++seen === failAt) throw new Error('Interrupted write'); };
    h.context.processReadySchedules(); h.beforeWrite = null;
    assert.ok(seen >= failAt);
    correct(h); successful(h);
    assert.equal(h.records('intakes').length, 3, `write ${failAt}`);
    assert.deepEqual(h.records('history').map(r => r.Version), [1, 2], `write ${failAt}`);
  }
});

test('every flush boundary recovers after writes may already have persisted', () => {
  const counter = generated(); let flushes = 0;
  counter.edit('schedules', counter.records('schedules')[0].ID,
    { Times: '14:30,16:00', Dosage: '2 druppels', Status: 'READY_FOR_RECONCILIATION' });
  counter.onFlush = () => { flushes++; };
  counter.context.processReadySchedules(); successful(counter);
  for (let failAt = 1; failAt <= flushes; failAt++) {
    const h = generated(); let seen = 0;
    h.edit('schedules', h.records('schedules')[0].ID,
      { Times: '14:30,16:00', Dosage: '2 druppels', Status: 'READY_FOR_RECONCILIATION' });
    h.onFlush = () => { if (++seen === failAt) throw new Error('Uncertain flush'); };
    h.context.processReadySchedules(); h.onFlush = null;
    correct(h); successful(h);
    assert.equal(h.records('intakes').length, 3, `flush ${failAt}`);
    assert.deepEqual(h.records('history').map(r => r.Version), [1, 2], `flush ${failAt}`);
  }
});

test('snapshot-only changes preserve completed history but create a distinct plan version', () => {
  const h = generated();
  h.context.completeIntake(h.records('intakes')[0].ID);
  const completed = h.records('intakes')[0];
  correct(h, { Medication: 'Testmedicatie', Dosage: '2 druppels', Administration: 'linkeroog' }); successful(h);
  assert.deepEqual(h.records('intakes')[0], completed);
  assert.equal(h.records('intakes')[1].Medication, 'Testmedicatie');
  assert.equal(h.records('history')[1].Medication, 'Testmedicatie');
});

test('duplicate functional identities reject corrections before any mutation', () => {
  const h = generated(); const intake = h.records('intakes')[0];
  h.edit('intakes', h.records('intakes')[1].ID, { ScheduledAt: intake.ScheduledAt });
  const before = JSON.stringify(h.records('intakes'));
  correct(h, { Times: '17:00' });
  assert.equal(h.records('schedules')[0].Status, 'ERROR');
  assert.equal(JSON.stringify(h.records('intakes')), before);
  assert.equal(h.records('history').length, 1);
});

test('reconciliation shares DST validation and rejects nonexistent times before cancelling', () => {
  const h = generated({ StartDate: '2026-03-29', Times: '01:30' });
  const before = JSON.stringify(h.records('intakes'));
  correct(h, { Times: '02:30' });
  assert.equal(h.records('schedules')[0].Status, 'ERROR');
  assert.equal(JSON.stringify(h.records('intakes')), before);
  assert.equal(h.records('history').length, 1);
});

test('reconciliation logs application identifiers and counts without medication content', () => {
  const h = generated();
  correct(h, { Medication: 'PrivateMedicationMarker', Times: '17:00' }); successful(h);
  const logs = h.logs.map(value => JSON.parse(value));
  const result = logs.filter(entry => entry.event === 'schedule_applied').at(-1);
  assert.equal(result.details.version, 2);
  assert.equal(result.details.counts.cancelled, 2);
  assert.equal(result.details.counts.created, 1);
  assert.ok(result.details.applicationId);
  assert.doesNotMatch(h.logs.join(''), /PrivateMedicationMarker|fake-token|fake-user/);
});
