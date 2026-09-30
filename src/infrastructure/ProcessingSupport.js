var ProcessingSupport = (function () {
  /** Eén scriptlock voor generatie, notificaties en completion. */
  function locked(work) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return { busy: true };
    try { return work(); } finally { lock.releaseLock(); }
  }

  function fingerprint(plan) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, JSON.stringify(plan), Utilities.Charset.UTF_8));
  }

  function frozen(id) { return PropertiesService.getScriptProperties().getProperty('PLAN_' + id); }
  function freeze(id, hash) { PropertiesService.getScriptProperties().setProperty('PLAN_' + id, hash); }

  function log(event, id) {
    // Geen providerresponse, credentials, completion-links of medische gegevens loggen.
    console.error(JSON.stringify({ event: event, recordId: id || '' }));
  }

  return { locked: locked, fingerprint: fingerprint, frozen: frozen, freeze: freeze, log: log };
})();
