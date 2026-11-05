// cdp.mjs — playwright 없이 설치된 Chrome 을 헤드리스로 띄워 DevTools 프로토콜(CDP)로 직접 움직이는 최소 드라이버.
//
// 왜: 브라우저 하니스(qa-hq-browser)는 playwright 가 있어야 도는데, 이 저장소에는 설치하지 않는다(사용자 결정).
//   Chrome 하나와 Node 내장 WebSocket 만으로 클릭·입력·주소·뒤로가기·네트워크 관찰·응답 강제 실패까지 된다.
// 쓰는 곳: scripts/qa-hq-structure.mjs · qa-journey-*.mjs(REST 요청 수·Realtime 채널 수 예산 = rest/countRest/channelCount).
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
  /** 모든 /rest/v1/ 요청(RPC 포함) = { method, url, at }. 요청 수 예산 검사용(M4 2026-11-04 · "채팅 1건에 REST 몇 번 읽나").
   *  requests/calls 는 RPC 이름만 모아 표 조회(GET /rest/v1/work_feed?…)가 안 잡힌다 → 따로 둔다. 지우지 않고 쌓이므로 sinceMs 로 창을 자른다. */
  const rest = [];
  /** Realtime(phoenix) 채널 토픽 — WebSocket 프레임 { topic, event:'phx_join'|'phx_leave' } 를 소켓(requestId)별 집합으로 센다.
   *  왜: 앱이 supabase 클라이언트를 전역에 노출하지 않아 getChannels() 를 못 부른다. 소켓이 닫히면(이동·새로고침) 그 집합을 버린다.
   *  재조인(phx_join 두 번)은 집합이라 1로 센다. 쓰는 곳: 채널 예산 검사(레이아웃 구독 수 ≤). */
  const wsTopics = new Map();
  const errors = [];
  let failing = new Set();
  /** 이름 → 응답 바꾸기 함수. 실제 응답을 받은 뒤 고쳐서 돌려준다(빈 상태·여러 곳 같은 파일럿에 없는 모양 실측용). */
  let mocks = new Map();
  // 실패는 요청 단계, 바꾸기는 응답 단계에서 멈춘다. 둘 다 없으면 Fetch 를 끈다.
  const syncFetch = async () => {
    const patterns = [];
    if (failing.size) patterns.push({ urlPattern: '*/rest/v1/rpc/*', requestStage: 'Request' });
    if (mocks.size) patterns.push({ urlPattern: '*/rest/v1/rpc/*', requestStage: 'Response' });
    if (patterns.length) await s('Fetch.enable', { patterns });
    else await s('Fetch.disable');
  };
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
      if (m.params.request.url.includes('/rest/v1/')) rest.push({ method: m.params.request.method, url: m.params.request.url, at: Date.now() });
    }
    if (m.method === 'Network.webSocketFrameSent') {
      // 하트비트(phoenix 토픽)·메시지 프레임은 건너뛴다. 파싱 실패 = 바이너리·조각 프레임 → 무시.
      // ★realtime-js v2(vsn=2.0.0)는 객체가 아니라 배열 [join_ref, ref, topic, event, payload] 로 보낸다(serializer.js encode).
      //   객체 모양(vsn 1.0.0)도 같이 받는다. 2026-11-05 첫 실측에서 배열을 못 읽어 관측 0 → skip 이 났다.
      let f = null;
      try {
        const raw = JSON.parse(m.params.response?.payloadData ?? '');
        f = Array.isArray(raw) ? { topic: raw[2], event: raw[3] } : raw;
      } catch { /* JSON 아님 */ }
      if (f && typeof f.topic === 'string' && f.topic.startsWith('realtime:')) {
        if (!wsTopics.has(m.params.requestId)) wsTopics.set(m.params.requestId, new Set());
        const set = wsTopics.get(m.params.requestId);
        if (f.event === 'phx_join') set.add(f.topic);
        else if (f.event === 'phx_leave') set.delete(f.topic);
      }
    }
    // ★페이지 이동(location 바꿈)으로 죽은 소켓은 webSocketClosed 가 안 온다(2026-11-05 실측: 소켓 8~9개 집합이 쌓여 채널 72·90).
    //   앱은 realtime 소켓을 하나만 쓰므로 새 소켓이 열리면 이전 집합을 전부 버린다.
    if (m.method === 'Network.webSocketCreated') wsTopics.clear();
    if (m.method === 'Network.webSocketClosed') wsTopics.delete(m.params.requestId);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    }
    if (m.method === 'Fetch.requestPaused') {
      const name = m.params.request.url.match(/\/rpc\/([a-z0-9_]+)/)?.[1];
      // ★응답을 기다리는 사이 failRpc([]) 가 Fetch 를 끄면 이 호출이 'Fetch domain is not enabled' 로 거부된다 —
      //   잡지 않으면 하니스가 통째로 죽는다(2026-10-02 G 묶음). 꺼진 뒤엔 요청이 그대로 흘러가므로 버려도 된다.
      if (m.params.responseStatusCode !== undefined) {
        // 응답 단계 — 바꾸기 대상이고 성공 응답일 때만 고친다. 나머지는 원래 응답 그대로.
        const id = m.params.requestId;
        if (name && mocks.has(name) && m.params.responseStatusCode === 200) {
          void (async () => {
            const b = await s('Fetch.getResponseBody', { requestId: id });
            const raw = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
            const out = mocks.get(name)(JSON.parse(raw));
            const headers = (m.params.responseHeaders ?? []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
            await s('Fetch.fulfillRequest', { requestId: id, responseCode: 200, responseHeaders: headers, body: Buffer.from(JSON.stringify(out)).toString('base64') });
          })().catch(() => s('Fetch.continueRequest', { requestId: id }).catch(() => {}));
        } else {
          void s('Fetch.continueRequest', { requestId: id }).catch(() => {});
        }
      } else if (name && failing.has(name)) {
        void s('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 500,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: Buffer.from(JSON.stringify({ message: 'qa forced failure', code: 'QA500' })).toString('base64'),
        }).catch(() => {});
      } else {
        void s('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
      }
    }
  });

  const page = {
    requests, calls, rest, errors, send: s,
    /** sinceMs(Date.now() 기준) 이후의 /rest/v1/ 요청 수. pattern(RegExp 또는 문자열)이 있으면 url 에 걸리는 것만. */
    countRest(sinceMs, pattern) { return page.restSince(sinceMs, pattern).length; },
    /** 같은 조건의 요청 목록 — 예산 초과 시 "무엇을 읽었나" 진단용. */
    restSince(sinceMs, pattern) {
      const re = pattern == null ? null : pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return rest.filter((r) => r.at >= sinceMs && (!re || re.test(r.url)));
    },
    /** 지금 열린 소켓들의 조인 토픽 수(= supabase 채널 수에 해당). 토픽 목록은 channelTopics(). */
    channelCount() { return page.channelTopics().length; },
    channelTopics() { return [...wsTopics.values()].flatMap((set) => [...set]); },
    async seedSession(session) {
      await s('Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.clear();localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))});}catch(e){}`,
      });
    },
    /** 이름이 든 RPC 를 500 으로 돌려준다(빈 배열 = 해제). 오류 화면 실측용. */
    async failRpc(names) {
      failing = new Set(names);
      await syncFetch();
    },
    /** { rpc이름: (실제 응답) => 바꾼 응답 } — 빈 객체 = 해제. 다음 요청부터 걸린다. */
    async mockRpc(map) {
      mocks = new Map(Object.entries(map));
      await syncFetch();
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
