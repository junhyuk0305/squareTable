// qa-journey-task.mjs — 할일 여정 하니스(2026-10-15). 사장 창(S)과 직원 창(J)을 한 스크립트에서 같이 연다.
//   사장 할일 만들기(담당 2명 반복 1 + 단건 1) → 직원 목록 → 직원 완료(사진 1장) → 사장 확인.
//   화면 문자열을 DB 원본(service_role 읽기)과 맞대어 단언한다. DB 쓰기는 셋업(K2 비오늘 반복 1건 · K4-n 공지 1건)·정리에만 쓴다.
//
//   node scripts/qa-journey-task.mjs      (개발 서버 http://localhost:8081 · QA_ORIGIN 으로 바꾼다 · .env + .env.seed 필요)
//
// 고정 계정만 쓴다(qa-fixed-accounts) — 사장 owner@ · 직원 staff2@(이수민) · 매니저 staff@(박지원) · store_001.
// 이 하니스가 만든 데이터 = 할일 text 접두사 'qa_jr_task_'. 시작·끝에 그것만 지운다(work_templates·work_done·work_feed·사진).
// 포트: S 9343 · J 9344 · 매니저 9345(K5 비담당 완료 한 번만 열고 닫는다). 다른 하니스가 9333/9334 를 쓴다.
// ★건너뛴 단언은 ✗ 로 센다. 마지막 줄 GREEN n/0 또는 RED n/m.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW, UNIT, login, ensureActive, restoreActive, rolePrecondition } from './lib/qa-fixed-accounts.mjs';

const T0 = Date.now();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const f of ['.env', '.env.seed']) {
  try {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* 없으면 skip */ }
}
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = env.QA_ORIGIN ?? 'http://localhost:8081';
if (!SB || !ANON || !SRV) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY(.env) · SUPABASE_SERVICE_ROLE_KEY(.env.seed) 필요'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const PREFIX = 'qa_jr_task_';
const STAMP = Date.now().toString(36);
const TXT_REPEAT = `${PREFIX}반복_${STAMP}`;
const TXT_ONCE = `${PREFIX}단건_${STAMP}`;
const TXT_K2 = `${PREFIX}비오늘반복_${STAMP}`;
const TXT_NOTICE = `${PREFIX}공지_${STAMP}`;
const NOTICE_ID = `f_qajr_${STAMP}`;
const TXT_K6 = `${PREFIX}전제안내배정_${STAMP}`; // 할일 이름에 '기기'·'알림' 을 넣지 않는다(K6-a 정규식이 토스트 대신 이름에 걸린다)
const NAME_J = '이수민';
const NAME_M = '박지원';
const STORAGE_KEY = storageKeyFor(SB);
const ERR_RE = /실패|못 했어요|못했어요|올리지 못|못 올렸/g;

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓', n, extra ? `— ${extra}` : ''); } else { fail++; console.log('  ✗', n, extra); }
};
const section = (t) => console.log(`\n── ${t}`);
const info = (t) => console.log('  ·', t);

// ── DB(service_role) ────────────────────────────────────────────────────────
const H = { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' };
async function sel(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`select ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function del(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(`delete ${path}: ${r.status} ${await r.text()}`);
}
async function ins(table, row) {
  const r = await fetch(`${SB}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`insert ${table}: ${r.status} ${await r.text()}`);
}
const inList = (ids) => `(${ids.map((x) => `"${x}"`).join(',')})`;
const mineTemplates = async () =>
  (await sel(`work_templates?unit_id=eq.${UNIT}&text=like.${encodeURIComponent(PREFIX)}*&select=*`)).filter((t) => t.text.startsWith(PREFIX));

/** 접두사 데이터만 지운다 — 사진(스토리지) → 피드 → 완료 → 할일 순. */
async function cleanup(label) {
  const tpl = await mineTemplates();
  const ids = tpl.map((t) => t.id);
  let photos = [];
  if (ids.length) {
    const done = await sel(`work_done?unit_id=eq.${UNIT}&template_id=in.${inList(ids)}&select=data`);
    photos = done.map((d) => d.data?.photoUrl).filter((p) => typeof p === 'string' && p.startsWith(`${UNIT}/`));
  }
  const feed = (await sel(`work_feed?unit_id=eq.${UNIT}&data->>kind=eq.task_done&select=id,data&order=created_at.desc&limit=500`))
    .filter((f) => ids.includes(f.data?.refId) || String(f.data?.text ?? '').includes(PREFIX));
  photos.push(...feed.map((f) => f.data?.photoUrl).filter((p) => typeof p === 'string' && p.startsWith(`${UNIT}/`)));
  photos.push(...createdPhotos);
  photos = [...new Set(photos)];
  if (photos.length) {
    const r = await fetch(`${SB}/storage/v1/object/playbook-photos`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: photos }) });
    if (!r.ok) info(`사진 정리 실패 ${r.status}`);
  }
  if (feed.length) await del(`work_feed?id=in.${inList(feed.map((f) => f.id))}`);
  // K4-n 이 심은 공지(본문 접두사).
  const notices = (await sel(`work_feed?unit_id=eq.${UNIT}&data->>kind=eq.notice&select=id,data&order=created_at.desc&limit=500`))
    .filter((f) => String(f.data?.text ?? '').startsWith(PREFIX));
  if (notices.length) await del(`work_feed?id=in.${inList(notices.map((f) => f.id))}`);
  if (ids.length) {
    await del(`work_done?unit_id=eq.${UNIT}&template_id=in.${inList(ids)}`);
    await del(`work_template_knowhow?template_id=in.${inList(ids)}`).catch(() => {});
    await del(`work_templates?id=in.${inList(ids)}`);
  }
  info(`정리(${label}): 할일 ${ids.length} · 피드 ${feed.length} · 공지 ${notices.length} · 사진 ${photos.length}`);
}
const createdPhotos = [];

