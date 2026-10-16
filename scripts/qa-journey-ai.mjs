// qa-journey-ai.mjs — 직원 AI 질문 → 사장 답 → 재질의 여정 하니스(2026-10-15).
//
//   node scripts/qa-journey-ai.mjs        (개발 서버 http://localhost:8081 이 떠 있어야 한다 · QA_ORIGIN 으로 바꾼다)
//
// 직원 창(J, 포트 9363)과 사장 창(S, 포트 9364)을 한 스크립트에서 동시에 연다(scripts/lib/cdp.mjs).
// 화면 문자열과 DB 원본(service_role 읽기 · .env.seed)을 맞대어 단언한다. 고정 계정만 쓴다(계정 신설 없음).
//   직원 staff2@pilot.squaretable.app · 사장 owner@pilot.squaretable.app · 매장 store_001
//
// ★만드는 데이터는 전부 토큰 qa_jr_ai_<ts> 가 붙는다. 지우는 것도 그것만이다(시작·끝 두 번 · 멱등):
//   unknown_queries(본문에 qa_jr_ai_) · chat_queries(본문에 qa_jr_ai_) · 그 질문을 해결한 playbook_entries
//   (행 내용에 qa_jr_ai_ 가 있을 때만) · playbook_embeddings.
// ★AI 호출 상한: 직원 질문 제출은 3번(있는 질문 · 없는 질문 · 재질의)이다. 재질의가 10초에 출처를 못 붙이면
//   30초에 한 번 더 묻는다(4번째). 제출 1번이 엣지 ai 를 여러 번 부른다(triage 는 항상 · intent 는 긴 질문 ·
//   answer 는 후보가 애매할 때). 그래서 엣지 호출을 task 별로 센다(페이지 fetch 를 감싸 sessionStorage 에 적는다).
//   과금 단위(answer)가 3을 넘거나 LLM 호출 합이 QA_JR_AI_LLM_MAX(기본 10)를 넘으면 더 묻지 않는다.
// ★K5 '같은 질문 두 번 보내기'는 제출이 1번 더 든다 → 기본 꺼짐. QA_JR_AI_DUP=1 로 켠다.
// ★건너뛴 것을 통과로 세지 않는다. 마지막 줄 = GREEN n/0 또는 RED n/m. 실패면 exit 1.
// 자동화 불가: 푸시 도달(q-answered → /junior/chat) · 실기기 알림 탭 착지.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, UNIT, login, rolePrecondition, ensureActive, restoreActive } from './lib/qa-fixed-accounts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const f of ['.env', '.env.seed']) {
  try {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* 없으면 아래에서 막힌다 */ }
}
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = env.QA_ORIGIN ?? 'http://localhost:8081';
if (!SB || !ANON || !SRV) { console.error('FAIL: .env(URL·ANON) + .env.seed(SUPABASE_SERVICE_ROLE_KEY) 필요'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const T0 = Date.now();
const TOKEN = `qa_jr_ai_${T0.toString(36)}`;
const PREFIX = 'qa_jr_ai_';
const W = 460, H = 900;
const LLM_TASKS = ['triage', 'intent', 'answer', 'square', 'patch'];
const LLM_MAX = Number(env.QA_JR_AI_LLM_MAX ?? 10);
const DUP = env.QA_JR_AI_DUP === '1';
const STORAGE_KEY = storageKeyFor(SB);
const db = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0;
let fail = 0;
const failed = [];
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; failed.push(n); console.log('  ✗', n, extra); }
};
const section = (t) => console.log(`\n── ${t}`);
const log = (s) => console.log('   ·', s);
const secs = (ms) => (ms / 1000).toFixed(1);

// ── DB ─────────────────────────────────────────────────────────────
const kstMonth = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
async function aiUsed() {
  const { data } = await db.from('ai_usage_monthly').select('used').eq('unit_id', UNIT).eq('month', kstMonth()).maybeSingle();
  return data?.used ?? 0;
}
async function dbPending() {
  const { count, error } = await db.from('unknown_queries').select('id', { count: 'exact', head: true })
    .eq('unit_id', UNIT).eq('status', 'pending_owner_answer');
  if (error) throw new Error(`pending 집계 실패: ${error.message}`);
  return count;
}
async function dbPendingSuggestions(ownerId) {
  const { data } = await db.from('playbook_suggestions').select('proposer_id').eq('unit_id', UNIT).eq('status', 'pending');
  return (data ?? []).filter((s) => s.proposer_id !== ownerId).length;
}
const uqRows = async (text) =>
  (await db.from('unknown_queries').select('id,status,similar_queries_count,resolved_with_entry_id,query_text')
    .eq('unit_id', UNIT).eq('query_text', text)).data ?? [];

/** 하니스가 만든 것만 지운다. 몇 개 지웠는지 돌려준다. */
async function cleanup(label) {
  const { data: uqs } = await db.from('unknown_queries').select('id,resolved_with_entry_id').eq('unit_id', UNIT).ilike('query_text', `%${PREFIX}%`);
  const linked = (uqs ?? []).map((u) => u.resolved_with_entry_id).filter(Boolean);
  // 노하우는 행 내용에 토큰이 있을 때만 지운다 — 기존 노하우로 답한 경우(answerWithExisting) 남의 노하우를 지우지 않게.
  const { data: byTitle } = await db.from('playbook_entries').select('*').eq('unit_id', UNIT).ilike('title', `%${PREFIX}%`);
  const { data: byLink } = linked.length ? await db.from('playbook_entries').select('*').in('id', linked) : { data: [] };
  const entryIds = [...new Set([...(byTitle ?? []), ...(byLink ?? [])].filter((e) => JSON.stringify(e).includes(PREFIX)).map((e) => e.id))];
  const skipped = linked.filter((id) => !entryIds.includes(id));
  const n = { uq: 0, chat: 0, emb: 0, entry: 0 };
  if (uqs?.length) n.uq = (await db.from('unknown_queries').delete().in('id', uqs.map((u) => u.id)).select('id')).data?.length ?? 0;
  n.chat = (await db.from('chat_queries').delete().eq('unit_id', UNIT).ilike('query_text', `%${PREFIX}%`).select('id')).data?.length ?? 0;
  if (entryIds.length) {
    n.emb = (await db.from('playbook_embeddings').delete().in('entry_id', entryIds).select('entry_id')).data?.length ?? 0;
    n.entry = (await db.from('playbook_entries').delete().in('id', entryIds).select('id')).data?.length ?? 0;
  }
  log(`정리(${label}): 질문 ${n.uq} · 대화 ${n.chat} · 임베딩 ${n.emb} · 노하우 ${n.entry}${skipped.length ? ` · 토큰 없는 연결 노하우 ${skipped.length}개는 안 지움(${skipped})` : ''}`);
  return n;
}

