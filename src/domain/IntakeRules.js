var IntakeRules = (function () {
  function due(intake, now, config) {
    if (intake.NotificationBlockedAt || intake.CompletedAt) return false;
    if (!(intake.ScheduledAt instanceof Date) || !Number.isFinite(intake.ScheduledAt.getTime())) {
      throw new Error('ScheduledAt bevat geen geldige datum/tijd.');
    }
    if (intake.ScheduledAt > now) return false;
    if (intake.Status === 'PENDING') return true;
    if (intake.Status !== 'NOTIFIED') return false;
    var count = Number(intake.ReminderCount);
    var last = intake.LastReminderAt || intake.NotifiedAt;
    if (!Number.isInteger(count) || count < 0 || !(last instanceof Date) || !Number.isFinite(last.getTime())) {
      throw new Error('Ongeldige herinneringsregistratie.');
    }
    return count < config.reminderLimit && now.getTime() >= last.getTime() + config.reminderMinutes * 60000;
  }

  function completion(intake, now) {
    if (intake.Status === 'COMPLETED') return null;
    if (intake.Status !== 'PENDING' && intake.Status !== 'NOTIFIED') {
      throw new Error('Deze intake kan niet als uitgevoerd worden geregistreerd.');
    }
    return { Status: 'COMPLETED', CompletedAt: now, UpdatedAt: now };
  }

  return { due: due, completion: completion };
})();
