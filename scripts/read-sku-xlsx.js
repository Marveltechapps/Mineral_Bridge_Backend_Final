/**
 * One-off: Read Mineral Bridge Master Sheet.xlsx, list sheets, and output SKU sheet structure + sample rows.
 * Run from repo root: node backend/scripts/read-sku-xlsx.js
 */
const path = require('path');
const fs = require('fs');

const xlsxPath = path.join(__dirname, '../../Mineral Bridge Master Sheet.xlsx');
if (!fs.existsSync(xlsxPath)) {
  console.error('File not found:', xlsxPath);
  process.exit(1);
}

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.error('Install xlsx: npm install xlsx');
  process.exit(1);
}

const workbook = XLSX.readFile(xlsxPath);
console.log('Sheet names:', workbook.SheetNames);

// Find sheet that might be "sku" (case-insensitive or contains sku)
const skuSheetName = workbook.SheetNames.find(
  (n) => n.toLowerCase() === 'sku' || n.toLowerCase().includes('sku')
) || workbook.SheetNames[0];

const sheet = workbook.Sheets[skuSheetName];
if (!sheet) {
  console.error('Sheet not found:', skuSheetName);
  process.exit(1);
}

const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, header: 1 });
// Find header row (row that has 'SKU Code' or 'SKU Code' in first cells)
let headerRowIndex = 0;
for (let i = 0; i < Math.min(10, rawData.length); i++) {
  const row = rawData[i];
  const first = (row && row[0]) ? String(row[0]).trim() : '';
  if (first === 'SKU Code' || first.includes('SKU')) {
    headerRowIndex = i;
    break;
  }
}
const headers = rawData[headerRowIndex] || [];
const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, range: headerRowIndex });
console.log('\nSheet:', skuSheetName, '| Data rows:', data.length);
if (data.length > 0) {
  console.log('Columns:', Object.keys(data[0]));
  // Show rows that look like real data (SKU Code not like "Mandatory" or "varchar")
  const dataRows = data.filter((r) => {
    const code = (r['SKU Code'] || '').toString().trim();
    return code && !/^(Mandatory|Not Null|varchar|Decimal|decimal)/i.test(code);
  });
  console.log('Rows with actual SKU codes:', dataRows.length);
  console.log('\nSample data rows (first 5):');
  dataRows.slice(0, 5).forEach((row, i) => {
    console.log(JSON.stringify({
      'SKU Code': row['SKU Code'],
      'SKU Name': row['SKU Name'],
      'SKU Classification': row['SKU Classification'],
      'SKU Classification_1': row['SKU Classification_1'],
      'Country Of Origin': row['Country Of Origin'],
      'Description': (row['Description'] || '').toString().slice(0, 80),
      'SKUimgURL': (row['SKUimgURL'] || '').toString().slice(0, 60),
      'Hierarchy Code': row['Hierarchy Code'],
    }, null, 2));
  });
}
