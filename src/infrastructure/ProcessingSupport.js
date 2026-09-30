var ProcessingSupport = (function () {
  /**
   * Voert werk uit onder het gedeelde scriptlock; geeft het lock ook bij fouten vrij.
   * @template T
   * @param {function(): T} work Synchrone verwerking, alleen aangeroepen na verkrijgen van het lock.
   * @returns {T|{busy: boolean}} Resultaat van work, of {busy: true} na maximaal drie seconden wachten.
   * @throws {Error} Geeft fouten uit work door.
   */
  function locked(work) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return { busy: true };
    try { return work(); } finally { lock.releaseLock(); }
  }

  /**
   * @param {Object} plan Genormaliseerd plan met stabiele sleutelvolgorde.
   * @returns {string} Webveilige Base64 SHA-256 van de JSON-representatie voor wijzigingsdetectie.
   */
  function fingerprint(plan) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, JSON.stringify(plan), Utilities.Charset.UTF_8));
  }

  /**
   * @param {string} id UUID van het schema.
   * @returns {?string} Opgeslagen planvingerafdruk uit Script Properties, of null als die ontbreekt.
   */
  function frozen(id) { return PropertiesService.getScriptProperties().getProperty('PLAN_' + id); }
  /**
   * Slaat de planvingerafdruk op in Script Properties; overschrijft een bestaande waarde.
   * @param {string} id UUID van het schema.
   * @param {string} hash Resultaat van fingerprint.
   * @returns {void}
   */
  function freeze(id, hash) { PropertiesService.getScriptProperties().setProperty('PLAN_' + id, hash); }

  /**
   * Schrijft technische foutmetadata naar het uitvoeringslog.
   * @param {string} event Vaste eventcode zonder gevoelige gegevens.
   * @param {string} [id] Record-UUID; laat weg als die onbekend is.
   * @param {Object} [details] Technische metadata: uitsluitend IDs, aantallen, versie en vaste foutcodes.
   * @returns {void}
   */
  function log(event, id, details) {
    // Geen providerresponse, credentials, completion-links of medische gegevens loggen.
    console.error(JSON.stringify({ event: event, recordId: id || '', details: details || {} }));
  }

  return { locked: locked, fingerprint: fingerprint, frozen: frozen, freeze: freeze, log: log };
})();
