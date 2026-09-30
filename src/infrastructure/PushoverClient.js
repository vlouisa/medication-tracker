var PushoverClient = (function () {
  function failure_(message) {
    var error = new Error(message);
    error.notificationMessage = message;
    return error;
  }

  /**
   * @param {{ID: string}} intake Intake met UUID voor de registratielink.
   * @returns {string} Web App-link die de registratiepagina opent zonder de inname te registreren.
   * @throws {Error} Bij een ontbrekende of ongeldige WEB_APP_URL.
   */
  function completionUrl(intake) {
    return Config.webUrl() + '?action=complete&id=' + encodeURIComponent(intake.ID);
  }

  function errorDetails_(body, credentials) {
    if (!Array.isArray(body.errors)) return '';
    return body.errors.filter(function (value) { return typeof value === 'string'; }).slice(0, 3)
      .map(function (value) {
        // Verwijder credentials vóór inkorten, ook als een provider ze in zijn fouttekst herhaalt.
        [credentials.token, credentials.user, encodeURIComponent(credentials.token), encodeURIComponent(credentials.user)]
          .filter(Boolean).sort(function (a, b) { return b.length - a.length; })
          .forEach(function (secret) { value = value.split(secret).join('[verwijderd]'); });
        return value.replace(/https?:\/\/[^\s<>"']+/gi, '[URL verwijderd]')
          .replace(/[A-Za-z0-9]{30,}/g, '[identifier verwijderd]')
          .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
      }).join('; ');
  }

  /**
   * Verstuurt een notificatie met normale prioriteit; alleen NOTIFIED krijgt de herinneringstekst.
   * Doet geen retry of Sheet-write. De aanroeper verzorgt verzendblokkering en resultaatregistratie.
   * Acceptatie door Pushover bewijst niet dat de telefoon de melding heeft getoond.
   * @param {Object} intake Intake met ID, Status, ScheduledAt (Date) en medicatiesnapshot.
   * @returns {void} Alleen bij HTTP 200 en Pushover-status 1.
   * @throws {Error} Bij configuratie-, lengte- of verzendfouten. Verzendfouten dragen een veilige
   *   notificationMessage; bij transportfouten kan de melding toch geaccepteerd zijn.
   */
  function send(intake) {
    var credentials = Config.pushover();
    var repeat = intake.Status === 'NOTIFIED';
    // Een vertraagde eerste melding blijft een eerste melding; alleen herhalingen zijn gemiste herinneringen.
    var message = [repeat ? 'Gemiste herinnering: nog geen inname geregistreerd.' : 'Tijd voor uw medicatie.',
      intake.Medication, intake.Dosage, intake.Administration,
      'Gepland: ' + LocalTime.display(intake.ScheduledAt)].filter(Boolean).join('\n');
    if (message.length > 1024) throw failure_('Notificatie overschrijdt de maximale berichtlengte.');
    var url = completionUrl(intake);
    var response;
    try {
      response = UrlFetchApp.fetch('https://api.pushover.net/1/messages.json', {
        method: 'post', muteHttpExceptions: true, followRedirects: false,
        // Zonder priority gebruikt Pushover normale prioriteit; alle formuliervelden zijn tekst.
        payload: { token: credentials.token, user: credentials.user, title: 'Medicatie',
          message: message, url: url, url_title: 'Inname registreren' }
      });
    } catch (error) {
      // Alleen classificeren; de oorspronkelijke exception kan gevoelige gegevens bevatten.
      var reason = String(error.message || '');
      if (/permission|authorization|authorisation|script\.external_request|rechten|toestemming/i.test(reason)) {
        throw failure_('Apps Script heeft onvoldoende autorisatie voor UrlFetchApp. Controleer de machtigingen van het triggeraccount.');
      }
      if (/quota|too many times|limit exceeded/i.test(reason)) {
        throw failure_('Apps Script meldt een limiet voor externe verzoeken.');
      }
      throw failure_('UrlFetchApp gaf geen bruikbaar antwoord. Netwerkfout of timeout mogelijk; verzenduitkomst onbekend.');
    }
    var body;
    var status = Number(response.getResponseCode());
    var http = Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'onbekend';
    try { body = JSON.parse(response.getContentText()); } catch (error) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw failure_('Pushover: HTTP ' + http + ', antwoord bevat geen geldig JSON-object.');
    }
    if (status !== 200 || body.status !== 1) {
      // Pushover markeert ongeldige invoervelden in de response; toon uitsluitend vaste veldnamen.
      var fields = ['token', 'user', 'device', 'message', 'url', 'url_title', 'priority', 'title']
        .filter(function (field) { return body[field] === 'invalid'; });
      var details = errorDetails_(body, credentials);
      throw failure_('Pushover heeft verzending niet bevestigd (HTTP ' + http + ').' +
        (status === 429 ? ' Verzendlimiet bereikt.' : '') +
        (fields.length ? ' Ongeldige velden: ' + fields.join(', ') + '.' : '') +
        (details ? ' Reden: ' + details : ''));
    }
  }

  return { send: send, completionUrl: completionUrl };
})();
