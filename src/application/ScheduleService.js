var ScheduleService = (function () {
  function processOne_(candidate, config, deadline) {
    var record = candidate.ID ? SheetStore.find('schedules', candidate.ID) :
      SheetStore.read('schedules').find(function (item) { return item._row === candidate._row; });
    if (!record || ['READY', 'READY_FOR_RECONCILIATION'].indexOf(record.Status) === -1 &&
        !(record.Status === 'GENERATED' && record.ApplicationState)) return 'skipped';
    try {
      if (!record.CreatedAt) record = SheetStore.patch('schedules', record, { CreatedAt: new Date() });
      if (!record.ID) record = SheetStore.patch('schedules', record, { ID: Utilities.getUuid() });
      return ScheduleApplication.apply(record, config, deadline) ? 'processed' : 'remaining';
    } catch (error) {
      var details = { errorCode: 'application_failed' };
      try {
        var current = SheetStore.find('schedules', record.ID);
        var state = current.ApplicationState ? JSON.parse(current.ApplicationState) : null;
        if (state) { details.applicationId = state.id; details.version = state.noHistory ? state.version - 1 : state.version; }
      } catch (readError) { /* De oorspronkelijke fout blijft leidend. */ }
      ProcessingSupport.log('schedule_failed', record.ID, details);
      try {
        SheetStore.patch('schedules', record, { LastError: String(error.message).slice(0, 500),
          UpdatedAt: new Date(), Status: 'ERROR' });
      } catch (writeError) { ProcessingSupport.log('schedule_error_write_failed', record.ID); }
      return 'failed';
    }
  }

  /**
   * Verwerkt READY en READY_FOR_RECONCILIATION binnen de batch- en uitvoeringslimiet.
   * Hervat onafgeronde GENERATED-toepassingen; ERROR vereist opnieuw aanbieden door de gebruiker.
   * Vergrendelt per schema; ScheduleApplication bewaakt intakes, history en duurzame herstelgegevens.
   * Zet verwerkte schema's op GENERATED of bij een verwerkingsfout op ERROR waar mogelijk.
   * Recordfouten worden geisoleerd; een bezet lock stopt de batch.
   * @returns {{processed: number, failed: number, skipped: number, remaining: number, busy: boolean}} Resultaat van deze batch, inclusief onafgeronde schema's.
   * @throws {Error} Bij configuratiefouten of fouten tijdens het inlezen van de kandidaten.
   */
  function processReady() {
    var config = Config.get();
    var started = Date.now();
    var summary = { processed: 0, failed: 0, skipped: 0, remaining: 0, busy: false };
    var candidates = SheetStore.read('schedules').filter(function (item) { return item.Status === 'READY' || item.Status === 'READY_FOR_RECONCILIATION' ||
        (item.Status === 'GENERATED' && item.ApplicationState); });
    for (var index = 0; index < Math.min(candidates.length, config.batchSize); index++) {
      if (Date.now() - started >= config.executionBudgetMs) break;
      try {
        var result = ProcessingSupport.locked(function () { return processOne_(candidates[index], config, started + config.executionBudgetMs); });
        if (result && result.busy) { summary.busy = true; break; }
        summary[result]++;
      } catch (error) { summary.failed++; ProcessingSupport.log('schedule_processing_failed', candidates[index].ID); }
    }
    summary.remaining += candidates.length - index;
    return summary;
  }

  return { processReady: processReady };
})();
