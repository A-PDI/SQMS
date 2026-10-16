'use strict';
const ExcelJS = require('exceljs');
const { Readable } = require('node:stream');
const ALIASES = { part: ['part number', 'part_number', 'part #', 'part#', 'part no', 'part no.'], description: ['description', 'desc', 'part description'], type: ['product type', 'product_type', 'part type', 'type', 'component', 'form'] };
async function readPartWorkbook(bytes, extension) {
  const book = new ExcelJS.Workbook();
  if (extension === 'csv') await book.csv.read(Readable.from(bytes)); else await book.xlsx.load(bytes);
  const sheet = book.worksheets[0]; if (!sheet) throw new Error('Workbook has no worksheet');
  let header = 0; let columns = {}; const rows = [];
  sheet.eachRow((row, index) => {
    if (!header) {
      const values = (row.values || []).map(v => String(v ?? '').trim().toLowerCase());
      for (const [key, names] of Object.entries(ALIASES)) columns[key] = values.findIndex(v => names.includes(v));
      if (columns.part > 0) header = index;
      return;
    }
    const part = row.getCell(columns.part); if (part.value == null || part.value === '') return;
    const text = col => col > 0 ? row.getCell(col).text : '';
    rows.push({ row: index, partNumber: part.text, description: text(columns.description), productType: text(columns.type), identifierIsText: typeof part.value === 'string' });
  });
  if (!header) throw new Error('Part Number header column is required');
  return rows;
}
async function writePartWorkbook(rows) {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Part Specifications');
  sheet.columns = [{header:'Part Number',key:'partNumber',width:25},{header:'Description',key:'description',width:50},{header:'Product Type',key:'productType',width:30}];
  for(const row of rows) { const r=sheet.addRow(row);r.getCell(1).numFmt='@'; }
  return Buffer.from(await book.xlsx.writeBuffer());
}
module.exports = { readPartWorkbook, writePartWorkbook };
