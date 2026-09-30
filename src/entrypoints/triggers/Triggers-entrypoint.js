/** Verwerkt uitsluitend aangeboden READY-schema's. */
function processReadySchedules() {
  ScheduleService.processReady();
}

/** Verstuurt eerste meldingen en maximaal het ingestelde aantal herhalingen. */
function processPendingIntakeNotifications() {
  NotificationService.processPending();
}
