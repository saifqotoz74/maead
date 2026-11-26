// End-to-end check in real Chrome over CDP: paste, parse, send click marks sent, outcome select, persistence on reload.
import { spawn } from 'node:child_process';
const port = 9333;
const ch = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${port}`,'--user-data-dir=/tmp/cp-e2e','about:blank'],{stdio:'ignore'});
await new Promise(r=>setTimeout(r,2500));
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fails++;};
await send('Page.enable');
await send('Page.navigate',{url:`file://${process.cwd()}/app.html`}); await sleep(800);
await ev(`localStorage.clear()`); await send('Page.navigate',{url:`file://${process.cwd()}/app.html`}); await sleep(800);
// 1. paste a messy Excel-style table for tomorrow
const d = await ev(`(()=>{const t=new Date();t.setDate(t.getDate()+1);return t.getDate()+'/'+(t.getMonth()+1)+'/'+t.getFullYear();})()`);
const tsv = `الاسم\tالموبايل\tالتاريخ\tالساعة\tالدكتور\nمنى\t٠١٠٠٠٠٠٠٠٠١\t${d}\t5 م\tد. سارة\nكريم\t0100\t${d}\t6 م\t\nمنى\t01000000001\t${d}\t5 م\tد. سارة`;
await ev(`document.getElementById('paste').value=${JSON.stringify(tsv)};document.getElementById('btnParse').click();`);
await sleep(200);
ok(/اتقرا 3 ميعاد/.test(await ev(`document.getElementById('parseInfo').textContent`)),'parses 3 rows');
const rows = await ev(`document.querySelectorAll('#list .row:not(.head)').length`);
ok(rows===3,'3 rows shown for tomorrow, got '+rows);
ok(await ev(`document.querySelectorAll('#list a.wa').length`)===1,'only 1 sendable (bad phone + duplicate blocked)');
const href = await ev(`document.querySelector('#list a.wa').href`);
ok(href.startsWith('https://wa.me/201000000001?text='),'wa.me link has Egyptian international number');
ok(decodeURIComponent(href).includes('عيادة النور'),'message includes clinic name');
// 2. click send marks sent
await ev(`document.querySelector('#list a.wa').addEventListener('click',e=>e.preventDefault(),true);document.querySelector('#list a.wa').click()`);
await sleep(300);
ok(/اتبعت/.test(await ev(`document.querySelector('#list a.wa').textContent`)),'send click marks row as sent');
// 3. outcome select
await ev(`(()=>{const s=document.querySelector('#list select');s.value='came';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await sleep(200);
ok(/حضر|1/.test(await ev(`document.getElementById('results').textContent`)),'results panel reacts to outcome');
// 4. persistence
await send('Page.navigate',{url:`file://${process.cwd()}/app.html`}); await sleep(800);
ok(await ev(`document.querySelectorAll('#list .row:not(.head)').length`)===3,'rows persist after reload');
ok(/اتبعت/.test(await ev(`document.querySelector('#list a.wa').textContent`)),'sent mark persists after reload');
// 5. XSS: name with HTML must be escaped
const evil = `الاسم,الموبايل,التاريخ\n<img src=x onerror=window.__x=1>,01000000002,${d}`;
await ev(`document.getElementById('paste').value=${JSON.stringify(evil)};document.getElementById('btnParse').click();`); await sleep(300);
ok(await ev(`window.__x`)===undefined && await ev(`document.querySelectorAll('#list img').length`)===0,'HTML in names is escaped');
// 6. clear
await ev(`document.getElementById('btnClear').click()`); await sleep(200);
ok(await ev(`JSON.parse(localStorage.getItem('maead.v1')).text`)==='','clear wipes stored data');
console.log(fails?`${fails} FAILED`:'ALL E2E PASSED');
ch.kill(); process.exit(fails?1:0);
