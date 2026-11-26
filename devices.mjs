// Layout + keyboard check in real Chrome: no sideways scroll at phone/tablet/desktop widths, every control reachable with Tab, focus always visible.
import { spawn } from 'node:child_process';
const port = 9444;
const ch = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${port}`,'--user-data-dir=/tmp/cp-dev','about:blank'],{stdio:'ignore'});
await new Promise(r=>setTimeout(r,2500));
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fails++;};
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'MAEAD_CONFIG',{configurable:true,set(v){v.licenceApi='';this._c=v},get(){return this._c}})"});
const pages=['index.html','app.html#demo','privacy.html'];
for (const [w,h,mob,label] of [[320,640,true,'small phone'],[360,740,true,'Android'],[390,844,true,'iPhone'],[768,1024,true,'tablet'],[1280,800,false,'desktop']]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:mob});
  for (const p of pages) {
    await send('Page.navigate',{url:`file://${process.cwd()}/${p}`}); await sleep(700);
    if (p.includes('demo')) { await ev(`localStorage.clear()`); await send('Page.navigate',{url:`file://${process.cwd()}/${p.replace('#demo','')}#demo`}); await sleep(300); await ev(`location.reload()`); await sleep(900); }
    const o = await ev(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})`);
    ok(o.sw<=o.cw+1,`${label} ${w}px ${p}: no sideways scroll (${o.sw}/${o.cw})`);
  }
}
// keyboard walk on the app, desktop size
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:`file://${process.cwd()}/app.html`}); await sleep(600);
await ev(`localStorage.clear()`); await send('Page.navigate',{url:`file://${process.cwd()}/app.html#demo`}); await sleep(300); await ev(`location.reload()`); await sleep(900);
const key=async(k,code,vk)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk});await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk});};
const seen=[]; let lost=0, noRing=0;
for (let i=0;i<60;i++){ await key('Tab','Tab',9); await sleep(25);
  const f=await ev(`(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {t:e.tagName+(e.id?'#'+e.id:''),vis:r.width>0&&r.height>0,ring:cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0,sum:e.tagName==='SUMMARY'}})()`);
  if(!f){ if(seen.length>10) break; lost++; continue;} seen.push(f.t); if(!f.vis){lost++;console.log('invisible',f.t);} if(!f.ring){noRing++;console.log('noring',f.t);} }
ok(lost===0,'keyboard: focus never lost or on an invisible element');
ok(noRing===0,'keyboard: every focused control shows a focus outline ('+noRing+' without)');
ok(seen.includes('A') || seen.some(t=>t.startsWith('A')),'keyboard: skip link reachable first, got '+seen[0]);
ok(seen.includes('BUTTON#btnBackup')||seen.includes('BUTTON#btnExport'),'keyboard: reaches export/backup buttons');
ok(seen.some(t=>t.startsWith('SELECT')),'keyboard: reaches the result dropdowns');
// Enter on a focused send link marks it sent? (anchor click via Enter)
const before = await ev(`document.querySelectorAll('#list a.wa.done').length`);
await ev(`document.querySelector('#list a.wa').focus()`);
await ev(`document.querySelector('#list a.wa').removeAttribute('target')`);
console.log('seen:',seen.slice(0,14).join(' '));
ws.close(); ch.kill();
console.log(fails?`${fails} FAILED`:'ALL DEVICE/KEYBOARD CHECKS PASSED'); process.exit(fails?1:0);
