/**
 * Toont de bevestigingspagina zonder een inname te registreren.
 * Ongeldige links en leesfouten worden als algemene foutmelding op de pagina getoond.
 * @param {{parameter: Object<string, string>, parameters: Object<string, string[]>}} e Apps Script GET-event met action=complete en id.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} Registratiepagina of pagina met foutmelding.
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('entrypoints/web/Completion');
  template.model = null;
  template.error = '';
  try {
    if (!e || !e.parameter || e.parameter.action !== 'complete' ||
        (e.parameters && Object.keys(e.parameters).some(function (key) { return e.parameters[key].length !== 1; }))) {
      throw new Error('Ongeldige registratielink.');
    }
    template.model = CompletionView.fromResult(CompletionService.inspect(e.parameter.id));
  } catch (error) {
    template.error = 'Deze intake kan niet worden geopend. Controleer de link of probeer later opnieuw.';
    ProcessingSupport.log('completion_page_failed');
  }
  return template.evaluate().setTitle('Inname registreren')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Registreert de bevestiging vanuit google.script.run in de afgeschermde Web App.
 * @param {string} id UUID van de intake.
 * @returns {Object} Paginamodel van CompletionView na idempotente registratie.
 * @throws {Error} Algemene gebruikersmelding bij een mislukte registratie; technische details worden niet doorgestuurd.
 */
function completeIntake(id) {
  try { return CompletionView.fromResult(CompletionService.complete(id)); }
  catch (error) {
    ProcessingSupport.log('completion_failed');
    throw new Error('Registreren is niet gelukt. Probeer opnieuw; een eerdere registratie blijft behouden.');
  }
}
