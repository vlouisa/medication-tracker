var ScheduleService = (function () {
  function normalize_(record, config) {
    return MedicationPlan.normalize(record, LocalTime.dateText(record.StartDate), config.maxIntakes);
  }

  function processOne_(candidate, config) {
    var record = candidate.ID ? SheetStore.find('schedules', candidate.ID) :
      SheetStore.read('schedules').find(function (item) { return item._row === candidate._row; });
    if (!record || record.Status !== 'READY') return;
    try {
      if (!record.CreatedAt) record = SheetStore.patch('schedules', record, { CreatedAt: new Date() });
      var plan = normalize_(record, config);
      var expected = MedicationPlan.moments(plan, LocalTime.resolve);
      var now = new Date();
      if (!record.ID) record = SheetStore.patch('schedules', record, { ID: Utilities.getUuid() });
      var existing = SheetStore.read('intakes').filter(function (item) { return item.ScheduleID === record.ID; });
      var hash = ProcessingSupport.fingerprint(plan);
      if (existing.length && ProcessingSupport.frozen(record.ID) !== hash) {
        throw new Error('Planning is bevroren. Herstel de oorspronkelijke invoer voordat u opnieuw READY kiest.');
      }
      var missing = MedicationPlan.missing(plan, expected, existing);
      ProcessingSupport.freeze(record.ID, hash);
      var additions = missing.map(function (scheduledAt) {
        return { ID: Utilities.getUuid(), ScheduleID: record.ID, Medication: plan.medication,
          Dosage: plan.dosage, Administration: plan.administration, ScheduledAt: scheduledAt,
          Status: 'PENDING', ReminderCount: 0, CreatedAt: now, UpdatedAt: now };
      });
      SheetStore.appendIntakes(additions);
      var actual = SheetStore.read('intakes').filter(function (item) { return item.ScheduleID === record.ID; });
      if (MedicationPlan.missing(plan, expected, actual).length) throw new Error('Generatie is nog niet volledig. Kies opnieuw READY.');
      var latest = SheetStore.find('schedules', record.ID);
      if (latest.Status !== 'READY' || ProcessingSupport.fingerprint(normalize_(latest, config)) !== hash) {
        throw new Error('Schema gewijzigd tijdens generatie. Herstel de oorspronkelijke invoer.');
      }
      SheetStore.patch('schedules', latest, { LastError: '', UpdatedAt: new Date(), Status: 'GENERATED' });
    } catch (error) {
      ProcessingSupport.log('schedule_failed', record.ID);
      try {
        SheetStore.patch('schedules', record, { LastError: String(error.message).slice(0, 500),
          UpdatedAt: new Date(), Status: 'ERROR' });
      } catch (writeError) { ProcessingSupport.log('schedule_error_write_failed', record.ID); }
    }
  }

  function processReady() {
    var config = Config.get();
    var started = Date.now();
    var candidates = SheetStore.read('schedules').filter(function (item) { return item.Status === 'READY'; });
    for (var index = 0; index < Math.min(candidates.length, config.batchSize); index++) {
      if (Date.now() - started >= config.executionBudgetMs) break;
      try {
        var result = ProcessingSupport.locked(function () { processOne_(candidates[index], config); });
        if (result && result.busy) break;
      } catch (error) { ProcessingSupport.log('schedule_processing_failed', candidates[index].ID); }
    }
  }

  return { processReady: processReady };
})();
