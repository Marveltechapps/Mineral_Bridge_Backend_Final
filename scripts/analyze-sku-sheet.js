/**
 * Analyze Mineral Bridge Master Sheet (2).xlsx – SKU sheet: columns, row count, duplicates.
 * Run from repo root: node backend/scripts/analyze-sku-sheet.js [path-to-file.xlsx]
 * Example: node backend/scripts/analyze-sku-sheet.js "Mineral Bridge Master Sheet (2).xlsx"
 */
const path = require('path');
const fs = require('fs');

const defaultPaths = [
  path.join(process.cwd(), 'Mineral Bridge Master Sheet (2).xlsx'),
  path.join(process.cwd(), 'Mineral Bridge Master Sheet.xlsx'),
  path.join(__dirname, '../../Mineral Bridge Master Sheet (2).xlsx'),
  path.join(__dirname, '../../Mineral Bridge Master Sheet.xlsx'),
];

const filePath = process.argv[2] || defaultPaths.find((p) => fs.existsSync(p));
if (!filePath || !fs.existsSync(filePath)) {
  console.error('Usage: node analyze-sku-sheet.js [path-to-file.xlsx]');
  console.error('File not found. Tried:', defaultPaths.join(', '));
  if (process.argv[2]) console.error('You passed:', process.argv[2]);
  process.exit(1);
}

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.error('Install xlsx in backend: cd backend && npm install xlsx');
  process.exit(1);
}

const workbook = XLSX.readFile(filePath);

console.log('=== Mineral Bridge Master Sheet – SKU analysis ===\n');
console.log('File:', filePath);
console.log('All sheet names:', workbook.SheetNames.join(', '));

const skuSheetName =
  workbook.SheetNames.find((n) => n.toLowerCase() === 'sku' || n.toLowerCase().includes('sku')) ||
  workbook.SheetNames[0];
const sheet = workbook.Sheets[skuSheetName];
if (!sheet) {
  console.error('SKU sheet not found:', skuSheetName);
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
console.log('\n--- SKU sheet:', skuSheetName, '---');
console.log('Total rows (first row = headers):', rows.length);

if (rows.length === 0) {
  console.log('No data.');
  process.exit(0);
}

const sheetHeaders = Object.keys(rows[0]);
console.log('Columns in sheet (' + sheetHeaders.length + '):', sheetHeaders.join(' | '));

// ID column: try common names (case-insensitive)
const idCandidates = ['Mineral ID', 'SKU Code', 'SKU code', 'Code', 'SKU', 'Product Code', 'ID'];
let idHeader = null;
for (const c of idCandidates) {
  const found = sheetHeaders.find((h) => h.trim().toLowerCase() === c.trim().toLowerCase());
  if (found) {
    idHeader = found;
    break;
  }
}
if (!idHeader) idHeader = sheetHeaders[0];

// Filter data rows (skip header-like rows)
function isDataRow(row) {
  const code = String(row[idHeader] ?? '').trim();
  if (!code) return false;
  if (code === 'SKU Code' || code === 'Mandatory' || code === 'Not Null') return false;
  if (/^varchar\s*\(|^decimal\s*\(/i.test(code)) return false;
  return true;
}

const dataRows = rows.filter(isDataRow);
console.log('Data rows (after filtering header/metadata):', dataRows.length);

// Duplicates by ID
const seen = new Map();
const duplicateIds = [];
dataRows.forEach((r) => {
  const id = String(r[idHeader] ?? '').trim();
  if (seen.has(id)) {
    if (seen.get(id) === 1) duplicateIds.push(id);
    seen.set(id, seen.get(id) + 1);
  } else {
    seen.set(id, 1);
  }
});

const uniqueIds = [...new Set(dataRows.map((r) => String(r[idHeader] ?? '').trim()))];
const duplicateIdsUnique = [...new Set(duplicateIds)];

console.log('\n--- Duplicates ---');
console.log('Unique mineral IDs:', uniqueIds.length);
console.log('Duplicate IDs (appear more than once):', duplicateIdsUnique.length);
if (duplicateIdsUnique.length > 0) {
  console.log('List:', duplicateIdsUnique.join(', '));
}

console.log('\n--- Dashboard import outcome ---');
console.log('If you import all', dataRows.length, 'rows:');
console.log('  - Minerals created:', dataRows.length, '(duplicate IDs get suffix _2, _3, etc.)');
console.log('  - So you will get', dataRows.length, 'minerals in the dashboard.');
if (dataRows.length === 136) {
  console.log('  -> You have 136 data rows → 136 minerals in dashboard.');
} else {
  console.log('  -> To get 136 minerals: ensure the SKU sheet has 136 data rows (excluding header).');
}

console.log('\n--- Sample rows (first 3) ---');
dataRows.slice(0, 3).forEach((row, i) => {
  const out = {};
  sheetHeaders.forEach((h) => {
    const v = row[h];
    if (v !== undefined && v !== '') out[h] = String(v).length > 50 ? String(v).slice(0, 50) + '…' : v;
  });
  console.log(JSON.stringify(out, null, 2));
});

console.log('\nDone.');
