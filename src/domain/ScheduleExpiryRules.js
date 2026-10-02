var ScheduleExpiryRules = (function () {
  /** @param {string} day yyyy-MM-dd. @param {number} days Kalenderdagen. @returns {string} Verschoven datum. */
  function shift(day, days) {
    var date = new Date(MedicationPlan.calendarDate(day) + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return MedicationPlan.calendarDate(date.toISOString().slice(0, 10));
  }

  /**
   * Gebruikt dezelfde momenten als intakegeneratie; datumconversie wordt door de aanroeper geleverd.
   * @param {Object} plan Genormaliseerd plan.
   * @param {function(string,string): Date} resolveLocal Bestaande tijdzoneconversie.
   * @param {function(Date): string} dateText Lokale datumconversie.
   * @returns {{lastDate: string, threshold: string, endDate: string, enabled: boolean}} Reminderperiode.
   * @throws {Error} Bij ongeldige of ontbrekende momenten.
   */
  function windowFor(plan, resolveLocal, dateText) {
    var moments = MedicationPlan.moments(plan, resolveLocal);
    if (!moments.length) throw new Error('Plan bevat geen innamemomenten.');
    var last = moments.reduce(function (a, b) { return a > b ? a : b; });
    var day = MedicationPlan.calendarDate(dateText(last));
    var days = MedicationPlan.expiryDays(plan.expiryReminderDaysBefore);
    return { lastDate: day, threshold: shift(day, -days), endDate: shift(day, 7), enabled: days > 0 };
  }

  /**
   * @param {Object} window Reminderperiode.
   * @param {Object} state Expiry-record.
   * @param {string} today Lokale kalenderdatum.
   * @param {string} attemptedDay Lokale datum van vorige poging, of leeg.
   * @returns {boolean} Hoogstens één poging per dag en uitsluitend voor een open beslissing.
   */
  function due(window, state, today, attemptedDay) {
    return window.enabled && today >= window.threshold && today <= window.endDate &&
      state.DecisionStatus === 'OPEN' && state.ReminderStatus === 'ACTIVE' && !state.ResolutionState &&
      (!attemptedDay || attemptedDay < today);
  }

  /** @param {string} lastDate Laatste plandag. @param {string} today Keuzedatum. @returns {string} Voorstel of leeg na afloop. */
  function continuationStart(lastDate, today) { return today <= lastDate ? shift(lastDate, 1) : ''; }

  /**
   * @param {Object} state Expiry-record.
   * @param {string} resolution Gevraagde keuze.
   * @returns {boolean} True als dezelfde keuze al volledig is afgehandeld.
   * @throws {Error} Bij een onbekende of conflicterende keuze.
   */
  function resolved(state, resolution) {
    if (['CONTINUATION_CREATED', 'NO_CONTINUATION'].indexOf(resolution) === -1) throw new Error('Onbekende keuze.');
    if (state.DecisionStatus === 'RESOLVED') {
      if (state.Resolution !== resolution) throw new Error('Er is al een andere keuze vastgelegd.');
      return true;
    }
    if (state.DecisionStatus !== 'OPEN') throw new Error('Ongeldige beslisstatus.');
    return false;
  }
  return { shift: shift, windowFor: windowFor, due: due, continuationStart: continuationStart, resolved: resolved };
})();
