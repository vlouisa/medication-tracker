/**
 * Globaal kloktrigger-entrypoint: genereert READY-schema's en verwerkt READY_FOR_RECONCILIATION.
 * @returns {void}
 * @throws {Error} Bij configuratie- of leesfouten voor de batch; recordfouten worden in de service afgehandeld.
 */
function processReadySchedules() {
  ScheduleService.processReady();
}

/**
 * Globaal kloktrigger-entrypoint: verstuurt verschuldigde meldingen en registreert het resultaat.
 * @returns {void}
 * @throws {Error} Bij configuratie- of leesfouten voor de batch; recordfouten worden in de service afgehandeld.
 */
function processPendingIntakeNotifications() {
  NotificationService.processPending();
}

/** Verwerkt expiry-reminders per actuele planversie. @returns {void} @throws {Error} Bij globale configuratie- of leesfouten. */
function processScheduleExpiryNotifications() { ScheduleExpiryService.processPending(); }
