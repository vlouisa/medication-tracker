var ScheduleHistory = (function () {
  /**
   * @param {string} id Schema-UUID.
   * @returns {Object[]} Gepubliceerde versies, oplopend gesorteerd.
   * @throws {Error} Bij dubbele of ongeldige versie-identiteiten.
   */
  function published(id) {
    var rows = SheetStore.read('history').filter(function (row) { return row.ScheduleID === id && row.RecordedAt; });
    var versions = new Set(), applications = new Set();
    rows.forEach(function (row) {
      if (!Number.isInteger(row.Version) || row.Version < 1 || versions.has(row.Version) ||
          !row.ApplicationID || applications.has(row.ApplicationID)) throw new Error('Ongeldige planhistorie.');
      versions.add(row.Version); applications.add(row.ApplicationID);
    });
    return rows.sort(function (a, b) { return a.Version - b.Version; });
  }
  /** @param {Object} row Gepubliceerde snapshot. @returns {Object} Genormaliseerd plan. @throws {Error} Bij ongeldige planinhoud. */
  function plan(row) { return MedicationPlan.normalize(row, LocalTime.dateText(row.StartDate), Config.get().maxIntakes); }
  return { published: published, plan: plan };
})();
