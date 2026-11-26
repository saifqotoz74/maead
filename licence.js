/* Maead licence client. Only a clinic name, phone and licence code go to the server. No patient data. */
(function () {
  var CFG = window.MAEAD_CONFIG || {};
  var KEY = 'maead.licence.v1';
  var GRACE = 7 * 86400; // seconds an offline device keeps working after the last good check
  var st = null, pub = null, listeners = [];

  function nowS() { return Math.floor(Date.now() / 1000); }
  function enabled() { return !!CFG.licenceApi; }
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write() { try { if (st) localStorage.setItem(KEY, JSON.stringify(st)); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }
  function b64uToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

  function verify(token) {
    if (!token || !window.crypto || !crypto.subtle || !CFG.licencePubKey) return Promise.resolve(null);
    var parts = String(token).split('.'); if (parts.length !== 2) return Promise.resolve(null);
    var p = pub || (pub = crypto.subtle.importKey('jwk', CFG.licencePubKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    return p.then(function (k) {
      return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64uToBytes(parts[1]), new TextEncoder().encode(parts[0]));
    }).then(function (ok) {
      if (!ok) return null;
      try { return JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0]))); } catch (e) { return null; }
    }).catch(function () { return null; });
  }

  // View of the licence for the UI. Computed from the saved, signature-checked token.
  // state: off | none | active | grace | expired | revoked | unknown
  function view() {
    if (!enabled()) return { state: 'off', locked: false };
    if (!st || !st.code) return { state: 'none', locked: true };
    if (st.lock) return { state: st.lock, locked: true, code: st.code };
    if (!st.payload) return { state: 'unverified', locked: true, code: st.code };
    var t = nowS(), exp = st.payload.e, checked = st.checkedAt || 0;
    if (t >= exp) return { state: 'expired', locked: true, code: st.code, kind: st.payload.k, expires: exp };
    var left = Math.ceil((exp - t) / 86400);
    if (t - checked > GRACE) return { state: 'stale', locked: true, code: st.code, kind: st.payload.k, expires: exp, left: left };
    var offline = t - checked > 2 * 86400;
    return { state: offline ? 'grace' : 'active', locked: false, code: st.code, kind: st.payload.k, expires: exp, left: left, graceLeft: Math.max(0, Math.ceil((GRACE - (t - checked)) / 86400)) };
  }
  function emit() { listeners.forEach(function (f) { try { f(view()); } catch (e) { /* ui error */ } }); }

  function call(path, body) {
    return fetch(CFG.licenceApi + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._http = r.status; return j; }); });
  }

  // Apply a /status or /trial reply. Returns a promise of the view.
  function apply(code, j) {
    if (j.status === 'revoked' || j.status === 'expired' || j.status === 'unknown_code') {
      st = { code: code, lock: j.status === 'unknown_code' ? 'unknown' : j.status, checkedAt: nowS() }; write(); emit(); return Promise.resolve(view());
    }
    if (j.status === 'active' && j.token) {
      return verify(j.token).then(function (payload) {
        if (!payload || payload.c !== code) { st = { code: code, lock: 'unverified', checkedAt: nowS() }; }
        else { st = { code: code, token: j.token, payload: payload, checkedAt: nowS() }; }
        write(); emit(); return view();
      });
    }
    return Promise.resolve(view());
  }

  function check() { // refresh in the background; network errors keep the saved state (grace)
    if (!enabled() || !st || !st.code) return Promise.resolve(view());
    var code = st.code;
    return call('/status', { code: code }).then(function (j) { return apply(code, j); }).catch(function () { emit(); return view(); });
  }
  function activate(code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length < 6) return Promise.resolve({ error: 'bad_code' });
    return call('/status', { code: code }).then(function (j) {
      if (j.status === 'unknown_code') return { error: 'unknown_code' };
      return apply(code, j).then(function (v) { return j.status === 'revoked' ? { error: 'revoked' } : j.status === 'expired' ? { error: 'expired' } : { ok: true, view: v }; });
    }).catch(function () { return { error: 'network' }; });
  }
  function startTrial(clinic, phone) {
    return call('/trial', { clinic: clinic, phone: phone }).then(function (j) {
            if (j.error) return { error: j.error };
      return apply(j.code, j).then(function (v) { return { ok: true, view: v, code: j.code }; });
    }).catch(function () { return { error: 'network' }; });
  }
  function clear() { st = null; write(); emit(); }
  function onChange(f) { listeners.push(f); }
  function init() { st = read(); if (st && st.token && !st.lock) { return verify(st.token).then(function (p) { if (!p) { st.payload = null; } else { st.payload = p; } emit(); check(); }); } emit(); if (st && st.code) check(); return Promise.resolve(); }

  window.MaeadLicence = { enabled: enabled, view: view, init: init, check: check, activate: activate, startTrial: startTrial, clear: clear, onChange: onChange };
})();
