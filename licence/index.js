// Maead licence server. Holds licence records and staff accounts only. No patient data ever reaches this server.
// Storage: Cloudflare D1. Secret: ADMIN_KEY (bootstrap of the first owner + break-glass recovery only).
// Optional vars: TRIAL_DAYS, TRIAL_DAILY_CAP, ALLOWED_ORIGINS, ALLOW_LOCAL.
//
// Accounts: users table with roles owner | staff. Login returns a session token (12h). Every /admin/* call
// carries `Authorization: Bearer <session token>`; ADMIN_KEY is no longer accepted as a session.
const DAY = 86400;
const SESSION_TTL = 12 * 3600;
const MIN_PASS = 12;
// PBKDF2 cost is capped by the Workers free plan (10 ms CPU per request). 40k iterations is ~4 ms here.
const PBKDF2_ITER = 40000;
const LOGIN_FAIL_LIMIT = 8;
const LOGIN_FAIL_WINDOW = 900;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const te = new TextEncoder();

const b64u = (buf) => { let s = ''; const b = new Uint8Array(buf); for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const now = () => Math.floor(Date.now() / 1000);
const hex = (buf) => { let s = ''; const b = new Uint8Array(buf); for (const x of b) s += x.toString(16).padStart(2, '0'); return s; };
const unhex = (s) => { const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16); return out; };
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
function eqHex(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

function origins(env) {
  return (env.ALLOWED_ORIGINS || 'https://maead.pages.dev').split(',').map((s) => s.trim()).filter(Boolean);
}
function corsHeaders(req, env) {
  const o = req.headers.get('Origin') || '';
  const ok = origins(env).includes(o) || (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) && env.ALLOW_LOCAL === '1');
  const h = { 'Vary': 'Origin' };
  if (ok) { h['Access-Control-Allow-Origin'] = o; h['Access-Control-Allow-Headers'] = 'content-type, authorization'; h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'; h['Access-Control-Max-Age'] = '86400'; }
  return h;
}
function json(obj, status, req, env) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, corsHeaders(req, env)) });
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS licences (code TEXT PRIMARY KEY, kind TEXT NOT NULL, clinic TEXT, phone TEXT, note TEXT, days INTEGER NOT NULL, started_at INTEGER, expires_at INTEGER, status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS licences_trial_phone ON licences(phone) WHERE kind = \'trial\' AND phone IS NOT NULL'),
    db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, role TEXT NOT NULL DEFAULT \'staff\', pass_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL, last_login_at INTEGER, fail_count INTEGER NOT NULL DEFAULT 0, fail_at INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, ua TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id TEXT, username TEXT, action TEXT NOT NULL, detail TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS clinics (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, code TEXT UNIQUE, status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL, created_by TEXT, note TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS clinic_users (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, role TEXT NOT NULL DEFAULT \'staff\', pass_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL, last_login_at INTEGER, fail_count INTEGER NOT NULL DEFAULT 0, fail_at INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS clinic_users_clinic ON clinic_users(clinic_id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS clinic_state (clinic_id TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 1, doc TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS clinic_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, clinic_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, ua TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS clinic_sessions_clinic ON clinic_sessions(clinic_id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS clinic_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, clinic_id TEXT, user_id TEXT, username TEXT, action TEXT NOT NULL, detail TEXT)'),
  ]);
  try { await db.prepare('ALTER TABLE licences ADD COLUMN issued_by TEXT').run(); } catch (e) { /* already there */ }
  schemaReady = true;
}

// ---- passwords -------------------------------------------------------------------------------------
async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iter }, key, 256);
  return hex(bits);
}
async function hashPassword(p) {
  const salt = randHex(16);
  return 'pbkdf2$' + PBKDF2_ITER + '$' + salt + '$' + (await pbkdf2(p, salt, PBKDF2_ITER));
}
async function checkPassword(p, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10) || 0;
  if (iter < 1000 || iter > 1000000) return false;
  return eqHex(await pbkdf2(p, parts[2], iter), parts[3]);
}
const DUMMY_HASH = 'pbkdf2$' + PBKDF2_ITER + '$' + '00112233445566778899aabbccddeeff' + '$' + '0'.repeat(64);

// ---- sessions --------------------------------------------------------------------------------------
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
const sha256Hex = async (s) => hex(await crypto.subtle.digest('SHA-256', te.encode(s)));

