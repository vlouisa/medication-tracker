var ManagementService = (function () {
  function value_(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? LocalTime.display(value) : 'Ongeldige datum';
    return ManagementStore.safeText(value);
  }

  function record_(kind, record, labels, heading) {
    return { kind: kind, id: ManagementStore.safeText(record.ID), heading: ManagementStore.safeText(heading),
      fields: labels.map(function (pair) { return { label: pair[1], value: value_(record[pair[0]]) }; }) };
  }

  function find_(kind, id) {
    var record = ManagementStore.read(kind).find(function (item) { return item.ID === id; });
    if (!record) throw new Error('Record niet gevonden. Selecteer de rij opnieuw.');
    return record;
  }

  /**
   * Controleert inrichting en operationele problemen zonder writes of externe verzoeken.
   * Elke controle wordt apart afgevangen; een configuratiefout verhindert overige diagnoses niet.
   * @returns {Object} Serializable rapport met checks, begrensde probleemlijst en uitleg.
   */
  function status() {
    var report = { title: 'Beheerstatus', notes: ['Momentopname; gegevens kunnen tijdens het lezen veranderen.',
      'Triggers: alleen zichtbaar voor het huidige account. Aanwezigheid bewijst geen succesvolle uitvoering.'], checks: [], records: [] };
    function check(label, work) {
      try { var result = work(); report.checks.push({ label: label, level: result.level || 'goed', detail: result.detail }); return result.value; }
      catch (error) { report.checks.push({ label: label, level: 'niet controleerbaar', detail: ManagementStore.safeText(error.message) }); return null; }
    }
    var book = check('Geopende Spreadsheet', function () {
      return { detail: 'Komt overeen met SPREADSHEET_ID.', value: ManagementStore.assertTarget() };
    });
    var config = check('Herinneringsinstellingen', function () {
      var result = Config.get();
      return { detail: result.reminderLimit + ' herhalingen, interval ' + result.reminderMinutes + ' minuten.', value: result };
    });
    check('Pushover-configuratie', function () {
      Config.pushover(); return { detail: 'Beide credentials zijn ingevuld. Geldigheid bij Pushover is niet getest.' };
    });
    check('Expiry-instellingen', function () {
      return { detail: 'Expiry-reminders vanaf ' + Config.expiryHour() + ':00 lokale tijd.' };
    });
    check('Web App-configuratie', function () {
      Config.webUrl(); return { detail: 'URL heeft het verwachte formaat. Bereikbaarheid en deploymentversie zijn niet getest.' };
    });
    check('Projecttijdzone', function () {
      var zone = Session.getScriptTimeZone();
      return { level: zone === 'Europe/Brussels' ? 'goed' : 'aandacht nodig', detail: 'Project: ' + zone + '; verwacht Europe/Brussels.' };
    });
    if (!book) { report.notes.push('Recordgegevens worden pas gelezen vanuit de geconfigureerde Spreadsheet.'); return report; }
    check('Spreadsheet-tijdzone', function () {
      var zone = book.getSpreadsheetTimeZone();
      return { level: zone === 'Europe/Brussels' ? 'goed' : 'aandacht nodig', detail: 'Spreadsheet: ' + zone + '; verwacht Europe/Brussels.' };
    });
    check('Kloktriggers', function () {
      var triggers = ScriptApp.getProjectTriggers();
      var counts = ['processReadySchedules', 'processPendingIntakeNotifications', 'processScheduleExpiryNotifications'].map(function (name) {
        return triggers.filter(function (trigger) { return trigger.getHandlerFunction() === name && trigger.getEventType() === ScriptApp.EventType.CLOCK; }).length;
      });
      return { level: counts.every(function (count) { return count === 1; }) ? 'goed' : 'aandacht nodig',
        detail: 'Schemaverwerking: ' + counts[0] + '; notificaties: ' + counts[1] + '; expiry: ' + counts[2] + '. Verwacht één per soort. Het werkelijke interval is hier niet vastgesteld.' };
    });
    var tables = {};
    ['schedules', 'intakes', 'history', 'expiry'].forEach(function (kind) {
      tables[kind] = check('Tabel: ' + kind, function () {
        var rows = ManagementStore.read(kind); return { detail: rows.length + ' records; vereiste headers aanwezig.', value: rows };
      });
    });
    var total = 0;
    function issue(kind, record, heading, advice) {
      total++;
      if (report.records.length >= 100) return;
      var entry = record_(kind, record, [['ID', 'UUID'], ['Status', 'Status'], ['LastError', 'Laatste fout']], heading);
      entry.fields.push({ label: 'Vervolgstap', value: advice });
      report.records.push(entry);
    }
    (tables.schedules || []).forEach(function (record) {
      if (record.Status === 'ERROR' || record.ApplicationState) issue('schedules', record,
        record.Status === 'ERROR' ? 'Schema met fout' : 'Onafgeronde planverwerking',
        'Inspecteer het schema. Herstel bij gedeeltelijke verwerking eerst het aangeboden doelplan en bied met dezelfde verwerkingsstatus opnieuw aan.');
      if (record.Status === 'GENERATED' && Number(record.ExpiryReminderDaysBefore) > 0 && tables.history &&
          !tables.history.some(function (row) { return row.ScheduleID === record.ID && row.RecordedAt; })) {
        issue('schedules', record, 'Expiry zonder toegepaste history-versie',
          'Controleer alle planvelden en pas de expiry-instelling toe via READY_FOR_RECONCILIATION.');
      }
    });
    (tables.expiry || []).forEach(function (record) {
      if (!record.CreatedAt || record.DecisionStatus === 'OPEN' && record.ResolutionState) {
        issue('expiry', record, 'Onafgeronde expiry-verwerking',
          record.CreatedAt ? 'Open de oorspronkelijke herinneringslink en herhaal dezelfde keuze. Wijzig geen herstelvelden.' :
            'Een volgende expiry-uitvoering hervat de initialisatie voor een actuele versie.');
      } else if (record.LastError) issue('expiry', record, 'Expiry-verzendfout',
        'Vandaag wordt niet automatisch opnieuw verzonden. Een volgende kalenderdag mag een nieuwe poging volgen.');
    });
    if (tables.expiry) report.checks.push({ label: 'Expiry-beslissingen', level: 'informatie',
      detail: tables.expiry.filter(function (row) { return row.DecisionStatus === 'OPEN'; }).length + ' open; ' +
        tables.expiry.filter(function (row) { return row.DecisionStatus === 'OPEN' && row.ReminderStatus === 'EXPIRED'; }).length +
        ' open met verstreken reminderperiode. Ook eerdere versies blijven voor audit bewaard; alleen actuele versies kunnen verzenden.' });
    (tables.intakes || []).forEach(function (record) {
      if (record.NotificationBlockedAt && !record.CompletedAt && record.Status !== 'COMPLETED') issue('intakes', record, 'Verzendblokkering',
        'Onderzoek de eerdere verzendpoging. Deze kan al bezorgd zijn; wis de blokkering niet blind.');
      if (!record.ID) issue('intakes', record, 'Intake zonder UUID', 'Onderzoek de technische gegevens; geen automatisch herstel beschikbaar.');
    });
    (tables.history || []).forEach(function (record) {
      if (!record.RecordedAt) issue('history', record, 'Onvolledige history-rij',
        'Nog niet gepubliceerd. Hervat het bijbehorende schema met het oorspronkelijke doelplan.');
    });
    if (config && tables.intakes && tables.schedules) {
      var sendable = 0, blocked = 0, invalid = 0;
      var schedules = new Map(tables.schedules.map(function (item) { return [item.ID, item]; }));
      tables.intakes.forEach(function (intake) {
        try {
          if (!IntakeRules.due(Object.assign({}, intake, { NotificationBlockedAt: '' }), new Date(), config)) return;
          var schedule = schedules.get(intake.ScheduleID);
          if (intake.NotificationBlockedAt || !schedule || schedule.Status !== 'GENERATED' || schedule.ApplicationState) blocked++;
          else sendable++;
        } catch (error) { invalid++; }
      });
      report.checks.push({ label: 'Verschuldigde meldingen', level: blocked || invalid ? 'aandacht nodig' : 'goed',
        detail: sendable + ' verzendbaar volgens de recordregels; ' + blocked + ' geblokkeerd; ' + invalid + ' ongeldige records. Configuratie en tijdzones moeten ook geldig zijn.' });
    } else report.checks.push({ label: 'Verschuldigde meldingen', level: 'niet controleerbaar', detail: 'Herstel eerst de configuratie of tabelproblemen.' });
    report.notes.push(total + ' recordproblemen gevonden; maximaal 100 getoond.');
    return report;
  }

  /**
   * Inspecteert één actueel record op UUID; toont geen ruwe ApplicationState of credentials.
   * @param {string} kind schedules, intakes of history.
   * @param {string} id UUID uit de selectie.
   * @returns {Object} Rapport met velden en concrete vervolgstappen.
   * @throws {Error} Bij ongeldige selectie of onleesbare tabel.
   */
  function inspect(kind, id) {
    var record = find_(kind, id);
    var labels = [['ID', 'UUID'], ['ScheduleID', 'Schema-UUID'], ['Status', 'Status'], ['Medication', 'Medicatie'],
      ['Dosage', 'Dosering'], ['Administration', 'Toediening'], ['StartDate', 'Startdatum'], ['DurationDays', 'Duur in dagen'],
      ['Times', 'Tijden'], ['ScheduledAt', 'Gepland'], ['CompletedAt', 'Uitgevoerd'], ['NotifiedAt', 'Eerste melding'],
      ['LastReminderAt', 'Laatste melding'], ['ReminderCount', 'Herhalingen'], ['NotificationBlockedAt', 'Geblokkeerd sinds'],
      ['Version', 'Versie'], ['RecordedAt', 'Versie vastgelegd'], ['LastError', 'Laatste fout'],
      ['ExpiryReminderDaysBefore', 'Expiry-voorwaarschuwing in dagen'], ['SourceScheduleID', 'Bronplan'], ['SourceScheduleVersion', 'Bronversie'],
      ['ScheduleVersion', 'Planversie'], ['DecisionStatus', 'Beslissing'], ['ReminderStatus', 'Reminderperiode'],
      ['LastReminderAttemptAt', 'Laatste verzendpoging'], ['Resolution', 'Keuze'], ['ResolvedAt', 'Afgehandeld'],
      ['ContinuationScheduleID', 'Vervolgplan']]
      .filter(function (pair) { return Object.prototype.hasOwnProperty.call(record, pair[0]); });
    var report = { title: 'Recordinspectie', checks: [], records: [record_(kind, record, labels, 'Geselecteerd record')], notes: [] };
    if (record.ApplicationState) {
      try {
        var state = JSON.parse(record.ApplicationState);
        if (['initial', 'reconciliation'].indexOf(state.mode) === -1 || !state.plan || typeof state.plan !== 'object') {
          throw new Error('Ongeldige herstelgegevens.');
        }
        report.notes.push('Onafgeronde toepassing. Hervatten via ' + (state.mode === 'initial' ? 'READY' : 'READY_FOR_RECONCILIATION') + '.');
        report.notes.push('Herstel eerst de aangeboden planvelden hieronder. Wijzig ApplicationState niet.');
        var plan = state.plan || {};
        report.records.push({ heading: 'Aangeboden doelplan', fields: ['medication', 'dosage', 'administration', 'startDate', 'durationDays', 'times', 'expiryReminderDaysBefore'].map(function (key) {
          return { label: key, value: value_(Array.isArray(plan[key]) ? plan[key].join(',') : plan[key]) };
        }) });
      } catch (error) { report.notes.push('De herstelgegevens zijn onleesbaar. Laat deze onderzoeken; wis ApplicationState niet.'); }
    } else if (record.Status === 'ERROR') report.notes.push('Controleer Laatste fout en herstel de invoer. Gebruik READY voor eerste generatie, READY_FOR_RECONCILIATION voor een correctie.');
    if (record.NotificationBlockedAt) report.notes.push('De verzenduitkomst kan onzeker zijn. Deze versie biedt geen automatische deblokkering.');
    if (record.Status === 'CANCELLED') report.notes.push('Dit moment krijgt geen meldingen. Een bestaande link kan daadwerkelijke inname nog registreren.');
    if (record.Status === 'COMPLETED') report.notes.push('Deze inname is geregistreerd; oorspronkelijke uitvoeringsgegevens blijven behouden.');
    if (kind === 'expiry') {
      report.notes.push('Alleen de actuele gepubliceerde versie kan worden afgehandeld. EXPIRED beëindigt meldingen, niet de open beslissing.');
      if (record.ResolutionState && record.DecisionStatus === 'OPEN') report.notes.push('Herhaal de oorspronkelijk gekozen actie via de herinneringslink om de afhandeling te hervatten.');
    }
    if (!report.notes.length) report.notes.push('Geen herstelactie op basis van dit record nodig. Gebruik de normale Sheet-statussen om een schema aan te bieden.');
    return report;
  }

  /**
   * Vergelijkt opeenvolgende gepubliceerde versies voor het geselecteerde schema of gekoppelde record.
   * @param {string} kind schedules, intakes of history.
   * @param {string} id Record-UUID.
   * @returns {Object} Alleen-lezen historie met verschillen; maximaal de laatste 100 versies.
   * @throws {Error} Bij ongeldige selectie of ontbrekende historiegegevens.
   */
  function history(kind, id) {
    var selected = find_(kind, id);
    var scheduleId = kind === 'schedules' ? selected.ID : selected.ScheduleID;
    if (!scheduleId) throw new Error('Deze rij verwijst niet naar een schema.');
    var rows = ManagementStore.read('history').filter(function (row) { return row.ScheduleID === scheduleId && row.RecordedAt; })
      .sort(function (a, b) { return Number(a.Version) - Number(b.Version); });
    var labels = [['Medication', 'Medicatie'], ['Dosage', 'Dosering'], ['Administration', 'Toediening'],
      ['StartDate', 'Startdatum'], ['DurationDays', 'Duur in dagen'], ['Times', 'Tijden'], ['ExpiryReminderDaysBefore', 'Expiry-voorwaarschuwing in dagen']];
    var records = rows.map(function (row, index) {
      var entry = record_('history', row, [['Version', 'Versie'], ['RecordedAt', 'Vastgelegd']].concat(labels), 'Planversie ' + row.Version);
      var before = rows[index - 1];
      entry.fields.push({ label: 'Gewijzigd', value: before ? labels.filter(function (pair) {
        return pair[0] === 'StartDate' ? LocalTime.dateText(before.StartDate) !== LocalTime.dateText(row.StartDate) :
          String(before[pair[0]]) !== String(row[pair[0]]);
      }).map(function (pair) { return pair[1]; }).join(', ') || 'Geen inhoudelijk verschil' : 'Eerste vastgelegde versie' });
      return entry;
    });
    return { title: 'Planhistorie', checks: [], records: records.slice(-100), notes: [rows.length + ' gepubliceerde versies; maximaal de laatste 100 getoond.',
      'Bij oudere schema’s kan de historie pas bij de eerste correctie beginnen. Onvolledige history-rijen zijn geen gepubliceerde versie.'] };
  }

  return { status: status, inspect: inspect, history: history };
})();
