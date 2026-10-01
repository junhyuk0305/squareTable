// cdp.mjs — playwright 없이 설치된 Chrome 을 헤드리스로 띄워 DevTools 프로토콜(CDP)로 직접 움직이는 최소 드라이버.
//
// 왜: 브라우저 하니스(qa-hq-browser)는 playwright 가 있어야 도는데, 이 저장소에는 설치하지 않는다(사용자 결정).
//   Chrome 하나와 Node 내장 WebSocket 만으로 클릭·입력·주소·뒤로가기·네트워크 관찰·응답 강제 실패까지 된다.
// 쓰는 곳: scripts/qa-hq-structure.mjs.
//
// ★클릭은 element.click() 이 아니라 **좌표 마우스 이벤트**다 — RN-web Pressable 은 click 이벤트만으로는 눌리지 않는다.
// ★클릭 전에 최상단 요소가 대상인지 확인한다 — 스플래시·커버가 덮은 채 누르면 조용히 아무 일도 안 일어난다.
// ★닫을 때 프로세스 트리째 죽인다 — 부모만 죽이면 디버깅 포트를 잡은 자식이 남아 다음 실행이 옛 브라우저에 붙는다.
import { Buffer } from 'node:buffer';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 세션을 심을 localStorage 키 — supabase-js 기본값(sb-<프로젝트 ref>-auth-token). */
export const storageKeyFor = (supabaseUrl) => `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

export async function launch({ origin, storageKey, width = 1600, height = 1000, port = 9333 }) {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('Chrome 을 찾지 못했어요 — CHROME_PATH 로 지정하세요.');
  const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`,
    '--no-first-run', '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 50 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
  }
  if (!ver) throw new Error('Chrome 디버깅 포트에 붙지 못했어요');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable'); await s('Network.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  /** 이 페이지가 부른 RPC 이름(POST /rest/v1/rpc/<name>) — 호출 횟수 검사용. */
  const requests = [];
  /** 같은 것에 본문까지 — 같은 RPC 를 인자로 구별해야 할 때(목록 쪽 조회 vs 한 매장 조회). */
  const calls = [];
  const errors = [];
  let failing = new Set();
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Network.requestWillBeSent') {
      const rpc = m.params.request.url.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/);
      if (rpc && m.params.request.method === 'POST') {
        requests.push(rpc[1]);
        let body = null;
        try { body = JSON.parse(m.params.request.postData ?? 'null'); } catch { /* 본문 없음 */ }
        calls.push({ name: rpc[1], body });
      }
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    }
    if (m.method === 'Fetch.requestPaused') {
      const name = m.params.request.url.match(/\/rpc\/([a-z0-9_]+)/)?.[1];
      if (name && failing.has(name)) {
        void s('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 500,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: Buffer.from(JSON.stringify({ message: 'qa forced failure', code: 'QA500' })).toString('base64'),
        });
      } else {
        void s('Fetch.continueRequest', { requestId: m.params.requestId });
      }
    }
  });

  const page = {
    requests, calls, errors, send: s,
    async seedSession(session) {
      await s('Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.clear();localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))});}catch(e){}`,
      });
    },
    /** 이름이 든 RPC 를 500 으로 돌려준다(빈 배열 = 해제). 오류 화면 실측용. */
    async failRpc(names) {
      failing = new Set(names);
      if (names.length) await s('Fetch.enable', { patterns: [{ urlPattern: '*/rest/v1/rpc/*' }] });
      else await s('Fetch.disable');
    },
    async slowNetwork(latencyMs) {
      await s('Network.emulateNetworkConditions', { offline: false, latency: latencyMs, downloadThroughput: -1, uploadThroughput: -1 });
    },
    async goto(path) { await s('Page.navigate', { url: origin + path }); },
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
      return r.result.value;
    },
    async waitFor(expr, ms = 20000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        try { if (await page.eval(expr)) return true; } catch { /* 로딩 중 */ }
        await sleep(150);
      }
      return false;
    },
    path() { return page.eval('location.pathname'); },
    text() { return page.eval('document.body.innerText'); },
    /** 보이는(폭·높이가 있는) 요소의 상자. 숨긴 요소(display:none)는 null. */
    box(sel) {
      return page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();if(!r.width&&!r.height)return null;return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
    },
    async visible(sel) { return !!(await page.box(sel)); },
    async click(sel) {
      let x = 0, y = 0, ok = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        await page.eval(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'center'})`);
        const b = await page.box(sel);
        if (b) {
          x = b.x + Math.min(b.w / 2, 40); y = b.y + b.h / 2;
          ok = await page.eval(`(()=>{const t=document.elementFromPoint(${x},${y});const e=document.querySelector(${JSON.stringify(sel)});return !!(t&&e&&e.contains(t));})()`);
          if (ok) break;
        }
        await sleep(200);
      }
      if (!ok) {
        const who = await page.eval(`(()=>{const t=document.elementFromPoint(${x},${y});return t?(t.dataset.testid||t.tagName):'none'})()`);
        throw new Error(`누를 수 없음 ${sel} (위에 있는 것: ${who})`);
      }
      await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    async type(sel, text) { await page.click(sel); await s('Input.insertText', { text }); },
    async back() { await page.eval('history.back()'); },
    async reload() { await s('Page.reload', {}); },
    async resize(w, h) { await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async shot(file) { const { data } = await s('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(data, 'base64')); },
  };

  const close = async () => {
    try { ws.close(); } catch { /* 이미 닫힘 */ }
    try {
      if (platform() === 'win32') execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
      else proc.kill('SIGKILL');
    } catch { /* 이미 끝남 */ }
  };
  return { page, close };
}
