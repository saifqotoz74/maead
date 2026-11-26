const test = require('node:test');
const assert = require('node:assert');
const M = require('./lib.js');

test('phones', () => {
  assert.deepStrictEqual(M.normalizePhone('01000000001').e164, '201000000001');
  assert.strictEqual(M.normalizePhone('+20 100 000 0002').e164, '201000000002');
  assert.strictEqual(M.normalizePhone('٠١٠٠٠٠٠٠٠٠٣').e164, '201000000003');
  assert.strictEqual(M.normalizePhone('00201000000004').e164, '201000000004');
  assert.strictEqual(M.normalizePhone('1000000005').e164, '201000000005');
  assert.strictEqual(M.normalizePhone('01300000006').ok, false);
  assert.strictEqual(M.normalizePhone('0100000').ok, false);
  assert.strictEqual(M.normalizePhone('').reason, 'empty');
  assert.strictEqual(M.normalizePhone('0224000000').ok, false); // landline: no WhatsApp link
});
test('dates', () => {
  assert.strictEqual(M.parseDate('2026-11-27'), '2026-11-27');
  assert.strictEqual(M.parseDate('27/11/2026'), '2026-11-27');
  assert.strictEqual(M.parseDate('٢٧-١١-٢٦'), '2026-11-27');
  assert.strictEqual(M.parseDate('5.1.2027'), '2027-01-05'); // day first
  assert.strictEqual(M.parseDate('31/02/2026'), null);
  assert.strictEqual(M.parseDate('hello'), null);
});
test('times', () => {
  assert.strictEqual(M.parseTime('17:30'), '17:30');
  assert.strictEqual(M.parseTime('5:30 PM'), '17:30');
  assert.strictEqual(M.parseTime('5 م'), '17:00');
  assert.strictEqual(M.parseTime('9 ص'), '09:00');
  assert.strictEqual(M.parseTime('12 ص'), '00:00');
  assert.strictEqual(M.parseTime('12:30 م'), '12:30');
  assert.strictEqual(M.parseTime('٦:١٥ مساء'), '18:15');
  assert.strictEqual(M.parseTime('10'), '10:00');
  assert.strictEqual(M.parseTime('abc'), null);
});
test('table: arabic headers, quotes, duplicates, issues', () => {
  const csv = 'الاسم,الموبايل,التاريخ,الساعة,الدكتور\n"منى, أحمد",01000000001,27/11/2026,5 م,د. سارة\nمنى احمد,01000000001,27/11/2026,5 م,د. سارة\nكريم,0100,27/11/2026,,\nيوسف,01000000002,بكرة,6 م,';
  const r = M.parseTable(csv);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.length, 4);
  assert.strictEqual(r.rows[0].name, 'منى, أحمد');
  assert.ok(!r.rows[1].issues.includes('duplicate')); const d = M.parseTable('name,phone,date\nA,01000000001,27/11/2026\nA,+201000000001,2026-11-27'); assert.ok(d.rows[1].issues.includes('duplicate'));
  assert.ok(r.rows[2].issues.includes('bad_phone'));
  assert.ok(r.rows[3].issues.includes('bad_date'));
});
test('table: tab separated from Excel paste and missing columns', () => {
  const tsv = 'Name\tPhone\tDate\tTime\nAhmed\t01000000009\t2026-11-27\t17:00';
  assert.strictEqual(M.parseTable(tsv).rows[0].e164, '201000000009');
  const bad = M.parseTable('foo,bar\n1,2');
  assert.strictEqual(bad.error, 'missing_columns');
  assert.deepStrictEqual(bad.missing, ['name', 'phone', 'date']);
  assert.strictEqual(M.parseTable('').error, 'need_header_and_rows');
});
test('message and link', () => {
  const row = { name: 'منى أحمد', date: '2026-11-27', time: '17:00', doctor: 'د. سارة' };
  const msg = M.buildMessage(null, row, 'عيادة النور');
  assert.ok(msg.includes('أهلاً منى،'));
  assert.ok(msg.includes('عيادة النور'));
  assert.ok(msg.includes('الجمعة 27 نوفمبر'));
  assert.ok(msg.includes('الساعة 5 م'));
  assert.ok(msg.includes('مع د. سارة'));
  const link = M.waLink('201000000001', msg);
  assert.ok(link.startsWith('https://wa.me/201000000001?text='));
  assert.strictEqual(decodeURIComponent(link.split('text=')[1]), msg);
  assert.strictEqual(M.buildMessage('x {unknown}', row, 'c'), 'x {unknown}');
});
test('date label weekday is correct (27 Nov 2026 is Friday)', () => {
  assert.strictEqual(new Date('2026-11-27T00:00:00Z').getUTCDay(), 5);
  assert.strictEqual(M.dateLabel('2026-11-26'), 'الخميس 26 نوفمبر');
  assert.strictEqual(M.addDays('2026-11-30', 1), '2026-12-01');
});
test('stats split reminded vs not reminded and ignore dup/bad dates', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id, issues: [] }));
  rows.push({ id: 'e', issues: ['duplicate'] });
  const marks = { a: { sent: true, outcome: 'came' }, b: { sent: true, outcome: 'came' }, c: { outcome: 'noshow' }, d: { outcome: 'came' }, e: { outcome: 'noshow' } };
  const s = M.stats(rows, marks);
  assert.deepStrictEqual([s.sent.came, s.sent.noshow, s.sent.rate], [2, 0, 0]);
  assert.deepStrictEqual([s.notSent.came, s.notSent.noshow, s.notSent.rate], [1, 1, 0.5]);
  assert.strictEqual(s.all.n, 4);
});

test('migrateState keeps good data, drops bad data, adds version', () => {
  const d = { text: '', clinic: 'x', fee: 300, tpl: 'T', marks: {}, day: '', sample: false };
  assert.deepStrictEqual(M.migrateState(null, d).marks, {});
  const m = M.migrateState({ clinic: 'عيادة', fee: '450', day: '2026-11-27', marks: { a: { sent: 1, outcome: 'came' }, b: { outcome: 'hack' } }, junk: 1 }, d);
  assert.strictEqual(m.clinic, 'عيادة');
  assert.strictEqual(m.fee, 450);
  assert.strictEqual(m.day, '2026-11-27');
  assert.deepStrictEqual(m.marks.a, { sent: true, outcome: 'came' });
  assert.strictEqual(m.marks.b.outcome, '');
  assert.strictEqual(m.junk, undefined);
  assert.strictEqual(m.v, M.SCHEMA);
  assert.strictEqual(M.migrateState({ fee: -5, day: 'bad' }, d).fee, 300);
  assert.strictEqual(M.migrateState({ day: 'bad' }, d).day, '');
});
test('dayProgress counts what is left to send', () => {
  const rows = [{ id: 'a', issues: [] }, { id: 'b', issues: [] }, { id: 'c', issues: ['bad_phone'] }];
  const p = M.dayProgress(rows, { a: { sent: true } });
  assert.deepStrictEqual([p.total, p.sendable, p.sent, p.left, p.blocked], [3, 2, 1, 1, 1]);
});
test('checkTemplate flags templates missing the essentials', () => {
  assert.deepStrictEqual(M.checkTemplate(M.DEFAULT_TEMPLATE), []);
  assert.ok(M.checkTemplate('تعالى بكرة').includes('no_name'));
  assert.ok(M.checkTemplate('x'.repeat(800)).includes('too_long'));
});
