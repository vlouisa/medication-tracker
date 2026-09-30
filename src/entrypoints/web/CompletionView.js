var CompletionView = (function () {
  /**
   * Zet het registratieresultaat om naar het paginamodel; formatteert tijdstippen in Europe/Brussels.
   * @param {{intake: Object, already: boolean}} result Resultaat van CompletionService.
   * @returns {{id: string, medication: string, dosage: string, administration: string, scheduled: string, completed: boolean, cancelled: boolean, already: boolean, completedAt: string}} Paginamodel met een lege completedAt zolang registratie ontbreekt.
   */
  function fromResult(result) {
    var intake = result.intake;
    return { id: intake.ID, medication: intake.Medication, dosage: intake.Dosage,
      administration: intake.Administration, scheduled: LocalTime.display(intake.ScheduledAt),
      completed: intake.Status === 'COMPLETED', cancelled: intake.Status === 'CANCELLED', already: Boolean(result.already),
      completedAt: intake.CompletedAt ? LocalTime.display(intake.CompletedAt) : '' };
  }

  return { fromResult: fromResult };
})();
