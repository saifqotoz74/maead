/* Maead clinic accounts. Talks to the licence server for login and for the clinic's day.
   The day is still kept on the device first, so the tool keeps working with no internet. */
(function (root) {
  'use strict';
  var CFG = root.MAEAD_CONFIG || {};
  var BASE = (CFG.clinicApi || '').replace(/\/+$/, '');
  var SKEY = 'maead.session.v1';

  function readSession() {
    try { return JSON.parse(root.localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; }
  }
  function writeSession(s) {
    try { if (s) root.localStorage.setItem(SKEY, JSON.stringify(s)); else root.localStorage.removeItem(SKEY); } catch (e) { /* private mode */ }
  }

  var session = readSession();

  function call(path, opts) {
    opts = opts || {};
    var h = { 'content-type': 'application/json' };
    if (opts.token) h.authorization = 'Bearer ' + opts.token;
    return root.fetch(BASE + path, {
      method: opts.method || (opts.body === undefined ? 'GET' : 'POST'),
      headers: h,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j = j || {};
        j.http = r.status;
        return j;
      });
    }, function () {
      return { error: 'offline', http: 0 };
    });
  }

  function token() { return (session && session.token) || ''; }

  function save(j) {
    session = { token: j.token, user: j.user, expires_at: j.expires_at };
    writeSession(session);
    return session;
  }

  var api = {
    enabled: function () { return !!BASE; },
    session: function () { return session; },
    user: function () { return session && session.user; },
    token: token,

    register: function (clinic, phone, code, username, password, name) {
      return call('/clinic/register', { body: { clinic: clinic, phone: phone, code: code, username: username, password: password, name: name } })
        .then(function (j) { if (j.ok && j.token) save(j); return j; });
    },

    login: function (username, password) {
      return call('/clinic/login', { body: { username: username, password: password } })
        .then(function (j) { if (j.ok && j.token) save(j); return j; });
    },

    logout: function () {
      var t = token();
      session = null;
      writeSession(null);
      if (!t) return Promise.resolve({ ok: true });
      return call('/clinic/logout', { token: t, body: {} });
    },

    me: function () { return call('/clinic/me', { token: token() }); },

    pull: function () { return call('/clinic/state', { token: token() }); },

    push: function (doc, rev) {
      return call('/clinic/state', { token: token(), body: { rev: rev, doc: doc } });
    },

    password: function (oldPass, next) {
      return call('/clinic/password', { token: token(), body: { old: oldPass, new: next } });
    },

    addUser: function (username, name, password, role) {
      return call('/clinic/users', { token: token(), body: { username: username, name: name, password: password, role: role } });
    },

    users: function () { return call('/clinic/users', { token: token() }); },

    wipe: function () { return call('/clinic/wipe', { token: token(), body: {} }); },

    /* 401 means the session died: drop it so the UI can ask for a login again. */
    dropIfDead: function (j) {
      if (j && j.http === 401) { session = null; writeSession(null); }
      return j;
    }
  };

  root.Clinic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