// ── DB 원본으로 화면 수를 다시 센다(앱 SSOT 를 import 하지 않는 독립 계산) ─────
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const TODAY = kstToday();
const DOW = new Date(`${TODAY}T00:00:00Z`).getUTCDay();
const ownersOf = (t) => (t.owner_ids?.length ? t.owner_ids : t.owner_id ? [t.owner_id] : []);
function occurs(t, d) {
  if (t.hidden) return false;
  if (t.skip?.includes(d)) return false;
  if (t.recurrence && t.recurrence !== 'once') return t.recurrence.weekly.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const dd = t.date ?? t.due_date;
  if (dd) return dd === d;
  return t.recurrence !== 'once';
}
const visibleTo = (t, me) => (t.scope ?? 'shared') !== 'private' || ownersOf(t).includes(me) || t.created_by === me;
const assignedTo = (t, me) => ownersOf(t).includes(me) && !!t.created_by && t.created_by !== me;
async function oracle(ids) {
  const [tpl, cfg, done, prefs] = await Promise.all([
    sel(`work_templates?unit_id=eq.${UNIT}&select=*`),
    sel(`schedule_config?unit_id=eq.${UNIT}&select=dayparts`),
    sel(`work_done?unit_id=eq.${UNIT}&work_date=eq.${TODAY}&select=template_id,data`),
    sel(`unit_member_prefs?unit_id=eq.${UNIT}&user_id=eq.${ids.J}&select=notif_ack_at`),
  ]);
  // 매장 공통 루틴(schedule_config.dayparts[].routines) — 매일 · 매장 전체.
  const dp = cfg[0]?.dayparts;
  const routines = Array.isArray(dp)
    ? dp.flatMap((d, i) => (Array.isArray(d?.routines) ? d.routines : []).filter((r) => r && typeof r === 'object')
      .map((r, j) => ({ id: `dpr_${r.id ?? `${d.id ?? `dp_${i}`}_rt_${j}`}`, scope: 'shared', owner_ids: r.assigneeId ? [r.assigneeId] : [], recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] } })))
    : [];
  const all = [...routines, ...tpl];
  const doneSet = new Set(done.map((d) => d.template_id));
  const ack = prefs[0]?.notif_ack_at ?? null;
  const at = (t) => t.assigned_meta?.[ids.J]?.at ?? t.created_at ?? `${TODAY}T08:00:00`;
  const sToday = all.filter((t) => occurs(t, TODAY) && visibleTo(t, ids.S));
  const jToday = all.filter((t) => occurs(t, TODAY) && visibleTo(t, ids.J));
  const jAssign = tpl.filter((t) => assignedTo(t, ids.J) && occurs(t, TODAY));
  return {
    sTotal: sToday.length,
    sDone: sToday.filter((t) => doneSet.has(t.id)).length,
    jRemain: jToday.filter((t) => !doneSet.has(t.id)).length,
    jAssignRows: jAssign.length,
    jAssignPending: jAssign.filter((t) => !doneSet.has(t.id) && (!ack || at(t) > ack)).length,
    routines: routines.length,
  };
}

// ── 브라우저 도우미 ─────────────────────────────────────────────────────────
// fetch 를 감싸 ≥400 응답을 모은다(cdp.mjs 는 응답 상태를 노출하지 않는다). + 파일 선택창 가로채기.
const INJECT = `(()=>{try{const of=window.fetch;window.__qaBad=[];window.fetch=async(...a)=>{const r=await of(...a);try{if(r.status>=400)window.__qaBad.push(r.status+' '+String(a[0]&&a[0].url||a[0]).replace(/\\?.*/,'').slice(-70));}catch(e){}return r;};
const oc=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'&&window.__qaFileArm){window.__qaFileArm=false;window.__qaFileInput=this;return;}return oc.call(this);};}catch(e){}})()`;
async function open(port, session) {
  const w = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width: 460, height: 900, port });
  await w.page.seedSession(session);
  await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  w.page.errSeen = 0;
  return w;
}
/** 전환 1번의 콘솔 에러·≥400 수(지난 집계 이후). */
const totals = { err: 0, bad: 0 };
async function stat(page, tag, label) {
  const errs = page.errors.slice(page.errSeen);
  page.errSeen = page.errors.length;
  let bad = [];
  try { bad = (await page.eval('(window.__qaBad||[]).splice(0)')) ?? []; } catch { /* 이동 중 */ }
  totals.err += errs.length; totals.bad += bad.length;
  console.log(`    [${tag}] ${label}: 콘솔 에러 ${errs.length} · ≥400 ${bad.length}${errs.length ? ` · ${errs[0].slice(0, 120)}` : ''}${bad.length ? ` · ${bad.slice(0, 3).join(', ')}` : ''}`);
}
async function go(page, tag, path, label) {
  await stat(page, tag, `(${label} 전)`).catch(() => {});
  await page.goto(path);
  await sleep(1500);
  await dismiss(page);
}
/** 첫 실행 안내 덮개(홈 '알겠어요' · 업무 탭 코치마크 '건너뛰기') — 남아 있으면 클릭이 덮개에 먹힌다.
 *  seedSession 이 문서마다 localStorage 를 비워서 이동할 때마다 다시 뜬다. 늦게 뜨므로 잠깐 기다린다. */
async function dismiss(page) {
  let quiet = 0;
  for (let i = 0; i < 30 && quiet < 8; i++) {
    let hit = false;
    for (const t of ['알겠어요, 시작할게요', '건너뛰기']) {
      if (await page.eval(`!!${leafJs(t)}`)) { await clickLeaf(page, t).catch(() => {}); hit = true; await sleep(500); }
    }
    quiet = hit ? 0 : quiet + 1;
    await sleep(250);
  }
}
/** 보이는 잎 요소 중 글자가 정확히 같은 마지막 것(시트가 DOM 뒤에 붙는다). root 는 CSS 선택자. */
const leafJs = (text, root = '') =>
  `(()=>{const r=${root ? `document.querySelector(${JSON.stringify(root)})` : 'document'};if(!r)return null;const a=[...r.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0);return a[a.length-1]||null;})()`;
