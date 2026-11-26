// Licence gate in real Chrome over CDP, against a mock licence API that signs tokens with a real ECDSA key.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { webcrypto as crypto } from 'node:crypto';
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const b64u = b => Buffer.from(b).toString('base64url');
const DAY = 86400, nowS = () => Math.floor(Date.now() / 1000);
let mode = 'active', expAt = nowS() + 7 * DAY, signKey = kp.privateKey;
async function token(code) { const body = b64u(JSON.stringify({ c: code, k: 'trial', e: expAt, i: nowS() })); const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, new TextEncoder().encode(body)); return body + '.' + b64u(sig); }
const srv = http.createServer(async (req, res) => {
  const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  let b = ''; for await (const c of req) b += c; b = JSON.parse(b || '{}');
  if (mode === 'down') return req.socket.destroy();
  const send = (o, c = 200) => { res.writeHead(c, h); res.end(JSON.stringify(o)); };
  if (req.url === '/trial') { if (b.phone === '01000000009') return send({ error: 'trial_used' }, 409); expAt = nowS() + 7 * DAY; return send({ code: 'MD-TEST-0001', status: 'active', kind: 'trial', expires_at: expAt, token: await token('MD-TEST-0001') }); }
  if (req.url === '/status') {
    if (b.code === 'MD-NOPE-0000') return send({ status: 'unknown_code' }, 404);
    if (mode === 'revoked') return send({ status: 'revoked' });
    if (mode === 'expired') return send({ status: 'expired' });
    return send({ status: 'active', kind: 'trial', expires_at: expAt, token: await token(b.code) });
  }
  send({ error: 'not_found' }, 404);
});
await new Promise(r => srv.listen(8791, r));
const port = 9334;
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/cp-lic', 'about:blank'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'MAEAD_CONFIG',{configurable:true,set(v){v.licenceApi='http://127.0.0.1:8791';v.licencePubKey=${JSON.stringify(jwk)};this._c=v},get(){return this._c}});
const _n=Date.now.bind(Date);Date.now=()=>_n()+(+localStorage.getItem('__off')||0)*1000;` });
const load = async () => { await send('Page.navigate', { url: `file://${process.cwd()}/app.html` }); await sleep(900); };
const state = () => ev(`document.getElementById('licBox').className+'|'+document.getElementById('licBox').textContent`);
const links = () => ev(`document.querySelectorAll('#list a.wa').length`);
const offs = () => ev(`document.querySelectorAll('#list .wa.off').length`);
const paste = async () => { const d = await ev(`(()=>{const t=new Date();t.setDate(t.getDate()+1);return t.getDate()+'/'+(t.getMonth()+1)+'/'+t.getFullYear();})()`); await ev(`document.getElementById('paste').value=${JSON.stringify(`الاسم\tالموبايل\tالتاريخ\tالساعة\nمنى\t01000000001\t${d}\t5 م`)};document.getElementById('btnParse').click();`); await sleep(300); };
const setOff = d => ev(`localStorage.setItem('__off',${d * DAY})`);
await load(); await ev(`localStorage.clear()`); await load();
// 1 no licence
ok(/lock/.test(await state()), 'no licence: lock box shown');
await paste();
ok(await links() === 0 && await offs() === 1, 'no licence: real-data send links disabled');
await ev(`document.getElementById('btnSample').click()`); await sleep(300);
ok(await links() > 0, 'no licence: sample data still sendable');
await ev(`document.getElementById('btnClear').click()`); await sleep(200);
// 2 bad phone for trial used
await ev(`document.getElementById('licClinic').value='عيادة';document.getElementById('licPhone').value='01000000009';document.getElementById('licTrial').click()`); await sleep(500);
ok(/خد التجربة قبل كده/.test(await state()), 'second trial on same phone is refused with a clear message');
// 3 start trial
await ev(`document.getElementById('licClinic').value='عيادة';document.getElementById('licPhone').value='01000000002';document.getElementById('licTrial').click()`); await sleep(700);
let s = await state(); ok(/ok/.test(s) && /فاضل 7 يوم/.test(s), 'trial starts, 7 days left: ' + s.slice(0, 60));
await paste(); ok(await links() === 1, 'trial: send link enabled');
// 4 reload online keeps working
await load(); await paste(); ok(await links() === 1 && /ok/.test(await state()), 'reload online: still active');
// 5 offline grace
mode = 'down'; await setOff(3); await load(); await paste();
s = await state(); ok(await links() === 1 && /من غير اتصال/.test(s), 'offline 3 days: still works, shows offline note');
await setOff(6.5); await load(); await paste(); ok(await links() === 1, 'offline 6.5 days: works until licence end (still before day 7)');
await setOff(7.5); await load(); await paste(); s = await state(); ok(await links() === 0 && /lock/.test(s), 'offline past licence expiry: locked, not extended by grace');
// 6 grace cap vs long licence
expAt = nowS() + 30 * DAY; mode = 'active'; await setOff(0); await load(); await sleep(400); await paste();
ok(await links() === 1, 'online refresh with 30-day expiry: active');
mode = 'down'; await setOff(6.9); await load(); await paste(); ok(await links() === 1, 'offline 6.9 days on 30-day licence: still works');
await setOff(7.2); await load(); await paste(); s = await state(); ok(await links() === 0 && /النت/.test(s), 'offline 7.2 days on 30-day licence: locked until online');
mode = 'active'; await load(); await sleep(500); await paste(); ok(await links() === 1, 'coming back online unlocks again');
// 7 tamper
const tampered = await ev(`(()=>{const o=JSON.parse(localStorage.getItem('maead.licence.v1'));const [b,sg]=o.token.split('.');const p=JSON.parse(atob(b.replace(/-/g,'+').replace(/_/g,'/')));p.e+=99999999;o.token=btoa(JSON.stringify(p)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_')+'.'+sg;localStorage.setItem('maead.licence.v1',JSON.stringify(o));return 1})()`);
mode = 'down'; await load(); await paste(); ok(await links() === 0, 'tampered token (expiry edited) is rejected');
// 8 revoke
mode = 'active'; await ev(`localStorage.removeItem('maead.licence.v1')`); await load();
await ev(`document.getElementById('licCode').value='md-test-0001';document.getElementById('licAct').click()`); await sleep(600);
ok(/ok/.test(await state()), 'activating a code with the server working');
mode = 'revoked'; await load(); await sleep(500); await paste(); s = await state(); ok(await links() === 0 && /اتلغى/.test(s), 'revoked: locked right away on next check');
// 9 expired
mode = 'expired'; await load(); await sleep(500); s = await state(); ok(/خلص/.test(s), 'expired from server: locked');
// 10 unknown code
await ev(`document.getElementById('licCode').value='MD-NOPE-0000';document.getElementById('licAct').click()`); await sleep(500);
ok(/مش موجود/.test(await state()), 'unknown code message');
// 11 data survives lock
ok(await ev(`!!localStorage.getItem('maead.v1')`), 'patient data kept in browser while locked');
const net = await ev(`JSON.stringify(Object.keys(localStorage))`);
console.log(fails ? 'FAILS ' + fails : 'ALL LICENCE CHECKS PASSED');
ch.kill(); srv.close(); process.exit(fails ? 1 : 0);
