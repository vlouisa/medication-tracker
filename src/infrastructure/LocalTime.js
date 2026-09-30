var LocalTime = (function () {
  function dateText(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return Utilities.formatDate(value, 'Europe/Brussels', 'yyyy-MM-dd');
    }
    return String(value || '').trim();
  }

  /** Zoekt echte UTC-instanties; een dubbel uur kiest de vroegste instantie. */
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

  function display(date) { return Utilities.formatDate(date, 'Europe/Brussels', 'dd-MM-yyyy HH:mm'); }
  return { dateText: dateText, resolve: resolve, display: display };
})();
