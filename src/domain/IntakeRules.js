var IntakeRules = (function () {
  /**
   * Bepaalt zonder mutaties of een eerste melding of herhaling verschuldigd is.
   * Voltooide of geblokkeerde intakes worden overgeslagen; herhalingen tellen vanaf de laatste verzending.
   * @param {Object} intake Intake met Sheet-veldnamen en Date-waarden voor tijdstippen.
   * @param {Date} now Referentietijdstip.
   * @param {{reminderLimit: number, reminderMinutes: number}} config Herhalingslimiet en interval in minuten.
   * @returns {boolean} Of de intake nu voor verzending in aanmerking komt.
   * @throws {Error} Bij een ongeldige plandatum of herinneringsregistratie die beoordeeld moet worden.
   */
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

  /**
   * Berekent de registratievelden zonder de intake te wijzigen.
   * @param {Object} intake Intake met status PENDING, NOTIFIED, CANCELLED of COMPLETED.
   * @param {Date} now Tijdstip van registratie.
   * @returns {?{Status: string, CompletedAt: Date, UpdatedAt: Date}} Wijzigingen, of null bij COMPLETED.
   * @throws {Error} Als de status geen registratie toestaat.
   */
  function completion(intake, now) {
    if (intake.Status === 'COMPLETED') return null;
    if (intake.Status !== 'PENDING' && intake.Status !== 'NOTIFIED' && intake.Status !== 'CANCELLED') {
      throw new Error('Deze intake kan niet als uitgevoerd worden geregistreerd.');
    }
    return { Status: 'COMPLETED', CompletedAt: now, UpdatedAt: now };
  }

  return { due: due, completion: completion };
})();