// ── 브라우저 ───────────────────────────────────────────────────────
async function passwordSession(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: 'pilot1234' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}

// 페이지 fetch 를 감싸 엣지 ai 호출(task)과 ≥400 응답을 sessionStorage 에 적는다.
// ★localStorage 는 seedSession 이 새 문서마다 비우므로 쓰지 않는다. sessionStorage 는 같은 탭의 이동·새로고침을 견딘다.
const FETCH_TAP = `(()=>{if(window.__qaTap)return;window.__qaTap=1;const of=window.fetch.bind(window);
const push=(k,v)=>{try{const a=JSON.parse(sessionStorage.getItem(k)||'[]');a.push(v);sessionStorage.setItem(k,JSON.stringify(a));}catch(e){}};
window.fetch=async(input,init)=>{const url=typeof input==='string'?input:(input&&input.url)||String(input);let task=null;
if(url.includes('/functions/v1/ai')){try{task=JSON.parse((init&&init.body)||'{}').task||'answer';}catch(e){task='?';}}
try{const r=await of(input,init);if(task)push('__qa_ai',{task,s:r.status});if(r.status>=400)push('__qa_bad',{u:url.replace(/\\?.*/,'').slice(-70),s:r.status,p:location.pathname});return r;}
catch(e){if(task)push('__qa_ai',{task,s:0});throw e;}};})();`;

async function openWindow(port, session) {
  const w = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width: W, height: H, port });
  await w.page.seedSession(session);
  await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_TAP });
  w.mark = { err: 0, bad: 0 };
  return w;
}
const readSS = (page, k) => page.eval(`JSON.parse(sessionStorage.getItem('${k}')||'[]')`).catch(() => []);

/** 화면 전환마다 새로 생긴 콘솔 에러·≥400 응답 수. */
async function transition(w, name, label) {
  const bad = await readSS(w.page, '__qa_bad');
  const newErr = w.page.errors.slice(w.mark.err);
  const newBad = bad.slice(w.mark.bad);
  w.mark = { err: w.page.errors.length, bad: bad.length };
  log(`[${name}] ${label}: 콘솔 에러 ${newErr.length} · ≥400 ${newBad.length}${newBad.length ? ' ' + JSON.stringify(newBad.slice(0, 3)) : ''}${newErr.length ? ' ' + JSON.stringify(newErr.slice(0, 2).map((e) => String(e).slice(0, 120))) : ''}`);
}

async function aiCalls(wins) {
  const all = [];
  for (const w of wins) if (w) all.push(...(await readSS(w.page, '__qa_ai')));
  const by = {};
  for (const c of all) by[c.task] = (by[c.task] ?? 0) + 1;
  const llm = LLM_TASKS.reduce((s, t) => s + (by[t] ?? 0), 0);
  return { by, llm, answer: by.answer ?? 0, total: all.length };
}

// ── J 화면 헬퍼 ───────────────────────────────────────────────────
const J_INPUT = '[placeholder="궁금한 걸 물어보세요"]';
const J_SEND = '[aria-label="질문 보내기"]';
// 가장 최근 말풍선(질문 원문과 글자가 같은 잎 요소) 기준으로 그 뒤의 텍스트·라벨을 읽는다.
const turnExpr = (q) => `(()=>{const Q=${JSON.stringify(q)};
const leaves=[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&e.textContent.trim()===Q&&e.getBoundingClientRect().width>0);
const b=leaves[leaves.length-1];if(!b)return {found:false};
const t=document.body.innerText;const after=t.slice(t.lastIndexOf(Q)+Q.length);
const labels=[...document.querySelectorAll('[aria-label]')].filter(e=>b.compareDocumentPosition(e)&4).map(e=>e.getAttribute('aria-label'));
const inp=document.querySelector(${JSON.stringify(J_INPUT)});
return {found:true,after,labels,inputReady:!!inp&&!inp.readOnly&&!inp.disabled};})()`;
const ANSWER_MARKERS = ['원문 보기', '참고한 노하우', '사장님께 보낼까요?', '혹시 이거 찾으세요?', '보내지 않았어요', '사장님께 보냈어요'];

/** 말풍선 뒤에서 글자가 정확히 같은 잎 요소에 표시를 달고 좌표로 누른다. */
async function clickTextAfter(page, q, text, tag) {
  const ok = await page.eval(`(()=>{const Q=${JSON.stringify(q)};
const leaves=[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&e.textContent.trim()===Q&&e.getBoundingClientRect().width>0);
const b=leaves[leaves.length-1];const els=[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&e.textContent.trim()===${JSON.stringify(text)}&&(!b||(b.compareDocumentPosition(e)&4))&&e.getBoundingClientRect().width>0);
const e=els[0];if(!e)return false;e.setAttribute('data-qa',${JSON.stringify(tag)});return true;})()`);
  if (!ok) return false;
  await page.click(`[data-qa="${tag}"]`);
  return true;
}
/** 화면 어디든 글자가 같은 잎 요소를 누른다(사장 화면 탈출구 칩처럼 라벨 없는 버튼). */
async function clickText(page, text, tag) {
  const ok = await page.eval(`(()=>{const els=[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0);
const e=els[els.length-1];if(!e)return false;e.setAttribute('data-qa',${JSON.stringify(tag)});return true;})()`);
  if (!ok) return false;
  await page.click(`[data-qa="${tag}"]`);
  return true;
}