async function newSession(db, user, req, t) {
  const token = randHex(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)')
    .bind(await sha256Hex(token), user.id, t, t + SESSION_TTL, (req.headers.get('cf-connecting-ip') || '').slice(0, 45), (req.headers.get('user-agent') || '').slice(0, 160)).run();
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t).run();
  return token;
}
async function sessionUser(req, db, t) {
  const tok = bearer(req);
  if (!tok || tok.length < 32) return null;
  const row = await db.prepare('SELECT s.expires_at, u.id, u.username, u.name, u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(await sha256Hex(tok)).first();
  if (!row || row.expires_at <= t || row.status !== 'active') return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}
async function audit(db, user, action, detail) {
  try {
    await db.prepare('INSERT INTO audit (at, user_id, username, action, detail) VALUES (?,?,?,?,?)')
      .bind(now(), (user && user.id) || null, (user && user.username) || null, action, String(detail == null ? '' : detail).slice(0, 300)).run();
  } catch (e) { /* logging must never break the action */ }
}
const isOwner = (u) => !!u && u.role === 'owner';
function userView(r) {
  return { id: r.id, username: r.username, name: r.name, role: r.role, status: r.status, created_at: r.created_at, last_login_at: r.last_login_at };
}
function validUsername(s) { return /^[a-z0-9][a-z0-9._-]{2,23}$/.test(String(s || '').toLowerCase()); }
function validPassword(s) { return typeof s === 'string' && s.length >= MIN_PASS && s.length <= 200; }

function adminKeyOk(req, env) {
  const key = bearer(req);
  if (!env.ADMIN_KEY || key.length < 16) return false;
  const a = te.encode(key), b = te.encode(env.ADMIN_KEY);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

// ---- licences --------------------------------------------------------------------------------------
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  let s = ''; for (const x of r) s += ALPHABET[x % ALPHABET.length];
  return 'MD-' + s.slice(0, 4) + '-' + s.slice(4);
}
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MD/, ''); }
function fmtCode(norm) { return 'MD-' + norm.slice(0, 4) + '-' + norm.slice(4); }
function normPhone(p) {
  let d = String(p || '').replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[^\d]/g, '').replace(/\.0+$/, '');
  if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d[0] === '1') d = '0' + d;
  return /^01[0125]\d{8}$/.test(d) ? d : '';
}
function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n || 80); }

function view(r, t) {
  const status = r.status === 'revoked' ? 'revoked' : (r.expires_at && r.expires_at <= t ? 'expired' : 'active');
  return { code: r.code, kind: r.kind, clinic: r.clinic, phone: r.phone, note: r.note, days: r.days, started_at: r.started_at, expires_at: r.expires_at, status, created_at: r.created_at, issued_by: r.issued_by || null };
}
async function findByCode(db, raw) {
  const n = normCode(raw);
  if (n.length !== 8) return null;
  return db.prepare('SELECT * FROM licences WHERE code = ?').bind(fmtCode(n)).first();
}

async function statusFor(db, row, t) {
  if (row.status === 'revoked') return { status: 'revoked' };
  if (!row.started_at) { // paid code starts on first use
    const exp = t + row.days * DAY;
    await db.prepare('UPDATE licences SET started_at = ?, expires_at = ? WHERE code = ? AND started_at IS NULL').bind(t, exp, row.code).run();
    row = await db.prepare('SELECT * FROM licences WHERE code = ?').bind(row.code).first();
  }
  if (row.expires_at <= t) return { status: 'expired', kind: row.kind, expires_at: row.expires_at };
  const token = await signToken(db, { c: row.code, k: row.kind, e: row.expires_at, i: t });
  return { status: 'active', kind: row.kind, expires_at: row.expires_at, server_time: t, token };
}

// ---- licence signing key ---------------------------------------------------------------------------
// ECDSA P-256 signing key, generated on first use and kept in D1. Public half is published at /pubkey.
let keyCache = null;
async function getKeys(db) {
  if (keyCache) return keyCache;
  let row = await db.prepare('SELECT v FROM kv WHERE k = \'signing_jwk\'').first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    await db.prepare('INSERT OR IGNORE INTO kv (k, v) VALUES (\'signing_jwk\', ?)').bind(JSON.stringify(priv)).run();
    row = await db.prepare('SELECT v FROM kv WHERE k = \'signing_jwk\'').first();
  }
  const privJwk = JSON.parse(row.v);
  const priv = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const pub = { kty: 'EC', crv: 'P-256', x: privJwk.x, y: privJwk.y, ext: true, key_ops: ['verify'] };
  keyCache = { priv, pub };
  return keyCache;
}
async function signToken(db, payload) {
  const { priv } = await getKeys(db);
  const body = b64u(te.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, te.encode(body));
  return body + '.' + b64u(sig);
}

