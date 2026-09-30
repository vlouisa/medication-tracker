var CompletionView = (function () {
  /** Zet het registratieresultaat om naar het paginamodel voor de Web App. */
  function fromResult(result) {
    var intake = result.intake;
    return { id: intake.ID, medication: intake.Medication, dosage: intake.Dosage,
      administration: intake.Administration, scheduled: LocalTime.display(intake.ScheduledAt),
      completed: intake.Status === 'COMPLETED', already: Boolean(result.already),
      completedAt: intake.CompletedAt ? LocalTime.display(intake.CompletedAt) : '' };
  }

  return { fromResult: fromResult };
})();
