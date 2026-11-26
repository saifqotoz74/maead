(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function calc() {
    var v = +$('c-v').value || 0, d = +$('c-d').value || 0, n = Math.min(100, Math.max(0, +$('c-n').value || 0)) / 100, f = +$('c-f').value || 0, r = +$('c-r').value / 100;
    $('c-rv').textContent = Math.round(r * 100);
    var miss = v * d * n, lost = miss * f, back = lost * r;
    $('o-miss').textContent = fmt(miss); $('o-lost').textContent = fmt(lost); $('o-back').textContent = fmt(back);
    var net = back - 250;
    $('o-net').textContent = (net < 0 ? '-' : '') + fmt(Math.abs(net));
    $('o-net').className = 'num ' + (net >= 0 ? 'pos' : 'neg');
  }
  ['c-v', 'c-d', 'c-n', 'c-f', 'c-r'].forEach(function (id) { $(id).addEventListener('input', calc); });
  calc();

  /* ?src=name on the link only adds a line to the message the visitor sends, so we know which post brought them. No cookies, no tracker. */
  function srcLine() {
    var m = /[?&]src=([\w-]{1,24})/.exec(location.search);
    return m ? '\nجاي من: ' + m[1] : '';
  }
  var num = (window.MAEAD_CONFIG || {}).whatsapp || '';
  var form = $('req'), note = $('q-note');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!$('q-n').value.trim() || !$('q-c').value.trim()) { note.textContent = 'اكتب اسمك واسم العيادة الأول.'; ($('q-n').value.trim() ? $('q-c') : $('q-n')).focus(); return; }
    note.textContent = '';
    var msg = 'أهلاً، عايز أجهّز ميعاد لعيادتي.\nالاسم: ' + $('q-n').value + '\nالعيادة: ' + $('q-c').value + '\nالمواعيد دلوقتي: ' + $('q-t').value + srcLine();
    if (!num) {
      note.innerHTML = '<b>رقم الدعم لسه مش متاح، ومحدش هيستلم الطلب ده.</b> الأداة نفسها شغالة ومجانية: <a href="app.html#demo">جرّبها دلوقتي</a>. ولو عايز تحتفظ بالطلب، انسخه من هنا:<textarea id="q-copy" rows="4" readonly></textarea><button type="button" class="btn ghost small" id="q-copybtn">انسخ الطلب</button> <span id="q-copied" role="status"></span>';
      $('q-copy').value = msg;
      $('q-copybtn').onclick = function () {
        var t = $('q-copy'); t.select();
        var done = function () { $('q-copied').textContent = 'اتنسخ.'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(done, function () { document.execCommand('copy'); done(); });
        else { document.execCommand('copy'); done(); }
      };
      return;
    }
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  });
})();
