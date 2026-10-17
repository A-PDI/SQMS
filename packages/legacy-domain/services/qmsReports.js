'use strict';
// Original report layout bodies from QMS-Development 9e53417; only stream targets changed.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
async function qmsReportWorkbook({ rows, details }) {
    // Create workbook
    const workbook = new ExcelJS.Workbook();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Label', key: 'label', width: 20 },
      { header: 'Count', key: 'count', width: 12 },
      { header: 'Pass', key: 'pass', width: 12 },
      { header: 'Fail', key: 'fail', width: 12 },
      { header: 'Accepted', key: 'accepted', width: 12 },
    ];
    summarySheet.addRows(rows);

    // Detail sheet
    const detailSheet = workbook.addWorksheet('Detail');
    detailSheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'Form No', key: 'form_no', width: 12 },
      { header: 'Component Type', key: 'component_type', width: 20 },
      { header: 'Part Number', key: 'part_number', width: 15 },
      { header: 'Supplier', key: 'supplier', width: 20 },
      { header: 'PO Number', key: 'po_number', width: 15 },
      { header: 'Inspector', key: 'inspector_name', width: 20 },
      { header: 'Disposition', key: 'disposition', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Assigned To', key: 'assigned_to_name', width: 20 },
      { header: 'Due Date', key: 'due_date', width: 15 },
      { header: 'Started At', key: 'started_at', width: 20 },
      { header: 'Completed At', key: 'completed_at', width: 20 },
      { header: 'Created At', key: 'created_at', width: 20 },
    ];
    detailSheet.addRows(details);


return Buffer.from(await workbook.xlsx.writeBuffer());
}
function qmsReportPdf({ rows, totals }, { date_from, date_to, group_by }) {
return new Promise((resolve,reject) => {
const doc = new PDFDocument(); const chunks=[]; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error',reject);
    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('PDI Inspection Report', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(` `, { align: 'center' });

    // Date range
    const dateRange = [];
    if (date_from) dateRange.push(date_from);
    if (date_to) dateRange.push(date_to);
    if (dateRange.length > 0) {
      doc.fontSize(10).text(`Date Range: ${dateRange.join(' to ')}`, { align: 'center' });
    }
    doc.text(' ', { align: 'center' });

    // Summary table
    doc.fontSize(12).font('Helvetica-Bold').text('Summary by ' + (group_by || 'All'), { underline: true });
    doc.fontSize(10).font('Helvetica');

    const tableData = [];
    tableData.push(['Label', 'Count', 'Pass', 'Fail', 'Accepted']);
    for (const row of rows) {
      tableData.push([
        String(row.label),
        String(row.count || 0),
        String(row.pass || 0),
        String(row.fail || 0),
        String(row.accepted || 0),
      ]);
    }

    doc.fontSize(9);
    const colWidth = 100;
    let startY = doc.y;
    for (let i = 0; i < tableData.length; i++) {
      const row = tableData[i];
      for (let j = 0; j < row.length; j++) {
        doc.text(row[j], 50 + j * colWidth, startY, { width: colWidth - 5 });
      }
      startY += 20;
    }

    // Totals section
    doc.fontSize(12).font('Helvetica-Bold').text('Totals', { underline: true });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Total Inspections: ${totals.total}`);
    doc.text(`Complete: ${totals.complete}, Draft: ${totals.draft}`);
    doc.text(`Pass: ${totals.pass}, Fail: ${totals.fail}, Accepted: ${totals.accepted}`);


doc.end();
});
}
async function qmsTemplateWorkbook(templates) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PDI QMS';
    const ws = wb.addWorksheet('Inspection Forms');

    ws.columns = [
      { header: 'Form No',                  key: 'form_no',          width: 14 },
      { header: 'Title',                     key: 'title',            width: 42 },
      { header: 'Component Type',            key: 'component_type',   width: 18 },
      { header: 'Revision',                  key: 'revision',         width: 10 },
      { header: 'Section',                   key: 'section',          width: 36 },
      { header: 'Section Type',              key: 'section_type',     width: 22 },
      { header: 'Item #',                    key: 'item_id',          width: 8  },
      { header: 'Inspection Item',           key: 'item_name',        width: 30 },
      { header: 'Requirement / Description', key: 'item_requirement', width: 52 },
    ];

    const hdr = ws.getRow(1);
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
    hdr.alignment = { vertical: 'middle' };

    for (const t of templates) {
      const sections = t.sections || {};
      for (const [sectionKey, section] of Object.entries(sections)) {
        if (sectionKey.startsWith('__')) continue;
        const items = section.items || [];
        if (items.length === 0) {
          ws.addRow({
            form_no: t.form_no, title: t.title, component_type: t.component_type,
            revision: t.revision || '', section: section.title || sectionKey,
            section_type: section.section_type || '',
            item_id: '', item_name: '', item_requirement: '',
          });
        } else {
          for (const item of items) {
            ws.addRow({
              form_no: t.form_no, title: t.title, component_type: t.component_type,
              revision: t.revision || '', section: section.title || sectionKey,
              section_type: section.section_type || '',
              item_id: item.id ?? '',
              item_name: item.name || item.measurement || item.ctq_area || '',
              item_requirement: item.requirement || item.criteria || item.spec || '',
            });
          }
        }
      }
    }


return Buffer.from(await wb.xlsx.writeBuffer());
}
module.exports = { qmsReportWorkbook, qmsReportPdf, qmsTemplateWorkbook };
