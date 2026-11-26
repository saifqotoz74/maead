const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const X = require('./xlsx.js');
const M = require('./lib.js');

test('reads a real .xlsx: dates, times, phones stored as numbers, shared strings', async () => {
  const file = process.env.MAEAD_XLSX || '/tmp/sample.xlsx';
  if (!fs.existsSync(file)) return; /* sample is made by the build script, skip if absent */
  const t = X.toTSV(await X.readXlsx(fs.readFileSync(file)), M.mapHeader);
  const p = M.parseTable(t);
  assert.strictEqual(p.rows.length, 3);
  assert.strictEqual(p.rows[0].e164, '201000000001');
  assert.strictEqual(p.rows[0].date, '2026-11-27');
  assert.strictEqual(p.rows[0].time, '17:00');
  assert.strictEqual(p.rows[2].doctor, '');
});
test('rejects a file that is not a zip', async () => {
  await assert.rejects(() => X.readXlsx(new TextEncoder().encode('hello, this is csv text, not a zip file at all')), /not_zip/);
});
