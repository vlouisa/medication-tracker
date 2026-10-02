var ExpiryFormToken = (function () {
  var KEY = 'EXPIRY_FORM_SECRET';
  function secret_() {
    var secret = PropertiesService.getScriptProperties().getProperty(KEY);
    if (!secret) throw new Error('Voer setupSpreadsheet uit voor expiry-formulieren.');
    return secret;
  }
  function signature_(id, version, resolution, expires) {
    return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
      [id, version, resolution, expires].join('|'), secret_(), Utilities.Charset.UTF_8));
  }
  /** Maakt uitsluitend tijdens setup onder het scriptlock een formuliergeheim aan. @returns {void} */
  function setup() {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty(KEY)) props.setProperty(KEY, Utilities.getUuid() + Utilities.getUuid());
  }
  /**
   * Maakt een ondertekend formulierbewijs zonder writes; dit vervangt de Google-toegangscontrole niet.
   * @param {string} id Schema-UUID. @param {number} version Versie. @param {string} resolution Actie.
   * @returns {string} Actiegebonden token, 24 uur geldig.
   * @throws {Error} Als setup ontbreekt.
   */
  function issue(id, version, resolution) {
    var expires = String(Date.now() + 86400000);
    return expires + '.' + signature_(id, version, resolution, expires);
  }
  /**
   * @param {string} token Formulierbewijs. @param {string} id Schema-UUID.
   * @param {number} version Versie. @param {string} resolution Actie.
   * @returns {void}
   * @throws {Error} Bij verlopen, ontbrekend of gewijzigd bewijs.
   */
  function verify(token, id, version, resolution) {
    var parts = String(token || '').split('.');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || Number(parts[0]) < Date.now() ||
        Number(parts[0]) > Date.now() + 86400000) throw new Error('Open de herinneringslink opnieuw voordat u kiest.');
    var expected = signature_(id, version, resolution, parts[0]);
    var difference = expected.length ^ parts[1].length;
    for (var index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ (parts[1].charCodeAt(index) || 0);
    if (difference) throw new Error('Ongeldig formulierbewijs. Open de herinneringslink opnieuw.');
  }
  return { setup: setup, issue: issue, verify: verify };
})();
