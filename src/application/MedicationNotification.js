var MedicationNotification = (function () {
  /**
   * Stelt de eerste melding samen zonder te verzenden of gegevens te wijzigen.
   * @param {Object} intake Intake met ID, ScheduledAt (Date) en medicatiesnapshot.
   * @returns {{title: string, message: string, url: string, urlTitle: string}} Bericht voor de notificatieclient.
   * @throws {Error} Bij een ontbrekende/ongeldige WEB_APP_URL of een niet te formatteren plandatum.
   */
  function initial(intake) {
    return compose_(intake, 'Tijd voor uw medicatie.');
  }

  /**
   * Stelt een herinnering samen zonder te verzenden of gegevens te wijzigen.
   * @param {Object} intake Intake met ID, ScheduledAt (Date) en medicatiesnapshot.
   * @returns {{title: string, message: string, url: string, urlTitle: string}} Bericht voor de notificatieclient.
   * @throws {Error} Bij een ontbrekende/ongeldige WEB_APP_URL of een niet te formatteren plandatum.
   */
  function reminder(intake) {
    return compose_(intake, 'Gemiste herinnering: nog geen inname geregistreerd.');
  }

  function compose_(intake, heading) {
    var message = [heading,
      intake.Medication, intake.Dosage, intake.Administration,
      'Gepland: ' + LocalTime.display(intake.ScheduledAt)].filter(Boolean).join('\n');
    return { title: 'Medicatie', message: message,
      url: Config.webUrl() + '?action=complete&id=' + encodeURIComponent(intake.ID),
      urlTitle: 'Inname registreren' };
  }

  /**
   * @param {Object} snapshot Gepubliceerde planversie met ScheduleID en Version.
   * @param {string} lastDate Laatste lokale plandag. @param {string} today Lokale datum.
   * @returns {Object} Niet-medisch sturend bericht met versiegebonden keuzelink.
   * @throws {Error} Bij ongeldige Web App-configuratie.
   */
  function expiry(snapshot, lastDate, today) {
    var heading = today < lastDate ? 'Medicatieschema loopt bijna af' :
      today === lastDate ? 'Medicatieschema eindigt vandaag' : 'Medicatieschema is afgelopen';
    return { title: heading, message: [snapshot.Medication, 'Laatste geplande dag: ' + lastDate,
      'Er is nog geen keuze gemaakt over een eventueel vervolgplan. Geef aan of een nieuw plan moet worden klaargezet.'].join('\n'),
      url: Config.webUrl() + '?action=schedule-expiry&id=' + encodeURIComponent(snapshot.ScheduleID) + '&version=' + snapshot.Version,
      urlTitle: 'Keuze over vervolgplan' };
  }
  return { initial: initial, reminder: reminder, expiry: expiry };
})();