async function clickJs(page, js, what) {
  const mark = () => page.eval(`(()=>{document.querySelectorAll('[data-qa-t]').forEach(e=>e.removeAttribute('data-qa-t'));const e=${js};if(!e)return false;e.setAttribute('data-qa-t','1');return true;})()`);
  // 늦게 뜬 코치마크가 덮거나, 실시간 재조회로 행이 다시 그려져 표시한 요소가 사라질 수 있다 — 걷고 다시 표시해 3번까지.
  for (let i = 0; i < 3; i++) {
    if (!(await mark())) { if (i === 2) throw new Error(`못 찾음: ${what}`); await sleep(800); continue; }
    try { await page.click('[data-qa-t="1"]'); return; } catch { if (i < 2) await dismiss(page); }
  }
  {
    const cover = await page.eval(`(()=>{const e=document.querySelector('[data-qa-t="1"]');if(!e)return '대상 사라짐';const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+Math.min(r.width/2,40),r.y+r.height/2);return t?(t.innerText||'').replace(/\\s+/g,' ').slice(0,80):'none';})()`).catch(() => '?');
    throw new Error(`${what} 누를 수 없음 — 덮은 것: "${cover}"`);
  }
}
const clickLeaf = (page, text, root = '') => clickJs(page, leafJs(text, root), text);
/** 할일 화면(TodoScreen) 행의 체크 상자 = 글자 칸의 바로 앞 형제. */
const todoBoxJs = (text) => `(()=>{const l=${leafJs(text)};return l&&l.parentElement&&l.parentElement.previousElementSibling;})()`;
/** 할일 화면에서 완료 상태 — 카메라 버튼은 미완료일 때만 있다. */
const todoDone = async (page, text) => !(await page.eval(`!!document.querySelector(${JSON.stringify(`[aria-label="${text} 사진으로 완료"]`)})`));
const errLines = async (page) => ((await page.text()).match(ERR_RE) ?? []).length;
async function errContext(page) {
  return (await page.text()).split('\n').filter((l) => ERR_RE.test(l)).map((l) => { ERR_RE.lastIndex = 0; return l.trim(); }).slice(0, 3).join(' / ');
}
const waitText = (page, re, ms = 30000) => page.waitFor(`${re}.test(document.body.innerText)`, ms);

// 화면 읽기 — 각 자리의 수.
async function readOwnerHome(page) {
  await waitText(page, '/\\d+% · \\d+\\/\\d+/', 40000);
  const m = (await page.text()).match(/(\d+)% · (\d+)\/(\d+)/);
  return m ? { pct: +m[1], done: +m[2], total: +m[3] } : null;
}
async function readTodoRows(page) {
  await waitText(page, '/할일 \\d+|이 날 할일이 없어요/', 40000);
  await sleep(800);
  return page.eval(`[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+\\/\\d+$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0).reduce((s,e)=>s+Number(e.textContent.trim().split('/')[1]),0)`);
}
async function readJuniorHome(page) {
  await waitText(page, '/남은 할일\\n/', 40000);
  const t = await page.text();
  const m = t.match(/남은 할일\n(\d+)개|남은 할일\n(다 했어요|없어요)/);
  return m ? (m[1] ? +m[1] : 0) : null;
}
async function readBell(page) {
  // ★배지는 스토어(업무·근무·질문·제안)가 따로따로 차며 오른다 — 1.5초 한 번 읽으면 0 을 읽었다(2회차 실측).
  //   홈 본문이 선 뒤, 같은 값이 3초 이어질 때까지 읽는다.
  await page.waitFor(`!!document.querySelector('[aria-label^="알림"]') && /남은 할일\\n/.test(document.body.innerText)`, 40000);
  const read = async () => {
    const l = await page.eval(`(document.querySelector('[aria-label^="알림"]')||{}).getAttribute?.('aria-label')`);
    const m = String(l ?? '').match(/알림 (\d+)건/);
    return l === '알림' ? 0 : m ? +m[1] : null;
  };
  let v = await read();
  let since = Date.now();
  const t0 = Date.now();
  while (Date.now() - since < 3000 && Date.now() - t0 < 20000) {
    await sleep(250);
    const n = await read();
    if (n !== v) { v = n; since = Date.now(); }
  }
  return v;
}
async function readNotifRows(page) {
  await page.waitFor(`!/알림을 불러오고/.test(document.body.innerText) && /배정했어요|아직 새 알림이 없어요/.test(document.body.innerText)`, 40000);
  await sleep(1000);
  const t = await page.text();
  return { assign: (t.match(/할 일을 배정했어요/g) ?? []).length, text: t };
}

// ════════════════════════════════════════════════════════════════════════════
const cs = await login(SB, ANON, FIXED.owner);
const cj = await login(SB, ANON, FIXED.junior);
const cm = await login(SB, ANON, FIXED.manager);
const ids = { S: cs.uid, J: cj.uid, M: cm.uid };
const pre = await rolePrecondition({ owner: cs, manager: cm, junior: cj });
if (pre) { console.error(`FAIL: 전제 깨짐 — ${pre}`); process.exit(2); }
const prevActive = { S: await ensureActive(cs), J: await ensureActive(cj), M: await ensureActive(cm) };
for (const [k, v] of Object.entries(prevActive)) if (v) info(`활성 매장을 바꾼 계정 = ${k}(원래 ${v})`);
async function sessionOf(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: PW }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}

console.log(`할일 여정 · ${UNIT} · 오늘 ${TODAY}(요일 ${DOW}) · 접두사 ${PREFIX}`);
await cleanup('시작');

