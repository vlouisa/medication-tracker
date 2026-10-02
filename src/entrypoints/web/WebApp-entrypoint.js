/**
 * Toont Vandaag, een expiry-keuzepagina of de bevestigingspagina zonder writes.
 * Ongeldige links en leesfouten worden als algemene foutmelding op de pagina getoond.
 * @param {{parameter: Object<string, string>, parameters: Object<string, string[]>}} e GET-event met action=today, complete of schedule-expiry en bijbehorende identiteit.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} Registratiepagina of pagina met foutmelding.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'schedule-expiry') return renderScheduleExpiry_(e);
  var duplicate = e && e.parameters && Object.keys(e.parameters).some(function (key) { return e.parameters[key].length !== 1; });
  if (e && e.parameter && e.parameter.action === 'today' && !duplicate) {
    return HtmlService.createTemplateFromFile('entrypoints/web/Today').evaluate().setTitle('Vandaag — Medication Tracker')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var template = HtmlService.createTemplateFromFile('entrypoints/web/Completion');
  template.model = null;
  template.error = '';
  template.todayUrl = '';
  try { template.todayUrl = TodayService.url(); } catch (error) { /* Registratie blijft bruikbaar zonder navigatielink. */ }
  try {
    if (!e || !e.parameter || e.parameter.action !== 'complete' ||
        duplicate) {
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
 * Leest het actuele Vandaag-overzicht vanuit de afgeschermde Web App, zonder writes.
 * @returns {Object} JSON-geschikt overzicht, opnieuw bepaald op het moment van verversen.
 * @throws {Error} Algemene gebruikersmelding bij een leesfout, zonder technische gegevens.
 */
function getTodayOverview() {
  try { return TodayService.overview(); }
  catch (error) {
    ProcessingSupport.log('today_overview_failed');
    throw new Error('Het overzicht kan niet worden geladen. Probeer opnieuw.');
  }
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
