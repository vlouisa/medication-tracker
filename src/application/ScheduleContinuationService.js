var ScheduleContinuationService = (function () {
  function draft_(ctx, now) {
    var plan = ctx.plan;
    return { ID: Utilities.getUuid(), Medication: plan.medication, Dosage: plan.dosage,
      Administration: plan.administration, StartDate: ScheduleExpiryRules.continuationStart(ctx.window.lastDate, LocalTime.dateText(now)),
      DurationDays: plan.durationDays, Times: plan.times.join(','), ExpiryReminderDaysBefore: plan.expiryReminderDaysBefore || '',
      SourceScheduleID: ctx.schedule.ID, SourceScheduleVersion: ctx.snapshot.Version,
      LastError: '', ApplicationState: '', CreatedAt: now.toISOString(), UpdatedAt: now.toISOString(), Status: 'DRAFT' };
  }

  function linked_(id, version) {
    var rows = SheetStore.read('schedules').filter(function (row) { return row.SourceScheduleID === id && row.SourceScheduleVersion === version; });
    if (rows.length > 1) throw new Error('Meerdere vervolgplannen voor dezelfde bronversie. Onderzoek de gegevens.');
    return rows[0] || null;
  }

  /**
   * Legt een expliciete keuze vast onder het gedeelde scriptlock. De journal bewaart de keuze,
   * het oorspronkelijke tijdstip en de volledige vervolg-DRAFT, ook bij onderbreking of middernacht.
   * Een reeds gepubliceerde continuation wordt nooit overschreven; RESOLVED wordt als laatste geschreven.
   * @param {string} id Bron-UUID. @param {*} version Toegepaste bronversie.
   * @param {'CONTINUATION_CREATED'|'NO_CONTINUATION'} resolution Expliciete gebruikerskeuze.
   * @returns {Object} Alleen-lezen resultaatmodel.
   * @throws {Error} Bij oude versie, conflicterende keuze, bezet lock of opslagfouten. Herhaal dezelfde keuze voor herstel.
   */
  function resolve(id, version, resolution) {
    var result = ProcessingSupport.locked(function () {
      var ctx = ScheduleExpiryService.context(id, version), now = new Date();
      ScheduleExpiryService.assertActionable(ctx, now);
      // Onbekende acties afwijzen voordat een lifecycle wordt aangemaakt.
      ScheduleExpiryRules.resolved({ DecisionStatus: 'OPEN' }, resolution);
      var state = ScheduleExpiryService.ensure(ctx, now);
      if (ScheduleExpiryRules.resolved(state, resolution)) return ScheduleExpiryService.inspect(id, version);
      var journal = state.ResolutionState ? JSON.parse(state.ResolutionState) : null;
      if (journal && journal.resolution !== resolution) throw new Error('Een andere keuze wordt al verwerkt. Hervat die oorspronkelijke keuze.');
      var existing = linked_(id, ctx.snapshot.Version);
      if (!journal) {
        if (existing) throw new Error('Vervolgplan gevonden zonder herstelregistratie. Onderzoek de gegevens.');
        journal = { resolution: resolution, at: now.toISOString(), draft: resolution === 'CONTINUATION_CREATED' ? draft_(ctx, now) : null };
        state = SheetStore.patch('expiry', state, { ResolutionState: JSON.stringify(journal) });
      }
      if (!Number.isFinite(Date.parse(journal.at))) throw new Error('Ongeldige herstelregistratie.');
      var continuationId = '';
      if (resolution === 'CONTINUATION_CREATED') {
        var draft = journal.draft;
        if (!draft || draft.SourceScheduleID !== id || draft.SourceScheduleVersion !== ctx.snapshot.Version || draft.Status !== 'DRAFT') {
          throw new Error('Ongeldig opgeslagen vervolgvoorstel.');
        }
        if (existing && existing.ID !== draft.ID) throw new Error('Conflicterende vervolgidentiteit.');
        var saved = SheetStore.insertReserved('schedules', Object.assign({}, draft,
          { CreatedAt: new Date(draft.CreatedAt), UpdatedAt: new Date(draft.UpdatedAt) }));
        if (!saved.Status || saved.SourceScheduleID !== id || saved.SourceScheduleVersion !== ctx.snapshot.Version) {
          throw new Error('Vervolgplan is niet volledig opgeslagen.');
        }
        continuationId = saved.ID;
      }
      SheetStore.patch('expiry', state, { Resolution: resolution, ContinuationScheduleID: continuationId,
        ResolvedAt: new Date(journal.at), LastError: '', UpdatedAt: now, DecisionStatus: 'RESOLVED' });
      // Journal blijft als herstelbewijs staan; RESOLVED bepaalt dat verdere writes verboden zijn.
      return ScheduleExpiryService.inspect(id, version);
    });
    if (result && result.busy) throw new Error('Een andere verwerking is bezig. Probeer dezelfde keuze opnieuw.');
    return result;
  }
  return { resolve: resolve };
})();
