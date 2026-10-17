'use strict';
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

async function inspectionSummaryWorkbook(report) {
  const book = new ExcelJS.Workbook(); book.creator = 'PDI QMS';
  for (const [name, rows] of [['Summary', report.groups], ['Inspections', report.details], ['Filters', [{ filters: JSON.stringify(report.filters), dateBasis: 'Inspection creation date, UTC', generatedAt: report.generatedAt }]]]) {
    const sheet = book.addWorksheet(name);
    const keys = Object.keys(rows[0] || { result: 'No matching records' });
    sheet.columns = keys.map(key => ({ header: key, key, width: 24 }));
    sheet.addRows(rows); sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
function inspectionSummaryPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 45 }); const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(19).text('PDI Inspection Report'); doc.fontSize(9).text(`Generated ${report.generatedAt}`);
    doc.text(`Filters: ${JSON.stringify(report.filters)}`); doc.moveDown();
    doc.fontSize(10).text('Group | Inspections | Complete | Pass | Fail | Accepted');
    for (const row of report.groups) {
      if (doc.y > 720) doc.addPage();
      doc.text(`${row.label} | ${row.count} | ${row.complete} | ${row.pass} | ${row.fail} | ${row.accepted}`);
    }
    doc.moveDown().text(`Total: ${report.totals.count} inspections; ${report.totals.complete} complete`); doc.end();
  });
}
module.exports = { inspectionSummaryWorkbook, inspectionSummaryPdf };