let asked = 0;
/** J 가 질문을 보내고 답 블록이 뜰 때까지 기다린다. 상한을 넘으면 묻지 않는다(null). */
async function ask(J, wins, q, why) {
  const c = await aiCalls(wins);
  if (c.answer >= 3 || c.llm >= LLM_MAX) {
    log(`상한 도달 — '${why}' 질문을 보내지 않음(answer ${c.answer} · LLM ${c.llm}/${LLM_MAX})`);
    return null;
  }
  asked++;
  const before = await aiCalls([J]);
  const t = Date.now();
  await J.page.waitFor(`!!document.querySelector(${JSON.stringify(J_INPUT)})`, 30000);
  await J.page.type(J_INPUT, q);
  await sleep(300);
  await J.page.click(J_SEND);
  let info = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    info = await J.page.eval(turnExpr(q)).catch(() => null);
    if (info?.found && info.inputReady && ANSWER_MARKERS.some((m) => info.after.includes(m))) break;
    // 잡담 응대처럼 표시가 없는 답 — 입력이 다시 열리고 6초 지나면 끝난 것으로 본다.
    if (info?.found && info.inputReady && Date.now() - t > 6000 && (await J.page.eval(`!document.querySelector('[role="progressbar"]')`).catch(() => true))) {
      await sleep(1500);
      info = await J.page.eval(turnExpr(q)).catch(() => info);
      if (ANSWER_MARKERS.some((m) => info.after.includes(m)) || Date.now() - t > 20000) break;
    }
    await sleep(400);
  }
  await sleep(800); // 늦게 붙는 칩·버튼
  info = await J.page.eval(turnExpr(q)).catch(() => info);
  const after = await aiCalls([J]);
  const delta = Object.fromEntries(Object.entries(after.by).map(([k, v]) => [k, v - (before.by[k] ?? 0)]).filter(([, v]) => v));
  log(`질문 #${asked}(${why}) ${secs(Date.now() - t)}초 · 엣지 ai ${JSON.stringify(delta)}`);
  return info ?? { found: false, after: '', labels: [] };
}
const sourceTitles = (info) => (info?.labels ?? [])
  .map((l) => l.match(/^(.*) (원문|원본) 보기$/)?.[1])
  .filter(Boolean);
const head200 = (s) => JSON.stringify((s ?? '').replace(/\n+/g, ' ⏎ ').slice(0, 200));

// ── S 화면 헬퍼 ───────────────────────────────────────────────────
const heroValue = async (S) => {
  const v = await S.page.eval(`(document.body.innerText.match(/답 기다리는 질문\\n([^\\n]+)/)||[])[1]||null`);
  if (v == null) return null;
  if (v.includes('없어요')) return 0;
  const m = v.match(/(\d+)건/);
  return m ? Number(m[1]) : null;
};
const tabBadge = (S) => S.page.eval(`(()=>{const els=[...document.querySelectorAll('[aria-label="노하우"]')].filter(e=>e.getBoundingClientRect().width>0);const e=els[els.length-1];if(!e)return null;const m=e.innerText.match(/(\\d+)/);return m?Number(m[1]):0;})()`);
const segTodo = (S) => S.page.eval(`(()=>{const e=document.querySelector('[aria-label="할 일"]');if(!e)return null;const m=e.innerText.match(/(\\d+)/);return m?Number(m[1]):0;})()`);
// 사장 벨 질문 항목 제목 = '<질문자>님의 질문'(10-16 P1 · 레지스트리 question.title · 옛 제목 '답 기다리는 질문이 있어요').
const bellQuestionItems = (S) => S.page.eval(`(document.body.innerText.match(/님의 질문(?=\\n)/g)||[]).length`);
const bellLabel = (S) => S.page.eval(`(()=>{const e=[...document.querySelectorAll('[aria-label^="알림"]')].find(x=>/^알림( \\d+건)?$/.test(x.getAttribute('aria-label')));return e?e.getAttribute('aria-label'):null;})()`);

