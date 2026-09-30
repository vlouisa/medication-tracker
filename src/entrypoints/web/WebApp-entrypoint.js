/** Toont alleen informatie; het openen van een link registreert geen inname. */
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

/** Alleen aangeroepen door de bevestigingsknop binnen de afgeschermde Web App. */
function completeIntake(id) {
  try { return CompletionView.fromResult(CompletionService.complete(id)); }
  catch (error) {
    ProcessingSupport.log('completion_failed');
    throw new Error('Registreren is niet gelukt. Probeer opnieuw; een eerdere registratie blijft behouden.');
  }
}
