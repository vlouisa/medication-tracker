var CompletionService = (function () {
  function validateId_(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Ongeldige registratielink.');
    }
  }

  /**
   * Leest de intake en controleert of registratie mogelijk is; schrijft geen gegevens.
   * @param {string} id UUID van de intake.
   * @returns {{intake: Object, already: boolean}} Intake en indicatie of deze al voltooid is.
   * @throws {Error} Bij een ongeldige UUID, ontbrekende intake, ongeldige status of leesfout.
   */
  function inspect(id) {
    validateId_(id);
    var intake = SheetStore.find('intakes', id);
    IntakeRules.completion(intake, new Date());
    return { intake: intake, already: intake.Status === 'COMPLETED' };
  }

  /**
   * Registreert de inname onder het scriptlock. Herhaalde registratie behoudt het oorspronkelijke tijdstip.
   * Schrijft CompletedAt voor Status, zodat herstel na een gedeeltelijke write het tijdstip behoudt.
   * @param {string} id UUID van de intake.
   * @returns {{intake: Object, already: boolean}} Intake en indicatie of deze al voltooid was.
   * @throws {Error} Bij ongeldige invoer/status, een bezet lock of een lees-/schrijffout.
   */
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
