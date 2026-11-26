/* Maead core: parsing and message building. Pure functions, no DOM. Works in browser and Node. */
(function (root) {
  'use strict';

  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  function normDigits(s) {
    return String(s == null ? '' : s).replace(/[٠-٩۰-۹]/g, function (c) {
      var i = AR_DIGITS.indexOf(c);
      if (i < 0) i = FA_DIGITS.indexOf(c);
      return String(i);
    });
  }

  /* Egyptian mobile numbers: 010, 011, 012, 015 + 8 digits. */
  function normalizePhone(raw) {
    var d = normDigits(raw).replace(/[^\d+]/g, '');
    if (!d) return { ok: false, reason: 'empty' };
    d = d.replace(/^\+/, '');
    if (d.indexOf('0020') === 0) d = d.slice(4);
    else if (d.indexOf('20') === 0 && d.length === 12) d = d.slice(2);
    if (d.length === 10 && d.charAt(0) === '1') d = '0' + d; // 10xxxxxxxx typed without leading zero
    if (/^01[0125]\d{8}$/.test(d)) {
      return { ok: true, e164: '20' + d.slice(1), display: d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) };
    }
    return { ok: false, reason: 'format' };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function validISO(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /* Egyptian convention: day first. Accepts 2026-11-27, 27/11/2026, 27-11-26, 27.11.2026. */
  function parseDate(raw) {
    var s = normDigits(raw).trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    var y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})/);
      if (!m) return null;
      d = +m[1]; mo = +m[2]; y = +m[3];
      if (y < 100) y += 2000;
    }
    if (!validISO(y, mo, d)) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  /* Accepts 17:30, 5:30 PM, 5 pm, 5:30 م, 5:30 مساء, 9 ص, 9:15 صباحا. Returns HH:MM or null. */
  function parseTime(raw) {
    var s = normDigits(raw).trim().toLowerCase();
    if (!s) return null;
    var m = s.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|ص|م|صباحا|صباحاً|مساء|مساءً|ظهرا|ظهراً)?/);
    if (!m) return null;
    var h = +m[1], min = m[2] ? +m[2] : 0, suf = m[3] || '';
    if (h > 24 || min > 59) return null;
    var pm = /^(pm|م|مساء|مساءً|ظهرا|ظهراً)$/.test(suf);
    var am = /^(am|ص|صباحا|صباحاً)$/.test(suf);
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (!pm && !am && h <= 7 && !m[3]) { /* bare "5" or "5:30" in clinic hours: assume afternoon */ h += 12; }
    if (h === 24) h = 0;
    return pad(h) + ':' + pad(min);
  }

  /* Minimal CSV/TSV parser with quotes. */
  function splitRows(text) {
    var t = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var firstLine = t.split('\n')[0] || '';
    var delim = '\t';
    if (firstLine.indexOf('\t') < 0) delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (q) {
        if (c === '"') { if (t.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    row.push(cur); rows.push(row);
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  var SYN = {
    name: ['name', 'patient', 'الاسم', 'اسم', 'المريض', 'اسم المريض', 'العميل', 'اسم العميل', 'العضو'],
    phone: ['phone', 'mobile', 'tel', 'whatsapp', 'الموبايل', 'موبايل', 'التليفون', 'تليفون', 'الهاتف', 'هاتف', 'رقم', 'رقم الموبايل', 'رقم التليفون', 'واتساب', 'رقم الهاتف'],
    date: ['date', 'day', 'التاريخ', 'تاريخ', 'اليوم', 'تاريخ الكشف', 'تاريخ الميعاد'],
    time: ['time', 'hour', 'الساعة', 'ساعة', 'الوقت', 'وقت', 'الميعاد', 'ميعاد'],
    doctor: ['doctor', 'dr', 'الدكتور', 'دكتور', 'الطبيب', 'طبيب', 'دكتورة', 'الدكتورة', 'المعالج', 'الكابتن'],
    service: ['service', 'type', 'الخدمة', 'خدمة', 'نوع الكشف', 'نوع', 'الإجراء', 'السبب']
  };

  function mapHeader(h) {
    var k = normDigits(h).trim().toLowerCase();
    for (var f in SYN) if (SYN[f].indexOf(k) >= 0) return f;
    return null;
  }

  function hashId(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'r' + (h >>> 0).toString(36);
  }

  /* Returns { rows, columns, missing, error }. rows: {id,name,phone,date,time,doctor,service,line,issues[]} */
  function parseTable(text) {
    var grid = splitRows(text || '');
    if (grid.length < 2) return { rows: [], columns: {}, missing: ['name', 'phone', 'date'], error: 'need_header_and_rows' };
    var head = grid[0].map(mapHeader);
    var colIdx = {};
    head.forEach(function (f, i) { if (f && colIdx[f] == null) colIdx[f] = i; });
    var missing = ['name', 'phone', 'date'].filter(function (f) { return colIdx[f] == null; });
    if (missing.length) return { rows: [], columns: colIdx, missing: missing, error: 'missing_columns' };
    var seen = {};
    var rows = grid.slice(1).map(function (r, n) {
      function g(f) { return colIdx[f] == null ? '' : String(r[colIdx[f]] == null ? '' : r[colIdx[f]]).trim(); }
      var issues = [];
      var ph = normalizePhone(g('phone'));
      if (!ph.ok) issues.push(ph.reason === 'empty' ? 'no_phone' : 'bad_phone');
      var date = parseDate(g('date'));
      if (!date) issues.push('bad_date');
      var time = g('time') ? parseTime(g('time')) : null;
      if (g('time') && !time) issues.push('bad_time');
      var row = {
        name: g('name'), phone: g('phone'), e164: ph.ok ? ph.e164 : '', phoneDisplay: ph.ok ? ph.display : g('phone'),
        date: date, time: time, doctor: g('doctor'), service: g('service'), line: n + 2, issues: issues
      };
      if (!row.name) issues.push('no_name');
      row.id = hashId([row.name, row.e164 || row.phone, row.date, row.time].join('|'));
      if (seen[row.id]) issues.push('duplicate'); else seen[row.id] = true;
      return row;
    });
    return { rows: rows, columns: colIdx, missing: [], error: null };
  }

  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function dateLabel(iso) {
    var p = iso.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DAYS[dt.getUTCDay()] + ' ' + p[2] + ' ' + MONTHS[p[1] - 1];
  }

  function timeLabel(hhmm) {
    if (!hhmm) return '';
    var p = hhmm.split(':').map(Number);
    var h = p[0], suf = h >= 12 ? 'م' : 'ص';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (p[1] ? ':' + pad(p[1]) : '') + ' ' + suf;
  }

  var DEFAULT_TEMPLATE =
    'أهلاً {name}،\nبنفكرك بميعادك في {clinic} يوم {day}{time_part}{doctor_part}.\nلو هتحضر رد علينا بكلمة "تأكيد"، ولو محتاج تغيّر الميعاد قولنا ونرتبلك ميعاد تاني.\nشكراً.';

  function buildMessage(tpl, row, clinic) {
    var out = String(tpl || DEFAULT_TEMPLATE);
    var first = (row.name || '').trim().split(/\s+/)[0] || '';
    var map = {
      name: first, full_name: row.name || '', clinic: clinic || 'العيادة',
      day: row.date ? dateLabel(row.date) : '',
      time: row.time ? timeLabel(row.time) : '',
      time_part: row.time ? ' الساعة ' + timeLabel(row.time) : '',
      doctor: row.doctor || '',
      doctor_part: row.doctor ? ' مع ' + row.doctor : ''
    };
    return out.replace(/\{(\w+)\}/g, function (m, k) { return k in map ? map[k] : m; });
  }

  function waLink(e164, message) {
    return 'https://wa.me/' + e164 + '?text=' + encodeURIComponent(message);
  }

  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  /* state.marks: { id: { sent: bool, outcome: ''|'confirmed'|'came'|'noshow' } } */
  function stats(rows, marks) {
    function agg(list) {
      var came = 0, noshow = 0;
      list.forEach(function (r) {
        var o = (marks[r.id] || {}).outcome;
        if (o === 'came') came++; else if (o === 'noshow') noshow++;
      });
      var n = came + noshow;
      return { came: came, noshow: noshow, n: n, rate: n ? noshow / n : null };
    }
    var valid = rows.filter(function (r) { return !r.issues.some(function (i) { return i === 'bad_date' || i === 'duplicate'; }); });
    var sent = valid.filter(function (r) { return (marks[r.id] || {}).sent; });
    var notSent = valid.filter(function (r) { return !(marks[r.id] || {}).sent; });
    return { all: agg(valid), sent: agg(sent), notSent: agg(notSent) };
  }


  /* ---- stored state: versioned so old saves never break the page ---- */
  var SCHEMA = 2;
  var OUTCOMES = ['', 'confirmed', 'came', 'noshow'];
  function migrateState(raw, defaults) {
    var out = {}, k;
    for (k in defaults) out[k] = defaults[k];
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.text === 'string') out.text = raw.text.slice(0, 500000);
    if (typeof raw.clinic === 'string') out.clinic = raw.clinic.slice(0, 80);
    if (raw.fee != null && isFinite(+raw.fee) && +raw.fee >= 0) out.fee = +raw.fee;
    if (typeof raw.tpl === 'string' && raw.tpl.trim()) out.tpl = raw.tpl.slice(0, 2000);
    if (typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day)) out.day = raw.day;
    out.sample = !!raw.sample;
    var marks = {};
    if (raw.marks && typeof raw.marks === 'object') {
      Object.keys(raw.marks).forEach(function (id) {
        var m = raw.marks[id] || {};
        marks[id] = { sent: !!m.sent, outcome: OUTCOMES.indexOf(m.outcome) >= 0 ? m.outcome : '' };
      });
    }
    out.marks = marks;
    out.v = SCHEMA;
    return out;
  }

  /* how far through the day's reminders the secretary is */
  function dayProgress(rows, marks) {
    var sendable = rows.filter(function (r) { return !r.issues.some(function (i) { return i === 'bad_phone' || i === 'no_phone' || i === 'duplicate'; }); });
    var sent = sendable.filter(function (r) { return (marks[r.id] || {}).sent; }).length;
    return { total: rows.length, sendable: sendable.length, sent: sent, left: sendable.length - sent, blocked: rows.length - sendable.length };
  }

  /* warn about a template that would send something unhelpful */
  function checkTemplate(tpl) {
    var w = [];
    if (!/\{name\}/.test(tpl)) w.push('no_name');
    if (!/\{day\}/.test(tpl)) w.push('no_day');
    if (!/\{clinic\}/.test(tpl)) w.push('no_clinic');
    if (tpl.length > 700) w.push('too_long');
    return w;
  }

  /* ---- backup file: a JSON copy of the saved state, kept by the user ---- */
  function makeBackup(state, nowISO) {
    return JSON.stringify({ app: 'maead', schema: SCHEMA, exportedAt: nowISO, state: state }, null, 1);
  }
  function parseBackup(text, defaults) {
    var o;
    try { o = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, error: 'not_json' }; }
    if (!o || o.app !== 'maead' || !o.state || typeof o.state !== 'object') return { ok: false, error: 'not_maead' };
    if (typeof o.schema === 'number' && o.schema > SCHEMA) return { ok: false, error: 'too_new' };
    return { ok: true, state: migrateState(o.state, defaults), exportedAt: o.exportedAt || '' };
  }

  var api = {
    makeBackup: makeBackup, parseBackup: parseBackup,
    mapHeader: mapHeader,
    migrateState: migrateState, dayProgress: dayProgress, checkTemplate: checkTemplate, SCHEMA: SCHEMA,
    normDigits: normDigits, normalizePhone: normalizePhone, parseDate: parseDate, parseTime: parseTime,
    splitRows: splitRows, parseTable: parseTable, dateLabel: dateLabel, timeLabel: timeLabel,
    buildMessage: buildMessage, waLink: waLink, addDays: addDays, stats: stats, DEFAULT_TEMPLATE: DEFAULT_TEMPLATE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Maead = api;
})(typeof self !== 'undefined' ? self : this);
