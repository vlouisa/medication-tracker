var TodayService = (function () {
  function validDate_(value) { return value instanceof Date && Number.isFinite(value.getTime()); }

  /** @returns {string} Vaste link die bij openen steeds de huidige dag toont. @throws {Error} Bij ongeldige WEB_APP_URL. */
  function url() { return Config.webUrl() + '?action=today'; }

  /**
   * Leest opgeslagen innamemomenten voor de lokale plandatum; schrijft of genereert niets.
   * CompletedAt gaat voor op Status bij een gedeeltelijk opgeslagen registratie.
   * Onbruikbare records worden geteld als waarschuwing, zodat een onvolledig overzicht herkenbaar is.
   * @returns {Object} JSON-geschikt overzicht met datum, tellingen, records en aantal onleesbare records.
   * @throws {Error} Bij configuratie- of leesfouten; een leesfout is geen lege dag.
   */
  function overview() {
    var now = new Date();
    var day = LocalTime.dateText(now);
    var baseUrl = Config.webUrl();
    var counts = { open: 0, completed: 0, cancelled: 0 };
    var invalid = 0;
    var records = [];
    SheetStore.read('intakes').forEach(function (intake) {
      if (!validDate_(intake.ScheduledAt)) { invalid++; return; }
      if (LocalTime.dateText(intake.ScheduledAt) !== day) return;
      if (typeof intake.ID !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intake.ID) ||
          ['PENDING', 'NOTIFIED', 'COMPLETED', 'CANCELLED'].indexOf(intake.Status) === -1 ||
          (intake.CompletedAt && !validDate_(intake.CompletedAt))) { invalid++; return; }
      var group = intake.CompletedAt || intake.Status === 'COMPLETED' ? 'completed' :
        intake.Status === 'CANCELLED' ? 'cancelled' : 'open';
      counts[group]++;
      records.push({ id: intake.ID, medication: String(intake.Medication || ''), dosage: String(intake.Dosage || ''),
        administration: String(intake.Administration || ''), scheduled: LocalTime.display(intake.ScheduledAt),
        scheduledAt: intake.ScheduledAt.getTime(), group: group,
        label: group === 'completed' ? 'Ingenomen' : group === 'cancelled' ? 'Geannuleerd' :
          intake.ScheduledAt <= now ? 'Nog niet geregistreerd' : 'Later vandaag',
        completedAt: intake.CompletedAt ? LocalTime.display(intake.CompletedAt) : '',
        url: baseUrl + '?action=complete&id=' + encodeURIComponent(intake.ID) });
    });
    records.sort(function (a, b) { return a.scheduledAt - b.scheduledAt || a.id.localeCompare(b.id); });
    return { date: day, refreshedAt: LocalTime.display(now), counts: counts, records: records, invalid: invalid };
  }

  /**
   * Verstuurt op expliciet verzoek een overzichtslink via Pushover, zonder automatische retry.
   * Een onbekende verzenduitkomst kan betekenen dat het bericht toch is afgeleverd.
   * @returns {void}
   * @throws {Error} Bij configuratie- of verzendfouten.
   */
  function sendLink() {
    PushoverClient.send({ title: 'Medication Tracker', message: 'Open uw medicatieoverzicht voor vandaag.',
      url: url(), urlTitle: 'Open Vandaag' });
  }

  return { url: url, overview: overview, sendLink: sendLink };
})();
