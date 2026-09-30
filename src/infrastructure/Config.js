var Config = (function () {
  var SCHEDULE_HEADERS = ['ID', 'Medication', 'Dosage', 'Administration', 'StartDate',
    'DurationDays', 'Times', 'Status', 'LastError', 'CreatedAt', 'UpdatedAt'];
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

  /** Leest configuratie zonder secrets te loggen. */
  function get() {
    var properties = PropertiesService.getScriptProperties();
    return {
      spreadsheetId: required_(properties, 'SPREADSHEET_ID'),
      timezone: 'Europe/Brussels',
      scheduleSheet: 'medication-schedules',
      intakeSheet: 'medication-intakes',
      reminderLimit: integer_(properties, 'REMINDER_REPEAT_COUNT', 3, 0, 100),
      reminderMinutes: integer_(properties, 'REMINDER_INTERVAL_MINUTES', 20, 1, 10080),
      maxIntakes: 2000,
      batchSize: 25,
      executionBudgetMs: 240000
    };
  }

  function webUrl() {
    var value = required_(PropertiesService.getScriptProperties(), 'WEB_APP_URL');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value)) {
      throw new Error('WEB_APP_URL moet een Apps Script /exec-URL zijn.');
    }
    return value;
  }

  function pushover() {
    var properties = PropertiesService.getScriptProperties();
    return {
      token: required_(properties, 'PUSHOVER_API_TOKEN'),
      user: required_(properties, 'PUSHOVER_USER_KEY')
    };
  }

  return { get: get, webUrl: webUrl, pushover: pushover,
    scheduleHeaders: function () { return SCHEDULE_HEADERS.slice(); },
    intakeHeaders: function () { return INTAKE_HEADERS.slice(); } };
})();