// ---- CSV export ------------------------------------------------------------------------------------
const cairoParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
function cairo(sec) {
  if (!sec) return '';
  const p = {};
  for (const x of cairoParts.formatToParts(new Date(sec * 1000))) p[x.type] = x.value;
  return p.year + '-' + p.month + '-' + p.day + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
}
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s; // no formula injection into Excel
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function licencesCsv(rows, t) {
  const head = ['الكود', 'الحالة', 'النوع', 'العيادة', 'الموبايل', 'الأيام', 'البداية', 'النهاية', 'اتعمل', 'اطلعه', 'ملاحظة'];
  const out = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const v = view(r, t);
    const kind = v.kind === 'trial' ? 'تجربة' : 'مدفوع';
    const st = v.status === 'active' ? 'شغال' : v.status === 'revoked' ? 'ملغي' : 'خلص';
    out.push([v.code, st, kind, v.clinic, v.phone, v.days, cairo(v.started_at), cairo(v.expires_at), cairo(v.created_at), v.issued_by, v.note].map(csvCell).join(','));
  }
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}

// ---- auth endpoints --------------------------------------------------------------------------------
async function handleBootstrap(req, env, t) {
  if (!adminKeyOk(req, env)) return json({ error: 'bad_key' }, 401, req, env);
  const db = env.DB;
  const n = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (n.n > 0) return json({ error: 'already_setup' }, 409, req, env);
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').toLowerCase().trim();
  if (!validUsername(username)) return json({ error: 'bad_username' }, 400, req, env);
  if (!validPassword(b.password)) return json({ error: 'weak_password', min: MIN_PASS }, 400, req, env);
  const user = { id: 'u-' + randHex(8), username, name: clean(b.name, 60) || username, role: 'owner' };
  await db.prepare('INSERT INTO users (id, username, name, role, pass_hash, status, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(user.id, user.username, user.name, user.role, await hashPassword(b.password), 'active', t).run();
  const token = await newSession(db, user, req, t);
  await audit(db, user, 'bootstrap', 'first owner account');
  return json({ ok: true, token, user, expires_at: t + SESSION_TTL }, 200, req, env);
}

async function handleRecover(req, env, t) {
  if (!adminKeyOk(req, env)) return json({ error: 'bad_key' }, 401, req, env);
  const db = env.DB;
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').toLowerCase().trim();
  if (!validPassword(b.password)) return json({ error: 'weak_password', min: MIN_PASS }, 400, req, env);
  const u = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!u || u.role !== 'owner') return json({ error: 'not_owner' }, 404, req, env);
  await db.prepare('UPDATE users SET pass_hash = ?, status = \'active\', fail_count = 0, fail_at = NULL WHERE id = ?').bind(await hashPassword(b.password), u.id).run();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
  await audit(db, { id: u.id, username: u.username }, 'recover', 'password reset with the admin key');
  return json({ ok: true, username: u.username }, 200, req, env);
}

async function handleLogin(req, env, t) {
  const db = env.DB;
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').toLowerCase().trim();
  const password = typeof b.password === 'string' ? b.password : '';
  if (!username || !password) return json({ error: 'bad_input' }, 400, req, env);
  const u = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (u && u.fail_at && t - u.fail_at < LOGIN_FAIL_WINDOW && u.fail_count >= LOGIN_FAIL_LIMIT) {
    return json({ error: 'locked', retry_after: LOGIN_FAIL_WINDOW - (t - u.fail_at) }, 429, req, env);
  }
  const ok = u ? await checkPassword(password, u.pass_hash) : (await checkPassword(password, DUMMY_HASH), false);
  if (!ok) {
    if (u) {
      await db.prepare('UPDATE users SET fail_count = CASE WHEN ? - COALESCE(fail_at, 0) < ? THEN fail_count + 1 ELSE 1 END, fail_at = ? WHERE id = ?')
        .bind(t, LOGIN_FAIL_WINDOW, t, u.id).run();
      await audit(db, { id: u.id, username: u.username }, 'login_fail', 'wrong password');
    }
    return json({ error: 'bad_login' }, 401, req, env);
  }
  if (u.status !== 'active') return json({ error: 'disabled' }, 403, req, env);
  const user = { id: u.id, username: u.username, name: u.name, role: u.role };
  const token = await newSession(db, user, req, t);
  await db.prepare('UPDATE users SET fail_count = 0, fail_at = NULL, last_login_at = ? WHERE id = ?').bind(t, u.id).run();
  await audit(db, user, 'login', (req.headers.get('cf-connecting-ip') || '').slice(0, 45));
  return json({ ok: true, token, user, expires_at: t + SESSION_TTL }, 200, req, env);
}

