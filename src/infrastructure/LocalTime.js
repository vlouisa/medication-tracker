var LocalTime = (function () {
  /**
   * @param {*} value Sheet-datum of tekstuele datumwaarde.
   * @returns {string} Date als yyyy-MM-dd in Europe/Brussels; overige invoer als getrimde tekst, zonder validatie.
   */
  function dateText(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return Utilities.formatDate(value, 'Europe/Brussels', 'yyyy-MM-dd');
    }
    return String(value || '').trim();
  }

  /**
   * Zet een lokale tijd in Europe/Brussels om naar een absoluut tijdstip.
   * Bij een dubbel uur tijdens de wintertijdomschakeling wordt de vroegste instantie gekozen.
   * @param {string} date Gevalideerde kalenderdatum in yyyy-MM-dd.
   * @param {string} time Gevalideerde tijd in HH:mm.
   * @returns {Date} Het bijbehorende absolute tijdstip.
   * @throws {Error} Als het lokale tijdstip niet bestaat door de klokwisseling.
   */
  function resolve(date, time) {
    var target = date + ' ' + time;
    var wall = new Date(date + 'T' + time + ':00Z').getTime();
    var offsets = new Set();
    [-36, 0, 36].forEach(function (hours) {
      var offset = Utilities.formatDate(new Date(wall + hours * 3600000), 'Europe/Brussels', 'Z');
      var sign = offset[0] === '-' ? -1 : 1;
      offsets.add(sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5))));
    });
    var candidates = Array.from(offsets).map(function (offset) { return new Date(wall - offset * 60000); })
      .filter(function (instant) {
        return Utilities.formatDate(instant, 'Europe/Brussels', 'yyyy-MM-dd HH:mm') === target;
      }).sort(function (a, b) { return a - b; });
    if (!candidates.length) throw new Error('Dit lokale tijdstip bestaat niet door de klokwisseling: ' + target);
    return candidates[0];
  }

  /**
   * @param {Date} date Absoluut tijdstip.
   * @returns {string} Weergave in Europe/Brussels als dd-MM-yyyy HH:mm.
   */
  function display(date) { return Utilities.formatDate(date, 'Europe/Brussels', 'dd-MM-yyyy HH:mm'); }
  return { dateText: dateText, resolve: resolve, display: display };
})();
