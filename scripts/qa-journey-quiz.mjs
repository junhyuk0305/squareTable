// qa-journey-quiz.mjs — 퀴즈 여정 하니스(2026-10-15 · a3fd6d3 / 0307 회귀).
//
// 사장 창(S)과 직원 창(J)을 같은 스크립트에서 동시에 열어 한 흐름을 끝까지 밟는다:
//   같은 노하우 4개로 퀴즈 A·B 를 화면으로 만든다 → 발송(claim_quiz_send) → 직원 홈·응시
//   → 사장 결과·마감 변경·다시 알리기 → 외부 링크(anon).
// 화면 문자열을 DB 원본(service_role 읽기)과 맞춘다. 핵심은 K2: 같은 노하우로 두 번 만들어도 문항이 섞이지 않는가.
//
//   node scripts/qa-journey-quiz.mjs      (개발 서버 http://localhost:8081 · QA_ORIGIN 으로 바꾼다 · .env + .env.seed)
//
// ★AI 호출 0회: 만들기 3단계가 부르는 /functions/v1/ai (task quiz_item) 를 **페이지 안 fetch 감싸개**가 받아
//   고정 4지선다(mc4) 한 문항을 돌려준다. 화면 경로(ensureCourse·insertQuizItem·course_id 찍기·발송 원장)는 그대로 탄다.
//   진짜 엣지로 나간 호출은 window 계수기로 세서 마지막에 적는다(0이어야 한다).
// ★발송은 크론이다 — 만들기가 넣은 원장 행을 service_role 로 claim_quiz_send 해 "받은 상태"를 만든다(qa-quiz-schedule ⑥ 선례).
// ★고정 계정만(owner·staff2) · store_001 · 하니스 데이터 = 퀴즈 이름 접두사 qa_jr_quiz_ (시작·끝 양쪽 정리).
//   재료 노하우는 만들지도 지우지도 않는다. 직원이 아직 통과 안 한 활성 노하우 4개를 고른다.
//   ⚠️ knowhow_quiz_stats(노하우별 오답 집계 누계)는 되돌리지 않는다 — 누구 것인지 안 남는 합계다.
// ★건너뛴 것은 통과로 세지 않는다. 마지막 줄 GREEN n/0 · RED n/m.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW, UNIT, login, ensureActive, restoreActive, rolePrecondition } from './lib/qa-fixed-accounts.mjs';

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
if (!SB || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const admin = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const STORAGE_KEY = storageKeyFor(SB);
const PREFIX = 'qa_jr_quiz_';
const STAMP = String(Date.now()).slice(-6);
const NAME_A = `${PREFIX}${STAMP}_A`;
const NAME_B = `${PREFIX}${STAMP}_B`;
const W = 460, H = 900;
const T0 = Date.now();

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { if (ok) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); } };
const note = (n, v) => console.log('  ·', n, '=', v);
const section = (t) => console.log(`\n── ${t}`);
const J_ = JSON.stringify;
const attr = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const kstYmd = (plus = 0) => new Date(Date.now() + 9 * 3600_000 + plus * 86400_000).toISOString().slice(0, 10);
const mdLabel = (ymd) => { const [, m, d] = ymd.split('-'); return `${Number(m)}월 ${Number(d)}일까지`; };

// ── 페이지 안 감싸개: 요청 수(settle) · ≥400 응답 · AI 엣지 대체(S 창만) ───────────────
// sessionStorage 에 누적한다 — goto(전체 이동) 뒤에도 셈이 이어진다.
const WRAP = (shim) => `(()=>{if(window.__qaWrapped)return;window.__qaWrapped=true;window.__qaReqN=0;
const ld=k=>{try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch(e){return null}};
const sv=(k,v)=>{try{sessionStorage.setItem(k,JSON.stringify(v))}catch(e){}};
const orig=window.fetch.bind(window);
window.fetch=async(input,init)=>{window.__qaReqN++;
 const url=typeof input==='string'?input:(input&&input.url)||'';
 if(url.indexOf('/functions/v1/ai')>=0){let body=null;try{body=JSON.parse((init&&init.body)||'null')}catch(e){}
  const ai=ld('qaAi')||{shim:0,real:0};
  if(${shim}&&body&&body.task==='quiz_item'){ai.shim++;sv('qaAi',ai);const n=ai.shim;const sops=(body.payload&&body.payload.sops)||[];
   const out={items:[{format:'mc4',kind:'t0',entry_ids:sops[0]&&sops[0].id?[sops[0].id]:[],
    payload:{ask:'qa_jr 확인 문제 '+n+' · 이 노하우대로 하면?',choices:['정답 '+n+' 노하우대로 한다','오답 가 '+n,'오답 나 '+n,'오답 다 '+n],answer_index:0,explain:'qa_jr 하니스 고정 문항'}}]};
   return new Response(JSON.stringify(out),{status:200,headers:{'Content-Type':'application/json'}});}
  ai.real++;sv('qaAi',ai);}
 const r=await orig(input,init);
 if(r.status>=400){const b=ld('qaBad')||[];b.push(r.status+' '+url.replace(/\\?.*/,'').split('/').slice(-2).join('/'));sv('qaBad',b);}
 return r;};})()`;

async function openWin(port, session, shim) {
  const w = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width: W, height: H, port });
  await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: WRAP(shim) });
  if (session) await w.page.seedSession(session);
  return w;
}

/** 단언 9 — 화면 전환마다 콘솔 에러·≥400 응답 수. 읽고 비운다. */
const netLog = { err: 0, bad: 0 };
async function net(page, tag) {
  const errs = page.errors.splice(0);
  let bad = [];
  try { bad = (await page.eval(`(()=>{try{const b=JSON.parse(sessionStorage.getItem('qaBad')||'[]');sessionStorage.setItem('qaBad','[]');return b}catch(e){return []}})()`)) ?? []; } catch { /* 이동 중 */ }
  netLog.err += errs.length; netLog.bad += bad.length;
  console.log(`  · [${tag}] 콘솔 에러 ${errs.length} · ≥400 ${bad.length}${errs.length ? ' · ' + errs.slice(0, 2).map((e) => e.slice(0, 120)).join(' | ') : ''}${bad.length ? ' · ' + bad.slice(0, 4).join(', ') : ''}`);
}
async function aiCount(page) {
  try { return (await page.eval(`JSON.parse(sessionStorage.getItem('qaAi')||'{"shim":0,"real":0}')`)); } catch { return null; }
}

/** 요청 수가 ms 동안 안 변하면 끝(데이터 다 왔다). */
async function settle(page, ms = 2000, max = 30000) {
  const t0 = Date.now(); let last = -1, since = Date.now();
  while (Date.now() - t0 < max) {
    const n = await page.eval('window.__qaReqN||0').catch(() => -1);
    if (n !== last) { last = n; since = Date.now(); } else if (Date.now() - since >= ms) return;
    await sleep(250);
  }
}
const vis = (sel) => `(()=>{const e=document.querySelector(${J_(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`;
const textOf = (page, sel) => page.eval(`(()=>{const e=[...document.querySelectorAll(${J_(sel)})].find(x=>x.getBoundingClientRect().width>0);return e?e.innerText:null;})()`);
const bodyHas = (re) => `new RegExp(${J_(re.source)}).test(document.body.innerText)`;
const bodyMatch = async (page, re) => (await page.text()).match(re);

