'use strict';
module.exports = Object.assign({}, ...['pdf','ncrPdf','injectorSteps','injectorResult','injectorUnits','injectorFilters','injectorEvaluation','reportPagination','timeZone','carbonzapp','injectorReports','injectorExport','repairDelta','inspectionSections','injectorInspection','injectorPartNumbers','dailyExport','injectorAnalytics'].map(n=>require('./services/'+n)));

module.exports.STANDARD_PLANS = require("./standard-plans.json").plans;
Object.assign(module.exports, require('./services/partWorkbook'));

Object.assign(module.exports, require('./services/operationalReports'));

Object.assign(module.exports, require('./services/itemCompletion'));
