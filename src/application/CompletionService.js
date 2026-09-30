var CompletionService = (function () {
  function validateId_(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Ongeldige registratielink.');
    }
  }

  function view_(intake, already) {
    return { id: intake.ID, medication: intake.Medication, dosage: intake.Dosage,
      administration: intake.Administration, scheduled: LocalTime.display(intake.ScheduledAt),
      completed: intake.Status === 'COMPLETED', already: Boolean(already),
      completedAt: intake.CompletedAt ? LocalTime.display(intake.CompletedAt) : '' };
  }

  function inspect(id) {
    validateId_(id);
    var intake = SheetStore.find('intakes', id);
    IntakeRules.completion(intake, new Date());
    return view_(intake, intake.Status === 'COMPLETED');
  }

  /** Idempotente registratie; GET roept deze functie nooit aan. */
  function complete(id) {
    validateId_(id);
    var result = ProcessingSupport.locked(function () {
      var intake = SheetStore.find('intakes', id);
      var changes = IntakeRules.completion(intake, new Date());
      if (!changes) return view_(intake, true);
      // Tijdstip eerst opslaan zodat herstel na een gedeeltelijke write dit kan behouden.
      if (intake.CompletedAt) changes.CompletedAt = intake.CompletedAt;
      intake = SheetStore.patch('intakes', intake, { CompletedAt: changes.CompletedAt,
        UpdatedAt: changes.UpdatedAt, Status: changes.Status });
      return view_(intake, false);
    });
    if (result && result.busy) throw new Error('Even bezig. Probeer de registratie nogmaals.');
    return result;
  }

  return { inspect: inspect, complete: complete };
})();
