var MedicationPlan = (function () {
  function text_(value) { return String(value === null || value === undefined ? '' : value).trim(); }

  /**
   * @param {string} value Komma-gescheiden dagelijkse tijden in H:mm of HH:mm.
   * @returns {string[]} Unieke, gesorteerde tijden in HH:mm.
   * @throws {Error} Bij lege of ongeldige tijden.
   */
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

  /**
   * Valideert een kalenderdatum zonder lokale tijdzoneconversie.
   * @param {string} value Datum in yyyy-MM-dd.
   * @returns {string} De gevalideerde invoer.
   * @throws {Error} Bij een onbestaande datum of een jaar buiten 1900 tot en met 9998.
   */
  function calendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('StartDate moet een geldige datum zijn.');
    var date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value ||
        Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 9998) {
      throw new Error('StartDate moet een geldige datum tussen 1900 en 9998 zijn.');
    }
    return value;
  }

  /**
   * Valideert het volledige schema voordat persistente intakes ontstaan.
   * @param {Object} record Schema met de oorspronkelijke Sheet-veldnamen.
   * @param {string} dateText StartDate als lokale kalenderdatum in yyyy-MM-dd.
   * @param {number} maxIntakes Maximumaantal innamemomenten voor dit schema.
   * @returns {{medication: string, dosage: string, administration: string, startDate: string, durationDays: number, times: string[]}} Genormaliseerd plan.
   * @throws {Error} Bij ongeldige invoer, te lange medicatietekst of overschrijding van maxIntakes.
   */
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

  /**
   * Genereert momenten per kalenderdag, zodat klokwisselingen de dagelijkse tijden behouden.
   * @param {Object} plan Gevalideerd resultaat van normalize.
   * @param {function(string, string): Date} resolveLocal Zet yyyy-MM-dd en HH:mm om naar een absoluut tijdstip.
   * @returns {Date[]} Alle geplande innamemomenten in dag- en tijdvolgorde.
   * @throws {Error} Als resolveLocal een lokaal tijdstip niet kan omzetten.
   */
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

  /**
   * Controleert momenten en medicatiesnapshots zonder bestaande intakes te wijzigen.
   * @param {Object} plan Gevalideerd resultaat van normalize.
   * @param {Date[]} expected Alle verwachte momenten voor het plan.
   * @param {Object[]} existing Bestaande intakes van uitsluitend dit schema.
   * @returns {Date[]} Ontbrekende momenten in de volgorde van expected.
   * @throws {Error} Bij dubbele/onverwachte momenten of afwijkende medicatiesnapshots.
   */
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
