var MedicationPlan = (function () {
  function text_(value) { return String(value === null || value === undefined ? '' : value).trim(); }

  function parseTimes(value) {
    var times = text_(value).split(',').map(function (part) {
      var match = /^(\d{1,2}):(\d{2})$/.exec(part.trim());
      if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
        throw new Error('Ongeldig tijdstip in Times: ' + part.trim());
      }
      return match[1].padStart(2, '0') + ':' + match[2];
    });
    return Array.from(new Set(times)).sort();
  }

  function calendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('StartDate moet een geldige datum zijn.');
    var date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value ||
        Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 9998) {
      throw new Error('StartDate moet een geldige datum tussen 1900 en 9998 zijn.');
    }
    return value;
  }

  /** Valideert het volledige schema voordat persistente intakes ontstaan. */
  function normalize(record, dateText, maxIntakes) {
    var medication = text_(record.Medication);
    var dosage = text_(record.Dosage);
    var administration = text_(record.Administration);
    if (!medication || !dosage) throw new Error('Medication en Dosage zijn verplicht.');
    if (medication.length + dosage.length + administration.length > 700) {
      throw new Error('Medication, Dosage en Administration mogen samen maximaal 700 tekens bevatten.');
    }
    if (typeof record.DurationDays !== 'number' && typeof record.DurationDays !== 'string') {
      throw new Error('DurationDays moet een positief geheel getal zijn.');
    }
    var duration = Number(record.DurationDays);
    if (!Number.isInteger(duration) || duration <= 0) throw new Error('DurationDays moet een positief geheel getal zijn.');
    var times = parseTimes(record.Times);
    if (duration * times.length > maxIntakes) throw new Error('Schema overschrijdt de limiet van ' + maxIntakes + ' intakes.');
    return { medication: medication, dosage: dosage, administration: administration,
      startDate: calendarDate(dateText), durationDays: duration, times: times };
  }

  function moments(plan, resolveLocal) {
    var result = [];
    var date = new Date(plan.startDate + 'T00:00:00Z');
    for (var day = 0; day < plan.durationDays; day++) {
      var dayText = date.toISOString().slice(0, 10);
      plan.times.forEach(function (time) { result.push(resolveLocal(dayText, time)); });
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return result;
  }

  /** Controleert sleutels én snapshots; retourneert uitsluitend ontbrekende momenten. */
  function missing(plan, expected, existing) {
    var wanted = new Set(expected.map(function (date) { return date.getTime(); }));
    var found = new Set();
    existing.forEach(function (intake) {
      var timestamp = intake.ScheduledAt instanceof Date ? intake.ScheduledAt.getTime() : NaN;
      if (!wanted.has(timestamp) || found.has(timestamp) || intake.Medication !== plan.medication ||
          intake.Dosage !== plan.dosage || intake.Administration !== plan.administration) {
        throw new Error('Bestaande intakes conflicteren met het schema. Herstel de oorspronkelijke invoer.');
      }
      found.add(timestamp);
    });
    return expected.filter(function (date) { return !found.has(date.getTime()); });
  }

  return { parseTimes: parseTimes, calendarDate: calendarDate, normalize: normalize,
    moments: moments, missing: missing };
})();
