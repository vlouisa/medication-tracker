var IntakeReconciliation = (function () {
  /**
   * Berekent mutaties zonder side effects; identiteit is ScheduledAt binnen een ScheduleID.
   * Uitvoering (ook een gedeeltelijk geschreven CompletedAt) heeft voorrang op plancorrecties.
   * @param {Object} plan Genormaliseerd doelplan.
   * @param {Date[]} expected Verwachte momenten.
   * @param {Object[]} existing Alle intakes van uitsluitend dit schema.
   * @param {Date} cutoff Vast starttijdstip van deze toepassing, ook bij retries.
   * @returns {{updates: Object[], missing: Date[], counts: Object}} Wijzigingen en classificatieaantallen.
   * @throws {Error} Bij dubbele momenten, ongeldige datums of onbekende statussen.
   */
  function changes(plan, expected, existing, cutoff) {
    var wanted = new Set(expected.map(function (date) { return date.getTime(); }));
    var found = new Set();
    var updates = [];
    var counts = { expected: expected.length, unchanged: 0, created: 0, cancelled: 0,
      completedPreserved: 0, reactivated: 0, snapshotsUpdated: 0, pastOmitted: 0 };
    existing.forEach(function (intake) {
      var time = intake.ScheduledAt instanceof Date ? intake.ScheduledAt.getTime() : NaN;
      if (!Number.isFinite(time) || found.has(time) ||
          ['PENDING', 'NOTIFIED', 'COMPLETED', 'CANCELLED'].indexOf(intake.Status) === -1) {
        throw new Error('Intakes bevatten een ongeldig of dubbel moment of een onbekende status.');
      }
      found.add(time);
      if (intake.Status === 'COMPLETED' || intake.CompletedAt) { counts.completedPreserved++; return; }
      var patch = {};
      if (!wanted.has(time)) {
        if (intake.Status !== 'CANCELLED') { patch.Status = 'CANCELLED'; counts.cancelled++; }
      } else {
        var status = intake.Status;
        if (status === 'CANCELLED' && time >= cutoff.getTime()) {
          status = intake.NotifiedAt ? 'NOTIFIED' : 'PENDING';
          patch.Status = status;
          counts.reactivated++;
        }
        // Een geblokkeerde verzendpoging kan al bezorgd zijn: behoud ook dan de oude snapshot.
        if (status === 'PENDING' && !intake.NotificationBlockedAt) {
          [['Medication', plan.medication], ['Dosage', plan.dosage], ['Administration', plan.administration]]
            .forEach(function (pair) { if (intake[pair[0]] !== pair[1]) patch[pair[0]] = pair[1]; });
          if (Object.keys(patch).some(function (key) { return key !== 'Status'; })) counts.snapshotsUpdated++;
        }
      }
      if (Object.keys(patch).length) updates.push({ id: intake.ID, values: patch });
      else counts.unchanged++;
    });
    var missing = expected.filter(function (date) {
      if (found.has(date.getTime())) return false;
      if (date < cutoff) { counts.pastOmitted++; return false; }
      return true;
    });
    counts.created = missing.length;
    return { updates: updates, missing: missing, counts: counts };
  }

  return { changes: changes };
})();