/** 보이는 글자로 누른다(라벨 없는 Pressable). 같은 글자가 여럿이면 DOM 마지막(시트가 위) 잎을 고른다. */
async function clickText(page, text, timeout = 15000) {
  const tag = 'qa' + Math.random().toString(36).slice(2, 8);
  const ok = await page.waitFor(`(()=>{const w=${J_(text)};const els=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(e.innerText||'').trim()===w;});
    if(!els.length)return false;const leaf=els.filter(e=>!els.some(o=>o!==e&&e.contains(o)));leaf[leaf.length-1].setAttribute('data-qa-t',${J_(tag)});return true;})()`, timeout);
  if (!ok) throw new Error(`글자를 못 찾음: ${text}`);
  await page.click(`[data-qa-t="${tag}"]`);
}

/** 새 브라우저라 뜨는 첫 사용 안내(코치마크·알림 권한 시트)를 닫는다 — 덮인 채 누르면 클릭이 막힌다. */
const OVERLAY_WORDS = ['건너뛰기', '나중에 할게요', '알겠어요, 시작할게요'];
async function dismissOverlays(page) {
  for (let i = 0; i < 4; i++) {
    const t = await page.eval(`(()=>{for(const w of ${J_(OVERLAY_WORDS)}){const e=[...document.querySelectorAll('body *')].find(x=>(x.innerText||'').trim()===w&&x.getBoundingClientRect().width>0);if(e)return w;}return null})()`).catch(() => null);
    if (!t) return;
    await clickText(page, t).catch(() => {});
    await sleep(700);
  }
}
/** 안내가 사라지는 애니메이션이 끝날 때까지 기다린다 — 닫히는 중인 겹층 위를 누르면 클릭이 먹히지 않는다(7-b 플레이크). */
async function overlaysGone(page) {
  await page.waitFor(`(()=>{const w=${J_(OVERLAY_WORDS)};return ![...document.querySelectorAll('body *')].some(e=>w.includes((e.innerText||'').trim())&&e.getBoundingClientRect().width>0)})()`, 5000).catch(() => {});
}

