/* Maead admin page. Talks to the licence server: session login, roles, licence codes, CSV export. */
(function () {
  var CFG = window.MAEAD_CONFIG || {};
  var API = CFG.licenceApi || '';
  var TKEY = 'maead.admin.v2';
  var tok = '';
  var me = null;

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function msg(text, kind) {
    var m = $('msg');
    if (!text) { m.innerHTML = ''; m.hidden = true; return; }
    m.innerHTML = '<span class="' + (kind === 'good' ? 'good' : kind === 'err' ? 'err' : '') + '">' + esc(text) + '</span>';
    m.hidden = false;
  }
  function cairo(sec) {
    if (!sec) return '-';
    try {
      var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(sec * 1000));
      var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
      return o.year + '-' + o.month + '-' + o.day + ' ' + (o.hour === '24' ? '00' : o.hour) + ':' + o.minute;
    } catch (e) { return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' '); }
  }
  var MSG = {
    bad_login: 'الاسم أو كلمة السر غلط.',
    locked: 'محاولات غلط كتير. استنى ربع ساعة وجرب تاني.',
    disabled: 'الحساب ده موقوف. كلم المالك.',
    weak_password: 'كلمة السر قصيرة. 12 حرف على الأقل.',
    bad_username: 'اسم المستخدم: حروف إنجليزي وأرقام ونقطة وشَرطة، من 3 لـ 24، ويبدأ بحرف أو رقم.',
    username_taken: 'اسم المستخدم ده موجود قبل كده.',
    forbidden: 'الحساب ده مش مسموح له بالعملية دي.',
    last_owner: 'ماينفعش تشيل آخر مالك شغال.',
    self_lockout: 'ماينفعش توقف حسابك انت أو تغيّر دورك.',
    unknown_code: 'الكود ده مش موجود.',
    bad_key: 'مفتاح الإدارة غلط.',
    already_setup: 'فيه حساب مالك بالفعل. اعمل دخول.',
    bad_old: 'كلمة السر الحالية غلط.',
    not_owner: 'مفيش حساب مالك بالاسم ده.',
    bad_input: 'كمّل الخانات.',
    server_error: 'حصلت مشكلة في السيرفر. جرب تاني.',
    not_found: 'مش موجود.',
    unauthorized: 'خلصت الجلسة. اعمل دخول تاني.'
  };
  function errText(j) {
    var k = (j && j.error) || '';
    if (MSG[k]) return MSG[k];
    return 'حصلت مشكلة. جرب تاني.';
  }

  function api(path, body, method, key) {
    var opt = { method: method || (body === undefined ? 'GET' : 'POST'), headers: {} };
    if (key) opt.headers['authorization'] = 'Bearer ' + key;
    else if (tok) opt.headers['authorization'] = 'Bearer ' + tok;
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + path, opt).then(function (r) {
      return r.text().then(function (txt) {
        var j = {};
        try { j = JSON.parse(txt); } catch (e) { j = {}; }
        if (r.status === 401 && !key && path !== '/admin/login') {
          clearTok();
          showLogin();
        }
        return { status: r.status, json: j };
      });
    }).catch(function () { return { status: 0, json: { error: 'offline' } }; });
  }

  function setTok(t) {
    tok = t || '';
    try { if (tok) sessionStorage.setItem(TKEY, tok); else sessionStorage.removeItem(TKEY); } catch (e) { /* private mode */ }
  }
  function clearTok() { setTok(''); me = null; }

  function showLogin() {
    show($('topbar'), false); show($('app'), false); show($('setupCard'), false); show($('loginCard'), true);
    $('lu').focus();
  }
  function showSetup() {
    show($('topbar'), false); show($('app'), false); show($('loginCard'), false); show($('setupCard'), true);
  }

  function enterApp(user) {
    me = user;
    var owner = user.role === 'owner';
    show($('loginCard'), false); show($('setupCard'), false); show($('app'), true); show($('topbar'), true);
    $('who').innerHTML = esc(user.name || user.username) + ' <span class="pill ' + (owner ? 'own' : 'stf') + '">' + (owner ? 'مالك' : 'موظف') + '</span>';
    show($('ownerOps'), owner);
    show($('staffNote'), !owner);
    show($('ownerBox'), owner);
    loadList();
    if (owner) { loadUsers(); loadAudit(); }
  }

  function boot() {
    if (!API) { showLogin(); msg('إعداد السيرفر ناقص (licenceApi).', 'err'); return; }
    try { tok = sessionStorage.getItem(TKEY) || ''; } catch (e) { tok = ''; }
    api('/admin/state', undefined, 'GET').then(function (r) {
      if (r.status === 0) { msg('مفيش اتصال بالسيرفر.', 'err'); showLogin(); return; }
      if (r.json && r.json.setup === false) { showSetup(); return; }
      if (!tok) { showLogin(); return; }
      api('/admin/me', undefined, 'GET').then(function (r2) {
        if (r2.status === 200 && r2.json.user) enterApp(r2.json.user);
        else showLogin();
      });
    });
  }

  function login() {
    var u = $('lu').value.trim(), p = $('lp').value;
    if (!u || !p) { msg('اكتب الاسم وكلمة السر.', 'err'); return; }
    msg('بيدخل...');
    api('/admin/login', { username: u, password: p }).then(function (r) {
      if (r.status === 200 && r.json.token) { setTok(r.json.token); $('lp').value = ''; msg(''); enterApp(r.json.user); }
      else msg(errText(r.json), 'err');
    });
  }

  function setup() {
    var key = $('sk').value.trim(), u = $('su').value.trim(), n = $('sn').value.trim();
    var p = $('sp').value, p2 = $('sp2').value;
    if (p !== p2) { msg('كلمتين السر مش زي بعض.', 'err'); return; }
    if (p.length < 12) { msg(MSG.weak_password, 'err'); return; }
    msg('بيعمل الحساب...');
    api('/admin/bootstrap', { username: u, name: n, password: p }, 'POST', key).then(function (r) {
      if (r.status === 200 && r.json.token) { setTok(r.json.token); $('sp').value = ''; $('sp2').value = ''; $('sk').value = ''; msg('اتعمل الحساب.', 'good'); enterApp(r.json.user); }
      else msg(errText(r.json), 'err');
    });
  }

  function recover() {
    var u = $('ru').value.trim(), p = $('rp').value, key = $('rk').value.trim();
    if (!u || !p || !key) { msg('كمّل الخانات التلاتة.', 'err'); return; }
    api('/admin/recover', { username: u, password: p }, 'POST', key).then(function (r) {
      if (r.status === 200) { $('rp').value = ''; $('rk').value = ''; msg('كلمة السر اتغيرت. ادخل بيها دلوقتي.', 'good'); $('lu').value = u; $('lp').focus(); }
      else msg(errText(r.json), 'err');
    });
  }

  function signOut() {
    api('/admin/logout', {}).then(function () {
      clearTok(); msg(''); showLogin();
    });
  }

  /* ---- licences ---- */
  function statusPill(s) {
    var t = s === 'active' ? 'شغال' : s === 'revoked' ? 'ملغي' : 'خلص';
    return '<span class="pill st st-' + s + '">' + t + '</span>';
  }
  function kindTxt(k) { return k === 'trial' ? 'تجربة' : 'مدفوع'; }

  function loadList() {
    $('licRows').innerHTML = '<tr><td colspan="8" class="muted">بيحمّل...</td></tr>';
    api('/admin/list', undefined, 'GET').then(function (r) {
      if (r.status !== 200) { $('licRows').innerHTML = '<tr><td colspan="8" class="muted">' + esc(errText(r.json)) + '</td></tr>'; return; }
      var rows = r.json.licences || [];
      if (!rows.length) { $('licRows').innerHTML = '<tr><td colspan="8" class="muted">مفيش أكواد لسه.</td></tr>'; return; }
      $('licRows').innerHTML = rows.map(function (x) {
        return '<tr><td class="code">' + esc(x.code) + '</td><td>' + statusPill(x.status) + '</td><td>' + kindTxt(x.kind) + '</td><td>' +
          esc(x.clinic || '-') + '</td><td class="code">' + esc(x.phone || '-') + '</td><td>' + esc(cairo(x.expires_at)) + '</td><td>' +
          esc(cairo(x.created_at)) + '</td><td>' + esc(x.issued_by || '-') + '</td></tr>';
      }).join('');
    });
  }

  function issue() {
    var clinic = $('ic').value.trim();
    if (!clinic) { msg('اكتب اسم العيادة.', 'err'); $('ic').focus(); return; }
    msg('بيطلع كود...');
    api('/admin/issue', { kind: 'paid', days: +$('id').value || 30, clinic: clinic, phone: $('ip').value, note: $('inote').value }).then(function (r) {
      if (r.status === 200 && r.json.code) {
        var out = $('issueOut');
        out.innerHTML = 'الكود: <b class="code" dir="ltr">' + esc(r.json.code) + '</b> — ' + esc(clinic) + '، ' + r.json.days + ' يوم. ' +
          '<button class="linkbtn" id="copyCode" type="button">انسخ</button>';
        show(out, true);
        $('copyCode').onclick = function () { copy(r.json.code); };
        $('ic').value = ''; $('ip').value = ''; $('inote').value = '';
        msg('الكود اتطلع.', 'good');
        loadList();
        if (me && me.role === 'owner') loadAudit();
      } else msg(errText(r.json), 'err');
    });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { msg('اتنسخ.', 'good'); }, function () { msg('ماقدرتش أنسخ. حدده بإيدك.', 'err'); });
    } else msg('انسخه بإيدك: ' + text);
  }

  function codeOp(path, body, okText) {
    var code = $('c').value.trim();
    if (!code) { msg('اكتب الكود الأول.', 'err'); $('c').focus(); return; }
    body.code = code;
    msg('...');
    api(path, body).then(function (r) {
      if (r.status === 200) { msg(okText, 'good'); loadList(); if (me && me.role === 'owner') loadAudit(); }
      else msg(errText(r.json), 'err');
    });
  }

  function download(kind) {
    var path = kind === 'csv' ? '/admin/export.csv' : '/admin/export.json';
    msg('بينزّل...');
    fetch(API + path, { headers: { authorization: 'Bearer ' + tok } }).then(function (r) {
      if (r.status !== 200) {
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t); } catch (e) { j = {}; }
          msg(errText(j), 'err');
        });
      }
      var cd = r.headers.get('content-disposition') || '';
      var m = /filename="([^"]+)"/.exec(cd);
      var name = m ? m[1] : 'maead-licences.' + (kind === 'csv' ? 'csv' : 'json');
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b);
        var a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
        msg('الملف نزل: ' + name, 'good');
        if (me && me.role === 'owner') loadAudit();
      });
    }).catch(function () { msg('مفيش اتصال.', 'err'); });
  }

  /* ---- users (owner) ---- */
  function loadUsers() {
    api('/admin/users', undefined, 'GET').then(function (r) {
      if (r.status !== 200) { $('userRows').innerHTML = '<tr><td colspan="6" class="muted">' + esc(errText(r.json)) + '</td></tr>'; return; }
      var us = r.json.users || [];
      $('userRows').innerHTML = us.map(function (u) {
        var self = me && u.id === me.id;
        return '<tr data-id="' + esc(u.id) + '"><td class="code">' + esc(u.username) + (self ? ' <span class="muted">(انت)</span>' : '') + '</td><td>' +
          esc(u.name || '-') + '</td><td>' + '<select data-act="role"' + (self ? ' disabled' : '') + '>' +
          '<option value="staff"' + (u.role === 'staff' ? ' selected' : '') + '>موظف</option>' +
          '<option value="owner"' + (u.role === 'owner' ? ' selected' : '') + '>مالك</option></select>' +
          '</td><td>' + (u.status === 'active' ? '<span class="pill st st-active">شغال</span>' : '<span class="pill st st-revoked">موقوف</span>') +
          '</td><td>' + esc(cairo(u.last_login_at)) + '</td><td>' +
          '<button class="btn ghost sm" data-act="toggle" type="button"' + (self ? ' disabled' : '') + '>' +
          (u.status === 'active' ? 'إيقاف' : 'تشغيل') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">مفيش مستخدمين.</td></tr>';
    });
  }

  function userUpdate(id, body) {
    api('/admin/users/update', Object.assign({ id: id }, body)).then(function (r) {
      if (r.status === 200) { msg('اتحدث.', 'good'); loadUsers(); loadAudit(); }
      else { msg(errText(r.json), 'err'); loadUsers(); }
    });
  }

  function addUser() {
    var u = $('nu').value.trim(), n = $('nn').value.trim(), role = $('nr').value, p = $('np').value;
    if (!u || !p) { msg('اسم المستخدم وكلمة السر مطلوبين.', 'err'); return; }
    api('/admin/users/create', { username: u, name: n, role: role, password: p }).then(function (r) {
      if (r.status === 200) {
        $('nu').value = ''; $('nn').value = ''; $('np').value = '';
        msg('المستخدم اتضاف. سلّمه كلمة السر المؤقتة وخلّيه يغيّرها.', 'good');
        loadUsers(); loadAudit();
      } else msg(errText(r.json), 'err');
    });
  }

  function resetPass() {
    var u = $('rsu').value.trim(), p = $('rsp').value;
    if (!u || !p) { msg('اسم المستخدم وكلمة السر الجديدة مطلوبين.', 'err'); return; }
    api('/admin/users', undefined, 'GET').then(function (r) {
      var hit = (r.json.users || []).filter(function (x) { return x.username === u.toLowerCase(); })[0];
      if (!hit) { msg('مفيش مستخدم بالاسم ده.', 'err'); return; }
      api('/admin/users/password', { id: hit.id, password: p }).then(function (r2) {
        if (r2.status === 200) { $('rsp').value = ''; msg('كلمة السر اتغيرت. جلسات المستخدم ده اتقفلت.', 'good'); loadAudit(); }
        else msg(errText(r2.json), 'err');
      });
    });
  }

  function loadAudit() {
    api('/admin/audit', undefined, 'GET').then(function (r) {
      if (r.status !== 200) { $('auditRows').innerHTML = '<tr><td colspan="4" class="muted">' + esc(errText(r.json)) + '</td></tr>'; return; }
      var es = r.json.entries || [];
      var ACT = { login: 'دخول', login_fail: 'محاولة دخول غلط', logout: 'خروج', issue: 'طلع كود', extend: 'مدّد', revoke: 'الغي', unrevoke: 'رجّع', export_csv: 'نزّل CSV', export_json: 'نزّل JSON', user_create: 'ضاف مستخدم', user_update: 'عدّل مستخدم', user_password: 'غيّر كلمة سر مستخدم', password: 'غيّر كلمة سره', bootstrap: 'أنشأ المالك', recover: 'استرجع بكلمة سر' };
      $('auditRows').innerHTML = es.length ? es.map(function (e) {
        return '<tr><td>' + esc(e.when) + '</td><td class="code">' + esc(e.username || '-') + '</td><td>' + esc(ACT[e.action] || e.action) + '</td><td class="muted">' + esc(e.detail || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="muted">مفيش سجل لسه.</td></tr>';
    });
  }

  function changePass() {
    var o = $('po').value, n = $('pn').value;
    if (!o || !n) { msg('اكتب الحالية والجديدة.', 'err'); return; }
    api('/admin/password', { old: o, next: n }).then(function (r) {
      if (r.status === 200) { $('po').value = ''; $('pn').value = ''; show($('pwCard'), false); show($('pwHead'), false); msg('كلمة السر اتغيرت.', 'good'); }
      else msg(errText(r.json), 'err');
    });
  }

  /* ---- wiring ---- */
  function on(id, fn) { var el = $(id); if (el) el.onclick = fn; }
  on('loginBtn', login);
  on('setupBtn', setup);
  on('recBtn', recover);
  on('outBtn', signOut);
  on('issueBtn', issue);
  on('listBtn', loadList);
  on('csvBtn', function () { download('csv'); });
  on('jsonBtn', function () { download('json'); });
  on('extendBtn', function () { codeOp('/admin/extend', { days: +$('ed').value || 30 }, 'اتمدد.'); });
  on('revokeBtn', function () { codeOp('/admin/revoke', {}, 'الكود اتلغى.'); });
  on('unrevokeBtn', function () { codeOp('/admin/unrevoke', {}, 'الكود رجع شغال.'); });
  on('addUserBtn', addUser);
  on('rsPassBtn', resetPass);
  on('pwBtn', function () { show($('pwCard'), $('pwCard').hidden); show($('pwHead'), $('pwCard').hidden); });
  on('pwSave', changePass);
  ['lu', 'lp'].forEach(function (id) {
    var el = $(id); if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  });
  var rows = $('userRows');
  if (rows) {
    rows.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="toggle"]'); if (!b || b.disabled) return;
      var tr = b.closest('tr'); var id = tr.getAttribute('data-id');
      var active = b.textContent.indexOf('إيقاف') === 0;
      userUpdate(id, { status: active ? 'disabled' : 'active' });
    });
    rows.addEventListener('change', function (e) {
      var s = e.target.closest('[data-act="role"]'); if (!s) return;
      var tr = s.closest('tr'); var id = tr.getAttribute('data-id');
      userUpdate(id, { role: s.value });
    });
  }

  boot();
})();
