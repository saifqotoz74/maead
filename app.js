(function () {
  'use strict';
  var M = window.Maead;
  var KEY = 'maead.v1';
  var $ = function (id) { return document.getElementById(id); };

  var state = { text: '', clinic: 'عيادة النور', fee: 300, tpl: M.DEFAULT_TEMPLATE, marks: {}, day: '', sample: false };
  var parsed = { rows: [], columns: {}, missing: [], error: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } if (typeof queuePush === 'function') queuePush(); }
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
      else if (lockedNow()) btn = '<span class="wa off">اشترك علشان تبعت</span>';
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
  function renderAll() { if (window.MaeadLicence) renderLic(window.MaeadLicence.view()); renderPreview(); renderDay(); renderResults(); renderSetup(); $('sampleBanner').hidden = !state.sample; }

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

  function readExcel(f, info, input) {
    if (!window.MaeadXlsx || typeof DecompressionStream === 'undefined') { info.innerHTML = '<span class="err">المتصفح ده قديم ومش بيفتح إكسل. انسخ الأعمدة والصقها فوق، أو احفظ الملف CSV.</span>'; input.value = ''; return; }
    var rd = new FileReader();
    rd.onerror = function () { info.innerHTML = '<span class="err">معرفتش أقرا الملف.</span>'; };
    rd.onload = function () {
      window.MaeadXlsx.readXlsx(rd.result).then(function (rows) {
        var tsv = window.MaeadXlsx.toTSV(rows, M.mapHeader);
        if (!tsv.trim()) { info.innerHTML = '<span class="err">الشيت الأول فاضي.</span>'; return; }
        setText(tsv, false);
        info.innerHTML = '<span class="good">اتفتح ملف إكسل (أول شيت بس).</span> ' + info.innerHTML;
      }).catch(function () { info.innerHTML = '<span class="err">الملف مش xlsx سليم أو متحمي بباسورد. احفظه CSV أو انسخ الأعمدة والصقها.</span>'; });
      input.value = '';
    };
    rd.readAsArrayBuffer(f);
  }

  function backupNow() {
    var blob = new Blob([M.makeBackup(state, new Date().toISOString())], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'maead-backup-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function restoreFrom(f) {
    var box = $('backupInfo');
    var rd = new FileReader();
    rd.onerror = function () { box.innerHTML = '<span class="err">معرفتش أقرا الملف.</span>'; };
    rd.onload = function () {
      var r = M.parseBackup(String(rd.result), state);
      var msg = { not_json: 'الملف ده مش نسخة احتياطية من ميعاد.', not_maead: 'الملف ده مش نسخة احتياطية من ميعاد.', too_new: 'النسخة دي من إصدار أحدث من الصفحة دي.' };
      if (!r.ok) { box.innerHTML = '<span class="err">' + msg[r.error] + '</span>'; return; }
      if (!window.confirm('هترجّع النسخة دي وتمسح البيانات الحالية. متأكد؟')) return;
      state = r.state; $('paste').value = state.text; $('clinic').value = state.clinic; $('fee').value = state.fee; $('tpl').value = state.tpl;
      reparse(); save(); renderAll(); if (parsed.rows.length) $('setup').open = false;
      box.innerHTML = '<span class="good">اترجّعت النسخة (' + parsed.rows.length + ' ميعاد).</span>';
    };
    rd.readAsText(f, 'utf-8');
  }


  /* ---- licence box ---- */
  var L = window.MaeadLicence;
  function lockedNow() { return !!(L && L.enabled() && L.view().locked && !state.sample); }
  function priceText() { var p = (window.MAEAD_CONFIG || {}).price; return p ? 'السعر: ' + p + ' جنيه في الشهر' : 'السعر: يُحدد'; }
  function supportLink(text, msg) { return '<a href="https://wa.me/' + ((window.MAEAD_CONFIG || {}).whatsapp || '') + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">' + text + '</a>'; }
  var LIC_ERR = { bad_input: 'اكتب اسم العيادة ورقم موبايل مصري صحيح.', trial_used: 'الرقم ده خد التجربة قبل كده. لو معاك كود اكتبه تحت.', trial_busy: 'التجارب المجانية وقفت لحد بكرة. جرّب بكرة أو كلمنا على واتساب.', unknown_code: 'الكود ده مش موجود. اتأكد منه.', revoked: 'الكود ده اتلغى. كلمنا على واتساب.', expired: 'الكود ده خلص. كلمنا نجدّده.', network: 'مفيش اتصال بالسيرفر. جرّب تاني لما النت يرجع.', bad_code: 'اكتب الكود زي MD-XXXX-XXXX.', server_error: 'حصلت مشكلة عندنا. جرّب كمان شوية.' };
  function renderLic(v) {
    var box = $('licBox'); if (!box || !L || !L.enabled()) return;
    var keep = box.querySelector('input:focus'); if (keep && keep.id) { return; }
    var h = '', buy = supportLink('اشترك على واتساب', 'عايز أشترك في ميعاد. الكود: ' + (v.code || 'لسه معييش') );
    if (v.state === 'active' || v.state === 'grace') {
      h = '<div class="licline"><b>' + (v.kind === 'trial' ? 'تجربة مجانية' : 'اشتراك شغال') + '</b> فاضل ' + v.left + ' يوم. كودك: <span class="num">' + esc(v.code) + '</span>' +
        (v.state === 'grace' ? ' <span class="tag warn">من غير اتصال: شغال ' + v.graceLeft + ' يوم كمان</span>' : '') +
        (v.kind === 'trial' ? ' ' + buy + ' <span class="muted">(' + priceText() + ')</span>' : '') + '</div>';
      box.className = 'lic ok';
    } else {
      var why = { none: 'جرّب ميعاد ٧ أيام مجانًا بالبيانات الحقيقية. من غير كارت.', expired: 'الاشتراك خلص. التذكيرات الحقيقية واقفة، وبياناتك لسه موجودة على جهازك.', revoked: 'الكود ده اتلغى. التذكيرات الحقيقية واقفة.', unknown: 'الكود ده مش معروف. التذكيرات الحقيقية واقفة.', stale: 'لازم النت يتوصل مرة علشان نتأكد من الاشتراك. التذكيرات الحقيقية واقفة لحد ما يحصل.', unverified: 'مقدرناش نتأكد من الكود. اكتبه تاني.' }[v.state] || '';
      h = '<h2>' + (v.state === 'none' ? 'ابدأ التجربة المجانية' : 'فعّل الاشتراك') + '</h2><p class="hint">' + why + ' ' + priceText() + '. البيانات التجريبية والنسخ الاحتياطي شغالين دايمًا.</p>' +
        '<div class="licgrid">' +
        (v.state === 'none' ? '<div class="licf"><div class="grid2"><div><label for="licClinic">اسم العيادة</label><input id="licClinic" autocomplete="off"></div><div><label for="licPhone">موبايل العيادة</label><input id="licPhone" inputmode="tel" autocomplete="off" placeholder="01XXXXXXXXX"></div></div><button class="btn" id="licTrial" type="button">ابدأ ٧ أيام مجانًا</button></div>' : '') +
        '<div class="licf"><label for="licCode">عندي كود</label><div class="inl"><input id="licCode" autocomplete="off" placeholder="MD-XXXX-XXXX" dir="ltr"><button class="btn ghost" id="licAct" type="button">فعّل</button></div></div></div>' +
        '<div id="licMsg" class="info" role="status" aria-live="polite"></div>' +
        '<p class="hint">بنسجّل اسم العيادة وموبايلها وكود الاشتراك بس. بيانات المرضى مبتسيبش جهازك. ' + supportLink('محتاج مساعدة؟', 'عايز أفعّل ميعاد' ) + '</p>';
      box.className = 'lic lock';
    }
    box.innerHTML = h; box.hidden = false;
    var msg = function (k) { var m = $('licMsg'); if (m) m.innerHTML = '<span class="err">' + esc(LIC_ERR[k] || k) + '</span>'; };
    var go = function (p) { var m = $('licMsg'); if (m) m.textContent = 'ثانية...'; p.then(function (r) { if (r.error) msg(r.error); else { renderAll(); } }); };
    if ($('licTrial')) $('licTrial').onclick = function () { go(L.startTrial($('licClinic').value, $('licPhone').value)); };
    if ($('licAct')) $('licAct').onclick = function () { go(L.activate($('licCode').value)); };
  }

  function init() {
    load();
    $('clinic').value = state.clinic; $('fee').value = state.fee; $('tpl').value = state.tpl; $('paste').value = state.text;
    reparse();
    if (!state.day) state.day = M.addDays(todayISO(), 1);
    renderAll();
    if (parsed.rows.length) $('setup').open = false;

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
      if (/\.xls$/i.test(f.name)) { info.innerHTML = '<span class="err">ملف إكسل القديم (xls) مش مدعوم. افتحه واحفظه بصيغة xlsx أو CSV، أو انسخ الأعمدة والصقها فوق.</span>'; e.target.value = ''; return; }
      /* an .xlsx is a zip: "PK" at the start. Check the bytes, so a renamed or extension-less file still opens. */
      var head = new FileReader(), inputEl = e.target;
      head.onload = function () {
        var b = new Uint8Array(head.result);
        if ((b[0] === 0x50 && b[1] === 0x4B) || /\.xlsx$/i.test(f.name)) { readExcel(f, info, inputEl); return; }
        readText(f, info, inputEl);
      };
      head.onerror = function () { info.innerHTML = '<span class="err">معرفتش أقرا الملف.</span>'; };
      head.readAsArrayBuffer(f.slice(0, 4));
      return;
    };
    function readText(f, info, input) {
      var rd = new FileReader();
      rd.onerror = function () { info.innerHTML = '<span class="err">معرفتش أقرا الملف. جرّب تنسخ الأعمدة والصقها فوق.</span>'; };
      rd.onload = function () { setText(String(rd.result), false); input.value = ''; };
      rd.readAsText(f, 'utf-8');
    }
    $('clinic').oninput = function () { state.clinic = this.value; save(); renderAll(); };
    $('fee').oninput = function () { state.fee = this.value; save(); renderResults(); };
    $('tpl').oninput = function () { state.tpl = this.value; save(); renderAll(); };
    $('btnTplReset').onclick = function () { state.tpl = M.DEFAULT_TEMPLATE; $('tpl').value = state.tpl; save(); renderAll(); };
    $('day').onchange = function () { if (this.value) { state.day = this.value; save(); renderAll(); } };
    $('prevDay').onclick = function () { state.day = M.addDays(state.day, -1); save(); renderAll(); };
    $('nextDay').onclick = function () { state.day = M.addDays(state.day, 1); save(); renderAll(); };
    $('goTomorrow').onclick = function () { state.day = M.addDays(todayISO(), 1); save(); renderAll(); };
    $('btnExport').onclick = exportCSV;
    $('btnBackup').onclick = backupNow;
    $('restoreFile').onchange = function (e) { var f = e.target.files[0]; if (f) restoreFrom(f); e.target.value = ''; };

    $('list').addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.wa'); if (!a) return;
      var id = a.getAttribute('data-id'); state.marks[id] = Object.assign({}, state.marks[id], { sent: true }); save();
      setTimeout(renderAll, 50);
    });
    $('list').addEventListener('change', function (e) {
      var s = e.target.closest && e.target.closest('select'); if (!s) return;
      var id = s.getAttribute('data-id'); state.marks[id] = Object.assign({}, state.marks[id], { outcome: s.value }); save(); renderAll();
    });

    if (L) { L.onChange(function () { renderAll(); }); L.init(); }
    initAccount();
    if (location.hash === '#demo' && !parsed.rows.length) { $('btnSample').click(); }
  }

  /* ---- clinic account + server sync -------------------------------------------------------------
     The day still lives on the device. When a clinic is logged in, it also lives on the server:
     pulled on open, pushed after each change, and a stale push comes back as a conflict. */
  var C = window.Clinic || null;
  var clinicRev = 0;
  try { clinicRev = Number(localStorage.getItem('maead.rev.v1') || '0') || 0; } catch (e) { clinicRev = 0; }
  var pushTimer = null, applyingRemote = false;

  function saveRev(n) { clinicRev = n || 0; try { localStorage.setItem('maead.rev.v1', String(clinicRev)); } catch (e) { /* private mode */ } }
  function setNote(txt, bad) {
    var n = $('accNote'); if (!n) return;
    n.textContent = txt || '';
    n.className = 'note' + (bad ? ' err' : '');
  }
  function queuePush() {
    if (!C || !C.session() || applyingRemote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  }
  function pushNow() {
    if (!C || !C.session()) return;
    C.push(state, clinicRev).then(function (j) {
      if (j.ok) { saveRev(j.rev); setNote('محفوظ على السيرفر'); }
      else if (j.error === 'conflict') { saveRev(j.rev); setNote('العيادة عدّلت من جهاز تاني. اضغط «حدّث من السيرفر» قبل ما تكمل.', true); }
      else if (j.http === 401) { C.dropIfDead(j); renderAccount(); pendingNote = 'الجلسة انتهت. سجّل دخول تاني.'; }
      else if (j.error === 'offline') { setNote('مفيش نت، محفوظ على الجهاز.'); }
      else { setNote('مش قادر أحفظ على السيرفر.', true); }
    });
  }
  function applyRemote(doc) {
    applyingRemote = true;
    var keepDay = doc && doc.day;
    state = M.migrateState(doc, state);
    $('clinic').value = state.clinic; $('fee').value = state.fee; $('tpl').value = state.tpl;
    setText(state.text || '', !!state.sample);
    if (keepDay) { state.day = keepDay; $('day').value = keepDay; }
    save(); renderAll();
    applyingRemote = false;
  }
  function pullNow() {
    if (!C || !C.session()) return;
    setNote('بجيب آخر نسخة…');
    C.pull().then(function (j) {
      if (j.http === 401) { C.dropIfDead(j); renderAccount(); pendingNote = 'الجلسة انتهت. سجّل دخول تاني.'; return; }
      if (!j.ok) { setNote(j.error === 'offline' ? 'مفيش نت.' : 'مش قادر أقرا من السيرفر.', true); return; }
      saveRev(j.rev);
      if (j.doc && j.doc.text) { applyRemote(j.doc); setNote('آخر نسخة من السيرفر'); }
      else { setNote('الحساب جديد، الجدول اللي على الجهاز هيتحفظ عليه.'); pushNow(); }
    });
  }
  function renderAccount() {
    var s = C && C.session();
    $('accBar').hidden = !s;
    $('accIn').hidden = !!s;
    if (s) $('accWho').textContent = (s.user.name || s.user.username) + ' — ' + s.user.clinic;
  }
  var pendingNote = '';
  function accErr(txt) { $('accErr').textContent = txt || ''; }
  var ACC_ERRORS = {
    bad_login: 'اسم المستخدم أو كلمة السر غلط.', locked: 'محاولات كتير غلط. استنى شوية وجرّب تاني.',
    bad_input: 'راجع البيانات: اسم المستخدم 3 حروف على الأقل، وكلمة السر 12 حرف على الأقل.',
    bad_code: 'الكود مش موجود.', code_not_active: 'الكود مش مفعّل أو مش كود مدفوع.',
    code_used: 'الكود ده مستخدم لعيادة تانية.', username_taken: 'اسم المستخدم محجوز، جرّب غيره.',
    owner_only: 'الحاجة دي للمالك بس.', offline: 'مفيش نت.', disabled: 'الحساب مقفول.'
  };
  function accMsg(j) { return ACC_ERRORS[j && j.error] || 'حصلت مشكلة، جرّب تاني.'; }

  function initAccount() {
    if (!C || !C.enabled()) { $('accIn').hidden = true; return; }
    renderAccount();
    $('accIn').onclick = function () { accErr(pendingNote); pendingNote = ''; $('accDlg').showModal(); };
    $('accToReg').onclick = function () { $('accLogin').hidden = true; $('accReg').hidden = false; accErr(''); };
    $('accToLogin').onclick = function () { $('accReg').hidden = true; $('accLogin').hidden = false; accErr(''); };
    $('accSync').onclick = pullNow;
    $('accOut').onclick = function () {
      clearTimeout(pushTimer);
      C.logout().then(function () { renderAccount(); setNote(''); });
    };
    $('accLogin').onsubmit = function (e) {
      e.preventDefault();
      accErr('بندخل…');
      C.login($('alu').value.trim(), $('alp').value).then(function (j) {
        if (!j.ok) { accErr(accMsg(j)); return; }
        $('accDlg').close(); $('alp').value = ''; renderAccount(); pullNow();
      });
    };
    $('accReg').onsubmit = function (e) {
      e.preventDefault();
      accErr('بنعمل الحساب…');
      C.register($('arc').value.trim(), $('arp').value.trim(), $('ark').value.trim(), $('aru').value.trim(), $('arw').value, $('arn').value.trim()).then(function (j) {
        if (!j.ok) { accErr(accMsg(j)); return; }
        $('accDlg').close(); $('arw').value = ''; renderAccount(); pullNow();
      });
    };
    if (C.session()) pullNow();
  }

  init();
})();