async function stable(fn, ms = 2500) {
  let prev = await fn();
  for (let i = 0; i < 6; i++) {
    await sleep(ms / 2);
    const cur = await fn();
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
}
/** 사장 네 자리를 차례로 읽는다(홈 → 노하우 탭 → 알림). 끝나면 홈으로 돌아온다. */
async function ownerFour(S, label) {
  await S.page.goto('/owner/dashboard');
  await S.page.waitFor(`document.body.innerText.includes('답 기다리는 질문')`, 40000);
  const hero = await stable(() => heroValue(S));
  const badge = await stable(() => tabBadge(S));
  await transition(S, 'S', `${label} 홈`);
  await S.page.goto('/owner/categories');
  await S.page.waitFor(`!!document.querySelector('[aria-label="할 일"]')`, 40000);
  const seg = await stable(() => segTodo(S), 3000);
  await transition(S, 'S', `${label} 노하우 탭`);
  await S.page.goto('/owner/notifications');
  await S.page.waitFor(`document.body.innerText.includes('알림')`, 40000);
  await sleep(2500);
  const bell = await stable(() => bellQuestionItems(S), 3000);
  await transition(S, 'S', `${label} 알림`);
  await S.page.goto('/owner/dashboard');
  await S.page.waitFor(`document.body.innerText.includes('답 기다리는 질문')`, 40000);
  await sleep(1500);
  return { hero, badge, seg, bell };
}

// ── 시작 ───────────────────────────────────────────────────────────
console.log(`qa-journey-ai · 토큰 ${TOKEN} · ${ORIGIN}`);
const owner = await login(SB, ANON, FIXED.owner);
const junior = await login(SB, ANON, FIXED.junior);
const pre = await rolePrecondition({ owner, junior });
if (pre) { console.error(`FAIL: 전제 깨짐 — ${pre}`); process.exit(2); }
const prevOwner = await ensureActive(owner);
const prevJunior = await ensureActive(junior);
const ownerSess = await passwordSession(FIXED.owner);
const juniorSess = await passwordSession(FIXED.junior);

let J = null;
let S = null;
let finalCalls = null;
let used0 = null;
try {
  section('0. 준비 — 정리 · 기준선');
  await cleanup('시작');
  const P0 = await dbPending();
  used0 = await aiUsed();
  log(`DB 기준선: store_001 대기 질문 ${P0}건 · AI 사용 ${kstMonth()} ${used0}단위`);

  // 있는 노하우 하나 — 제목이 하나뿐이고 보관 안 된 것.
  const { data: ents } = await db.from('playbook_entries').select('id,title,status,archived_at').eq('unit_id', UNIT).eq('status', 'published').is('archived_at', null);
  const counts = {};
  for (const e of ents ?? []) counts[e.title] = (counts[e.title] ?? 0) + 1;
  const pool = (ents ?? []).filter((e) => counts[e.title] === 1 && !/qa|QA|test/i.test(e.title) && e.title.length >= 4 && e.title.length <= 20);
  const prefer = ['냉장고 온도 점검', '마감 시재 정산', '와이파이 비밀번호 안내', '에스프레소 머신 청소'];
  const known = pool.find((e) => prefer.includes(e.title)) ?? pool[0];
  if (!known) throw new Error('store_001 에 고를 노하우가 없어요');
  log(`있는 노하우 = "${known.title}" (${known.id})`);

  [J, S] = await Promise.all([openWindow(9363, juniorSess), openWindow(9364, ownerSess)]);
  const wins = () => [J, S];
  await Promise.all([J.page.goto('/junior/chat'), S.page.goto('/owner/dashboard')]);
  const jReady = await J.page.waitFor(`!!document.querySelector(${JSON.stringify(J_INPUT)})`, 60000);
  const sReady = await S.page.waitFor(`document.body.innerText.includes('답 기다리는 질문')`, 60000);
  check('준비: J 물어보기 입력창 · S 홈 히어로가 뜬다', jReady && sReady, `J=${jReady} S=${sReady}`);
  if (!jReady || !sReady) throw new Error('화면 준비 실패');
  await transition(J, 'J', '물어보기 진입');

  // ── 1. 있는 질문 ───────────────────────────────────────────────
  section('1. 있는 노하우로 질문 — 출처 제목 = DB 제목');
  const Q1 = `${known.title} 어떻게 해요? ${TOKEN}`;
  const a1 = await ask(J, wins(), Q1, '있는 질문');
  if (!a1) check('1 있는 질문 제출(상한 안)', false);
  else {
    const titles = sourceTitles(a1);
    const generated = a1.after.includes('AI가 정리한 답');
    log(`출처 제목(화면) = ${JSON.stringify(titles)} · 모드 = ${generated ? '여러 노하우 정리(generated)' : '저장된 답(served)'} · 첫 200자 ${head200(a1.after)}`);
    check(`1 답 블록에 출처가 붙고 그중 하나가 DB 제목 "${known.title}"과 같다(단위 = 문자열 일치)`, titles.includes(known.title), `화면=${JSON.stringify(titles)}`);
  }
  await transition(J, 'J', '있는 질문 답');

  // ★있는 질문 뒤에 잰다 — 있는 질문이 '안 쓰인 노하우'를 인용하면 세그먼트 '할 일'이 1 줄어 변화량이 섞인다(1차 실행 실측).
  section('K1 기준선 — 사장 네 자리(있는 질문 뒤 · 없는 질문 보내기 전)');
  const base = await ownerFour(S, '기준선');
  log(`화면 기준선: 홈 ${base.hero}건 · 탭 배지 ${base.badge} · 세그먼트 '할 일' ${base.seg} · 벨 질문 항목 ${base.bell} (단위 = 질문 수 · DB ${await dbPending()})`);

  // ── 2. 없는 질문 ───────────────────────────────────────────────
  section('2. 없는 질문 — 지어내지 않고 사장님께 보낼지 묻는다');
  const Q2 = `${TOKEN} 지하 창고 제습기 필터는 몇 달마다 갈아요?`;
  const a2 = await ask(J, wins(), Q2, '없는 질문');
  let kind = 'none';
  if (a2) {
    if (a2.after.includes('사장님께 보낼까요?') || a2.after.includes('아직 매장에 없는 질문이에요')) kind = 'deflect';
    else if (a2.after.includes('혹시 이거 찾으세요?')) kind = 'candidate';
    else if (sourceTitles(a2).length || a2.after.includes('원문 보기') || a2.after.includes('참고한 노하우')) kind = 'answer';
    else kind = 'other';
    log(`분기 = ${kind} · 첫 200자 ${head200(a2.after)}`);
    if (kind === 'answer') log(`출처 = ${JSON.stringify(sourceTitles(a2))} — 매장에 없는 질문에 노하우 답이 붙었다(P1 후보)`);
  }
  check('2 없는 질문 → DeflectCard(아직 매장에 없는 질문이에요) 또는 CandidateCard(사장님께 물어보기)', kind === 'deflect' || kind === 'candidate', `분기=${kind}`);
  await transition(J, 'J', '없는 질문 답');

  // ── 3. 질문 보내기 ─────────────────────────────────────────────
  section('3. 질문 보내기 → 화면 문구 + DB pending 1행');
  let tSent = null;
  let uq = null;
  if (kind === 'deflect' || kind === 'candidate') {
    const btn = kind === 'deflect' ? '질문 보내기' : '찾는 게 없어요 · 사장님께 물어보기';
    // G② 질문 보내기 상한(0033 too_many_pending → blocked · BLOCKED_TEXT): 이 직원의 대기 질문을 10건으로 채워 두고 누르면
    //   화면은 '대기 중인 질문이 많아요' 를 말하고 DB 에 행이 안 생기며 카드는 보내기 전으로 돌아와야 한다(useChatStore 되돌림).
    //   채운 것을 지우고 아래에서 다시 누르면 정상 전송이다.
    {
      const { count: pj } = await db.from('unknown_queries').select('id', { count: 'exact', head: true })
        .eq('unit_id', UNIT).eq('junior_id', junior.uid).eq('status', 'pending_owner_answer');
      const need = Math.max(0, 10 - (pj ?? 0));
      const fillers = Array.from({ length: need }, (_, i) => ({
        id: `uq_${TOKEN}_cap${i}`, unit_id: UNIT, junior_id: junior.uid, junior_name: 'QA직원', query_text: `${TOKEN} 상한 채우기 ${i}`,
        presumed_category: 'Routine', presumed_subcategory: '', status: 'pending_owner_answer', fallback_action: '', ai_general_answer: '',
      }));
      // ★직원 세션으로 심는다 — 0007 트리거가 insert 때 junior_id := auth.uid() 로 덮어써서, service role 로 넣으면 junior_id 가 null 이 되어 상한(0033)에 안 센다.
      const { error: fErr } = need ? await junior.from('unknown_queries').insert(fillers) : { error: null };
      log(`G② 직원 대기 질문 ${pj}건 → 채움 ${need}건${fErr ? ' · 채우기 실패 ' + fErr.message : ''}`);
      const clickedCap = !fErr && (await clickTextAfter(J.page, Q2, btn, 'qa-jr-register-cap'));
      const blockedShown = clickedCap && (await J.page.waitFor(`document.body.innerText.includes('대기 중인 질문이 많아요')`, 10000));
      const rowsCap = await uqRows(Q2);
      const backToAsk = clickedCap && (await J.page.waitFor(`(()=>{const t=document.body.innerText;const a=t.slice(t.lastIndexOf(${JSON.stringify(Q2)}));return a.includes('사장님께 보낼까요?')||a.includes('혹시 이거 찾으세요?');})()`, 5000));
      check("G② 상한(10건)에서 보내기 → 화면 '대기 중인 질문이 많아요'(BLOCKED_TEXT too_many_pending) · DB 행 0 · 카드가 보내기 전으로",
        clickedCap && blockedShown && rowsCap.length === 0 && backToAsk, `클릭=${clickedCap} 문구=${blockedShown} 행=${rowsCap.length} 카드복귀=${backToAsk}`);
      if (need) await db.from('unknown_queries').delete().in('id', fillers.map((f) => f.id));
      await transition(J, 'J', '질문 보내기(상한)');
    }
    const clicked = await clickTextAfter(J.page, Q2, btn, 'qa-jr-register');
    tSent = Date.now();
    check(`3 '${btn}' 버튼(카드 안 · 입력창 전송 버튼과 다른 것)을 찾아 누른다`, clicked);
    const okText = await J.page.waitFor(`(()=>{const t=document.body.innerText;const a=t.slice(t.lastIndexOf(${JSON.stringify(Q2)}));return a.includes('사장님께 보냈어요')||a.includes('사장님께 전달했어요');})()`, 15000);
    const after3 = (await J.page.eval(turnExpr(Q2)))?.after ?? '';
    const which = after3.includes('사장님께 전달했어요') ? "'사장님께 전달했어요'" : after3.includes('사장님께 보냈어요') ? "'사장님께 보냈어요'(DeflectCard 문구)" : '없음';
    log(`보낸 뒤 문구 = ${which}`);
    check("3 보낸 뒤 '사장님께 보냈어요/전달했어요' 문구가 뜬다", okText);
    const errText = /못했어요|실패했어요/.test(after3);
    check('3 보낸 뒤 오류 문구 0건', !errText, head200(after3));
    let rows = [];
    for (let i = 0; i < 20; i++) { rows = await uqRows(Q2); if (rows.length) break; await sleep(500); }
    uq = rows[0] ?? null;
    check('3 DB unknown_queries 에 그 문장의 행이 정확히 1개 · status=pending_owner_answer · similar=0',
      rows.length === 1 && uq.status === 'pending_owner_answer' && uq.similar_queries_count === 0, JSON.stringify(rows));
  } else {
    check('3 질문 보내기(앞 단계 분기가 카드가 아니라 못 함)', false, `분기=${kind}`);
  }
  await transition(J, 'J', '질문 보내기');

  // ── 5. 실시간 ──────────────────────────────────────────────────
  section('K3·⑤ S 창 새로고침 없이 홈 수가 +1 되는가(30초)');
  if (tSent) {
    let hero = null, dbNow = null, at = null;
    const bell0 = await bellLabel(S);
    while (Date.now() - tSent < 30000) {
      hero = await heroValue(S);
      dbNow = await dbPending();
      if (hero != null && hero === dbNow && dbNow >= P0 + 1) { at = Date.now() - tSent; break; }
      await sleep(500);
    }
    const bell1 = await bellLabel(S);
    log(`홈 히어로 ${base.hero}→${hero} · DB ${P0}→${dbNow} · 벨 라벨 '${bell0}'→'${bell1}' · 걸린 시간 ${at == null ? '30초 넘음' : secs(at) + '초'}`);
    check('K3 보낸 뒤 30초 안에 S 홈 "답 기다리는 질문" 수가 새로고침 없이 DB 수(+1)와 같아진다(단위 = 질문 건수)', at != null, `hero=${hero} db=${dbNow}`);
  } else check('K3 실시간(보내기 실패로 못 잼)', false);

  // ── G① · K5-b 두 기기가 같은 질문에 동시에 답한다(0311 answer_unknown_query) ──
  section('K5-b 두 기기 동시 답 — 노하우 1건 · 두 번째는 already(0311)');
  {
    // 주 흐름의 질문(uq)은 6단계 화면 발행에 쓰므로 경쟁용 질문을 하나 더 심는다(토큰 포함 · 정리 대상). 사장 세션 하나로 RPC 2회 동시.
    // ⚠️0311 push 전엔 RED 가 정상(함수 없음 → 둘 다 실패).
    const RQ = `uq_${TOKEN}_race`;
    const { error: rqErr } = await junior.from('unknown_queries').insert({ // 직원 세션(0007 이 junior_id 를 세션으로 찍는다)
      id: RQ, unit_id: UNIT, junior_id: junior.uid, junior_name: 'QA직원', query_text: `${TOKEN} 경쟁 질문`,
      presumed_category: 'Routine', presumed_subcategory: '', status: 'pending_owner_answer', fallback_action: '', ai_general_answer: '',
    });
    if (rqErr) check('K5-b (전제) 경쟁용 질문 심기', false, rqErr.message);
    else {
      const mkEntry = (n) => ({
        id: `pb_${TOKEN}_race${n}`, creator_id: owner.uid, creator_name: 'QA사장', category: 'Routine', subcategory: '', title: `${TOKEN} 경쟁 답 ${n}`,
        tags: [], search_keywords: [], square: { situation: `${TOKEN} 경쟁`, action: { steps: [`답 ${n}`] } }, execution: {}, stats: {}, photos: [],
        version: 1, status: 'published', quality_score: 0.7, section: null,
      });
      const [r1, r2] = await Promise.all([1, 2].map((n) => owner.rpc('answer_unknown_query', { p_uq_id: RQ, p_entry: mkEntry(n) })));
      const oks = [r1, r2].filter((r) => !r.error && typeof r.data === 'string');
      const errs = [r1, r2].filter((r) => r.error).map((r) => r.error.message);
      const { data: rq } = await db.from('unknown_queries').select('status,resolved_with_entry_id,answered_by').eq('id', RQ).maybeSingle();
      const { data: made } = await db.from('playbook_entries').select('id').eq('unit_id', UNIT).ilike('title', `${TOKEN} 경쟁 답%`);
      log(`동시 RPC 2회 → ok ${oks.length} · 오류 ${JSON.stringify(errs)} · DB 질문 ${JSON.stringify(rq)} · 노하우 ${(made ?? []).length}건`);
      check('K5-b 둘 중 하나만 ok · 다른 하나는 not_pending(decision.ts ALREADY → already 중립)', oks.length === 1 && errs.length === 1 && /not_pending/.test(errs[0]), JSON.stringify(errs));
      check('K5-b DB 노하우 1건 · 질문 resolved_with_entry · 그 노하우를 가리킨다', (made ?? []).length === 1 && rq?.status === 'resolved_with_entry' && rq?.resolved_with_entry_id === oks[0]?.data, `${(made ?? []).length}건 · ${JSON.stringify(rq)}`);
      // G① 이미 답한 질문에 다시 답하기 — 새 경로(RPC)는 not_pending, 옛 경로(resolveUnknown .neq)는 0행 = already. 노하우는 안 늘어난다.
      const r3 = await owner.rpc('answer_unknown_query', { p_uq_id: RQ, p_entry: mkEntry(3) });
      const { data: old } = await owner.from('unknown_queries').update({ status: 'resolved_with_entry', resolved_with_entry_id: `pb_${TOKEN}_race3` })
        .eq('id', RQ).neq('status', 'resolved_with_entry').select('id');
      const { data: made3 } = await db.from('playbook_entries').select('id').eq('unit_id', UNIT).ilike('title', `${TOKEN} 경쟁 답%`);
      check('G① 이미 답한 질문에 다시 답 → RPC not_pending(already) · 옛 경로 0행(already) · 노하우 그대로 1건',
        !!r3.error && /not_pending/.test(r3.error.message) && (old ?? []).length === 0 && (made3 ?? []).length === 1,
        `rpc=${r3.error?.message ?? r3.data} · 옛 경로 행=${(old ?? []).length} · 노하우 ${(made3 ?? []).length}`);
    }
  }

  // ── 9a. 같은 질문 두 번(옵션) ─────────────────────────────────
  section('K5 같은 질문 두 번 보내기');
  if (!DUP) log('미실행 — 제출이 1번 더 들어 기본 꺼짐(LLM 상한). QA_JR_AI_DUP=1 로 켠다. 통과로 세지 않음');
  else if (!uq) check('K5 이중 전송(앞 단계 실패로 못 함)', false);
  else {
    const a9 = await ask(J, wins(), Q2, '같은 질문 두 번째');
    if (!a9) check('K5 두 번째 제출(상한 안)', false);
    else {
      const btn = a9.after.includes('혹시 이거 찾으세요?') ? '찾는 게 없어요 · 사장님께 물어보기' : '질문 보내기';
      const clicked = await clickTextAfter(J.page, Q2, btn, 'qa-jr-register2');
      await sleep(3000);
      const after9 = (await J.page.eval(turnExpr(Q2)))?.after ?? '';
      const rows = await uqRows(Q2);
      log(`두 번째 보내기 클릭=${clicked} · DB 행 ${rows.length}개 · similar ${rows.map((r) => r.similar_queries_count)} · 첫 200자 ${head200(after9)}`);
      check('K5 두 번째 보내기 뒤 오류 문구 0건', clicked && !/못했어요|실패했어요/.test(after9));
      check('K5 DB 행은 1개 그대로 · similar_queries_count 0→1', rows.length === 1 && rows[0].similar_queries_count === 1, JSON.stringify(rows));
    }
    await transition(J, 'J', '같은 질문 두 번째');
  }

  // ── 4. K1 네 자리 ──────────────────────────────────────────────
  section('K1 사장 네 자리 = DB 대기 질문 수');
  {
    const now = await ownerFour(S, '보낸 뒤');
    const N = await dbPending();
    const sg = await dbPendingSuggestions(owner.uid);
    log(`DB: 대기 질문 ${N}건(단위 = 질문) · 검토 대기 제안 ${sg}건(단위 = 제안)`);
    log(`화면: 홈 ${now.hero}건 · 탭 배지 ${now.badge} · 세그먼트 '할 일' ${now.seg} · 벨 질문 항목 ${now.bell}`);
    if (now.badge != null) log(`탭 배지 ${now.badge} = 질문 ${N} + 제안 ${sg}? → ${now.badge === N + sg ? '예(질문·제안 두 단위 합)' : '아니오'}`);
    if (now.seg != null) log(`세그먼트 '할 일' ${now.seg} − (질문 ${N} + 제안 ${sg}) = ${now.seg - N - sg} ← 안 쓰인 노하우 수(unusedSegCount, 단위 = 노하우)로 추정`);
    check(`K1 홈 히어로 ${now.hero}건 = DB 대기 질문 ${N}건`, now.hero === N);
    // 10-16 사용자 결정: 탭 배지·'할 일' 세그먼트 = 질문 + 검토 대기 제안(한 라벨 = 한 단위). 안 쓰인 노하우는 세그먼트 수에 넣지 않는다.
    check(`K1 탭 배지 ${now.badge} = DB 대기 질문 ${N} + 검토 대기 제안 ${sg}`, now.badge === N + sg, '(단위: 할 일 = 질문+제안)');
    check(`K1 세그먼트 '할 일' ${now.seg} = DB 대기 질문 ${N} + 검토 대기 제안 ${sg}`, now.seg === N + sg, '(단위: 할 일 = 질문+제안 · 탭 배지와 같은 단위)');
    check(`K1 벨 질문 항목 ${now.bell}개 = DB 대기 질문 ${N}건`, now.bell === N);
    if (tSent) {
      const d = (a, b) => (a == null || b == null ? null : a - b);
      check(`K1 네 자리 모두 보내기 전보다 +1(홈 ${d(now.hero, base.hero)} · 배지 ${d(now.badge, base.badge)} · 세그먼트 ${d(now.seg, base.seg)} · 벨 ${d(now.bell, base.bell)})`,
        [d(now.hero, base.hero), d(now.badge, base.badge), d(now.seg, base.seg), d(now.bell, base.bell)].every((x) => x === 1) && N - P0 === 1, `DB ${P0}→${N}`);
    }
  }

  // ── K4-a 사장 벨 질문 항목 탭 → 착지 ───────────────────────────
  // ★답 발행(6) 전에 잰다 — 발행하면 질문이 pending 이 아니라 벨에서 빠진다.
  section('K4-a 사장 벨 "답 기다리는 질문" 항목 탭 → 착지 화면에 그 질문이 열려 있나');
  if (uq) {
    await S.page.goto('/owner/notifications');
    await S.page.waitFor(`document.body.innerText.includes(${JSON.stringify(Q2)})`, 40000);
    let k4 = { path: '?', search: '', first: '', visible: false };
    try {
      const tapped = await clickText(S.page, Q2, 'qa-jr-bell-q');
      if (!tapped) throw new Error('벨에 그 질문 본문 항목이 없음');
      await sleep(3500);
      // coach 는 질문을 “…” 따옴표로 감싸 보여 준다 → 잎 요소 글자가 질문을 '포함' 하면 그 질문이다(정확 일치가 아님).
      k4 = await S.page.eval(`(()=>{const Q=${JSON.stringify(Q2)};const l=[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&e.textContent.includes(Q)&&e.getBoundingClientRect().width>0).pop();let v=false;if(l){const r=l.getBoundingClientRect();v=r.top>=0&&r.bottom<=innerHeight;}return {path:location.pathname,search:location.search,first:document.body.innerText.split('\\n').map(s=>s.trim()).filter(Boolean).slice(0,2).join(' | '),visible:v};})()`);
    } catch (e) { k4.first = `탭 실패: ${e.message}`; }
    log(`벨 질문 항목 → 착지 ${k4.path}${k4.search} · 첫 줄 "${k4.first}" · 질문 본문 보임=${k4.visible}`);
    check(`K4-a(a) 벨 질문 항목 착지 주소에 그 질문 id(${uq.id})가 들어 있다(단위 = 문자열 포함)`, (k4.path + k4.search).includes(uq.id), `착지 ${k4.path}${k4.search}`);
    check('K4-a(b) 착지 화면에 그 질문 본문이 보인다(단위 = 문자열 일치 · 화면 안)', k4.visible, `첫 줄 "${k4.first}"`);
    await transition(S, 'S', '벨 질문 항목 탭');
  } else check('K4-a 벨 질문 항목 탭(보낸 질문이 없어 못 함)', false);

  // ── 6. 사장 답 ─────────────────────────────────────────────────
  section('6. 사장이 coach?uqId= 에서 답 발행 → DB resolved + 노하우 1행');
  const TITLE = `${TOKEN} 제습기 필터 교체`;
  let tPub = null;
  let entryId = null;
  if (uq) {
    await S.page.goto(`/owner/coach?uqId=${uq.id}`);
    const inp = '[placeholder="편하게 적어주세요"],[placeholder="답을 적어주세요"]';
    const open = await S.page.waitFor(`!!document.querySelector('[placeholder="편하게 적어주세요"],[placeholder="답을 적어주세요"]')&&document.body.innerText.includes('답 쓰기')`, 40000);
    check("6 '답 쓰기' 화면과 입력창이 뜬다", open, open ? '' : head200(await S.page.text()));
    await transition(S, 'S', 'coach 진입');
    if (open) {
      await S.page.type(inp, `${TOKEN} 제습기 필터는 3개월마다 새것으로 갈아요. 새 필터는 창고 선반 맨 위 상자에 있어요.`);
      await sleep(300);
      await S.page.click('[aria-label="보내기"]');
      let state = null;
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        state = await S.page.eval(`(()=>{const t=document.body.innerText;if([...document.querySelectorAll('[aria-label="이 답변 보내기"]')].some(e=>e.getBoundingClientRect().width>0))return 'card';if(t.includes('이대로 충분해요 · 바로 저장'))return 'followup';if(t.includes('정리가 잘 안 됐어요'))return 'empty';return null;})()`);
        if (state) break;
        await sleep(500);
      }
      log(`AI 정리 결과 = ${state ?? '90초 안에 안 옴'}`);
      if (state === 'followup') {
        await clickText(S.page, '이대로 충분해요 · 바로 저장', 'qa-jr-escape');
        await S.page.waitFor(`[...document.querySelectorAll('[aria-label="이 답변 보내기"]')].some(e=>e.getBoundingClientRect().width>0)`, 15000);
        state = 'card';
      }
      if (state === 'card') {
        // 제목을 토큰 제목으로 바꾼다 — 정리할 때 이 접두사로 찾는다.
        await S.page.click('[aria-label="제목 고치기"]');
        await S.page.waitFor(`!!document.querySelector('[placeholder="제목"]')`, 5000);
        await S.page.eval(`(()=>{const i=document.querySelector('[placeholder="제목"]');i.focus();i.select();})()`);
        await S.page.send('Input.insertText', { text: TITLE });
        await sleep(300);
        await S.page.eval('document.activeElement && document.activeElement.blur()');
        await sleep(500);
        const titled = await S.page.eval(`document.body.innerText.includes(${JSON.stringify(TITLE)})`);
        check(`6 카드 제목을 '${TITLE}' 로 고친다`, titled);
        await S.page.click('[aria-label="이 답변 보내기"]');
        const sheet = await S.page.waitFor(`[...document.querySelectorAll('[aria-label="노하우 저장"]')].some(e=>e.getBoundingClientRect().width>0)`, 15000);
        if (sheet) await S.page.click('[aria-label="노하우 저장"]');
        const toast = await S.page.waitFor(`/답변이 직원 챗봇에 반영됐어요|답변을 보냈어요|실패했어요/.test(document.body.innerText)`, 20000);
        tPub = Date.now();
        const tText = await S.page.eval(`(document.body.innerText.match(/답변이 직원 챗봇에 반영됐어요|답변을 보냈어요\\.[^\\n]*|[^\\n]*실패했어요[^\\n]*/)||[''])[0]`);
        // 역 ⑨ 전제 안내(0309 · coach noneReachable): 직원이 지금 알림을 못 받으면(기기 0 등) 전역 토스트
        //   '답변을 보냈어요. <이름>님이 앱을 열 때 볼 거예요.' 가 대신 뜬다. 어느 문구가 맞는지는 서버 술어(recipient_readiness)와 기기 토큰 수로 가른다.
        const { count: jTok } = await db.from('push_device_tokens').select('id', { count: 'exact', head: true }).eq('user_id', junior.uid);
        const { data: ready, error: readyErr } = await owner.rpc('recipient_readiness', { p_unit_id: UNIT, p_user_ids: [junior.uid] });
        const reachable = !readyErr && (ready ?? []).some((r) => r.user_id === junior.uid && r.blocked_reason == null);
        log(`저장 시트=${sheet} · 토스트='${tText}' · 직원 기기 토큰 ${jTok}건 · recipient_readiness ${readyErr ? '오류 ' + readyErr.message : JSON.stringify(ready)}`);
        check(`6 발행 뒤 토스트가 직원 수신 전제에 맞다(기기 토큰 ${jTok}건 · 받을 수 있음=${reachable} → ${reachable ? "'답변이 직원 챗봇에 반영됐어요'" : "'답변을 보냈어요. …앱을 열 때 볼 거예요.'"})`,
          toast && !readyErr && (reachable ? tText.includes('반영됐어요') : /답변을 보냈어요\. .*앱을 열 때 볼 거예요\./.test(tText)), tText);
      } else check('6 AI 정리 카드가 뜬다', false, `state=${state}`);
    }
    // DB 대조
    let row = null;
    for (let i = 0; i < 20; i++) { row = (await uqRows(Q2))[0]; if (row?.status === 'resolved_with_entry') break; await sleep(500); }
    entryId = row?.resolved_with_entry_id ?? null;
    const { data: made } = await db.from('playbook_entries').select('id,title,status').eq('unit_id', UNIT).ilike('title', `${TOKEN}%`);
    check(`6 DB unknown_queries.status = resolved_with_entry`, row?.status === 'resolved_with_entry', JSON.stringify(row));
    check(`6 DB playbook_entries 에 '${TITLE}' 새 행 1개 · 질문의 resolved_with_entry_id 와 같다`,
      (made ?? []).length === 1 && made[0].id === entryId && made[0].title === TITLE, JSON.stringify(made));
    await transition(S, 'S', 'coach 발행');
  } else check('6 사장 답(보낸 질문이 없어 못 함)', false);

  // ── 9b. 이미 처리된 질문 ───────────────────────────────────────
  section('K5 이미 답한 질문의 coach 를 다시 연다');
  if (uq) {
    await S.page.goto(`/owner/coach?uqId=${uq.id}`);
    const done = await S.page.waitFor(`document.body.innerText.includes('이미 처리된 질문이에요')`, 30000);
    check("K5 다시 열면 '이미 처리된 질문이에요'", done, done ? '' : head200(await S.page.text()));
    await transition(S, 'S', 'coach 다시 열기');
  } else check('K5 이미 처리됨(보낸 질문이 없어 못 함)', false);

  // ── 8. 직원 알림 ───────────────────────────────────────────────
  section('K6·⑥ 직원 인앱 벨에 "내 질문에 답" 항목');
  {
    await J.page.goto('/junior/notifications');
    await J.page.waitFor(`document.body.innerText.includes('알림')`, 30000);
    await sleep(3000);
    const t = await J.page.text();
    const has = t.includes(TOKEN) || /내 질문에 답|질문에 답이 왔어요/.test(t);
    if (!has) log("코드상 항목 없음(푸시만) — 직원 벨 종류(notifications.ts buildJuniorNotifications)에 '내 질문 답' 이 없고 푸시 'q-answered' → /junior/chat 만 있다");
    check('K6 직원 알림 목록에 내 질문 답 항목이 있다', has, `첫 200자 ${head200(t)}`);
    // K6-b — 항목이 있을 때만 본문을 잰다. 없으면 전제 실패로 남긴다(K6 가 살아나면 같이 산다).
    if (!has) check('K6-b (전제) K6 항목 없음', false);
    else {
      const ownerName = (await db.from('profiles').select('name').eq('id', owner.uid).maybeSingle()).data?.name ?? null;
      const rowText = await J.page.eval(`(()=>{const T=${JSON.stringify(TOKEN)};const re=/내 질문에 답|질문에 답이 왔어요/;
const l=[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&(e.textContent.includes(T)||re.test(e.textContent))&&e.getBoundingClientRect().width>0)[0];
return l&&l.parentElement?l.parentElement.innerText:'';})()`);
      const FRAG = '지하 창고'; // 질문 Q2 에만 있는 말(답 본문·노하우 제목에는 없다)
      log(`K6-b 항목 글자 ${head200(rowText)} · DB 사장 이름 ${ownerName}`);
      check(`K6-b 직원 벨 답 항목에 답한 사람 이름(DB profiles.name "${ownerName}")이 들어 있다(단위 = 문자열 포함)`, !!ownerName && rowText.includes(ownerName), head200(rowText));
      check(`K6-b 직원 벨 답 항목에 질문 문장 일부('${FRAG}')가 들어 있다(단위 = 문자열 포함)`, rowText.includes(FRAG), head200(rowText));
    }
    await transition(J, 'J', '알림 화면');
  }

  // ── 7. 재질의 ─────────────────────────────────────────────────
  section('K3 재질의 — 새 노하우가 출처로 붙는가(10초 · 30초)');
  if (tPub) {
    let hit = false;
    for (const waitS of [10, 30]) {
      const rest = tPub + waitS * 1000 - Date.now();
      if (rest > 0) await sleep(rest);
      const { data: emb } = entryId ? await db.from('playbook_embeddings').select('entry_id').eq('entry_id', entryId) : { data: [] };
      await J.page.goto('/junior/chat');
      await J.page.waitFor(`!!document.querySelector(${JSON.stringify(J_INPUT)})`, 40000);
      await sleep(1500);
      const a7 = await ask(J, wins(), Q2, `재질의 ${waitS}초`);
      if (!a7) break;
      const titles = sourceTitles(a7);
      hit = titles.includes(TITLE);
      const delayWord = /색인|반영 중|준비 중|잠시 후 다시/.test(a7.after);
      log(`${waitS}초: 색인 ${emb?.length ? '있음' : '없음'} · 출처 ${JSON.stringify(titles)} · 지연 안내 문구 ${delayWord ? '있음' : '없음'} · 첫 200자 ${head200(a7.after)}`);
      await transition(J, 'J', `재질의 ${waitS}초`);
      if (hit) { log(`발행 뒤 ${waitS}초 시도에서 붙음`); break; }
    }
    check(`K3 재질의 답에 새 노하우 '${TITLE}' 가 출처로 붙는다(30초 안)`, hit);
  } else check('K3 재질의(발행이 안 돼 못 함)', false);

  // ── 10. 콘솔·응답 ─────────────────────────────────────────────
  section('10. 창별 콘솔 에러 · ≥400 응답 합계');
  for (const [name, w] of [['J', J], ['S', S]]) {
    const bad = await readSS(w.page, '__qa_bad');
    log(`${name}: 콘솔 에러 ${w.page.errors.length} · ≥400 ${bad.length}${bad.length ? ' ' + JSON.stringify(bad.slice(0, 5)) : ''}`);
    check(`10 ${name} 창 콘솔 에러 0 · ≥400 응답 0`, w.page.errors.length === 0 && bad.length === 0,
      `에러 ${JSON.stringify(w.page.errors.slice(0, 2).map((e) => String(e).slice(0, 160)))}`);
  }
} catch (e) {
  check('하니스가 끝까지 돈다', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  try { finalCalls = await aiCalls([J, S]); } catch { /* 창이 없다 */ }
  await Promise.all([J?.close(), S?.close()].filter(Boolean));
  section('정리 · 비용');
  try { await cleanup('끝'); } catch (e) { console.log('  ! 정리 실패', e.message); }
  await restoreActive(owner, prevOwner);
  await restoreActive(junior, prevJunior);
  try {
    const used1 = await aiUsed();
    log(`AI 사용 단위(ai_usage_monthly ${kstMonth()}): ${used0}→${used1} · 차이 ${used0 == null ? "못 셈" : used1 - used0} (같은 매장 다른 하니스 몫이 섞일 수 있음)`);
  } catch { /* 무시 */ }
  if (finalCalls) {
    log(`직원 질문 제출 ${asked}번 · 엣지 ai 호출(fetch 감시) ${JSON.stringify(finalCalls.by)} · LLM(${LLM_TASKS.join('/')}) ${finalCalls.llm}회 · 과금 answer ${finalCalls.answer}회`);
  }
  log(`소요 ${secs(Date.now() - T0)}초`);
  if (failed.length) console.log(`\n실패: ${failed.join(' | ')}`);
  console.log(fail === 0 ? `\nGREEN ${pass}/0` : `\nRED ${pass}/${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