const PNG = join(tmpdir(), `qa_jr_task_${STAMP}.png`);
{ // 16x16 빨간 PNG 를 직접 만든다(유효한 CRC · 압축 경로 통과용).
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 16 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(16).fill([220, 40, 40]).flat())])));
  writeFileSync(PNG, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const S = await open(9343, await sessionOf(FIXED.owner));
const J = await open(9344, await sessionOf(FIXED.junior));
let created = { repeat: null, once: null, k2: null };
let viaUI = { repeat: false, once: false };
try {
  // ── 0. 직원 배지 기준점 ────────────────────────────────────────────────
  section('0. 기준점 — 직원 벨 배지(만들기 전)');
  await go(J.page, 'J', '/junior/home', '홈');
  await dismiss(J.page);
  const B0 = await readBell(J.page);
  const o0 = await oracle(ids);
  info(`J 벨 배지 = ${B0}건 · DB 배정 미완료(ack 이후) = ${o0.jAssignPending} · 공통 루틴 ${o0.routines}개`);
  await stat(J.page, 'J', '홈(기준점)');

  // ── 1. S 가 화면으로 할일 2개를 만든다 ────────────────────────────────
  section('1. 사장 화면으로 할일 만들기 — 반복(오늘 요일 · 담당 이수민+박지원) 1 · 단건(오늘 · 담당 이수민) 1');
  async function compose(text, { weekly, assignees, armToast = false }) {
    // ★?compose= 딥링크로 열면 시트가 데이터 도착 전에 떠서, 도착 뒤 다시 그려지며 입력이 지워졌다(1차 실행).
    //   목록이 다 선 뒤 할일 추가 버튼(FAB)으로 연다.
    await go(S.page, 'S', '/owner/work?view=todo', '할일 작성');
    await readTodoRows(S.page);
    await clickJs(S.page, `document.querySelector('[aria-label$=" 할일 추가"]')`, '할일 추가 버튼');
    const INP = 'input[placeholder="예) 우유 재고 확인"]';
    if (!(await S.page.waitFor(`!!document.querySelector('${INP}')`, 10000))) throw new Error('작성 시트가 안 열림');
    await sleep(900); // 시트 올라오는 중에 누르면 옛 좌표에 떨어진다
    await S.page.eval(`(()=>{let e=document.querySelector('${INP}');while(e&&!/할일 등록/.test(e.innerText||''))e=e.parentElement;document.querySelectorAll('[data-qa-sheet]').forEach(x=>x.removeAttribute('data-qa-sheet'));if(e)e.setAttribute('data-qa-sheet','1');})()`);
    await S.page.type(INP, text);
    if (weekly) {
      await clickLeaf(S.page, '매주 반복', '[data-qa-sheet]');
      await S.page.waitFor(`!!${leafJs('반복 요일 (여러 개 선택)')}`, 5000);
      const DOWK = ['일', '월', '화', '수', '목', '금', '토'];
      const def = [1, 2, 3, 4, 5];
      for (let i = 0; i < 7; i++) {
        if (def.includes(i) !== (i === DOW)) {
          await clickJs(S.page, `(()=>{const l=${leafJs('반복 요일 (여러 개 선택)')};const row=l&&l.parentElement;return row?[...row.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(DOWK[i])}):null;})()`, `요일 ${DOWK[i]}`);
          await sleep(150);
        }
      }
    }
    for (const n of assignees) { await S.page.click(`[data-qa-sheet] [aria-label="${n}"]`); await sleep(150); }
    // K6-a: 토스트는 2.4초면 사라진다 — 등록 직후 새로 붙는 짧은 글을 모두 모은다(window.__qaToasts).
    if (armToast) await S.page.eval(`(()=>{window.__qaToasts=[];const add=(t)=>{t=String(t||'').trim();if(t&&t.length<=120)window.__qaToasts.push(t);};new MutationObserver((ms)=>{for(const m of ms){if(m.type==='characterData')add(m.target.textContent);for(const n of m.addedNodes)add(n.innerText??n.textContent);}}).observe(document.body,{childList:true,subtree:true,characterData:true});})()`);
    await clickLeaf(S.page, '할일 등록', '[data-qa-sheet]');
    for (let i = 0; i < 40; i++) {
      const row = (await mineTemplates()).find((t) => t.text === text);
      if (row) return row;
      await sleep(250);
    }
    throw new Error('DB 에 행이 안 생김');
  }
  async function dbInsert(text, extra) {
    const row = { id: `t_qajr_${Math.random().toString(36).slice(2, 10)}`, unit_id: UNIT, section: 'open', text, scope: 'shared', created_by: ids.S, room_id: 'room_main_store_001', ...extra };
    await ins('work_templates', row);
    return (await mineTemplates()).find((t) => t.text === text);
  }
  for (const [k, text, opt, fb] of [
    ['repeat', TXT_REPEAT, { weekly: true, assignees: [NAME_J, NAME_M] }, { recurrence: { weekly: [DOW] }, owner_ids: [ids.J, ids.M], owner_id: ids.J }],
    ['once', TXT_ONCE, { weekly: false, assignees: [NAME_J] }, { recurrence: 'once', date: TODAY, owner_ids: [ids.J], owner_id: ids.J }],
  ]) {
    try {
      created[k] = await compose(text, opt);
      viaUI[k] = true;
    } catch (e) {
      info(`화면 생성 실패(${k}): ${e.message} → DB insert 로 심는다(화면 생성 경로는 안 걸림)`);
      await S.page.shot(join(tmpdir(), `qa_jr_task_compose_${k}.png`)).catch(() => {});
      created[k] = await dbInsert(text, fb);
    }
    await stat(S.page, 'S', `할일 작성(${k})`);
  }
  const R = created.repeat;
  const O = created.once;
  check('1-a 반복 할일을 화면으로 만들었다(작성 시트 → 할일 등록)', viaUI.repeat);
  check('1-b 단건 할일을 화면으로 만들었다', viaUI.once);
  check('1-c DB 반복 = weekly[오늘 요일 하나] · owner_ids=[이수민,박지원] · created_by=사장',
    R && JSON.stringify(R.recurrence) === JSON.stringify({ weekly: [DOW] }) && JSON.stringify([...R.owner_ids].sort()) === JSON.stringify([ids.J, ids.M].sort()) && R.created_by === ids.S,
    R ? `recurrence=${JSON.stringify(R.recurrence)} owner_ids=${R.owner_ids?.length}명 created_by=${R.created_by === ids.S ? '사장' : R.created_by}` : '행 없음');
  check('1-d DB 단건 = once · date=오늘 · owner_ids=[이수민] · scope=shared',
    O && O.recurrence === 'once' && O.date === TODAY && JSON.stringify(O.owner_ids) === JSON.stringify([ids.J]) && O.scope === 'shared',
    O ? `recurrence=${JSON.stringify(O.recurrence)} date=${O.date} owner_ids=${JSON.stringify(O.owner_ids)} scope=${O.scope}` : '행 없음');

  // ── 2. K2 비오늘 반복 1건(DB 셋업) ─────────────────────────────────────
  created.k2 = await dbInsert(TXT_K2, {
    recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== DOW) }, owner_ids: [ids.J, ids.M], owner_id: ids.J, room_id: R?.room_id ?? 'room_main_store_001',
  });
  info(`K2 셋업: 오늘(${DOW})을 뺀 요일 반복 1건 DB 삽입`);

  // ── 3. K1 다섯 자리 ────────────────────────────────────────────────────
  section('2. K1 다섯 자리 수 ↔ DB(같은 조건으로 다시 센 수)');
  await go(S.page, 'S', '/owner/dashboard', '홈');
  await dismiss(S.page);
  const sHome = await readOwnerHome(S.page);
  await stat(S.page, 'S', '홈');
  await go(S.page, 'S', '/owner/work?view=todo', '업무 탭');
  const sRows = await readTodoRows(S.page);
  const sWorkText = await S.page.text();
  await stat(S.page, 'S', '업무 탭');
  await go(J.page, 'J', '/junior/home', '홈');
  await dismiss(J.page);
  const jRemain = await readJuniorHome(J.page);
  const B1 = await readBell(J.page);
  await stat(J.page, 'J', '홈');
  await go(J.page, 'J', '/junior/notifications', '알림');
  const nl = await readNotifRows(J.page);
  await stat(J.page, 'J', '알림');
  const o1 = await oracle(ids);
  const ok1 = sHome?.total === o1.sTotal;
  const ok2 = sRows === o1.sTotal;
  const ok3 = jRemain === o1.jRemain;
  const ok4 = B0 != null && B1 != null && B1 - B0 === o1.jAssignPending - o0.jAssignPending;
  const ok5 = nl.assign === o1.jAssignRows;
  check('K1-① 사장 홈 {done}/{total} 의 total = DB 오늘·사장에게 보이는 할일 전체 [단위: 총 할일]', ok1, `화면 ${sHome?.total} · DB ${o1.sTotal}`);
  check('K1-② 사장 업무 탭 오늘 행 수 = DB 같은 조건 [단위: 총 할일]', ok2, `화면 ${sRows} · DB ${o1.sTotal}`);
  check('K1-③ 직원 홈 "남은 할일 N개" = DB 오늘·직원에게 보이는·미완료 [단위: 미완료(담당 무관)]', ok3, `화면 ${jRemain} · DB ${o1.jRemain}`);
  check('K1-④ 직원 벨 배지 증가분 = DB 배정·미완료 증가분 [단위: 내 배정 미완료]',
    ok4, `배지 ${B0}→${B1}(+${B1 - B0}) · DB ${o0.jAssignPending}→${o1.jAssignPending}(+${o1.jAssignPending - o0.jAssignPending}) · 배지 총수는 다른 종류 포함`);
  check('K1-⑤ 직원 알림 목록 "할 일을 배정했어요" 행 수 = DB 오늘 나에게 배정(완료 포함) [단위: 내 배정]', ok5, `화면 ${nl.assign} · DB ${o1.jAssignRows}`);
  // ★다섯 수는 단위가 달라 같을 이유가 없다(2026-10-16). 단언 = 각 자리가 **자기 라벨이 말하는 단위**로 DB 와 맞는가(①~⑤ 전부 ✓).
  const five = [sHome?.total, sRows, jRemain, o1.jAssignPending, nl.assign];
  check('K1-⑥ 다섯 자리가 각자 라벨이 말하는 단위로 DB 와 일치한다(①~⑤ 모두 ✓)', ok1 && ok2 && ok3 && ok4 && ok5,
    `사장홈 total ${five[0]}(총) · 업무탭 ${five[1]}(총) · 직원홈 ${five[2]}(미완료·담당무관) · 벨 배정 ${five[3]}(내 배정 미완료) · 알림행 ${five[4]}(내 배정·완료 포함)`);

  // ── 4. K2 비오늘 반복은 어디에도 없다 ──────────────────────────────────
  section('3. K2 반복 할일은 오늘 요일 것만');
  await go(J.page, 'J', '/junior/work?view=todo', '할일');
  await readTodoRows(J.page);
  const jWorkText = await J.page.text();
  await stat(J.page, 'J', '할일');
  check('K2-① 사장 업무 탭(오늘)에 비오늘 반복 없음 · 오늘 반복은 있음', !sWorkText.includes(TXT_K2) && sWorkText.includes(TXT_REPEAT), `비오늘=${sWorkText.includes(TXT_K2)} 오늘=${sWorkText.includes(TXT_REPEAT)}`);
  check('K2-② 직원 할일(오늘)에 비오늘 반복 없음 · 오늘 반복·단건은 있음',
    !jWorkText.includes(TXT_K2) && jWorkText.includes(TXT_REPEAT) && jWorkText.includes(TXT_ONCE), `비오늘=${jWorkText.includes(TXT_K2)} 반복=${jWorkText.includes(TXT_REPEAT)} 단건=${jWorkText.includes(TXT_ONCE)}`);
  check('K2-③ 직원 알림 목록에 비오늘 반복 없음 · 오늘 두 건은 있음',
    !nl.text.includes(TXT_K2) && nl.text.includes(TXT_REPEAT) && nl.text.includes(TXT_ONCE), `비오늘=${nl.text.includes(TXT_K2)} 반복=${nl.text.includes(TXT_REPEAT)} 단건=${nl.text.includes(TXT_ONCE)}`);
  check('K2-④ DB 원본 셈(사장 total)이 비오늘 반복을 빼고 셌다', !occurs(created.k2, TODAY) && o1.sTotal === sHome?.total, `occurs=${occurs(created.k2, TODAY)}`);

  // ── 5. K3 직원 사진 완료 → 사장 홈 새로고침 없이 +1 ───────────────────
  section('4. K3 직원이 단건을 사진 1장으로 완료 → 사장 홈(새로고침 없음) done +1 · 20초 안');
  await go(S.page, 'S', '/owner/dashboard', '홈(대기)');
  const sBefore = await readOwnerHome(S.page);
  info(`사장 홈 전: ${sBefore?.done}/${sBefore?.total}`);
  let photoOk = false;
  let photoNote = '';
  try {
    await J.page.eval('window.__qaFileArm=true;window.__qaFileInput=null');
    await clickJs(J.page, `document.querySelector(${JSON.stringify(`[aria-label="${TXT_ONCE} 사진으로 완료"]`)})`, '사진으로 완료');
    if (!(await J.page.waitFor('!!window.__qaFileInput', 5000))) throw new Error('파일 입력이 안 만들어짐');
    const { result } = await J.page.send('Runtime.evaluate', { expression: 'window.__qaFileInput' });
    await J.page.send('DOM.enable');
    await J.page.send('DOM.setFileInputFiles', { files: [PNG], objectId: result.objectId });
    await sleep(500);
    // 떨어진(문서에 안 붙은) input 이라 change 가 안 올 수도 있다 → 파일이 들어갔으면 직접 쏜다.
    const n = await J.page.eval('window.__qaFileInput.files.length');
    if (!n) throw new Error('파일이 input 에 안 들어감');
    photoNote = 'DOM.setFileInputFiles';
    photoOk = true;
  } catch (e) {
    photoNote = `사진 자동화 실패: ${e.message}`;
  }
  const tDone0 = Date.now();
  if (photoOk) {
    // onchange 가 이미 돌았는지 2초 기다려 보고, 아니면 change 를 직접 쏜다.
    let row = null;
    for (let i = 0; i < 8 && !row; i++) { await sleep(250); row = (await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${O.id}&select=data`))[0]; }
    if (!row && !(await J.page.eval(`!document.querySelector('[aria-label="${TXT_ONCE} 사진으로 완료"]')`))) {
      await J.page.eval(`window.__qaFileInput.dispatchEvent(new Event('change'))`);
      photoNote += ' + change 직접 발사';
    }
  } else {
    info(`${photoNote} → 체크로 완료`);
    await clickJs(J.page, todoBoxJs(TXT_ONCE), `${TXT_ONCE} 체크`);
  }
  let sAfter = null;
  let secs = null;
  while (Date.now() - tDone0 < 20000) {
    const m = (await S.page.text()).match(/(\d+)% · (\d+)\/(\d+)/);
    if (m && +m[2] === (sBefore?.done ?? -9) + 1) { sAfter = { done: +m[2], total: +m[3] }; secs = ((Date.now() - tDone0) / 1000).toFixed(1); break; }
    await sleep(200);
  }
  const doneRows = await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${O.id}&work_date=eq.${TODAY}&select=data`);
  const mark = doneRows[0]?.data;
  if (mark?.photoUrl) createdPhotos.push(mark.photoUrl);
  check('K3-① 사진 1장으로 완료(화면 경로)', photoOk && !!mark?.photoUrl, `${photoNote} · photoUrl=${mark?.photoUrl ?? '없음'}`);
  check('K3-② DB work_done 1행 · by=이수민', doneRows.length === 1 && mark?.by === ids.J, `행 ${doneRows.length} · byName=${mark?.byName}`);
  const feedDone = (await sel(`work_feed?unit_id=eq.${UNIT}&data->>kind=eq.task_done&data->>refId=eq.${O.id}&select=id`)).length;
  check('K3-③ DB work_feed task_done 1행', feedDone === 1, `${feedDone}행`);
  check('K3-④ 사장 홈 done +1 · 새로고침 없이 20초 안', !!sAfter, sAfter ? `${sBefore.done}→${sAfter.done} · ${secs}초` : `20초 동안 ${sBefore?.done} 그대로`);
  await stat(J.page, 'J', '사진 완료');
  await stat(S.page, 'S', '홈(완료 반영 대기)');

  // ── 6. K4 벨 배정 항목 탭 → 착지 ───────────────────────────────────────
  section('5. K4 직원 벨 배정 항목 탭 → 착지 화면에 그 할일이 열려 있나');
  await go(J.page, 'J', '/junior/notifications', '알림');
  await readNotifRows(J.page);
  let k4 = { path: '?', search: '', first: '', visible: false };
  const k4Title = await J.page.eval(`(()=>{const l=${leafJs(TXT_REPEAT)};return l&&l.previousElementSibling?l.previousElementSibling.textContent.trim():'?';})()`);
  try {
    await clickJs(J.page, leafJs(TXT_REPEAT), `알림 행 ${TXT_REPEAT}`);
    await sleep(3500);
    k4 = await J.page.eval(`(()=>{const l=${leafJs(TXT_REPEAT)};let v=false;if(l){const r=l.getBoundingClientRect();v=r.top>=0&&r.bottom<=innerHeight;}return {path:location.pathname,search:location.search,first:document.body.innerText.split('\\n').map(s=>s.trim()).filter(Boolean).slice(0,2).join(' | '),visible:v};})()`);
  } catch (e) { k4.first = `탭 실패: ${e.message}`; }
  check('K4 벨 배정 항목 → 착지 화면에 그 할일이 열림(주소가 그 할일을 가리키고 화면에 보임)',
    k4.search.includes(R.id) && k4.visible, `벨 항목 "${k4Title} / ${TXT_REPEAT}" → 착지 ${k4.path}${k4.search} · 첫 줄 "${k4.first}" · 할일 보임=${k4.visible}`);
  const ownerName = (await sel(`profiles?id=eq.${R.created_by}&select=name`))[0]?.name;
  check('K4-0 벨 배정 항목 제목의 배정자 = DB created_by 의 이름', k4Title === `${ownerName}님이 할 일을 배정했어요`, `화면 "${k4Title}" · DB created_by=${ownerName}`);
  await stat(J.page, 'J', '벨 항목 탭');

  // ── 6-n. K4-n 벨 공지 항목 탭 → 착지(K4 와 같은 단언) ─────────────────────
  section('5-n. K4-n 직원 벨 공지 항목 탭 → 착지 주소·화면에 그 공지가 있나');
  // 공지는 DB 로 심는다(사장이 쓴 공지 1건과 같은 모양 · 푸시 없음). 끝 정리가 본문 접두사로 지운다.
  const nAt = new Date().toISOString();
  await ins('work_feed', {
    id: NOTICE_ID, unit_id: UNIT, feed_date: TODAY, room_id: 'room_main_store_001',
    data: { id: NOTICE_ID, date: TODAY, kind: 'notice', text: TXT_NOTICE, authorId: ids.S, authorName: ownerName, authorRole: 'owner', createdAt: nAt, reactions: {}, important: false, pinned: false, roomId: 'room_main_store_001' },
  });
  info(`K4-n 셋업: 공지 1건 DB 삽입(id ${NOTICE_ID})`);
  await go(J.page, 'J', '/junior/notifications', '알림(공지)');
  await readNotifRows(J.page);
  let kn = { path: '?', search: '', first: '', visible: false };
  try {
    if (!(await J.page.waitFor(`!!${leafJs(TXT_NOTICE)}`, 15000))) throw new Error('벨 목록에 공지 행이 없음');
    await clickJs(J.page, leafJs(TXT_NOTICE), `알림 행 ${TXT_NOTICE}`);
    await sleep(3500);
    kn = await J.page.eval(`(()=>{const l=${leafJs(TXT_NOTICE)};let v=false;if(l){const r=l.getBoundingClientRect();v=r.top>=0&&r.bottom<=innerHeight;}return {path:location.pathname,search:location.search,first:document.body.innerText.split('\\n').map(s=>s.trim()).filter(Boolean).slice(0,2).join(' | '),visible:v};})()`);
  } catch (e) { kn.first = `탭 실패: ${e.message}`; }
  check('K4-n-a 벨 공지 항목 → 착지 주소에 그 공지(피드) id 가 들어 있다 [문자열]',
    `${kn.path}${kn.search}`.includes(NOTICE_ID), `착지 ${kn.path}${kn.search} · 기대 포함 "${NOTICE_ID}" · 첫 줄 "${kn.first}"`);
  check('K4-n-b 착지 화면(보이는 영역)에 그 공지 본문 문자열이 있다 [문자열]', kn.visible, `본문 "${TXT_NOTICE}" 보임=${kn.visible}`);
  await stat(J.page, 'J', '벨 공지 탭');

  // ── 7. K5 두 번 완료 · 비담당 완료 ──────────────────────────────────────
  section('6. K5 같은 할일 두 번 완료 · 담당에서 빠진 사람의 완료 → 오류 문구 0');
  await go(J.page, 'J', '/junior/work?view=todo', '할일');
  await readTodoRows(J.page);
  const waitDone = (page, text, want, ms = 8000) => page.waitFor(`${want ? '!' : '!!'}document.querySelector(${JSON.stringify(`[aria-label="${text} 사진으로 완료"]`)})`, ms);
  /** 체크 상자 한 번 → (사진 있으면 확인창) → 화면 상태 확인 → 완료 뒤 뜨는 '이 업무, 어떻게 하셨어요?' 시트 건너뛰기. */
  async function toggle(page, text, want, what) {
    await clickJs(page, todoBoxJs(text), what);
    await sleep(500);
    if (await page.eval(`!!${leafJs('취소하고 사진 삭제')}`)) await clickLeaf(page, '취소하고 사진 삭제');
    const ok = await waitDone(page, text, want);
    await dismiss(page);
    if (!ok) throw new Error(`${what}: 화면이 ${want ? '완료' : '미완료'}로 안 바뀜`);
  }
  // (a) 한 사람이 완료 → 해제 → 완료
  for (const want of [true, false, true]) await toggle(J.page, TXT_REPEAT, want, `J ${want ? '완료' : '해제'}`);
  await sleep(1500);
  const rA = await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${R.id}&work_date=eq.${TODAY}&select=data`);
  const fA = (await sel(`work_feed?unit_id=eq.${UNIT}&data->>kind=eq.task_done&data->>refId=eq.${R.id}&select=id`)).length;
  const eA = await errLines(J.page);
  check('K5-a 직원 완료→해제→완료: 오류 문구 0', eA === 0, `${eA}건 ${eA ? await errContext(J.page) : ''} · 화면 상태 완료=${await todoDone(J.page, TXT_REPEAT)} · work_done ${rA.length}행 · task_done 피드 ${fA}행`);
  check('K5-a DB work_done 1행 · task_done 피드 1행', rA.length === 1 && fA === 1, `${rA.length}/${fA}`);
  await stat(J.page, 'J', 'K5-a');

  // (b) 두 창이 각각 완료 — 해제한 뒤 두 창이 미완료로 보이면 동시에 누른다.
  await go(S.page, 'S', '/owner/work?view=todo', '업무 탭');
  await readTodoRows(S.page);
  const sSawDone = await todoDone(S.page, TXT_REPEAT);
  const tU = Date.now(); // 직원 클릭부터 잰다(toggle 안에 화면 확인·시트 건너뛰기 2~3초가 들어 있다)
  await toggle(J.page, TXT_REPEAT, false, 'J 해제');
  const sSawUndone = await waitDone(S.page, TXT_REPEAT, false, 20000);
  check('K5-b0 직원이 완료를 해제하면 사장 업무 탭(새로고침 없음)도 20초 안에 미완료로 바뀐다', sSawDone && sSawUndone,
    `사장 화면 시작=완료 ${sSawDone} → 해제 반영 ${sSawUndone ? `${((Date.now() - tU) / 1000).toFixed(1)}초` : '20초 동안 안 됨'} · DB work_done ${(await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${R.id}&work_date=eq.${TODAY}&select=template_id`)).length}행`);
  if (!sSawUndone) {
    info('사장 화면이 낡아 동시 완료 시험이 무의미해진다 → 사장 창만 새로고침하고 진행');
    await go(S.page, 'S', '/owner/work?view=todo', '업무 탭(새로고침)');
    await readTodoRows(S.page);
  }
  await Promise.all([clickJs(J.page, todoBoxJs(TXT_REPEAT), 'J 체크'), clickJs(S.page, todoBoxJs(TXT_REPEAT), 'S 체크')]);
  await Promise.all([dismiss(J.page), dismiss(S.page)]);
  await sleep(3000);
  const rB = await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${R.id}&work_date=eq.${TODAY}&select=data`);
  const fB = (await sel(`work_feed?unit_id=eq.${UNIT}&data->>kind=eq.task_done&data->>refId=eq.${R.id}&select=id`)).length;
  const eB = (await errLines(J.page)) + (await errLines(S.page));
  check('K5-b 두 창 동시 완료: 오류 문구 0', eB === 0,
    `${eB}건 ${eB ? (await errContext(J.page)) + ' ' + (await errContext(S.page)) : ''} · S가 해제를 봄=${sSawUndone} · 화면 완료 J=${await todoDone(J.page, TXT_REPEAT)} S=${await todoDone(S.page, TXT_REPEAT)} · work_done ${rB.length}행 by=${rB[0]?.data?.byName}`);
  check('K5-b DB work_done 1행 · task_done 피드 1행(중복 완료 알림 없음)', rB.length === 1 && fB === 1, `work_done ${rB.length} · 피드 ${fB}`);
  await stat(J.page, 'J', 'K5-b');
  await stat(S.page, 'S', 'K5-b');

  // (d) 두 창 동시 완료 해제 — 반복 할일은 지금 완료 1행. 두 창이 완료로 보일 때 동시에 해제한다.
  //   두 번째 해제는 DELETE 0행 → clearDone false → '완료 해제 저장에 실패했어요' + 롤백(DB:3203 · WS:1188).
  for (const [tag, w, path] of [['J', J, '/junior/work?view=todo'], ['S', S, '/owner/work?view=todo']]) {
    if (!(await waitDone(w.page, TXT_REPEAT, true, 10000))) {
      info(`K5-d 셋업: ${tag} 화면이 완료로 안 보여 새로고침`);
      await go(w.page, tag, path, '할일(새로고침)');
      await readTodoRows(w.page);
    }
  }
  const dPre = { J: await todoDone(J.page, TXT_REPEAT), S: await todoDone(S.page, TXT_REPEAT) };
  await Promise.all([clickJs(J.page, todoBoxJs(TXT_REPEAT), 'J 해제'), clickJs(S.page, todoBoxJs(TXT_REPEAT), 'S 해제')]);
  await sleep(3000);
  const rD = await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${R.id}&work_date=eq.${TODAY}&select=template_id`);
  const eD = (await errLines(J.page)) + (await errLines(S.page));
  const dPost = { J: await todoDone(J.page, TXT_REPEAT), S: await todoDone(S.page, TXT_REPEAT) };
  check('K5-d 두 창 동시 완료 해제: 오류 문구 0 [건]', eD === 0,
    `${eD}건 ${eD ? (await errContext(J.page)) + ' ' + (await errContext(S.page)) : ''} · 해제 전 화면 완료 J=${dPre.J} S=${dPre.S}`);
  check('K5-d DB work_done 0행 [건]', rD.length === 0, `work_done ${rD.length}행`);
  check('K5-d 두 화면 모두 미완료 [문자열]', !dPost.J && !dPost.S, `화면 완료 J=${dPost.J} S=${dPost.S}`);
  await stat(J.page, 'J', 'K5-d');
  await stat(S.page, 'S', 'K5-d');
  // 남은 실패 배너가 다음 단계(단건 해제) 클릭을 덮지 않게 직원 창을 새로 연다.
  await go(J.page, 'J', '/junior/work?view=todo', '할일(K5-d 뒤)');
  await readTodoRows(J.page);

  // (c) 담당 아닌 매니저가 단건을 완료 — 직원 완료(사진)를 먼저 해제한다.
  await toggle(J.page, TXT_ONCE, false, 'J 단건 해제(사진 삭제 확인)');
  await sleep(1500);
  const M = await open(9345, await sessionOf(FIXED.manager));
  try {
    await go(M.page, 'M', '/junior/work?view=todo', '할일');
    await dismiss(M.page);
    await readTodoRows(M.page);
    const mPath = await M.page.path();
    await toggle(M.page, TXT_ONCE, true, '매니저 단건 완료');
    await sleep(1500);
    const rC = await sel(`work_done?unit_id=eq.${UNIT}&template_id=eq.${O.id}&work_date=eq.${TODAY}&select=data`);
    const eC = await errLines(M.page);
    check('K5-c 비담당(매니저 박지원) 단건 완료: 오류 문구 0', eC === 0,
      `${eC}건 ${eC ? await errContext(M.page) : ''} · 착지 ${mPath} · 화면 완료=${await todoDone(M.page, TXT_ONCE)} · work_done ${rC.length}행 byName=${rC[0]?.data?.byName}(서버 거부 없음=비담당 완료 허용)`);
    await stat(M.page, 'M', 'K5-c');
  } finally { await M.close(); }

  // ── 7-a. K6-a 기기 0건 직원에게 배정 → 사장 화면 안내 ────────────────────
  section('6-a. K6-a 기기 토큰 0건 직원(이수민)에게 배정 → 사장 화면에 "알림 받을 기기가 없어요" 류 안내');
  const tokN = (await sel(`push_device_tokens?user_id=eq.${ids.J}&select=user_id`)).length;
  info(`직원 기기 토큰(push_device_tokens) = ${tokN}건`);
  let k6Toasts = [];
  let k6Note = '';
  try {
    await compose(TXT_K6, { weekly: false, assignees: [NAME_J], armToast: true });
    await sleep(1000);
    k6Toasts = [...new Set((await S.page.eval('window.__qaToasts||[]')) ?? [])];
  } catch (e) { k6Note = `화면 배정 실패: ${e.message}`; }
  const k6Text = k6Toasts.filter((t) => !t.includes(TXT_K6) && /추가했어요|기기|알림|설치/.test(t)).join(' / ');
  if (tokN === 0) check('K6-a 기기 0건 직원 배정 직후 "알림 받을 기기가 없어요" 류 안내가 있다 [문자열]', /기기|알림을? (못|안) 받|앱을? 설치/.test(k6Text), `안내="${k6Text}" ${k6Note}`);
  else check('K6-a (전제) 직원 기기 토큰 0건 [건]', false, `토큰 ${tokN}건 — 기기 0건 상태가 아님`);
  await stat(S.page, 'S', 'K6-a');

  // ── 8. 전환별 콘솔 에러·≥400 합계 ───────────────────────────────────────
  section('7. 화면 전환 합계');
  await stat(S.page, 'S', '끝');
  await stat(J.page, 'J', '끝');
  check('전환 전체: 콘솔 에러 0 · ≥400(fetch) 0', totals.err === 0 && totals.bad === 0, `콘솔 ${totals.err} · ≥400 ${totals.bad}`);
} catch (e) {
  fail++;
  console.log('  ✗ 하니스 중단', e.message);
} finally {
  await S.close();
  await J.close();
  await cleanup('끝').catch((e) => console.log('  ! 정리 실패', e.message));
  await restoreActive(cs, prevActive.S);
  await restoreActive(cj, prevActive.J);
  await restoreActive(cm, prevActive.M);
}
console.log(`\n소요 ${((Date.now() - T0) / 1000).toFixed(0)}초`);
console.log(fail ? `RED ${pass}/${fail}` : `GREEN ${pass}/0`);
process.exit(fail ? 1 : 0);
