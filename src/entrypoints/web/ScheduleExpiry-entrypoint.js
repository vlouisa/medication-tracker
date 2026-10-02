function expiryParameters_(e) {
  if (!e || !e.parameter || e.parameters && Object.keys(e.parameters).some(function (key) { return e.parameters[key].length !== 1; })) {
    throw new Error('Ongeldige aanvraag.');
  }
  return e.parameter;
}

function expiryPage_(id, version, message) {
  var template = HtmlService.createTemplateFromFile('entrypoints/web/ScheduleExpiry');
  template.model = null; template.error = message || ''; template.url = ''; template.todayUrl = '';
  template.continuationToken = ''; template.noContinuationToken = '';
  try {
    template.url = Config.webUrl(); template.todayUrl = TodayService.url();
    template.model = ScheduleExpiryService.inspect(id, version);
    if (template.model.canChoose) {
      template.continuationToken = ExpiryFormToken.issue(id, template.model.version, 'CONTINUATION_CREATED');
      template.noContinuationToken = ExpiryFormToken.issue(id, template.model.version, 'NO_CONTINUATION');
    }
  } catch (error) {
    template.model = null;
    template.error = message || 'Deze planversie kan niet worden geopend. Controleer de link of probeer later opnieuw.';
    ProcessingSupport.log('expiry_page_failed');
  }
  return template.evaluate().setTitle('Keuze over vervolgplan').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Alleen-lezen router voor de versiegebonden expiry-pagina. @param {Object} e GET-event. @returns {Object} HTML-pagina. */
function renderScheduleExpiry_(e) {
  try { var params = expiryParameters_(e); return expiryPage_(params.id, params.version); }
  catch (error) { return expiryPage_('', '', 'Ongeldige herinneringslink.'); }
}

/**
 * Verwerkt uitsluitend expliciete expiry-formulieren via POST. GET maakt geen state of vervolgplan.
 * Controleert actiegebonden formulierbewijs; de service controleert opnieuw versie, keuze en lock.
 * @param {Object} e Apps Script POST-event met action, id, version, token en eventueel confirmed.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} Resultaat of veilige foutpagina; herhalen is idempotent.
 */
function doPost(e) {
  var params;
  try {
    params = expiryParameters_(e);
    var resolution = params.action === 'create-continuation' ? 'CONTINUATION_CREATED' :
      params.action === 'no-continuation' ? 'NO_CONTINUATION' : '';
    if (!resolution) throw new Error('Onbekende actie.');
    var version = ScheduleExpiryService.validate(params.id, params.version);
    ExpiryFormToken.verify(params.token, params.id, version, resolution);
    if (resolution === 'NO_CONTINUATION' && params.confirmed !== 'YES') throw new Error('Bevestiging ontbreekt.');
    ScheduleContinuationService.resolve(params.id, version, resolution);
    return expiryPage_(params.id, version);
  } catch (error) {
    ProcessingSupport.log('expiry_decision_failed');
    return expiryPage_(params ? params.id : '', params ? params.version : '',
      'De keuze kon niet worden bevestigd. Controleer de status hieronder. Bij een onafgeronde keuze kunt u dezelfde actie herhalen; open bij twijfel de herinneringslink opnieuw.');
  }
}
