/** Bouwt bij openen uitsluitend het beheermenu; leest of wijzigt geen operationele gegevens. @returns {void} */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Medication Tracker')
    .addItem('Vandaag-overzicht openen…', 'showTodayLink')
    .addItem('Vandaag-link naar telefoon sturen…', 'manageSendTodayLink')
    .addSeparator()
    .addItem('Beheerstatus…', 'showManagementStatus')
    .addItem('Geselecteerd record inspecteren…', 'showManagementRecord')
    .addItem('Planhistorie bekijken…', 'showManagementHistory')
    .addSeparator()
    .addSubMenu(ui.createMenu('Verwerking')
      .addItem('Aangeboden schema’s nu verwerken…', 'manageProcessSchedules')
      .addItem('Verschuldigde notificaties nu verwerken…', 'manageProcessNotifications'))
    .addSubMenu(ui.createMenu('Inrichting')
      .addItem('Spreadsheet inrichten / bijwerken…', 'manageSetupSpreadsheet')
      .addItem('Ontbrekende triggers installeren…', 'manageInstallTriggers'))
    .addItem('Help en herstel…', 'showManagementHelp').addToUi();
}

function managementPanel_(mode) {
  try {
    var selected = mode === 'record' || mode === 'history' ? ManagementStore.selection() : { kind: '', id: '' };
    var template = HtmlService.createTemplateFromFile('entrypoints/management/Management');
    template.mode = mode; template.kind = selected.kind; template.id = selected.id;
    SpreadsheetApp.getUi().showSidebar(template.evaluate().setTitle('Medication Tracker'));
  } catch (error) { SpreadsheetApp.getUi().alert(ManagementStore.safeText(error.message)); }
}

/** Opent het alleen-lezen statuspaneel, ook bij ontbrekende configuratie. @returns {void} */
function showManagementStatus() { managementPanel_('status'); }
/** Legt de geselecteerde UUID vast en opent de recordinspectie. @returns {void} */
function showManagementRecord() { managementPanel_('record'); }
/** Opent de gepubliceerde planversies van het geselecteerde record. @returns {void} */
function showManagementHistory() { managementPanel_('history'); }
/** Opent uitleg over normaal gebruik en herstel. @returns {void} */
function showManagementHelp() { managementPanel_('help'); }

/** Opent een zijpaneel met de vaste Vandaag-link; leest of wijzigt geen intakes. @returns {void} */
function showTodayLink() {
  try {
    ManagementStore.assertTarget();
    var template = HtmlService.createTemplateFromFile('entrypoints/management/TodayLink');
    template.url = TodayService.url();
    SpreadsheetApp.getUi().showSidebar(template.evaluate().setTitle('Vandaag'));
  } catch (error) { SpreadsheetApp.getUi().alert(ManagementStore.safeText(error.message)); }
}

/** Verstuurt na bevestiging een echte Pushover-link; doet geen automatische retry. @returns {void} */
function manageSendTodayLink() {
  managementAction_('Vandaag-link versturen', 'Dit verstuurt een Pushover-bericht met een link naar Vandaag. Doorgaan?',
    function () { return ProcessingSupport.locked(function () { TodayService.sendLink(); }); });
}

/**
 * Leest het rapport voor het beheerzijpaneel; doet geen operationele writes.
 * @param {string} mode status, record, history of help.
 * @param {string} kind Tabelsoort bij record/history.
 * @param {string} id UUID bij record/history.
 * @returns {Object} JSON-geschikt rapport zonder Date-objecten of credentials.
 * @throws {Error} Veilige melding bij een ongeldige aanvraag of onleesbare gegevens.
 */
