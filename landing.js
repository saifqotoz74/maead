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

  var num = (window.MAEAD_CONFIG || {}).whatsapp || '';
  var form = $('req'), note = $('q-note');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!num) { note.textContent = 'رقم التواصل لسه متحطش في config.js قبل النشر.'; return; }
    var msg = 'أهلاً، عايز أجهّز ميعاد لعيادتي.\nالاسم: ' + $('q-n').value + '\nالعيادة: ' + $('q-c').value + '\nالمواعيد دلوقتي: ' + $('q-t').value;
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  });
})();
