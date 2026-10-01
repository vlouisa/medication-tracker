var Config = (function () {
  var TABLE_NAMES = { schedules: 'medication-schedules', intakes: 'medication-intakes', history: 'medication-schedule-history' };
  var SCHEDULE_HEADERS = ['ID', 'Medication', 'Dosage', 'Administration', 'StartDate',
    'DurationDays', 'Times', 'Status', 'LastError', 'CreatedAt', 'UpdatedAt', 'ApplicationState'];
  var HISTORY_HEADERS = ['ID', 'ScheduleID', 'Version', 'Medication', 'Dosage', 'Administration',
    'StartDate', 'DurationDays', 'Times', 'ApplicationID', 'RecordedAt'];
  var INTAKE_HEADERS = ['ID', 'ScheduleID', 'Medication', 'Dosage', 'Administration',
    'ScheduledAt', 'Status', 'NotifiedAt', 'CompletedAt', 'LastError', 'CreatedAt',
    'UpdatedAt', 'ReminderCount', 'LastReminderAt', 'NotificationBlockedAt'];

  function required_(properties, key) {
    var value = properties.getProperty(key);
    if (!value || !value.trim()) throw new Error('Ontbrekende Script Property: ' + key);
    return value.trim();
  }

  function integer_(properties, key, fallback, min, max) {
    var raw = properties.getProperty(key);
    var value = raw === null ? fallback : Number(raw);
    if (raw === '' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error('Ongeldige Script Property: ' + key);
    }
    return value;
  }

  /**
   * Leest Script Properties en past standaardwaarden en numerieke grenzen toe.
   * @returns {{spreadsheetId: string, timezone: string, scheduleSheet: string, intakeSheet: string, historySheet: string, reminderLimit: number, reminderMinutes: number, maxIntakes: number, batchSize: number, executionBudgetMs: number}} Configuratie; interval in minuten en uitvoeringsbudget in milliseconden.
   * @throws {Error} Bij een ontbrekende SPREADSHEET_ID of ongeldige herinneringsinstellingen.
   */
  function get() {
    var properties = PropertiesService.getScriptProperties();
    return {
      spreadsheetId: required_(properties, 'SPREADSHEET_ID'),
      timezone: 'Europe/Brussels',
      scheduleSheet: TABLE_NAMES.schedules,
      intakeSheet: TABLE_NAMES.intakes,
      historySheet: TABLE_NAMES.history,
      reminderLimit: integer_(properties, 'REMINDER_REPEAT_COUNT', 3, 0, 100),
      reminderMinutes: integer_(properties, 'REMINDER_INTERVAL_MINUTES', 20, 1, 10080),
      maxIntakes: 2000,
      batchSize: 25,
      executionBudgetMs: 240000
    };
  }

  /**
   * @returns {string} Gevalideerde /exec-URL uit WEB_APP_URL.
   * @throws {Error} Als de property ontbreekt of geen ondersteunde Apps Script Web App-URL is.
   */
  function webUrl() {
    var value = required_(PropertiesService.getScriptProperties(), 'WEB_APP_URL');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value)) {
      throw new Error('WEB_APP_URL moet een Apps Script /exec-URL zijn.');
    }
    return value;
  }

  /**
   * @returns {{token: string, user: string}} Pushover-credentials uit Script Properties; nooit loggen.
   * @throws {Error} Als PUSHOVER_API_TOKEN of PUSHOVER_USER_KEY ontbreekt of leeg is.
   */
  function pushover() {
    var properties = PropertiesService.getScriptProperties();
    return {
      token: required_(properties, 'PUSHOVER_API_TOKEN'),
      user: required_(properties, 'PUSHOVER_USER_KEY')
    };
  }

  return { get: get, webUrl: webUrl, pushover: pushover,
    /** @returns {Object<string, string>} Kopie van tabelnamen, ook beschikbaar bij ongeldige Script Properties. */
    tableNames: function () { return Object.assign({}, TABLE_NAMES); },
    /** @returns {string[]} Kopie van de verplichte historyheaders. */
    historyHeaders: function () { return HISTORY_HEADERS.slice(); },
    /** @returns {string[]} Kopie van de verplichte schemaheaders in de standaardvolgorde. */
    scheduleHeaders: function () { return SCHEDULE_HEADERS.slice(); },
    /** @returns {string[]} Kopie van de verplichte intakeheaders in de standaardvolgorde. */
    intakeHeaders: function () { return INTAKE_HEADERS.slice(); } };
})();