// ---- admin endpoints (session required) ------------------------------------------------------------
async function handleAdmin(req, env, p, user, t) {
  const db = env.DB;
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  if (p === '/admin/logout') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(bearer(req))).run();
    await audit(db, user, 'logout', '');
    return json({ ok: true }, 200, req, env);
  }
  if (p === '/admin/me') return json({ ok: true, user, expires_at: t + SESSION_TTL }, 200, req, env);

  if (p === '/admin/password') {
    const old = typeof b.old === 'string' ? b.old : '';
    const next = typeof b.next === 'string' ? b.next : '';
    if (!validPassword(next)) return json({ error: 'weak_password', min: MIN_PASS }, 400, req, env);
    const row = await db.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(user.id).first();
    if (!row || !(await checkPassword(old, row.pass_hash))) return json({ error: 'bad_old' }, 401, req, env);
    await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(next), user.id).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(user.id, await sha256Hex(bearer(req))).run();
    await audit(db, user, 'password', 'changed own password');
    return json({ ok: true }, 200, req, env);
  }

  // licences: staff can look, export and issue; only an owner can extend or revoke.
  if (p === '/admin/issue') {
    const days = Math.max(1, Math.min(400, parseInt(b.days, 10) || 30));
    const kind = b.kind === 'trial' ? 'trial' : 'paid';
    const phone = normPhone(b.phone) || null;
    let code, tries = 0;
    for (;;) {
      code = newCode();
      try {
        await db.prepare('INSERT INTO licences (code, kind, clinic, phone, note, days, created_at, issued_by) VALUES (?,?,?,?,?,?,?,?)')
          .bind(code, kind, clean(b.clinic), phone, clean(b.note, 200), days, t, user.username).run();
        break;
      } catch (e) { if (++tries > 4 || /licences_trial_phone|phone/.test(String(e))) throw e; }
    }
    await audit(db, user, 'issue', code + ' ' + clean(b.clinic, 60));
    return json({ ok: true, code, days, kind }, 200, req, env);
  }
  if (p === '/admin/list') {
    const rs = await db.prepare('SELECT * FROM licences ORDER BY created_at DESC LIMIT 200').all();
    return json({ ok: true, now: t, licences: rs.results.map((r) => view(r, t)) }, 200, req, env);
  }
  if (p === '/admin/export.csv') {
    const rs = await db.prepare('SELECT * FROM licences ORDER BY created_at DESC LIMIT 5000').all();
    await audit(db, user, 'export_csv', rs.results.length + ' rows');
    const d = cairo(t).slice(0, 10);
    return new Response(licencesCsv(rs.results, t), {
      status: 200,
      headers: Object.assign({
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="maead-licences-' + d + '.csv"',
        'cache-control': 'no-store',
      }, corsHeaders(req, env)),
    });
  }
  if (p === '/admin/export.json') {
    const rs = await db.prepare('SELECT * FROM licences ORDER BY created_at DESC LIMIT 5000').all();
    await audit(db, user, 'export_json', rs.results.length + ' rows');
    return json({ ok: true, exported_at: cairo(t), now: t, licences: rs.results.map((r) => view(r, t)) }, 200, req, env);
  }
  if (p === '/admin/extend' || p === '/admin/revoke' || p === '/admin/unrevoke') {
    if (!isOwner(user)) return json({ error: 'forbidden' }, 403, req, env);
    const row = await findByCode(db, b.code);
    if (!row) return json({ error: 'unknown_code' }, 404, req, env);
    if (p === '/admin/extend') {
      const days = Math.max(1, Math.min(400, parseInt(b.days, 10) || 30));
      if (!row.started_at) await db.prepare('UPDATE licences SET days = days + ? WHERE code = ?').bind(days, row.code).run();
      else await db.prepare('UPDATE licences SET expires_at = MAX(expires_at, ?) + ?, kind = CASE WHEN kind = \'trial\' THEN \'paid\' ELSE kind END WHERE code = ?').bind(t, days * DAY, row.code).run();
      await audit(db, user, 'extend', row.code + ' +' + days + 'd');
    } else {
      await db.prepare('UPDATE licences SET status = ? WHERE code = ?').bind(p === '/admin/revoke' ? 'revoked' : 'active', row.code).run();
      await audit(db, user, p === '/admin/revoke' ? 'revoke' : 'unrevoke', row.code);
    }
    const r2 = await db.prepare('SELECT * FROM licences WHERE code = ?').bind(row.code).first();
    return json({ ok: true, licence: view(r2, t) }, 200, req, env);
  }

  // accounts: owner only
  if (p.startsWith('/admin/users')) {
    if (!isOwner(user)) return json({ error: 'forbidden' }, 403, req, env);
    if (p === '/admin/users' && req.method === 'GET') {
      const rs = await db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
      return json({ ok: true, users: rs.results.map(userView) }, 200, req, env);
    }
    if (p === '/admin/users/create') {
      const username = String(b.username || '').toLowerCase().trim();
      if (!validUsername(username)) return json({ error: 'bad_username' }, 400, req, env);
      if (!validPassword(b.password)) return json({ error: 'weak_password', min: MIN_PASS }, 400, req, env);
      const role = b.role === 'owner' ? 'owner' : 'staff';
      const id = 'u-' + randHex(8);
      try {
        await db.prepare('INSERT INTO users (id, username, name, role, pass_hash, status, created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(id, username, clean(b.name, 60) || username, role, await hashPassword(b.password), 'active', t).run();
      } catch (e) {
        return json({ error: /UNIQUE|unique/i.test(String(e)) ? 'username_taken' : 'server_error' }, 409, req, env);
      }
      await audit(db, user, 'user_create', username + ' (' + role + ')');
      const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      return json({ ok: true, user: userView(row) }, 200, req, env);
    }
    if (p === '/admin/users/update') {
      const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(String(b.id || '')).first();
      if (!target) return json({ error: 'not_found' }, 404, req, env);
      const role = b.role === 'owner' || b.role === 'staff' ? b.role : target.role;
      const status = b.status === 'active' || b.status === 'disabled' ? b.status : target.status;
      if (target.id === user.id && (role !== target.role || status !== 'active')) return json({ error: 'self_lockout' }, 400, req, env);
      if (target.role === 'owner' && (role !== 'owner' || status !== 'active')) {
        const owners = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = \'owner\' AND status = \'active\'').first();
        if (owners.n <= 1) return json({ error: 'last_owner' }, 400, req, env);
      }
      await db.prepare('UPDATE users SET role = ?, status = ?, name = ? WHERE id = ?')
        .bind(role, status, clean(b.name, 60) || target.name, target.id).run();
      if (status !== 'active') await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
      await audit(db, user, 'user_update', target.username + ' role=' + role + ' status=' + status);
      const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(target.id).first();
      return json({ ok: true, user: userView(row) }, 200, req, env);
    }
    if (p === '/admin/users/password') {
      const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(String(b.id || '')).first();
      if (!target) return json({ error: 'not_found' }, 404, req, env);
      if (!validPassword(b.password)) return json({ error: 'weak_password', min: MIN_PASS }, 400, req, env);
      await db.prepare('UPDATE users SET pass_hash = ?, fail_count = 0, fail_at = NULL WHERE id = ?').bind(await hashPassword(b.password), target.id).run();
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
      await audit(db, user, 'user_password', target.username);
      return json({ ok: true }, 200, req, env);
    }
    return json({ error: 'not_found' }, 404, req, env);
  }

  if (p === '/admin/audit' && req.method === 'GET') {
    if (!isOwner(user)) return json({ error: 'forbidden' }, 403, req, env);
    const rs = await db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all();
    return json({ ok: true, entries: rs.results.map((r) => ({ at: r.at, when: cairo(r.at), username: r.username, action: r.action, detail: r.detail })) }, 200, req, env);
  }

  return json({ error: 'not_found' }, 404, req, env);
}

