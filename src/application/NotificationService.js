var NotificationService = (function () {
  function processOne_(id, config) {
    var intake = SheetStore.find('intakes', id);
    if (!IntakeRules.due(intake, new Date(), config)) return false;
    var schedule = SheetStore.find('schedules', intake.ScheduleID);
    if (schedule.Status !== 'GENERATED') return false;

    // Eerst duurzaam blokkeren: ook een crash na verzending mag geen technische retry veroorzaken.
    intake = SheetStore.patch('intakes', intake, { NotificationBlockedAt: new Date(),
      LastError: 'Verzending gestart; bij onderbreking is de uitkomst onbekend.', UpdatedAt: new Date() });
    var accepted = false;
    try {
      PushoverClient.send(intake);
      accepted = true;
      var now = new Date();
      var repeat = intake.Status === 'NOTIFIED';
      SheetStore.patch('intakes', intake, {
        NotifiedAt: intake.NotifiedAt || now,
        ReminderCount: repeat ? Number(intake.ReminderCount) + 1 : 0,
        LastReminderAt: now, UpdatedAt: now, Status: 'NOTIFIED', LastError: '',
        NotificationBlockedAt: ''
      });
    } catch (error) {
      ProcessingSupport.log('notification_failed', intake.ID);
      var message = accepted ? 'Pushover heeft het bericht geaccepteerd, maar het opslaan van het resultaat is mislukt.' :
        (error.notificationMessage || 'Verzending mislukt of uitkomst onbekend.');
      SheetStore.patch('intakes', intake, { LastError: message + ' Automatisch verzenden is geblokkeerd.',
        UpdatedAt: new Date() });
    }
    return true;
  }

  /**
   * Verwerkt verschuldigde meldingen op plandatum binnen de batch- en uitvoeringslimiet.
   * Vergrendelt per intake en slaat een verzendblokkering op voordat Pushover wordt aangeroepen.
   * Bij mislukte of onzekere verzending blijft de blokkering staan; recordfouten worden geisoleerd.
   * Een bezet lock stopt de batch. Succesvolle verzending werkt status en herinneringsteller bij.
   * @returns {void}
   * @throws {Error} Bij configuratiefouten of fouten tijdens het inlezen van de kandidaten.
   */
  function processPending() {
    var config = Config.get();
    // Configuratiefouten stoppen vóór er intakepogingen worden vastgelegd.
    Config.pushover();
    Config.webUrl();
    var started = Date.now();
    var candidates = SheetStore.read('intakes').filter(function (intake) {
      try { return IntakeRules.due(intake, new Date(), config); }
      catch (error) { ProcessingSupport.log('invalid_notification_record', intake.ID); return false; }
    }).sort(function (a, b) { return a.ScheduledAt - b.ScheduledAt; });
    var sent = 0;
    for (var index = 0; index < candidates.length; index++) {
      if (sent >= config.batchSize || Date.now() - started >= config.executionBudgetMs) break;
      try {
        var result = ProcessingSupport.locked(function () { return processOne_(candidates[index].ID, config); });
        if (result && result.busy) break;
        if (result === true) sent++;
      } catch (error) { ProcessingSupport.log('notification_processing_failed', candidates[index].ID); }
    }
  }

  return { processPending: processPending };
})();
