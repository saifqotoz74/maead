(function () {
  'use strict';
  var M = window.Maead;
  var KEY = 'maead.v1';
  var $ = function (id) { return document.getElementById(id); };

  var state = { text: '', clinic: 'عيادة النور', fee: 300, tpl: M.DEFAULT_TEMPLATE, marks: {}, day: '', sample: false };
  var parsed = { rows: [], columns: {}, missing: [], error: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } }
  function load() { try { state = M.migrateState(JSON.parse(localStorage.getItem(KEY) || 'null'), state); } catch (e) { /* corrupt save: start clean */ } }

  var ISSUE_AR = { no_phone: 'مفيش رقم', bad_phone: 'الرقم مش موبايل مصري صح', bad_date: 'التاريخ مش مفهوم', bad_time: 'الساعة مش مفهومة', no_name: 'مفيش اسم', duplicate: 'مكرر' };

  function sampleCSV() {
    var t = todayISO(), d0 = M.addDays(t, -2), d1 = M.addDays(t, -1), d2 = M.addDays(t, 1);
    var fmt = function (iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
    var names = ['منى حسن', 'كريم عادل', 'هدى سعيد', 'يوسف مصطفى', 'نور إبراهيم', 'أحمد فتحي', 'سلمى رضا', 'عمر طارق', 'ليلى جمال', 'محمود نبيل'];
    var times = ['9 ص', '10 ص', '11:30 ص', '1 م', '5 م', '5:30 م', '6 م', '7 م'];
    var docs = ['د. سارة', 'د. سارة', 'د. هشام', 'د. هشام'];
    var rows = ['الاسم,الموبايل,التاريخ,الساعة,الدكتور'];
    function add(day, n, off) {
      for (var i = 0; i < n; i++) {
        var nm = names[(i + off) % names.length];
        var ph = '0100000' + ('0000' + (off * 10 + i + 1)).slice(-4);
        rows.push([nm, ph, fmt(day), times[i % times.length], docs[i % docs.length]].join(','));
      }
    }
    add(d0, 8, 1); add(d1, 8, 2); add(t, 6, 3); add(d2, 7, 4);
    /* messy rows on the target day, to show how problems are caught */
    rows.push(['هبة ناصر', '+20 100 000 0099', fmt(d2), '٦:٣٠ م', 'د. سارة'].join(','));
    rows.push(['رامي شوقي', '٠١٠٠٠٠٠٠١٠٠', fmt(d2), '8 م', 'د. هشام'].join(','));
    rows.push(['دينا عمرو', '0100000', fmt(d2), '4 م', 'د. هشام'].join(','));
    return rows.join('\n');
  }

  function seedSampleMarks() {
    var t = todayISO(), d0 = M.addDays(t, -2), d1 = M.addDays(t, -1);
    var marks = {};
    parsed.rows.forEach(function (r) {
      if (r.date === d0 || r.date === d1) {
        var k = parseInt(r.phone.slice(-2), 10);
        var sent = r.date === d1; /* demo: reminders started yesterday */
        var noshow = sent ? (k % 8 === 0) : (k % 3 === 0);
        marks[r.id] = { sent: sent, outcome: noshow ? 'noshow' : 'came' };
      }
    });
    state.marks = marks;
  }

  function reparse() {
    parsed = M.parseTable(state.text);
    var info = $('parseInfo');
    if (!state.text.trim()) { info.innerHTML = ''; return; }
    if (parsed.error === 'need_header_and_rows') { info.innerHTML = '<span class="err">محتاج صف عناوين وبعده صف مواعيد على الأقل.</span>'; return; }
    if (parsed.error === 'missing_columns') {
      var ar = { name: 'الاسم', phone: 'الموبايل', date: 'التاريخ' };
      info.innerHTML = '<span class="err">مش لاقي عمود: ' + parsed.missing.map(function (m) { return ar[m]; }).join('، ') + '.</span> سمّي العناوين زي «الاسم» و«الموبايل» و«التاريخ» (أو Name, Phone, Date).';
      return;
    }
    var bad = parsed.rows.filter(function (r) { return r.issues.length; }).length;
    var lab = { name: 'الاسم', phone: 'الموبايل', date: 'التاريخ', time: 'الساعة', doctor: 'الدكتور', service: 'الخدمة' };
    var chips = Object.keys(parsed.columns).map(function (k) { return '<span class="tag ok">' + lab[k] + '</span>'; }).join('');
    info.innerHTML = '<span class="good">اتقرا ' + parsed.rows.length + ' ميعاد.</span> ' + (bad ? bad + ' فيهم محتاجين مراجعة.' : 'كله سليم.') + '<div class="cols">' + chips + '</div>';
  }

  function dayRows() {
    return parsed.rows.filter(function (r) { return r.date === state.day; }).sort(function (a, b) { return (a.time || '99') < (b.time || '99') ? -1 : 1; });
  }

  function renderPreview() {
    var r = dayRows()[0] || parsed.rows[0] || { name: 'منى حسن', date: M.addDays(todayISO(), 1), time: '17:00', doctor: 'د. سارة' };
    $('preview').textContent = M.buildMessage(state.tpl, r, state.clinic);
  }

  function renderDay() {
    $('day').value = state.day;
    $('dayLabel').textContent = state.day ? M.dateLabel(state.day) : '';
    var rows = dayRows(), list = $('list');
    if (!parsed.rows.length) { $('progress').hidden = true; list.innerHTML = '<div class="empty">لسه مفيش جدول. الصق جدولك فوق أو جرّب البيانات التجريبية.</div>'; $('chips').innerHTML = ''; return; }
    if (!rows.length) { $('progress').hidden = true; list.innerHTML = '<div class="empty">مفيش مواعيد في اليوم ده في الجدول.</div>'; $('chips').innerHTML = ''; return; }
    var sent = 0, ready = 0, probs = 0;
    var html = '<div class="row head" role="row"><div role="columnheader">الساعة</div><div role="columnheader">المريض</div><div role="columnheader">الدكتور</div><div role="columnheader">الموبايل</div><div role="columnheader">تذكير</div><div role="columnheader">النتيجة</div></div>';
    rows.forEach(function (r) {
      var mk = state.marks[r.id] || {};
      var blocking = r.issues.some(function (i) { return i === 'bad_phone' || i === 'no_phone' || i === 'duplicate'; });
      if (blocking) probs++; else ready++;
      if (mk.sent) sent++;
      var msg = M.buildMessage(state.tpl, r, state.clinic);
      var btn;
      if (blocking) btn = '<span class="tag bad">' + esc(r.issues.map(function (i) { return ISSUE_AR[i]; }).filter(Boolean).join('، ')) + '</span>';
      else btn = '<a class="wa' + (mk.sent ? ' done' : '') + '" data-id="' + r.id + '" target="_blank" rel="noopener" href="' + M.waLink(r.e164, msg) + '">' + (mk.sent ? 'اتبعت. ابعت تاني' : 'ابعت واتساب') + '</a>';
      var oc = mk.outcome || '';
      html += '<div class="row' + (mk.sent ? ' sentrow' : '') + '" role="row">' +
        '<div class="t num" role="cell">' + esc(M.timeLabel(r.time) || '-') + '</div>' +
        '<div class="who" role="cell">' + esc(r.name || '-') + (r.service ? '<small>' + esc(r.service) + '</small>' : '') + '</div>' +
        '<div role="cell" class="doc">' + esc(r.doctor || '-') + '</div>' +
        '<div class="num ph" role="cell">' + esc(r.phoneDisplay) + '</div>' +
        '<div class="send" role="cell">' + btn + '</div>' +
        '<div class="out" role="cell"><select data-id="' + r.id + '" aria-label="نتيجة ميعاد ' + esc(r.name || '') + '">' +
        [['', 'لسه'], ['confirmed', 'أكّد'], ['came', 'حضر'], ['noshow', 'غاب']].map(function (o) { return '<option value="' + o[0] + '"' + (oc === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div></div>';
    });
    list.innerHTML = html;
    var pg = M.dayProgress(rows, state.marks), pc = pg.sendable ? Math.round(pg.sent / pg.sendable * 100) : 0;
    $('progress').hidden = false; $('pfill').style.width = pc + '%'; $('pfill').parentNode.setAttribute('aria-valuenow', pc);
    $('ptext').textContent = pg.left ? 'اتبعت ' + pg.sent + ' من ' + pg.sendable + '. فاضل ' + pg.left + '.' : (pg.sendable ? 'كل تذكيرات اليوم اتبعتت.' : '');
    $('chips').innerHTML = '<span class="tag">' + rows.length + ' مواعيد</span><span class="tag ok">' + sent + ' اتبعتلهم تذكير</span>' +
      (ready - sent > 0 ? '<span class="tag warn">' + (ready - sent) + ' لسه</span>' : '') + (probs ? '<span class="tag bad">' + probs + ' محتاجين مراجعة</span>' : '');
  }

  function pct(x) { return x == null ? '-' : Math.round(x * 100) + '%'; }
  function money(n) { return Math.round(n).toLocaleString('ar-EG-u-nu-latn'); }

  function renderResults() {
    var s = M.stats(parsed.rows, state.marks), el = $('results');
    if (s.all.n === 0) { el.innerHTML = '<div class="resnote">لسه مفيش مواعيد معلّمة «حضر» أو «غاب». علّم مواعيد يوم عدّى وهتظهر المقارنة هنا.</div>'; return; }
    var fee = +state.fee || 0;
    var html = '<div class="rc"><div class="sub">اتبعتلهم تذكير</div><div class="big num">' + pct(s.sent.rate) + '</div><div class="sub">غياب · ' + s.sent.noshow + ' من ' + s.sent.n + '</div></div>' +
      '<div class="rc no"><div class="sub">ما اتبعتلهمش</div><div class="big num">' + pct(s.notSent.rate) + '</div><div class="sub">غياب · ' + s.notSent.noshow + ' من ' + s.notSent.n + '</div></div>' +
      '<div class="resnote">إجمالي الغياب المتعلّم: ' + s.all.noshow + ' ميعاد، يعني حوالي <b class="num">' + money(s.all.noshow * fee) + '</b> جنيه كشوفات ضايعة. ' +
      (s.sent.n < 20 || s.notSent.n < 20 ? 'العينة صغيرة (أقل من 20 في أي جهة)، فمتاخدش المقارنة كدليل. كمّل كام أسبوع الأول.' : 'المقارنة دي من عيادتك، ومش تجربة علمية: ممكن اختلاف الدكاترة أو الأيام يأثر.') + '</div>';
    if (state.sample) html = '<div class="resnote" style="background:#F3E6C8">الأرقام دي طالعة من بيانات تجريبية مصنوعة، مش نتيجة حقيقية.</div>' + html;
    el.innerHTML = html;
  }

  var TPL_W = { no_name: 'الرسالة مفيهاش {name}، فهتوصل لكل المرضى بدون اسمهم.', no_day: 'الرسالة مفيهاش {day}، المريض مش هيعرف يوم الميعاد.', no_clinic: 'الرسالة مفيهاش {clinic}.', too_long: 'الرسالة طويلة. الأقصر بتتقري أكتر.' };
  function renderSetup() {
    var w = M.checkTemplate(state.tpl);
    $('tplWarn').innerHTML = w.length ? '<span class="err">' + w.map(function (k) { return esc(TPL_W[k]); }).join(' ') + '</span>' : '';
    var n = parsed.rows.length;
    $('setupSum').textContent = n ? 'الجدول: ' + n + ' ميعاد · ' + (state.clinic || 'بدون اسم عيادة') + ' · اضغط للتعديل' : 'إعداد الجدول والرسالة';
  }
  function renderAll() { renderPreview(); renderDay(); renderResults(); renderSetup(); $('sampleBanner').hidden = !state.sample; }

  function setText(text, isSample) {
    state.text = text; state.sample = !!isSample; $('paste').value = text; reparse();
    if (parsed.rows.length) {
      var t = todayISO();
      var dates = parsed.rows.map(function (r) { return r.date; }).filter(Boolean).sort();
      var future = dates.filter(function (d) { return d > t; });
      state.day = future.length ? future[0] : (dates[dates.length - 1] || t);
    }
    save(); renderAll();
    if (parsed.rows.length) { $('setup').open = false; }
  }

  function csvCell(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  function exportCSV() {
    var lab = { '': '', confirmed: 'أكّد', came: 'حضر', noshow: 'غاب' };
    var out = ['الاسم,الموبايل,التاريخ,الساعة,الدكتور,اتبعت تذكير,النتيجة'];
    parsed.rows.forEach(function (r) {
      var mk = state.marks[r.id] || {};
      out.push([r.name, r.phone, r.date || '', r.time || '', r.doctor, mk.sent ? 'نعم' : 'لا', lab[mk.outcome || '']].map(csvCell).join(','));
    });
    var blob = new Blob(['\uFEFF' + out.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'maead-' + todayISO() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function init() {
    load();
    $('clinic').value = state.clinic; $('fee').value = state.fee; $('tpl').value = state.tpl; $('paste').value = state.text;
    reparse();
    if (!state.day) state.day = M.addDays(todayISO(), 1);
    renderAll();

    $('btnParse').onclick = function () { state.sample = false; setText($('paste').value, false); };
    $('btnSample').onclick = function () { setText(sampleCSV(), true); seedSampleMarks(); save(); renderAll(); };
    $('btnClear').onclick = function () {
      if (!state.text && !Object.keys(state.marks).length) return;
      var backup = JSON.stringify(state), u = $('undo');
      state.marks = {}; setText('', false); state.day = M.addDays(todayISO(), 1); save(); renderAll(); $('setup').open = true;
      u.hidden = false; u.innerHTML = 'اتمسحت كل البيانات. <button type="button" class="linkbtn" id="btnUndo">تراجع</button>';
      var tm = setTimeout(function () { u.hidden = true; }, 15000);
      $('btnUndo').onclick = function () { clearTimeout(tm); state = M.migrateState(JSON.parse(backup), state); $('paste').value = state.text; $('clinic').value = state.clinic; $('tpl').value = state.tpl; reparse(); save(); renderAll(); u.hidden = true; if (parsed.rows.length) $('setup').open = false; };
    };
    $('file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var info = $('parseInfo');
      if (f.size > 2 * 1024 * 1024) { info.innerHTML = '<span class="err">الملف كبير (أكتر من 2 ميجا). ده مش جدول مواعيد عادي. صدّر الأعمدة المطلوبة بس كـ CSV.</span>'; e.target.value = ''; return; }
      if (/\.xlsx?$/i.test(f.name)) { info.innerHTML = '<span class="err">ملفات إكسل مش بتتقري هنا. افتح الملف واختار حفظ باسم > CSV، أو انسخ الأعمدة والصقها فوق.</span>'; e.target.value = ''; return; }
      var rd = new FileReader();
      rd.onerror = function () { info.innerHTML = '<span class="err">معرفتش أقرا الملف. جرّب تنسخ الأعمدة والصقها فوق.</span>'; };
      rd.onload = function () { setText(String(rd.result), false); e.target.value = ''; };
      rd.readAsText(f, 'utf-8');
    };
    $('clinic').oninput = function () { state.clinic = this.value; save(); renderAll(); };
    $('fee').oninput = function () { state.fee = this.value; save(); renderResults(); };
    $('tpl').oninput = function () { state.tpl = this.value; save(); renderAll(); };
    $('btnTplReset').onclick = function () { state.tpl = M.DEFAULT_TEMPLATE; $('tpl').value = state.tpl; save(); renderAll(); };
    $('day').onchange = function () { if (this.value) { state.day = this.value; save(); renderAll(); } };
    $('prevDay').onclick = function () { state.day = M.addDays(state.day, -1); save(); renderAll(); };
    $('nextDay').onclick = function () { state.day = M.addDays(state.day, 1); save(); renderAll(); };
    $('goTomorrow').onclick = function () { state.day = M.addDays(todayISO(), 1); save(); renderAll(); };
    $('btnExport').onclick = exportCSV;

    $('list').addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.wa'); if (!a) return;
      var id = a.getAttribute('data-id'); state.marks[id] = Object.assign({}, state.marks[id], { sent: true }); save();
      setTimeout(renderAll, 50);
    });
    $('list').addEventListener('change', function (e) {
      var s = e.target.closest && e.target.closest('select'); if (!s) return;
      var id = s.getAttribute('data-id'); state.marks[id] = Object.assign({}, state.marks[id], { outcome: s.value }); save(); renderAll();
    });

    if (location.hash === '#demo' && !parsed.rows.length) { $('btnSample').click(); }
  }
  init();
})();
