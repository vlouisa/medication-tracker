var CompletionService = (function () {
  function validateId_(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Ongeldige registratielink.');
    }
  }

  /** Levert de intake en registratiestatus zonder presentatieopmaak. */
  function inspect(id) {
    validateId_(id);
    var intake = SheetStore.find('intakes', id);
    IntakeRules.completion(intake, new Date());
    return { intake: intake, already: intake.Status === 'COMPLETED' };
  }

  /** Idempotente registratie; levert { intake, already }. GET roept deze functie nooit aan. */
  function complete(id) {
    validateId_(id);
    var result = ProcessingSupport.locked(function () {
      var intake = SheetStore.find('intakes', id);
      var changes = IntakeRules.completion(intake, new Date());
      if (!changes) return { intake: intake, already: true };
      // Tijdstip eerst opslaan zodat herstel na een gedeeltelijke write dit kan behouden.
      if (intake.CompletedAt) changes.CompletedAt = intake.CompletedAt;
      intake = SheetStore.patch('intakes', intake, { CompletedAt: changes.CompletedAt,
        UpdatedAt: changes.UpdatedAt, Status: changes.Status });
      return { intake: intake, already: false };
    });
    if (result && result.busy) throw new Error('Even bezig. Probeer de registratie nogmaals.');
    return result;
  }

  return { inspect: inspect, complete: complete };
})();