// ---- public licence endpoints ----------------------------------------------------------------------
// ---- clinic accounts + patient data -----------------------------------------------------------------
// A clinic owns one state document (the pasted table, template, fee, per-row send marks) so a secretary
// on one device and the owner on another see the same day. Every row is scoped by clinic_id.
const DOC_MAX = 500000;

async function newClinicSession(db, u, req, t) {
  const token = randHex(32);
  await db.prepare('INSERT INTO clinic_sessions (token_hash, user_id, clinic_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)')
    .bind(await sha256Hex(token), u.id, u.clinic_id, t, t + SESSION_TTL, (req.headers.get('cf-connecting-ip') || '').slice(0, 45), (req.headers.get('user-agent') || '').slice(0, 160)).run();
  await db.prepare('DELETE FROM clinic_sessions WHERE expires_at < ?').bind(t).run();
  return token;
}
async function clinicUser(req, db, t) {
  const tok = bearer(req);
  if (!tok || tok.length < 32) return null;
  const row = await db.prepare('SELECT s.expires_at, u.id, u.clinic_id, u.username, u.name, u.role, u.status, c.name AS clinic, c.status AS clinic_status FROM clinic_sessions s JOIN clinic_users u ON u.id = s.user_id JOIN clinics c ON c.id = u.clinic_id WHERE s.token_hash = ?')
    .bind(await sha256Hex(tok)).first();
  if (!row || row.expires_at <= t || row.status !== 'active' || row.clinic_status !== 'active') return null;
  return { id: row.id, clinic_id: row.clinic_id, username: row.username, name: row.name, role: row.role, clinic: row.clinic };
}
async function clinicAudit(db, u, action, detail) {
  try {
    await db.prepare('INSERT INTO clinic_audit (at, clinic_id, user_id, username, action, detail) VALUES (?,?,?,?,?,?)')
      .bind(now(), u.clinic_id, u.id, u.username, action, String(detail == null ? '' : detail).slice(0, 300)).run();
  } catch (e) { /* logging must never break the action */ }
}
function clinicUserView(r) {
  return { id: r.id, username: r.username, name: r.name, role: r.role, status: r.status, created_at: r.created_at, last_login_at: r.last_login_at };
}