function getManagementReport(mode, kind, id) {
  try {
    if (mode === 'status') return ManagementService.status();
    if (mode === 'record') return ManagementService.inspect(kind, id);
    if (mode === 'history') return ManagementService.history(kind, id);
    if (mode === 'help') return { title: 'Help en herstel', checks: [], records: [], notes: [
      'Nieuw schema: vul de planvelden in en kies READY. Corrigeer een gegenereerd schema via READY_FOR_RECONCILIATION.',
      'Bij ERROR: inspecteer het record en herstel de invoer. Bij gedeeltelijke verwerking moet eerst het aangeboden doelplan worden hersteld. Bied vervolgens met dezelfde verwerkingsstatus opnieuw aan.',
      'Schema’s nu verwerken pakt alleen aangeboden schema’s op. ERROR wordt niet automatisch opnieuw aangeboden.',
      'Een verzendblokkering kan betekenen dat een bericht wel is bezorgd maar de verwerking niet is afgerond. Wis deze niet zonder onderzoek.',
      'Bewerk ApplicationState, PLAN_-properties, intakegegevens en history niet handmatig voor normale correcties.',
      'CANCELLED betekent dat een gepland moment is vervallen. Een oude link blijft bruikbaar om daadwerkelijke inname te registreren.',
      'Spreadsheet inrichten / bijwerken past headers, opmaak en validatie aan. Maak vooraf duidelijk welke Spreadsheet u beheert.',
      'Triggerbeheer geldt voor het huidige account. Gebruik het account dat de applicatie beheert. Bestaande triggerintervallen worden niet aangepast.',
      'Dit menu is bedoeld voor beheer in de desktopbrowser; dagelijks gebruik via Sheet-statussen en registratielinks blijft beschikbaar.'
    ] };
    throw new Error('Onbekend beheeronderdeel.');
  } catch (error) { throw new Error(ManagementStore.safeText(error.message)); }
}

/**
 * Navigeert naar een record zonder celwaarden te wijzigen.
 * @param {string} kind schedules, intakes of history.
 * @param {string} id Record-UUID; rijnummers worden opnieuw opgezocht.
 * @returns {boolean} True na selectie.
 * @throws {Error} Bij ongeldige container, tabel of UUID.
 */
function selectManagementRecord(kind, id) {
  try { ManagementStore.select(kind, id); return true; }
  catch (error) { throw new Error(ManagementStore.safeText(error.message)); }
}

function managementAction_(title, explanation, work) {
  var ui = SpreadsheetApp.getUi();
  try {
    ManagementStore.assertTarget();
    if (ui.alert(title, explanation, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    // Een dialoog bewaart geen lock. Controleer de container opnieuw; de service verkrijgt daarna zelf het lock.
    ManagementStore.assertTarget();
    var result = work();
    if (result && Object.prototype.hasOwnProperty.call(result, 'processed')) {
      ui.alert(title, 'Afgerond: ' + result.processed + '\nMislukt: ' + result.failed + '\nOvergeslagen: ' + result.skipped +
        '\nNog niet afgerond: ' + result.remaining + (result.busy ? '\nGestopt: een andere verwerking is bezig.' : '') +
        '\nRaadpleeg Beheerstatus voor eventuele vervolgacties.', ui.ButtonSet.OK);
    } else ui.alert(result && result.busy ? 'Een andere verwerking is bezig. Probeer later opnieuw.' : 'Beheeractie afgerond.');
  } catch (error) {
    ui.alert('Beheeractie niet afgerond: ' + ManagementStore.safeText(error.message) +
      '\nEerdere deelstappen kunnen al uitgevoerd zijn. Controleer Beheerstatus.');
  }
}

/** Verwerkt na bevestiging aangeboden schema’s via de bestaande service en locks. @returns {void} */
function manageProcessSchedules() {
  managementAction_('Schema’s verwerken', 'Aangeboden schema’s worden nu verwerkt. Dit kan intakes en planhistorie wijzigen. Doorgaan?',
    function () { return ScheduleService.processReady(); });
}
/** Verstuurt na bevestiging verschuldigde echte meldingen; behoudt alle verzendblokkeringen. @returns {void} */
function manageProcessNotifications() {
  managementAction_('Notificaties verwerken', 'Dit kan echte Pushover-berichten versturen voor alle verschuldigde intakes. Doorgaan?',
    function () { return NotificationService.processPending(); });
}
/** Voert na bevestiging bestaande Spreadsheet-setup uit. @returns {void} */
function manageSetupSpreadsheet() {
  managementAction_('Spreadsheet bijwerken', 'Dit maakt ontbrekende applicatietabs en werkt headers, opmaak, validatie en bescherming bij. Doorgaan?',
    function () { return SpreadsheetSetup.run(); });
}
/** Installeert na bevestiging ontbrekende triggers en verwijdert duplicaten voor dit account. @returns {void} */
function manageInstallTriggers() {
  managementAction_('Triggers installeren', 'Dit installeert ontbrekende kloktriggers en verwijdert duplicaten voor uw huidige account. Bestaande intervallen blijven behouden. Doorgaan?',
    function () { return SpreadsheetSetup.installTriggers(); });
}