async function passwordSession(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: J_({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}

// ── 정리(멱등) — 접두사 퀴즈와 그 퀴즈가 남긴 것만 ───────────────────────────────
async function cleanup(jUid, tag) {
  const { data: cs } = await admin.from('training_courses').select('id,created_at').eq('unit_id', UNIT).like('name', `${PREFIX}%`);
  const ids = (cs ?? []).map((c) => c.id);
  if (ids.length === 0) { console.log(`  · 정리(${tag}): 남은 것 없음`); return; }
  const since = (cs ?? []).map((c) => c.created_at).sort()[0];
  const { data: ce } = await admin.from('course_entries').select('entry_id').in('course_id', ids);
  const eids = [...new Set((ce ?? []).map((r) => r.entry_id))];
  const { data: qi } = await admin.from('quiz_items').select('id').in('course_id', ids);
  const itemIds = (qi ?? []).map((r) => r.id);
  if (itemIds.length) await admin.from('quiz_attempt_items').delete().in('item_id', itemIds);
  if (jUid && eids.length) {
    // 직원이 이 퀴즈들로 남긴 응시·통과 — 퀴즈가 생긴 뒤의 것만(재료 노하우는 시작 때 미통과로 고른다).
    await admin.from('quiz_attempts').delete().eq('staff_id', jUid).in('entry_id', eids).gte('taken_at', since);
    await admin.from('knowhow_understanding').delete().eq('staff_id', jUid).in('entry_id', eids).gte('verified_at', since);
  }
  await admin.from('quiz_links').delete().in('course_id', ids);
  await admin.from('quiz_assignments').delete().in('course_id', ids);
  await admin.from('course_entries').delete().in('course_id', ids);
  if (itemIds.length) await admin.from('quiz_items').delete().in('id', itemIds);
  const { error } = await admin.from('training_courses').delete().in('id', ids);
  console.log(`  · 정리(${tag}): 퀴즈 ${ids.length} · 문항 ${itemIds.length}${error ? ' · 코스 삭제 오류 ' + error.message : ''}`);
}

// ════════════════════════════════════════════════════════════════════════
const ownerC = await login(SB, ANON, FIXED.owner);
const juniorC = await login(SB, ANON, FIXED.junior);
const jUid = juniorC.uid;
const wins = [];
let prevOwner = null, prevJunior = null;
let aiFinal = null;

try {
  section('0. 준비 — 전제·정리·재료');
  const pre = await rolePrecondition({ owner: ownerC, junior: juniorC });
  check('0-1 store_001 역할이 시드와 같다(owner·junior)', !pre, pre ?? '');
  if (pre) throw new Error('전제 불일치');
  prevOwner = await ensureActive(ownerC);
  prevJunior = await ensureActive(juniorC);
  await cleanup(jUid, '시작');

  const { data: jProf } = await admin.from('profiles').select('name').eq('id', jUid).maybeSingle();
  const J_NAME = jProf?.name ?? '';
  note('직원 이름', J_NAME);
  const { data: mem } = await admin.from('unit_members').select('user_id,role').eq('unit_id', UNIT);
  const { data: memProf } = await admin.from('profiles').select('id,name').in('id', (mem ?? []).filter((m) => m.role !== 'owner').map((m) => m.user_id));
  const STAFF_NAMES = [...new Set((memProf ?? []).map((p) => p.name).filter(Boolean))];

  // 재료: 발행·미보관·미숨김 · 직원이 아직 통과 안 한 것 · 제목이 매장 안에서 하나뿐 · 옛 문항(course_id null) 없는 것 우선.
  const { data: ents } = await admin.from('playbook_entries').select('id,title,status,archived_at,brand_hidden_at,created_at')
    .eq('unit_id', UNIT).neq('status', 'draft').is('archived_at', null).is('brand_hidden_at', null).order('created_at', { ascending: false });
  const { data: ku } = await admin.from('knowhow_understanding').select('entry_id').eq('staff_id', jUid).eq('unit_id', UNIT);
  const passedSet = new Set((ku ?? []).map((r) => r.entry_id));
  const titleN = new Map();
  for (const e of ents ?? []) titleN.set(e.title, (titleN.get(e.title) ?? 0) + 1);
  const cand = (ents ?? []).filter((e) => !passedSet.has(e.id) && titleN.get(e.title) === 1 && e.title && !/^qa_/i.test(e.title) &&!/["\\]/.test(e.title));
  const { data: legacy } = await admin.from('quiz_items').select('entry_ids').eq('unit_id', UNIT).eq('status', 'active').is('course_id', null);
  const legacyN = (id) => (legacy ?? []).filter((q) => (q.entry_ids ?? []).includes(id)).length;
  cand.sort((a, b) => legacyN(a.id) - legacyN(b.id));
  const PICK = cand.slice(0, 4);
  check('0-2 재료 노하우 4개(직원 미통과)', PICK.length === 4, `후보 ${cand.length}`);
  if (PICK.length < 4) throw new Error('재료 부족');
  const EIDS = PICK.map((e) => e.id);
  const legacyTotal = EIDS.reduce((s, id) => s + legacyN(id), 0);
  note('재료', PICK.map((e) => `${e.title}(${e.id})`).join(' · '));
  note('재료에 걸린 옛 문항(course_id null)', `${legacyTotal}개 — 0이 아니면 두 퀴즈 모두에 섞여 나온다(0307 설계)`);

  const { count: tokN } = await admin.from('push_device_tokens').select('id', { count: 'exact', head: true }).eq('user_id', jUid);
  note('직원 기기 토큰(push_device_tokens)', tokN);

  const ownerSess = await passwordSession(FIXED.owner);
  const juniorSess = await passwordSession(FIXED.junior);
  const Sw = await openWin(9353, ownerSess, true); wins.push(Sw);
  const Jw = await openWin(9354, juniorSess, false); wins.push(Jw);
  const S = Sw.page, J = Jw.page;

  // ── 직원 기준선 ──────────────────────────────────────────────────────────
  section('1. 직원 홈 기준선(다른 하니스 발송이 섞일 수 있어 차이로 본다)');
  await J.goto('/junior/home');
  const jReady = await J.waitFor(`document.body.innerText.length>40 && !!document.querySelector('[role="tablist"],[aria-label]')`, 240000);
  check('1-1 직원 홈이 떴다', jReady);
  await settle(J, 3000, 40000);
  await dismissOverlays(J);
  const openLabel = async () => (await J.eval(`(()=>{const e=document.querySelector('[aria-label^="안 푼 퀴즈"]');return e?e.getAttribute('aria-label'):null})()`));
  const countOf = (lbl) => (lbl ? Number((lbl.match(/^안 푼 퀴즈 (\d+)/) ?? [])[1] ?? NaN) : 0);
  const base = countOf(await openLabel());
  note('기준선 화면 안 푼 퀴즈', base);
  await net(J, 'J 홈');

  // ── 2. 퀴즈 만들기 A·B (화면) ─────────────────────────────────────────────
  const runBeforeOf = {};
  async function createQuiz(name) {
    await S.goto('/owner/training');
    const up = await S.waitFor(vis('[aria-label="퀴즈 만들기"]'), 240000);
    if (!up) throw new Error('퀴즈 목록이 안 떴다');
    await settle(S); await dismissOverlays(S);
    await dismissOverlays(S);
    await net(S, 'S 퀴즈 목록');
    runBeforeOf[name] = await runCount();
    await S.click('[aria-label="퀴즈 만들기"]');
    if (!(await S.waitFor(bodyHas(/누가 풀 건가요/), 60000))) throw new Error('만들기 1단계가 안 떴다');
    if (await S.visible('[aria-label="우리 직원"]')) await S.click('[aria-label="우리 직원"]');
    await S.click('input[aria-label="퀴즈 이름"]');
    await S.eval(`document.querySelector('input[aria-label="퀴즈 이름"]').select()`);
    await S.send('Input.insertText', { text: name });
    await S.waitFor(`(()=>{const e=document.querySelector('[aria-label="노하우 고르기"]');return e&&e.getAttribute('aria-disabled')!=='true';})()`, 60000);
    await S.click('[aria-label="노하우 고르기"]');
    if (!(await S.waitFor(vis(`[aria-label="${attr(PICK[0].title)}"]`), 60000))) throw new Error('2단계 노하우 목록에 재료가 없다');
    await settle(S, 1500); await dismissOverlays(S);
    for (const e of PICK) await S.click(`[aria-label="${attr(e.title)}"]`);
    await S.click('[aria-label="4개로 문제 만들기"]');
    const ok4 = await S.waitFor(bodyHas(/문항 \d+개를 만들었어요|아직 만들어진 문항이 없어요|문제를 만들지 못했어요/), 120000);
    if (!ok4) throw new Error('4단계(검토)가 안 떴다');
    note(`${name} 4단계 문구`, ((await bodyMatch(S, /[^\n]*(만들었어요|만들어진 문항이 없어요)[^\n]*/)) ?? [''])[0]);
    await S.click('[aria-label="받는 사람 고르기"]');
    if (!(await S.waitFor(vis(`[aria-label="${attr(J_NAME)}"]`), 60000))) throw new Error('5단계 받는 사람이 안 떴다');
    // 받는 사람 = 직원(staff2) 한 명만. 기본값은 전원 체크라 나머지 직원 이름을 한 번씩 눌러 끈다.
    // (RN-web 이 이 줄에 aria-checked 를 안 그려 상태는 버튼 문구 'N명에게 보내기'로 확인한다.)
    for (const nm of STAFF_NAMES.filter((n) => n !== J_NAME)) {
      if (await S.visible(`[aria-label="${attr(nm)}"]`)) { await S.click(`[aria-label="${attr(nm)}"]`); await sleep(300); }
    }
    if (await S.visible('[aria-label="0명에게 보내기"]')) await S.click(`[aria-label="${attr(J_NAME)}"]`);
    if (!(await S.waitFor(vis('[aria-label="1명에게 보내기"]'), 10000))) throw new Error('보내기 버튼이 1명이 아니다');
    await S.click('[aria-label="1명에게 보내기"]');
    if (!(await S.waitFor(`/^\\/owner\\/quiz\\/[^/]+$/.test(location.pathname)`, 60000))) throw new Error('발행 뒤 상세로 안 갔다');
    return (await S.path()).split('/').pop();
  }
  async function detailCounts() {
    await S.waitFor(vis('[role="tab"][aria-label="문항"]'), 60000);
    await settle(S); await dismissOverlays(S);
    const seg = (await textOf(S, '[role="tab"][aria-label="문항"]')) ?? '';
    const segN = Number((seg.match(/(\d+)/) ?? [])[1] ?? 0);
    const fact = await bodyMatch(S, /문항\s+(\d+)개/);
    return { segN, factN: fact ? Number(fact[1]) : null, seg: seg.replace(/\n/g, ' ') };
  }
  /** 목록으로 돌아가(뒤로) 새로고침 없이 '응시 중'에 그 퀴즈가 보이는가 + 줄 문구. */
  // RN-web 이 탭에 aria-selected 를 안 그린다 — '응시 중' 칸인지는 탭 숫자(+1)와 '응시 중인 퀴즈' 머리글로 본다.
  const runCount = async () => Number(((await textOf(S, '[role="tab"][aria-label="응시 중"]')) ?? '').match(/(\d+)/)?.[1] ?? 0);
  async function backToList(name, runBefore) {
    await S.back();
    const t0 = Date.now();
    const seen = await S.waitFor(`location.pathname==='/owner/training' && ${vis(`[aria-label="${attr(name)} 열기"]`)} && /응시 중인 퀴즈/.test(document.body.innerText)`, 15000);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    await S.waitFor(`(()=>{const t=document.querySelector('[role="tab"][aria-label="응시 중"]');return !!t&&Number((t.innerText.match(/(\\d+)/)||[])[1]||0)===${runBefore + 1}})()`, 10000);
    const runAfter = await runCount();
    return { seen, secs, running: runAfter === runBefore + 1, runBefore, runAfter };
  }
  const rowN = async (name) => {
    const t = (await textOf(S, `[aria-label="${attr(name)} 열기"]`)) ?? '';
    const m = t.match(/문제 (\d+)개/);
    return { n: m ? Number(m[1]) : /문제 없음/.test(t) ? 0 : null, text: t.replace(/\n/g, ' / ') };
  };

  section('2. 사장 — 퀴즈 A 만들기(화면 · AI 대체)');
  const A = await createQuiz(NAME_A);
  note('A 코스 id', A);
  const dA = await detailCounts();
  check('K2-1 A 상세 세그먼트 "문항" = 4 (단위: 문항)', dA.segN === 4, `탭="${dA.seg}"`);
  check('K2-2 A 상세 결과표 "문항 N개" = 4 (단위: 문항)', dA.factN === 4, `N=${dA.factN}`);
  await net(S, 'S A 상세');
  const kA = await backToList(NAME_A, runBeforeOf[NAME_A]);
  check('K3-1 A 만든 뒤 목록 "응시 중"에 새로고침 없이 보인다(탭 숫자 +1)', kA.seen && kA.running, `${kA.secs}s · 응시 중 ${kA.runBefore}→${kA.runAfter}`);
  await net(S, 'S 목록(A 뒤)');

  section('3. 사장 — 같은 노하우 4개로 퀴즈 B 만들기(화면 · K2 핵심)');
  const B = await createQuiz(NAME_B);
  note('B 코스 id', B);
  const dB = await detailCounts();
  check('K2-3 B 상세 세그먼트 "문항" = 4 (단위: 문항)', dB.segN === 4, `탭="${dB.seg}"`);
  check('K2-4 B 상세 결과표 "문항 N개" = 4 (단위: 문항)', dB.factN === 4, `N=${dB.factN}`);
  await net(S, 'S B 상세');
  const kB = await backToList(NAME_B, runBeforeOf[NAME_B]);
  check('K3-2 B 만든 뒤 목록 "응시 중"에 새로고침 없이 보인다(탭 숫자 +1)', kB.seen && kB.running, `${kB.secs}s · 응시 중 ${kB.runBefore}→${kB.runAfter}`);
  await settle(S); await dismissOverlays(S);
  const lA = await rowN(NAME_A), lB = await rowN(NAME_B);
  check('K2-5 목록 A 줄 "문제 N개" = 4 (단위: 문항)', lA.n === 4, `"${lA.text}"`);
  check('K2-6 목록 B 줄 "문제 N개" = 4 (단위: 문항)', lB.n === 4, `"${lB.text}"`);
  await net(S, 'S 목록(B 뒤)');

  section('4. DB 원본 — 문항이 퀴즈에 묶였나');
  const itemsOf = async (cid) => (await admin.from('quiz_items').select('id,format,entry_ids,status').eq('course_id', cid).eq('status', 'active')).data ?? [];
  const iA = await itemsOf(A), iB = await itemsOf(B);
  check('K2-7 DB quiz_items course_id=A 활성 = 4 (단위: 문항)', iA.length === 4, `${iA.length} · ${iA.map((q) => q.format).join(',')}`);
  check('K2-8 DB quiz_items course_id=B 활성 = 4 (단위: 문항)', iB.length === 4, `${iB.length} · ${iB.map((q) => q.format).join(',')}`);
  const ceN = async (cid) => (await admin.from('course_entries').select('entry_id').eq('course_id', cid)).data?.length ?? 0;
  check('4-1 DB course_entries A·B = 4·4 (단위: 노하우)', (await ceN(A)) === 4 && (await ceN(B)) === 4);
  aiFinal = await aiCount(S);
  note('AI 엣지 호출(만들기 2회 합)', `대체 ${aiFinal?.shim} · 진짜 ${aiFinal?.real}`);
  check('4-2 진짜 AI(LLM) 호출 0회', aiFinal?.real === 0, J_(aiFinal));

  section('5. 외부 링크(anon) — "문제 N개"');
  {
    const links = [];
    for (const [cid, nm] of [[A, 'A'], [B, 'B']]) {
      const token = `qajr${STAMP}${nm}${Math.random().toString(36).slice(2, 14)}xx`.padEnd(24, 'z');
      const { error } = await admin.from('quiz_links').insert({ id: `ql_qajr_${STAMP}_${nm}`, unit_id: UNIT, course_id: cid, token, expires_at: new Date(Date.now() + 86400_000).toISOString() });
      if (error) throw new Error('링크 심기: ' + error.message);
      links.push([nm, token]);
    }
    const Aw = await openWin(9355, null, false); wins.push(Aw);
    for (const [nm, token] of links) {
      await Aw.page.goto(`/q/${token}`);
      const ok = await Aw.page.waitFor(bodyHas(/문제 \d+개/), 240000);
      const m = await bodyMatch(Aw.page, /문제 (\d+)개/);
      // 머리글 수(quiz_link_open.item_count)와 실제로 내주는 문항(quiz_link_items)을 따로 센다 — 어느 쪽이 어긋났는지 가른다.
      const served = await fetch(`${SB}/rest/v1/rpc/quiz_link_items`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: J_({ p_token: token }) }).then((r) => r.json()).catch(() => null);
      const servedN = Array.isArray(served) ? served.length : null;
      check(`K2-9 외부 링크 ${nm} 화면 "문제 N개" = 4 (단위: 문항 · quiz_link_open)`, ok && Number(m?.[1]) === 4, `화면=${m?.[0] ?? '없음'} · 내주는 문항 quiz_link_items=${servedN}`);
      check(`K2-9b 외부 링크 ${nm} 내주는 문항 = 4 (단위: 문항 · quiz_link_items anon)`, servedN === 4, `${servedN}`);
      await net(Aw.page, `anon 링크 ${nm}`);
    }
    await Aw.close(); wins.splice(wins.indexOf(Aw), 1);
  }

  // 직원 카드는 1회성 퀴즈를 한 장만(position 순 첫 장) 띄운다. 기준선에 다른 발송이 있으면 그 카드가 앞설 수 있어
  // 하니스 퀴즈 두 개만 position -1 로 당긴다(하니스가 만든 행만 · 끝에 지운다).
  if (base > 0) {
    await admin.from('training_courses').update({ position: -1 }).in('id', [A, B]);
    note('카드 순서', `기준선 ${base}건 → 하니스 퀴즈 position -1`);
  }

  section('6. 발송 — claim_quiz_send(service_role · 크론 대신)');
  const { data: asg } = await admin.from('quiz_assignments').select('id,course_id,user_id,sent_at,due_on').in('course_id', [A, B]);
  note('원장(만들기가 넣은 것)', (asg ?? []).map((a) => `${a.course_id === A ? 'A' : 'B'}:${a.user_id === jUid ? 'J' : a.user_id.slice(0, 6)}:${a.sent_at ? '보냄' : '대기'}`).join(' '));
  for (const a of asg ?? []) {
    if (a.sent_at) continue;
    const { data: got, error } = await admin.rpc('claim_quiz_send', { p_id: a.id });
    if (error || got !== true) note('claim', `${a.id} → ${error?.message ?? got}`);
  }
  const { data: asg2 } = await admin.from('quiz_assignments').select('course_id,user_id,sent_at,due_on,completed_at').in('course_id', [A, B]).eq('user_id', jUid);
  const sentMine = (asg2 ?? []).filter((a) => a.sent_at && !a.completed_at);
  check('6-1 직원에게 A·B 둘 다 "받은 상태"(sent_at)', new Set(sentMine.map((a) => a.course_id)).size === 2, J_(asg2));

  section('7. 직원 홈 "안 푼 퀴즈" — K1(단위: 퀴즈)');
  await J.reload();
  await J.waitFor(`document.body.innerText.length>40`, 120000);
  await settle(J, 3000, 40000);
  await dismissOverlays(J);
  await J.waitFor(`!!document.querySelector('[aria-label^="안 푼 퀴즈"]')`, 15000);
  const afterN = countOf(await openLabel());
  check('K1 화면 안 푼 퀴즈 = 기준선 + 2 (A·B 퀴즈 2개 · 노하우 수 아님)', afterN === base + 2, `화면 ${base}→${afterN} · DB 내 발송·미완료 퀴즈 ${new Set(sentMine.map((a) => a.course_id)).size}`);
  await net(J, 'J 홈(발송 뒤)');

  section('7-b. 푸시 딥링크 ?quiz=<발송 id> → 그 퀴즈 시트(K4-b)');
  {
    // 푸시 url = /junior/work?quiz=<quiz_assignments.id>(push/index.ts:462). WorkBoard 가 값을 안 읽으면 첫 카드가 열린다.
    // 시트에 퀴즈 이름이 없고 A·B 노하우가 같아서, 첫 문제 글(대체 문항 번호)을 DB 문항과 맞춰 어느 퀴즈인지 가른다.
    // 두 발송 id 를 다 연다 — 첫 카드가 우연히 그 퀴즈라 통과하는 일을 막는다.
    const askNos = async (cid) => new Set(((await admin.from('quiz_items').select('payload').eq('course_id', cid).eq('status', 'active')).data ?? [])
      .map((q) => (String(q.payload?.ask ?? '').match(/qa_jr 확인 문제 (\d+)/) ?? [])[1]).filter(Boolean));
    const nosA = await askNos(A), nosB = await askNos(B);
    const opened = [];
    for (const [cid, nm] of [[B, 'B'], [A, 'A']]) {
      const aid = (asg ?? []).find((a) => a.course_id === cid && a.user_id === jUid)?.id;
      await J.goto(`/junior/work?quiz=${aid}`);
      const up = await J.waitFor(bodyHas(/퀴즈 시작하기/), 60000);
      let no = null;
      if (up) {
        await dismissOverlays(J);
        await overlaysGone(J);
        await clickText(J, '퀴즈 시작하기', 20000);
        await J.waitFor(bodyHas(/qa_jr 확인 문제 \d+/), 15000);
        no = (await bodyMatch(J, /qa_jr 확인 문제 (\d+)/))?.[1] ?? null;
      }
      const got = no && nosB.has(no) && !nosA.has(no) ? 'B' : no && nosA.has(no) && !nosB.has(no) ? 'A' : null;
      opened.push({ nm, got, text: `${nm} 발송(${aid})→${got ?? '못 가름'}(문제 ${no ?? '없음'})` });
    }
    check('K4-b 딥링크 ?quiz=<발송 id> 가 그 퀴즈 시트를 연다(B·A 각 1회 · 단위: 퀴즈)', opened.every((o) => o.got === o.nm), opened.map((o) => o.text).join(' · '));
    await net(J, 'J 업무(딥링크)');
    // 풀지 않고 닫는다(전체 이동) — 10단계 K4 는 홈 타일에서 시작한다.
    await J.goto('/junior/home');
    await J.waitFor(`!!document.querySelector('[aria-label^="안 푼 퀴즈"]')`, 120000);
    await settle(J, 3000, 40000);
    await dismissOverlays(J);
  }

  section('8. 사장 결과 — 기기 0건 직원 줄(K6)');
  await S.goto(`/owner/quiz/${A}`);
  await S.waitFor(vis('[role="tab"][aria-label="결과"]'), 120000);
  await settle(S); await dismissOverlays(S);
  const jRowSel = `[aria-label="${attr(J_NAME)}"],[aria-label="${attr(J_NAME)} 응시 결과 보기"]`;
  const k6 = ((await textOf(S, jRowSel)) ?? '').replace(/\n/g, ' / ');
  note('K6 결과 탭 직원 줄 원문', `"${k6}" (기기 토큰 ${tokN})`);
  if (tokN === 0) check('K6 기기 0건인데 "알림 받을 기기가 없어요" 류 안내가 있다', /기기|알림을? (못|안) 받|앱을? 설치/.test(k6), `줄="${k6}"`);
  else check('K6 (전제) 직원 기기 토큰 0건', false, `토큰 ${tokN}건 — 기기 0건 상태를 못 만듦`);
  await net(S, 'S A 결과');

  section('9. 다시 알리기 두 번 — K5');
  await S.goto(`/owner/quiz/${A}?tab=settings`);
  const remindSel = '[aria-label^="아직 안 푼 "][aria-label$="다시 알리기"]';
  const hasRemind = await S.waitFor(vis(remindSel), 60000);
  check('K5-0 다시 알리기 버튼이 보인다', hasRemind);
  if (hasRemind) {
    const cnt = async () => (await admin.from('quiz_assignments').select('id,scheduled_on,sent_at').eq('course_id', A)).data ?? [];
    const before = await cnt();
    const toasts = [];
    for (let i = 1; i <= 2; i++) {
      await S.click(remindSel);
      await sleep(1800);
      const m = await bodyMatch(S, /[^\n]*(못 ?했어요|이미 보내는 중이에요[^\n]*|다시 보낼게요)[^\n]*/);
      toasts.push(m?.[0] ?? '(문구 없음)');
      await sleep(4500);
    }
    const after = await cnt();
    note('K5 토스트 1·2', toasts.map((t) => `"${t}"`).join(' · '));
    note('K5 quiz_assignments(A) 행 수', `${before.length}→${after.length} · 새 행 날짜 ${after.filter((a) => !before.some((b) => b.id === a.id)).map((a) => a.scheduled_on).join(',') || '없음'}`);
    check('K5 다시 알리기 2회 · 오류 문구("못 했어요") 0건', toasts.every((t) => !/못 ?했어요/.test(t)), toasts.join(' | '));
  }
  await net(S, 'S A 설정');

  section('10. 직원 — 홈 "안 푼 퀴즈" 탭 → 응시 시트 바로 열림(K4)');
  await dismissOverlays(J);
  await J.click('[aria-label^="안 푼 퀴즈"]');
  const landed = await J.waitFor(`location.pathname==='/junior/work'`, 15000);
  const sheetOpen = await J.waitFor(bodyHas(/문제 \d+개 · \d+분 정도/), 20000);
  const sheetM = await bodyMatch(J, /문제 (\d+)개 · \d+분 정도/);
  check('K4 탭 한 번에 /junior/work 착지 + 응시 시트 열림("문제 N개" 보임)', landed && sheetOpen, `착지=${landed} 시트=${sheetOpen}`);
  await net(J, 'J 업무(시트)');
  // 지금 열린 카드 = 어느 퀴즈인가(카드 제목).
  const cardName = await J.eval(`(()=>{const t=document.body.innerText;const m=t.match(/${PREFIX}${STAMP}_[AB]/);return m?m[0]:null})()`);
  const X = cardName === NAME_A ? A : cardName === NAME_B ? B : null;
  note('직원 카드 퀴즈', cardName ?? '(우리 퀴즈 아님)');
  check('10-1 첫 카드가 하니스 퀴즈다(다른 발송이 앞서지 않음)', !!X, `카드=${cardName}`);
  if (!X) throw new Error('직원 첫 카드가 다른 퀴즈라 응시 단계를 진행할 수 없다');
  // 시트는 노하우 1개 단위로 연다(WorkBoard startTrainingCheck → sops=[entry]) — 기대값은 그 노하우·그 퀴즈의 DB 문항 수.
  const firstEntry = await J.eval(`(()=>{const t=document.body.innerText;const m=t.match(/이해 확인 · ([^\\n]+)/);return m?m[1].trim():null})()`);
  const fe = PICK.find((e) => e.title === firstEntry);
  const xItems = X === A ? iA : iB;
  const wantSheet = fe ? xItems.filter((q) => (q.entry_ids ?? []).includes(fe.id)).length + legacyN(fe.id) : null;
  check('K2-10 직원 응시 시트 "문제 N개" = DB(이 퀴즈·이 노하우 문항 수) (단위: 문항 · 시트는 노하우 1개씩)', sheetM && Number(sheetM[1]) === Math.min(wantSheet ?? -1, 3), `화면=${sheetM?.[0]} · DB=${wantSheet} · 노하우="${firstEntry}" (퀴즈 전체 4가 아님에 주의)`);

  /** 열린 시트 한 개를 끝까지 푼다(정답 고르기). 결과 화면 문구 + '제출됐어요' 표시·DB 제출 행 수를 돌려준다. */
  async function answerOpenSheet() {
    const tStart = Date.now();
    await clickText(J, '퀴즈 시작하기', 20000);
    for (let q = 0; q < 5; q++) {
      if (!(await J.waitFor(vis('[aria-label^="정답 "]'), 15000))) {
        const fm = (await J.text()).slice(0, 200).replace(/\n/g, ' / ');
        throw new Error(`자동 응시 불가(4지선다 아님?) · 화면 "${fm}"`);
      }
      await J.click('[aria-label^="정답 "]');
      await J.waitFor(bodyHas(/결과 보기|다음 문제/), 20000);
      if (await J.waitFor(bodyHas(/다음 문제/), 500)) { await clickText(J, '다음 문제'); continue; }
      await clickText(J, '결과 보기');
      break;
    }
    await J.waitFor(bodyHas(/이해 확인이 끝났어요|맞았어요\./), 20000);
    // '제출됐어요' 는 제출 저장(quiz_staff_record)이 서버에서 끝난 뒤에만 뜬다 — 문구가 뜬 시점에 DB 행이 있어야 한다(20초).
    const submittedShown = await J.waitFor(bodyHas(/제출됐어요\. 사장님이 결과를 볼 수 있어요\./), 20000);
    const { count: submittedRows } = await admin.from('quiz_attempt_items').select('id', { count: 'exact', head: true })
      .eq('staff_id', jUid).gte('created_at', new Date(tStart - 30000).toISOString());
    await sleep(800);
    const t = await J.text();
    await clickText(J, '닫기');
    await sleep(1200);
    return { text: t, submittedShown, submittedRows: submittedRows ?? 0 };
  }
  const r1 = await answerOpenSheet();
  check('7-1 직원 응시 결과 화면에 "다시 하기" 없음', !/다시 하기/.test(r1.text));
  check('7-1b 결과 화면 "제출됐어요. 사장님이 결과를 볼 수 있어요." 가 DB quiz_attempt_items 행이 생긴 뒤 뜬다(20초)', r1.submittedShown && r1.submittedRows > 0, `문구=${r1.submittedShown} · DB 제출 행 ${r1.submittedRows}`);
  await settle(J); await dismissOverlays(J);
  await net(J, 'J 응시 1');

  section('11. 마감 변경 → 직원 카드가 새로고침 없이 바뀌나(⑤)');
  const newDue = kstYmd(5);
  await S.goto(`/owner/quiz/${X}?tab=settings`);
  await S.waitFor(bodyHas(/언제까지 풀까요/), 60000);
  await settle(S); await dismissOverlays(S);
  if (await S.visible('[aria-label="마감일 정하기"]')) await S.click('[aria-label="마감일 정하기"]');
  for (let i = 0; i < 2 && !(await S.visible(`[aria-label="${newDue}"]`)); i++) { await S.click('[aria-label="다음 달"]'); await sleep(300); }
  await S.click(`[aria-label="${newDue}"]`);
  const cardBefore = ((await J.eval(`(()=>{const m=document.body.innerText.match(/\\d+월 \\d+일까지|오늘까지|기한이 지났어요/);return m?m[0]:null})()`)) ?? '없음');
  await S.click('[aria-label="저장"]');
  const saved = await S.waitFor(bodyHas(/저장했어요|못 ?했어요/), 10000);
  const saveMsg = (await bodyMatch(S, /[^\n]*(저장했어요|못 ?했어요)[^\n]*/))?.[0];
  const tSave = Date.now();
  const { data: dueRows } = await admin.from('quiz_assignments').select('due_on,due_date,sent_at').eq('course_id', X).eq('user_id', jUid);
  note('DB 마감(직원 행)', J_(dueRows));
  const flipped = await J.waitFor(`document.body.innerText.includes(${J_(mdLabel(newDue))})`, 20000);
  const cardAfter = ((await J.eval(`(()=>{const m=document.body.innerText.match(/\\d+월 \\d+일까지|오늘까지|기한이 지났어요/);return m?m[0]:null})()`)) ?? '없음');
  check('6-0 사장 마감 저장 성공', saved && /저장했어요/.test(saveMsg ?? ''), `"${saveMsg}"`);
  check(`⑤-1 직원 카드 마감이 새로고침 없이 "${mdLabel(newDue)}"로 바뀐다(20초)`, flipped, `${flipped ? ((Date.now() - tSave) / 1000).toFixed(1) + 's' : '20s 안 바뀜'} · 카드 ${cardBefore}→${cardAfter} · DB due_on=${dueRows?.map((r) => r.due_on).join(',')}`);
  if (!flipped) {
    await J.reload(); await J.waitFor(`document.body.innerText.length>40`, 60000); await settle(J);
    note('새로고침 뒤 직원 카드 마감', (await bodyMatch(J, /\d+월 \d+일까지|오늘까지/))?.[0] ?? '없음');
  }
  await net(S, 'S 설정(마감)'); await net(J, 'J 업무(마감)');

  section('12. 직원이 나머지를 다 푼다 → 사장 결과 줄이 새로고침 없이 바뀌나(⑤)');
  await S.goto(`/owner/quiz/${X}`);
  await S.waitFor(vis('[role="tab"][aria-label="결과"]'), 60000);
  await settle(S); await dismissOverlays(S);
  const rowBefore = ((await textOf(S, jRowSel)) ?? '').replace(/\n/g, ' / ');
  note('사장 결과 줄(나머지 풀기 전)', `"${rowBefore}"`);
  let rounds = 0;
  for (; rounds < 6; rounds++) {
    if (!(await J.waitFor(vis('[aria-label="혼자 할 수 있어요"]'), 8000))) break;
    const nm = await J.eval(`(()=>{const m=document.body.innerText.match(/${PREFIX}${STAMP}_[AB]/);return m?m[0]:null})()`);
    if (!nm) { note('카드', '하니스 퀴즈가 아닌 카드 — 멈춤'); break; }
    await J.click('[aria-label="혼자 할 수 있어요"]');
    await J.waitFor(bodyHas(/퀴즈 시작하기/), 20000);
    const r = await answerOpenSheet();
    if (/다시 하기/.test(r.text)) check('7-2 결과 화면 "다시 하기" 없음', false);
  }
  note('추가로 푼 시트', rounds);
  const { data: ku2 } = await admin.from('knowhow_understanding').select('entry_id').eq('staff_id', jUid).in('entry_id', EIDS);
  check('12-1 DB 직원 통과 노하우 = 4', (ku2 ?? []).length === 4, `${(ku2 ?? []).length}`);
  const tDone = Date.now();
  const live = await S.waitFor(`(()=>{const e=document.querySelector(${J_(jRowSel.split(',')[1])})||document.querySelector(${J_(jRowSel.split(',')[0])});return !!e&&/4문제 중 4개 맞힘/.test(e.innerText)})()`, 20000);
  const rowLive = ((await textOf(S, jRowSel)) ?? '').replace(/\n/g, ' / ');
  check('⑤-2 사장 결과 줄이 새로고침 없이 "4문제 중 4개 맞힘"으로 바뀐다(20초)', live, `${live ? ((Date.now() - tDone) / 1000).toFixed(1) + 's' : '20s 안 바뀜'} · 줄 "${rowBefore}"→"${rowLive}"`);
  check('7-3 사장 결과 화면에 "다시 하기" 없음', !/다시 하기/.test(await S.text()));
  await S.reload(); await S.waitFor(vis('[role="tab"][aria-label="결과"]'), 60000); await settle(S); await dismissOverlays(S);
  note('새로고침 뒤 사장 결과 줄', `"${((await textOf(S, jRowSel)) ?? '').replace(/\n/g, ' / ')}"`);
  await net(S, 'S 결과(완료 뒤)'); await net(J, 'J 업무(완료 뒤)');

  section('12-b. 응시 완료 판정 = 퀴즈 단위(0310) — 같은 노하우가 두 퀴즈에 담겼을 때');
  {
    // 노하우 1개(재료 밖 5번째 후보)를 퀴즈 C1·C2 에 담고, 문항은 각 퀴즈에 course_id 로 묶어 만든다(0307 방식).
    // 직원이 C1 의 문항만 풀면 C1 발송만 completed_at, C2 발송은 null 이어야 한다. DB 경로만(화면 없음 · 정리는 접두사 코스로).
    // ⚠️0310 push 전엔 12-b-3 RED 가 정상 — 0275 는 노하우 겹침(entry_ids)만 봐서 C2 도 완료로 찍는다.
    const E5 = cand[4];
    check('12-b-0 (전제) 재료 밖 노하우 1개(직원 미통과)', !!E5, `후보 ${cand.length}`);
    if (E5) {
      const C1 = `tc_qajr_${STAMP}_c1`, C2 = `tc_qajr_${STAMP}_c2`;
      const I1 = `qi_qajr_${STAMP}_c1`, I2 = `qi_qajr_${STAMP}_c2`;
      const { error: cErr } = await admin.from('training_courses').insert([C1, C2].map((id, i) => ({
        id, unit_id: UNIT, key: `qajr_${STAMP}_c${i + 1}`, name: `${PREFIX}${STAMP}_C${i + 1}`, due_days: null, position: 50 + i, active: true, start_at: kstYmd(0),
      })));
      if (cErr) throw new Error('12-b 코스: ' + cErr.message);
      const { error: ceErr } = await admin.from('course_entries').insert([C1, C2].map((cid) => ({ course_id: cid, entry_id: E5.id, unit_id: UNIT, position: 0 })));
      if (ceErr) throw new Error('12-b 담기: ' + ceErr.message);
      const mkItem = (id, cid, n) => ({
        id, unit_id: UNIT, entry_ids: [E5.id], kind: 't0', format: 'mc4', status: 'active', course_id: cid,
        payload: { ask: `qa_jr 12-b 문제 ${n}`, choices: ['정답', '오답 가', '오답 나', '오답 다'], answer_index: 0, explain: 'qa_jr 하니스 고정 문항' },
      });
      const { error: iErr } = await admin.from('quiz_items').insert([mkItem(I1, C1, 1), mkItem(I2, C2, 2)]);
      if (iErr) throw new Error('12-b 문항: ' + iErr.message);
      const sentAt = new Date(Date.now() - 60000).toISOString();
      const { data: asgC, error: aErr } = await admin.from('quiz_assignments')
        .insert([C1, C2].map((cid) => ({ unit_id: UNIT, course_id: cid, user_id: jUid, scheduled_on: kstYmd(0), sent_at: sentAt })))
        .select('id,course_id');
      if (aErr) throw new Error('12-b 발송: ' + aErr.message);
      const idOf = (cid) => (asgC ?? []).find((a) => a.course_id === cid)?.id;
      // 직원 세션이 C1 문항만 푼다 — 화면과 같은 RPC(quiz_staff_record). 맞혔는지는 안 본다(0275).
      const { data: sub, error: rErr } = await juniorC.rpc('quiz_staff_record', { p_rows: [{ item_id: I1, response: 0, ord: 0 }] });
      check('12-b-1 직원이 C1 문항 1개를 풀었다(quiz_staff_record 제출 id)', !rErr && !!sub, rErr?.message ?? `sub=${sub}`);
      const { data: d1, error: e1 } = await juniorC.rpc('mark_quiz_completed', { p_id: idOf(C1) });
      const { data: d2, error: e2 } = await juniorC.rpc('mark_quiz_completed', { p_id: idOf(C2) });
      const { data: rows } = await admin.from('quiz_assignments').select('course_id,completed_at').in('id', [idOf(C1), idOf(C2)]);
      const doneOf = (cid) => (rows ?? []).find((r) => r.course_id === cid)?.completed_at ?? null;
      check('12-b-2 C1 발송 = 완료(true · completed_at 있음)', !e1 && d1 === true && !!doneOf(C1), `${e1?.message ?? d1} · ${doneOf(C1)}`);
      check('12-b-3 C2 발송 = 미완료(false · completed_at null) — C2 문항은 안 풀었다(단위: 발송)', !e2 && d2 === false && doneOf(C2) === null, `${e2?.message ?? d2} · ${doneOf(C2)}`);
      const { error: rErr2 } = await juniorC.rpc('quiz_staff_record', { p_rows: [{ item_id: I2, response: 0, ord: 0 }] });
      const { data: d3, error: e3 } = await juniorC.rpc('mark_quiz_completed', { p_id: idOf(C2) });
      check('12-b-4 C2 문항을 풀면 C2 발송도 완료(true)', !rErr2 && !e3 && d3 === true, rErr2?.message ?? e3?.message ?? `got=${d3}`);
    }
  }

  section('12-b. 사장 벨 응시 완료(quiz_done) 항목 → 착지(그 퀴즈 결과 탭 · K7)');
  // 다시 알리기(K5)가 같은 퀴즈의 발송 행을 하나 더 만든다 → 완료된 행 하나를 고른다(maybeSingle 은 2행이면 null).
  const { data: doneRow } = await admin.from('quiz_assignments').select('id,completed_at').eq('course_id', X).eq('user_id', jUid)
    .not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1).maybeSingle();
  check('K7-0 DB quiz_assignments(X · 직원) completed_at 이 찍혔다(0275)', !!doneRow?.completed_at, `completed_at=${doneRow?.completed_at ?? 'null'}`);
  await S.goto('/owner/notifications');
  const K7_TITLE = `${J_NAME}님이 퀴즈를 다 풀었어요`;
  const k7Row = await S.waitFor(`(()=>{const t=document.body.innerText;return t.includes(${J_(K7_TITLE)})&&t.includes(${J_(cardName)})})()`, 30000);
  check('K7-1 사장 벨에 "<직원>님이 퀴즈를 다 풀었어요" + 퀴즈 이름 행이 있다 [문자열]', k7Row, `제목 "${K7_TITLE}" · 본문 "${cardName}"`);
  let k7 = { path: '?', search: '', rowVisible: false };
  if (k7Row) {
    await clickText(S, cardName); // 본문(퀴즈 이름)으로 누른다 — 같은 제목의 행이 둘(A·B)일 수 있다.
    await S.waitFor(`location.pathname===${J_(`/owner/quiz/${X}`)}`, 15000);
    await settle(S); await dismissOverlays(S);
    k7 = await S.eval(`(()=>{const e=document.querySelector(${J_(jRowSel.split(',')[1])})||document.querySelector(${J_(jRowSel.split(',')[0])});let v=false;if(e){const r=e.getBoundingClientRect();v=r.width>0&&r.top>=0&&r.bottom<=innerHeight;}return {path:location.pathname,search:location.search,rowVisible:v};})()`);
  }
  check('K7-2 벨 항목 → 착지 주소가 /owner/quiz/<퀴즈 id>?tab=result [문자열]', k7.path === `/owner/quiz/${X}` && k7.search.includes('tab=result'), `착지 ${k7.path}${k7.search}`);
  check('K7-3 착지 화면 결과 탭에 그 직원 줄이 보인다 [문자열]', k7.rowVisible, `직원 줄 보임=${k7.rowVisible}`);
  await net(S, 'S 벨 → 결과');

  // ── K7-h(0313 · 결정 1): 허브 알림(/notifications)에도 같은 quiz_done 행 + 매장 이름 칩. 사장 매장이 2개 이상일 때만 허브가 뜬다.
  {
    const { data: myUnits } = await ownerC.rpc('my_units');
    const nUnits = (myUnits ?? []).length;
    const { data: pref } = await admin.from('unit_member_prefs').select('nickname').eq('user_id', ownerC.uid).eq('unit_id', UNIT).maybeSingle();
    const { data: unitRow } = await admin.from('units').select('store_name').eq('id', UNIT).maybeSingle();
    const chip = pref?.nickname || unitRow?.store_name || '';
    note('사장 매장 수(my_units) · 매장 칩', `${nUnits} · "${chip}"`);
    if (nUnits >= 2) {
      await S.goto('/notifications');
      const hub = await S.waitFor(`(()=>{const t=document.body.innerText;return t.includes(${J_(K7_TITLE)})&&t.includes(${J_(cardName)})&&t.includes(${J_(chip)})})()`, 30000);
      check('K7-h 허브 /notifications 에도 "<직원>님이 퀴즈를 다 풀었어요" + 퀴즈 이름 + 매장 이름 칩 [문자열 · 0313 push 전엔 RED 가 정상]', hub, `칩 "${chip}"`);
      await net(S, 'S 허브 알림');
    } else {
      // 매장이 1개면 허브가 없다 — 매장 벨 '전체 읽음' 뒤 DB ack 시각이 갱신되는지로 대체.
      const t0 = new Date().toISOString();
      await S.goto('/owner/notifications');
      await S.waitFor(`document.body.innerText.includes(${J_(K7_TITLE)})`, 30000);
      await clickText(S, '전체 읽음');
      await sleep(1500);
      const { data: ack } = await admin.from('unit_member_prefs').select('notif_ack_at').eq('user_id', ownerC.uid).eq('unit_id', UNIT).maybeSingle();
      check('K7-h(대체 · 매장 1개) 매장 벨 전체 읽음 → notif_ack_at 갱신 [시각]', !!ack?.notif_ack_at && ack.notif_ack_at >= t0, `ack=${ack?.notif_ack_at ?? 'null'}`);
    }
  }

  section('13. 화면 전환 합계(단언 9)');
  check(`9 콘솔 에러 0 · ≥400 응답 0 (전 구간 · 콘솔 ${netLog.err} · ≥400 ${netLog.bad})`, netLog.err === 0 && netLog.bad === 0);
} catch (e) {
  fail++;
  console.log('  ✗ 중단:', e.message);
  // 멈춘 자리 화면을 남긴다(원인 확인용).
  for (const [i, w] of wins.entries()) {
    const f = join(tmpdir(), `qa-journey-quiz-${i}.png`);
    await w.page.shot(f).then(() => console.log('  · 화면 저장', f)).catch(() => {});
  }
} finally {
  for (const w of wins) await w.close().catch(() => {});
  await cleanup(jUid, '끝').catch((e) => console.log('  ! 정리 실패:', e.message));
  await restoreActive(ownerC, prevOwner);
  await restoreActive(juniorC, prevJunior);
  console.log(`\n  · AI(LLM) 호출: 진짜 ${aiFinal?.real ?? '못 셈'} · 대체 ${aiFinal?.shim ?? '못 셈'} · 소요 ${((Date.now() - T0) / 1000).toFixed(0)}s`);
  console.log(fail === 0 ? `GREEN ${pass}/0` : `RED ${pass}/${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
