var ScheduleApplication = (function () {
  function plan_(record, config) {
    return MedicationPlan.normalize(record, LocalTime.dateText(record.StartDate), config.maxIntakes);
  }

  function intakes_(id) {
    return SheetStore.read('intakes').filter(function (item) { return item.ScheduleID === id; });
  }

  function save_(record, state) {
    return SheetStore.patch('schedules', record, { ApplicationState: JSON.stringify(state) });
  }

  /**
   * Controleert handmatige wijzigingen; GENERATED is alleen toegestaan bij herstel van de afronding.
   * @param {Object} record Schema-identiteit.
   * @param {Object} state Duurzame toepassing met doelhash en fase.
   * @param {Object} config Applicatieconfiguratie.
   * @returns {Object} Actueel schema.
   * @throws {Error} Als invoer of verwerkingsstatus niet meer bij de toepassing hoort.
   */
  function assertCurrent_(record, state, config) {
    var latest = SheetStore.find('schedules', record.ID);
    var status = state.mode === 'initial' ? 'READY' : 'READY_FOR_RECONCILIATION';
    if ((latest.Status !== status && !(latest.Status === 'GENERATED' && state.phase === 'history')) ||
        ProcessingSupport.fingerprint(plan_(latest, config)) !== state.hash) {
      throw new Error('Schema gewijzigd tijdens verwerking. Herstel het aangeboden plan en bied het opnieuw aan.');
    }
    return latest;
  }

  function history_(id) {
    return ScheduleHistory.published(id);
  }

  function historyPlan_(row) {
    return ScheduleHistory.plan(row);
  }

  /**
   * Valideert bestaande records voor de eerste write en reserveert een nieuwe toepassingsidentiteit.
   * Vergelijkt alleen de laatste gepubliceerde versie, zodat A -> B -> A een nieuwe versie oplevert.
   * @param {Object} record Aangeboden schema.
   * @param {Object} plan Gevalideerd doelplan.
   * @param {Date[]} expected Volledige verwachte planning.
   * @returns {Object} Nog door save_ duurzaam vast te leggen ApplicationState.
   * @throws {Error} Bij conflicterende intakes, geschiedenis of een ongeldige verwerkingsopdracht.
   */
  function newState_(record, plan, expected) {
    var existing = intakes_(record.ID);
    var hash = ProcessingSupport.fingerprint(plan);
    var history = history_(record.ID);
    var latest = history.length ? history[history.length - 1] : null;
    var mode = record.Status === 'READY' ? 'initial' : 'reconciliation';
    if (mode === 'initial') {
      if (existing.length && ProcessingSupport.frozen(record.ID) !== hash) {
        throw new Error('Planning is bevroren. Gebruik READY_FOR_RECONCILIATION voor een correctie.');
      }
      MedicationPlan.missing(plan, expected, existing);
    } else {
      if (!latest && (!existing.length || !ProcessingSupport.frozen(record.ID))) {
        throw new Error('Dit schema is nog niet gegenereerd. Gebruik READY voor eerste generatie.');
      }
      IntakeReconciliation.changes(plan, expected, existing, new Date());
    }
    var unchanged = latest && ProcessingSupport.fingerprint(historyPlan_(latest)) === hash;
    return { id: Utilities.getUuid(), historyId: Utilities.getUuid(), mode: mode, plan: plan, hash: hash,
      startedAt: new Date().toISOString(), version: latest ? latest.Version + 1 : 1,
      phase: 'intakes', noHistory: Boolean(unchanged), pendingIntake: null };
  }

  function restoreIntake_(value) {
    var record = Object.assign({}, value);
    ['ScheduledAt', 'CreatedAt', 'UpdatedAt'].forEach(function (key) { record[key] = new Date(record[key]); });
    return record;
  }

  function historyRecord_(id, state) {
    var plan = state.plan;
    return { ID: state.historyId, ScheduleID: id, Version: state.version, Medication: plan.medication,
      Dosage: plan.dosage, Administration: plan.administration, StartDate: plan.startDate,
      DurationDays: plan.durationDays, Times: plan.times.join(','), ApplicationID: state.id,
      ExpiryReminderDaysBefore: plan.expiryReminderDaysBefore || '', RecordedAt: new Date(state.appliedAt) };
  }

  /**
   * Controleert journalintegriteit en de toegestane status zonder writes.
   * @param {Object} record Aangeboden schema.
   * @param {Object} state Duurzame ApplicationState.
   * @returns {void}
   * @throws {Error} Bij een ongeldig journal of een ongeschikte hervatstatus.
   */
  function validateApplicationState_(record, state) {
    if (!state.id || !state.historyId || !state.plan || !Number.isFinite(Date.parse(state.startedAt)) ||
        ['intakes', 'history'].indexOf(state.phase) === -1 ||
        ProcessingSupport.fingerprint(state.plan) !== state.hash) throw new Error('Ongeldige ApplicationState.');
    var requiredStatus = state.mode === 'initial' ? 'READY' : 'READY_FOR_RECONCILIATION';
    if (record.Status !== requiredStatus && !(record.Status === 'GENERATED' && state.phase === 'history')) {
      throw new Error('Hervat deze toepassing met status ' + requiredStatus + '.');
    }
  }

  /**
   * Hervat een gereserveerde intake en past intakewijzigingen toe onder het scriptlock.
   * Bewaart pendingIntake met UUID voor iedere insert en wist die pas na succesvolle opslag.
   * Bij tijdgebrek blijft fase intakes hervatbaar; de caller bewaart de faseovergang.
   * @param {Object} record Schema met duurzaam opgeslagen ApplicationState.
   * @param {Object} state Journal dat tijdens verwerking wordt bijgewerkt.
   * @param {Object} plan Gevalideerd doelplan.
   * @param {Date[]} expected Verwachte innamemomenten.
   * @param {Object} config Applicatieconfiguratie.
   * @param {number} deadline Uiterste uitvoeringstijd in epochmilliseconden.
   * @returns {{record: Object, completed: boolean, counts: Object=}} Actueel record en verwerkingsuitkomst.
   * @throws {Error} Bij gewijzigde invoer, integriteits- of opslagfouten; het journal blijft voor herstel.
   */
  function applyIntakeChanges_(record, state, plan, expected, config, deadline) {
    if (state.pendingIntake) {
      SheetStore.insertIntake(restoreIntake_(state.pendingIntake));
      state.pendingIntake = null;
      record = save_(record, state);
    }
    var existing = intakes_(record.ID);
    var changes = state.mode === 'initial' ? { updates: [],
      missing: MedicationPlan.missing(plan, expected, existing), counts: { expected: expected.length } } :
      IntakeReconciliation.changes(plan, expected, existing, new Date(state.startedAt));
    ProcessingSupport.log('schedule_application_batch', record.ID, { applicationId: state.id,
      version: state.noHistory ? state.version - 1 : state.version, counts: changes.counts });
    for (var index = 0; index < changes.updates.length; index++) {
      if (Date.now() >= deadline) return { record: record, completed: false };
      assertCurrent_(record, state, config);
      var change = changes.updates[index];
      var current = SheetStore.find('intakes', change.id);
      if (current.CompletedAt || current.Status === 'COMPLETED') continue;
      // Status als laatste: bij onderbreking blijven uitvoering en verzendhistorie intact.
      var values = Object.assign({}, change.values);
      var status = values.Status; delete values.Status;
      values.UpdatedAt = new Date();
      if (status) values.Status = status;
      SheetStore.patch('intakes', current, values);
    }
    for (var offset = 0; offset < changes.missing.length; offset++) {
      if (Date.now() >= deadline) return { record: record, completed: false };
      assertCurrent_(record, state, config);
      var now = new Date();
      state.pendingIntake = { ID: Utilities.getUuid(), ScheduleID: record.ID, Medication: plan.medication,
        Dosage: plan.dosage, Administration: plan.administration, ScheduledAt: changes.missing[offset],
        Status: 'PENDING', ReminderCount: 0, CreatedAt: now, UpdatedAt: now };
      record = save_(record, state);
      SheetStore.insertIntake(restoreIntake_(state.pendingIntake));
      state.pendingIntake = null;
      record = save_(record, state);
    }
    return { record: record, completed: true, counts: changes.counts };
  }

  /**
   * Leest intakes opnieuw en controleert volledigheid voor publicatie, zonder writes.
   * Gebruikt bij reconciliation de oorspronkelijke tijdsgrens uit het journal.
   * @param {Object} record Schema-identiteit.
   * @param {Object} state Duurzame toepassing met mode en startedAt.
   * @param {Object} plan Gevalideerd doelplan.
   * @param {Date[]} expected Verwachte innamemomenten.
   * @returns {void}
   * @throws {Error} Als intakewijzigingen ontbreken of de intakegegevens ongeldig zijn.
   */
  function verifyIntakeChanges_(record, state, plan, expected) {
    var actual = intakes_(record.ID);
    var remaining = state.mode === 'initial' ? { updates: [], missing: MedicationPlan.missing(plan, expected, actual) } :
      IntakeReconciliation.changes(plan, expected, actual, new Date(state.startedAt));
    if (remaining.updates.length || remaining.missing.length) throw new Error('Planverwerking is nog niet volledig.');
  }

  /**
   * Publiceert en rondt de duurzaam opgeslagen fase history af onder het scriptlock.
   * Herhaalde publicatie gebruikt dezelfde history-UUID; GENERATED mag hier worden hervat.
   * Wist ApplicationState en de notificatieblokkering pas na duurzame afronding.
   * @param {Object} record Schema-identiteit.
   * @param {Object} state Journal in fase history met appliedAt en tellingen.
   * @param {Object} config Applicatieconfiguratie.
   * @returns {boolean} True na succesvolle afronding.
   * @throws {Error} Bij gewijzigde invoer of opslagfouten; verwerking kan gedeeltelijk opgeslagen zijn.
   */
  function publishApplication_(record, state, config) {
    assertCurrent_(record, state, config);
    if (!state.noHistory) SheetStore.appendHistory(historyRecord_(record.ID, state));
    ProcessingSupport.freeze(record.ID, state.hash);
    var latest = assertCurrent_(record, state, config);
    SheetStore.patch('schedules', latest, { LastError: '', UpdatedAt: new Date(), Status: 'GENERATED' });
    // Pas na duurzame afronding de notificatieblokkering verwijderen.
    SheetStore.patch('schedules', latest, { ApplicationState: '' });
    ProcessingSupport.log('schedule_applied', record.ID, { applicationId: state.id,
      version: state.noHistory ? state.version - 1 : state.version, historyCreated: !state.noHistory, counts: state.counts });
    return true;
  }

  /**
   * Past een aangeboden plan hervatbaar toe onder het scriptlock van ScheduleService.
   * ApplicationState bewaart doelplan, UUIDs, tijdsgrens en voortgang; history publiceert pas na intakecontrole.
   * @param {Object} record READY/READY_FOR_RECONCILIATION-schema of onafgeronde GENERATED-toepassing.
   * @param {Object} config Applicatieconfiguratie.
   * @param {number} deadline Uiterste lokale uitvoeringstijd in epochmilliseconden.
   * @returns {boolean} True na afronding; false wanneer de volgende trigger de toepassing moet hervatten.
   * @throws {Error} Bij validatie-, integriteits- of opslagfouten. De journal blijft beschikbaar voor herstel.
   */
  function apply(record, config, deadline) {
    var plan = plan_(record, config);
    var expected = MedicationPlan.moments(plan, LocalTime.resolve);
    var state = record.ApplicationState ? JSON.parse(record.ApplicationState) : null;
    if (!state) {
      state = newState_(record, plan, expected);
      record = save_(record, state);
    }
    validateApplicationState_(record, state);
    assertCurrent_(record, state, config);
    // Een initiele partial generation blijft compatibel met de bestaande planvingerafdruk.
    if (state.mode === 'initial') ProcessingSupport.freeze(record.ID, state.hash);
    if (state.phase === 'intakes') {
      var result = applyIntakeChanges_(record, state, plan, expected, config, deadline);
      record = result.record;
      if (!result.completed) return false;
      verifyIntakeChanges_(record, state, plan, expected);
      assertCurrent_(record, state, config);
      // Pas na intakecontrole de publicatiefase duurzaam vastleggen.
      state.phase = 'history'; state.appliedAt = new Date().toISOString(); state.counts = result.counts;
      record = save_(record, state);
    }
    return publishApplication_(record, state, config);
  }

  return { apply: apply };
})();