async function handleClinicRegister(req, env, t) {
  const db = env.DB, b = await req.json().catch(() => ({}));
  const clinic = clean(b.clinic, 80), phone = normPhone(b.phone);
  const username = String(b.username || '').toLowerCase().trim();
  const password = typeof b.password === 'string' ? b.password : '';
  const name = clean(b.name, 60) || clinic;
  if (!clinic || !username || !validUsername(username) || !validPassword(password)) return json({ error: 'bad_input' }, 400, req, env);
  const row = await findByCode(db, b.code);
  if (!row) return json({ error: 'bad_code' }, 400, req, env);
  const st = await statusFor(db, row, t);
  if (st.status !== 'active' || st.kind !== 'paid') return json({ error: 'code_not_active' }, 403, req, env);
  const used = await db.prepare('SELECT id FROM clinics WHERE code = ?').bind(row.code).first();
  if (used) return json({ error: 'code_used' }, 409, req, env);
  const exists = await db.prepare('SELECT id FROM clinic_users WHERE username = ?').bind(username).first();
  if (exists) return json({ error: 'username_taken' }, 409, req, env);
  const id = 'cl_' + randHex(8);
  const uid = 'cu_' + randHex(8);
  try {
    await db.batch([
      db.prepare('INSERT INTO clinics (id, name, phone, code, status, created_at, created_by) VALUES (?,?,?,?,?,?,?)').bind(id, clinic, phone || null, row.code, 'active', t, 'self'),
      db.prepare('INSERT INTO clinic_users (id, clinic_id, username, name, role, pass_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(uid, id, username, name, 'owner', await hashPassword(password), 'active', t),
      db.prepare('INSERT INTO clinic_state (clinic_id, rev, doc, updated_at, updated_by) VALUES (?,?,?,?,?)').bind(id, 1, '{}', t, uid),
    ]);
  } catch (e) {
    if (/UNIQUE/.test(String(e))) return json({ error: 'code_used' }, 409, req, env);
    throw e;
  }
  const user = { id: uid, clinic_id: id, username, name, role: 'owner', clinic };
  const token = await newClinicSession(db, user, req, t);
  await clinicAudit(db, user, 'register', clinic);
  return json({ ok: true, token, user, expires_at: t + SESSION_TTL }, 200, req, env);
}

async function handleClinicLogin(req, env, t) {
  const db = env.DB, b = await req.json().catch(() => ({}));
  const username = String(b.username || '').toLowerCase().trim();
  const password = typeof b.password === 'string' ? b.password : '';
  if (!username || !password) return json({ error: 'bad_input' }, 400, req, env);
  const u = await db.prepare('SELECT u.*, c.name AS clinic, c.status AS clinic_status FROM clinic_users u JOIN clinics c ON c.id = u.clinic_id WHERE u.username = ?').bind(username).first();
  if (u && u.fail_at && t - u.fail_at < LOGIN_FAIL_WINDOW && u.fail_count >= LOGIN_FAIL_LIMIT) {
    return json({ error: 'locked', retry_after: LOGIN_FAIL_WINDOW - (t - u.fail_at) }, 429, req, env);
  }
  const ok = u ? await checkPassword(password, u.pass_hash) : (await checkPassword(password, DUMMY_HASH), false);
  if (!ok) {
    if (u) {
      await db.prepare('UPDATE clinic_users SET fail_count = CASE WHEN ? - COALESCE(fail_at, 0) < ? THEN fail_count + 1 ELSE 1 END, fail_at = ? WHERE id = ?')
        .bind(t, LOGIN_FAIL_WINDOW, t, u.id).run();
      await clinicAudit(db, { clinic_id: u.clinic_id, id: u.id, username: u.username }, 'login_fail', 'wrong password');
    }
    return json({ error: 'bad_login' }, 401, req, env);
  }
  if (u.status !== 'active') return json({ error: 'disabled' }, 403, req, env);
  if (u.clinic_status !== 'active') return json({ error: 'clinic_disabled' }, 403, req, env);
  const user = { id: u.id, clinic_id: u.clinic_id, username: u.username, name: u.name, role: u.role, clinic: u.clinic };
  const token = await newClinicSession(db, user, req, t);
  await db.prepare('UPDATE clinic_users SET fail_count = 0, fail_at = NULL, last_login_at = ? WHERE id = ?').bind(t, u.id).run();
  await clinicAudit(db, user, 'login', (req.headers.get('cf-connecting-ip') || '').slice(0, 45));
  return json({ ok: true, token, user, expires_at: t + SESSION_TTL }, 200, req, env);
}

async function handleClinic(req, env, p, user, t) {
  const db = env.DB;
  const b = await req.json().catch(() => ({}));
  const m = req.method;

  if (p === '/clinic/me' && m === 'GET') return json({ ok: true, user }, 200, req, env);

  if (p === '/clinic/logout' && m === 'POST') {
    const tok = bearer(req);
    if (tok) await db.prepare('DELETE FROM clinic_sessions WHERE token_hash = ?').bind(await sha256Hex(tok)).run();
    return json({ ok: true }, 200, req, env);
  }

  if (p === '/clinic/state' && m === 'GET') {
    const row = await db.prepare('SELECT rev, doc, updated_at FROM clinic_state WHERE clinic_id = ?').bind(user.clinic_id).first();
    let doc = {};
    try { doc = JSON.parse((row && row.doc) || '{}'); } catch (e) { doc = {}; }
    return json({ ok: true, rev: row ? row.rev : 0, doc, updated_at: row ? row.updated_at : 0 }, 200, req, env);
  }

  if (p === '/clinic/state' && m === 'POST') {
    const doc = JSON.stringify(b.doc == null ? {} : b.doc);
    if (doc.length > DOC_MAX) return json({ error: 'too_big', max: DOC_MAX }, 413, req, env);
    const rev = Number(b.rev);
    if (!isFinite(rev) || rev < 0) return json({ error: 'bad_input' }, 400, req, env);
    const row = await db.prepare('SELECT rev, doc FROM clinic_state WHERE clinic_id = ?').bind(user.clinic_id).first();
    if (row && row.rev !== rev) {
      let serverDoc = {};
      try { serverDoc = JSON.parse(row.doc); } catch (e) { serverDoc = {}; }
      return json({ error: 'conflict', rev: row.rev, doc: serverDoc }, 409, req, env);
    }
    if (row) {
      await db.prepare('UPDATE clinic_state SET rev = rev + 1, doc = ?, updated_at = ?, updated_by = ? WHERE clinic_id = ? AND rev = ?')
        .bind(doc, t, user.id, user.clinic_id, rev).run();
    } else {
      await db.prepare('INSERT INTO clinic_state (clinic_id, rev, doc, updated_at, updated_by) VALUES (?,?,?,?,?)').bind(user.clinic_id, 1, doc, t, user.id).run();
    }
    const after = await db.prepare('SELECT rev FROM clinic_state WHERE clinic_id = ?').bind(user.clinic_id).first();
    await clinicAudit(db, user, 'state_save', 'rev ' + (after ? after.rev : '?') + ', ' + doc.length + ' bytes');
    return json({ ok: true, rev: after ? after.rev : rev + 1, updated_at: t }, 200, req, env);
  }

  if (p === '/clinic/users' && m === 'GET') {
    const rows = await db.prepare('SELECT id, username, name, role, status, created_at, last_login_at FROM clinic_users WHERE clinic_id = ? ORDER BY created_at').bind(user.clinic_id).all();
    return json({ ok: true, users: (rows.results || []).map(clinicUserView) }, 200, req, env);
  }

  if (p === '/clinic/users' && m === 'POST') {
    if (!isOwner(user)) return json({ error: 'owner_only' }, 403, req, env);
    const username = String(b.username || '').toLowerCase().trim();
    const password = typeof b.password === 'string' ? b.password : '';
    const name = clean(b.name, 60);
    const role = b.role === 'owner' ? 'owner' : 'staff';
    if (!validUsername(username) || !validPassword(password)) return json({ error: 'bad_input' }, 400, req, env);
    const exists = await db.prepare('SELECT id FROM clinic_users WHERE username = ?').bind(username).first();
    if (exists) return json({ error: 'username_taken' }, 409, req, env);
    const id = 'cu_' + randHex(8);
    await db.prepare('INSERT INTO clinic_users (id, clinic_id, username, name, role, pass_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, user.clinic_id, username, name || username, role, await hashPassword(password), 'active', t).run();
    await clinicAudit(db, user, 'user_add', username + ' (' + role + ')');
    const row = await db.prepare('SELECT id, username, name, role, status, created_at, last_login_at FROM clinic_users WHERE id = ?').bind(id).first();
    return json({ ok: true, user: clinicUserView(row) }, 200, req, env);
  }

  if (p === '/clinic/password' && m === 'POST') {
    const oldPass = typeof b.old === 'string' ? b.old : '';
    const next = typeof b.new === 'string' ? b.new : '';
    if (!validPassword(next)) return json({ error: 'bad_input' }, 400, req, env);
    const row = await db.prepare('SELECT pass_hash FROM clinic_users WHERE id = ?').bind(user.id).first();
    if (!row || !(await checkPassword(oldPass, row.pass_hash))) return json({ error: 'bad_login' }, 401, req, env);
    await db.prepare('UPDATE clinic_users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(next), user.id).run();
    await db.prepare('DELETE FROM clinic_sessions WHERE user_id = ?').bind(user.id).run();
    await clinicAudit(db, user, 'password_change', '');
    return json({ ok: true, reauth: true }, 200, req, env);
  }

  if (p === '/clinic/wipe' && m === 'POST') {
    if (!isOwner(user)) return json({ error: 'owner_only' }, 403, req, env);
    await db.prepare('UPDATE clinic_state SET rev = rev + 1, doc = ?, updated_at = ?, updated_by = ? WHERE clinic_id = ?').bind('{}', t, user.id, user.clinic_id).run();
    await clinicAudit(db, user, 'wipe', 'patient data cleared by owner');
    return json({ ok: true }, 200, req, env);
  }

  return json({ error: 'not_found' }, 404, req, env);
}

async function handlePublic(req, env, p, t) {
  const db = env.DB;
  const b = await req.json().catch(() => ({}));
  if (p === '/status') {
    const row = await findByCode(db, b.code);
    if (!row) return json({ status: 'unknown_code' }, 404, req, env);
    return json(await statusFor(db, row, t), 200, req, env);
  }
  if (p === '/trial') {
    const phone = normPhone(b.phone), clinic = clean(b.clinic);
    if (!clinic || !phone) return json({ error: 'bad_input' }, 400, req, env);
    const cap = parseInt(env.TRIAL_DAILY_CAP || '30', 10);
    const today = await db.prepare('SELECT COUNT(*) AS n FROM licences WHERE kind = \'trial\' AND created_at > ?').bind(t - DAY).first();
    if (today.n >= cap) return json({ error: 'trial_busy' }, 429, req, env);
    const days = parseInt(env.TRIAL_DAYS || '7', 10);
    let code, tries = 0;
    for (;;) {
      code = newCode();
      try {
        await db.prepare('INSERT INTO licences (code, kind, clinic, phone, days, started_at, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(code, 'trial', clinic, phone, days, t, t + days * DAY, t).run();
        break;
      } catch (e) {
        if (/licences_trial_phone|UNIQUE constraint failed: licences\.phone/.test(String(e))) return json({ error: 'trial_used' }, 409, req, env);
        if (++tries > 4) throw e;
      }
    }
    const row = await db.prepare('SELECT * FROM licences WHERE code = ?').bind(code).first();
    return json(Object.assign({ code }, await statusFor(db, row, t)), 200, req, env);
  }
  return json({ error: 'not_found' }, 404, req, env);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      await ensureSchema(env.DB);
      const p = url.pathname.replace(/\/+$/, '') || '/';
      const t = now();
      const m = req.method;

      if (m === 'GET' && p === '/health') return json({ ok: true, t, v: 3 }, 200, req, env);
      if (m === 'GET' && p === '/pubkey') return json({ jwk: (await getKeys(env.DB)).pub }, 200, req, env);

      if (p === '/admin/state' && m === 'GET') {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        return json({ ok: true, setup: n.n > 0, min_password: MIN_PASS }, 200, req, env);
      }
      if (p === '/admin/bootstrap' && m === 'POST') return handleBootstrap(req, env, t);
      if (p === '/admin/recover' && m === 'POST') return handleRecover(req, env, t);
      if (p === '/admin/login' && m === 'POST') return handleLogin(req, env, t);

      if (p === '/clinic/register' && m === 'POST') return handleClinicRegister(req, env, t);
      if (p === '/clinic/login' && m === 'POST') return handleClinicLogin(req, env, t);
      if (p.startsWith('/clinic/')) {
        const cu = await clinicUser(req, env.DB, t);
        if (!cu) return json({ error: 'unauthorized' }, 401, req, env);
        return handleClinic(req, env, p, cu, t);
      }

      if (p.startsWith('/admin/')) {
        const user = await sessionUser(req, env.DB, t);
        if (!user) return json({ error: 'unauthorized' }, 401, req, env);
        return handleAdmin(req, env, p, user, t);
      }
      if (m !== 'POST') return json({ error: 'not_found' }, 404, req, env);
      return handlePublic(req, env, p, t);
    } catch (e) {
      return json({ error: 'server_error' }, 500, req, env);
    }
  },
};
