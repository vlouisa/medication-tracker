var ScheduleExpiryService = (function () {
  /** @param {string} id Schema-UUID. @param {*} version Positieve versie. @returns {number} Gevalideerde versie. @throws {Error} Bij ongeldige identiteit. */
  function validate(id, version) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
        !/^[1-9]\d*$/.test(String(version)) || !Number.isSafeInteger(Number(version))) throw new Error('Ongeldige planlink.');
    return Number(version);
  }

  function identity_(id, version) { return ProcessingSupport.identityUuid('schedule-expiry:' + id + ':' + version); }

  /**
   * Leest exact de gevraagde gepubliceerde versie en de huidige schemastatus, zonder writes.
   * @param {string} id Schema-UUID. @param {*} version Versienummer.
   * @returns {Object} Context met snapshot, genormaliseerd plan, reminderperiode en actualiteit.
   * @throws {Error} Bij ontbrekende of ongeldige brongegevens.
   */
  function context(id, version) {
    version = validate(id, version);
    var schedule = SheetStore.find('schedules', id);
    var history = ScheduleHistory.published(id);
    var snapshot = history.find(function (row) { return row.Version === version; });
    if (!snapshot) throw new Error('Deze toegepaste planversie is niet gevonden.');
    var plan = ScheduleHistory.plan(snapshot);
    return { schedule: schedule, snapshot: snapshot, plan: plan,
      current: history[history.length - 1].Version === version,
      ready: schedule.Status === 'GENERATED' && !schedule.ApplicationState,
      window: ScheduleExpiryRules.windowFor(plan, LocalTime.resolve, LocalTime.dateText) };
  }

  /**
   * @param {string} id Schema-UUID. @param {number} version Versienummer.
   * @returns {?Object} Expiry-state, eventueel nog onvolledig na een onderbreking.
   * @throws {Error} Bij dubbele functionele identiteit of ongeldige gepubliceerde state.
   */
  function stateFor(id, version) {
    var key = identity_(id, version);
    var rows = SheetStore.read('expiry').filter(function (row) {
      return row.ID === key || row.ScheduleID === id && row.ScheduleVersion === version;
    });
    if (rows.length > 1) throw new Error('Dubbele expiry-beslissing.');
    var state = rows[0] || null;
    if (state && state.CreatedAt && (state.ScheduleID !== id || state.ScheduleVersion !== version ||
        ['OPEN', 'RESOLVED'].indexOf(state.DecisionStatus) === -1 || ['ACTIVE', 'EXPIRED'].indexOf(state.ReminderStatus) === -1)) {
      throw new Error('Ongeldige expiry-beslissing.');
    }
    return state;
  }

  /**
   * Initialiseert een lifecycle vanaf de threshold; een gemist window wordt direct OPEN/EXPIRED.
   * Alleen onder het gedeelde scriptlock aanroepen. Een stabiele UUID hervat ook een losse ID-write.
   * @param {Object} ctx Actuele context. @param {Date} now Referentietijdstip.
   * @returns {Object} Duurzame expiry-state.
   * @throws {Error} Als de versie geen beslissing toestaat of opslag mislukt.
   */
  function ensure(ctx, now) {
    assertActionable(ctx, now);
    var id = ctx.schedule.ID, version = ctx.snapshot.Version;
    var state = stateFor(id, version);
    if (state && state.CreatedAt) return state;
    return SheetStore.insertReserved('expiry', { ID: identity_(id, version), ScheduleID: id, ScheduleVersion: version,
      DecisionStatus: 'OPEN', ReminderStatus: LocalTime.dateText(now) > ctx.window.endDate ? 'EXPIRED' : 'ACTIVE',
      LastReminderAttemptAt: '', ResolvedAt: '', Resolution: '', ContinuationScheduleID: '',
      UpdatedAt: now, LastError: '', ResolutionState: '', CreatedAt: now });
  }

  /** @param {Object} ctx Context. @param {Date} now Referentietijdstip. @returns {void} @throws {Error} Bij oude, geblokkeerde of nog niet verschuldigde versie. */
  function assertActionable(ctx, now) {
    if (!ctx.current) throw new Error('Deze herinnering hoort bij een eerdere planversie. Open de actuele herinnering.');
    if (!ctx.ready) throw new Error('Het schema wordt verwerkt of vereist herstel. Probeer later opnieuw.');
    if (!ctx.window.enabled || LocalTime.dateText(now) < ctx.window.threshold) throw new Error('Voor deze planversie is nog geen expiry-keuze beschikbaar.');
  }

  /** @param {string} id Schema-UUID. @param {*} version Versie. @returns {Object} Alleen-lezen paginamodel zonder technische state. @throws {Error} Bij ongeldige bron. */
  function inspect(id, version) {
    var ctx = context(id, version), today = LocalTime.dateText(new Date());
    var state = stateFor(id, ctx.snapshot.Version);
    var resolved = Boolean(state && state.DecisionStatus === 'RESOLVED');
    var pendingChoice = state && state.ResolutionState && !resolved ? JSON.parse(state.ResolutionState).resolution : '';
    var previous = SheetStore.read('schedules').filter(function (row) {
      return row.SourceScheduleID === id && row.SourceScheduleVersion !== ctx.snapshot.Version && row.Status;
    }).map(function (row) { return { id: row.ID, version: row.SourceScheduleVersion, status: row.Status }; });
    return { id: id, version: ctx.snapshot.Version, medication: ctx.plan.medication, dosage: ctx.plan.dosage,
      administration: ctx.plan.administration, lastDate: ctx.window.lastDate,
      current: ctx.current, ready: ctx.ready, expired: today > ctx.window.endDate,
      canChoose: ctx.current && ctx.ready && ctx.window.enabled && today >= ctx.window.threshold && !resolved,
      resolved: resolved, resolution: resolved ? state.Resolution : '',
      continuationId: resolved ? state.ContinuationScheduleID : '', previous: previous,
      pending: Boolean(pendingChoice), pendingChoice: pendingChoice };
  }

  function processOne_(id) {
    var history = ScheduleHistory.published(id);
    if (!history.length) return 'skipped';
    var ctx = context(id, history[history.length - 1].Version);
    var now = new Date(), today = LocalTime.dateText(now);
    if (!ctx.current || !ctx.ready || !ctx.window.enabled || today < ctx.window.threshold) return 'skipped';
    var state = ensure(ctx, now);
    if (state.DecisionStatus === 'RESOLVED') return 'skipped';
    if (today > ctx.window.endDate) {
      if (state.ReminderStatus !== 'EXPIRED') {
        SheetStore.patch('expiry', state, { ReminderStatus: 'EXPIRED', UpdatedAt: now });
        return 'processed';
      }
      return 'skipped';
    }
    if (state.LastReminderAttemptAt && (!(state.LastReminderAttemptAt instanceof Date) || !Number.isFinite(state.LastReminderAttemptAt.getTime()))) {
      throw new Error('Ongeldige expiry-pogingdatum.');
    }
    if (Number(LocalTime.display(now).slice(-5, -3)) < Config.expiryHour() ||
        !ScheduleExpiryRules.due(ctx.window, state, today, state.LastReminderAttemptAt ? LocalTime.dateText(state.LastReminderAttemptAt) : '')) return 'skipped';
    var notification = MedicationNotification.expiry(ctx.snapshot, ctx.window.lastDate, today);
    Config.pushover();
    // De eerste write is de dagreservering. Bij iedere onzekere uitkomst blijft die staan.
    state = SheetStore.patch('expiry', state, { LastReminderAttemptAt: now,
      LastError: 'Verzending gereserveerd; bij onderbreking is de uitkomst onbekend.', UpdatedAt: now });
    if (LocalTime.dateText(new Date()) !== today) return 'skipped';
    try {
      PushoverClient.send(notification);
      SheetStore.patch('expiry', state, { LastError: '', UpdatedAt: new Date() });
      return 'processed';
    } catch (error) {
      SheetStore.patch('expiry', state, { LastError: 'Verzending niet volledig bevestigd. Vandaag volgt geen nieuwe poging.', UpdatedAt: new Date() });
      ProcessingSupport.log('expiry_notification_failed', id);
      return 'failed';
    }
  }

  function expireOne_(candidate) {
    var state = SheetStore.find('expiry', candidate.ID);
    if (!state.CreatedAt || state.DecisionStatus !== 'OPEN' || state.ReminderStatus !== 'ACTIVE') return 'skipped';
    var ctx = context(state.ScheduleID, state.ScheduleVersion);
    var now = new Date();
    if (LocalTime.dateText(now) <= ctx.window.endDate) return 'skipped';
    // Afloop van de periode staat los van huidige schemastatus/versie; dit legt geen keuze vast.
    SheetStore.patch('expiry', state, { ReminderStatus: 'EXPIRED', UpdatedAt: now });
    return 'processed';
  }

  /**
   * Verwerkt actuele toegepaste plannen onder een lock per schema, met foutisolatie en batchbudget.
   * @returns {Object} Aantallen processed, skipped, failed, remaining en busy.
   * @throws {Error} Bij globale configuratie- of leesfouten; recordfouten blijven geïsoleerd.
   */
  function processPending() {
    var config = Config.get(); Config.expiryHour();
    var deadline = Date.now() + config.executionBudgetMs;
    var expiring = SheetStore.read('expiry').filter(function (row) {
      return row.CreatedAt && row.DecisionStatus === 'OPEN' && row.ReminderStatus === 'ACTIVE';
    }).map(function (row) { return { ID: row.ID, expireOnly: true }; });
    var rows = expiring.concat(SheetStore.read('schedules').filter(function (row) { return row.Status === 'GENERATED' && !row.ApplicationState; }));
    var result = { processed: 0, skipped: 0, failed: 0, remaining: 0, busy: false };
    for (var index = 0; index < rows.length; index++) {
      if (Date.now() >= deadline || result.processed + result.failed >= config.batchSize) break;
      try {
        var outcome = ProcessingSupport.locked(function () {
          return rows[index].expireOnly ? expireOne_(rows[index]) : processOne_(rows[index].ID);
        });
        if (outcome && outcome.busy) { result.busy = true; break; }
        result[outcome]++;
      } catch (error) { result.failed++; ProcessingSupport.log('expiry_processing_failed', rows[index].ID); }
    }
    result.remaining = rows.length - index;
    return result;
  }
  return { validate: validate, context: context, stateFor: stateFor, ensure: ensure, assertActionable: assertActionable,
    inspect: inspect, processPending: processPending };
})();
