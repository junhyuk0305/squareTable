#!/usr/bin/env node
// qa-journey-join.mjs — 합류 여정 하니스(2026-10-15): 초대 코드 → 직원 합류 대기 → 사장 승인 → 명부 반영.
//   사장 창(S)과 직원 창(J)을 한 스크립트 안에서 동시에 띄우고, 화면 문자열을 DB 원본과 맞춰 본다.
//
//   node scripts/qa-journey-join.mjs     (개발 서버 http://localhost:8081 · QA_ORIGIN 으로 바꾼다 · .env + .env.seed)
//
// 데이터 설계 (A): staff2 는 이미 store_001 멤버라 store_001 에는 합류 대기를 만들 수 없다.
//   사장이 하니스용 매장(qa_jr_join_<ts>)을 만들고 그 코드로 staff2 가 신청 → 사장 승인 → 명부를 본다.
//   2호점부터는 슬롯이 필요하다(0130) — 선례(qa-delete-store·qa-junior-multistore)처럼 service_role 로 슬롯 1개를 넣는다.
//   사장의 기존 매장 둘은 유료(multi)라 새 유료 매장이 생겨도 잠기지 않는다(0196 ②-b 는 무료 매장만 잠근다).
//   store_001 멤버십·역할은 건드리지 않는다. K1-a 만 store_001 명부를 읽기로 잰다(바꾸지 않는다).
// ★활성 매장은 로그인 세션마다 따로다(0285 session_active_units). create_store 가 계정 값(profiles.active_unit_id)을
//   새 매장으로 옮기므로, 사장 창 세션(S·S2)만 switch_session_unit 으로 새 매장에 두고 계정 값은 곧바로 되돌린다.
//   계정 값이 store_001 이 아닌 시간 = 1초 안팎. 다른 하니스의 새 로그인은 계정 값을 따르므로 이 창을 짧게 둔다.
// ★staff2 는 이미 매장이 있지만 '사장님 승인 대기 중' 카드가 뜬다(10-16 수정: 세션 pendingUnitId = profiles.pending_unit_id 그대로 · K5-a).
//   K3 은 "승인 뒤 J 가 새로고침 없이 소속을 다시 읽고(my_units) 매장 목록에 새 매장이 뜸"으로 잰다(카드 소멸보다 강한 단언).
// 끝나면 하니스가 연 브라우저 세션 3개를 로그아웃한다(auth.sessions · session_active_units 정리).
//
// 정리: 하니스 매장(qa_jr_ 접두사)·그 매장이 쓴 슬롯·이번 실행의 staff2 join_attempts 만 지운다. 시작과 끝 둘 다(멱등).
//   슬롯 표식 = paid_until 의 밀리초 .777 (소비 전에 죽은 실행의 슬롯을 다음 실행이 알아본다).
// ★건너뛴 단언은 통과로 세지 않는다 — 준비가 안 서서 못 돈 단언은 ✗ 로 센다.
// ★콘솔 에러 = cdp.mjs 의 page.errors. ≥400 응답 = 페이지의 fetch 를 감싸 센다(웹소켓·이미지는 안 센다).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW, UNIT, login, stateLine, rolePrecondition } from './lib/qa-fixed-accounts.mjs';

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
if (!SB || !ANON || !SRV) { console.error('FAIL: URL/ANON(.env) · SERVICE_ROLE(.env.seed) 필요'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const T0 = Date.now();
const RUN_START = new Date(T0 - 2000).toISOString();
const STORE_NAME = `qa_jr_join_${T0}`;
const STORAGE_KEY = storageKeyFor(SB);
const admin = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); }
};
const section = (t) => console.log(`\n── ${t}`);
const info = (...a) => console.log('  ·', ...a);

const ERR_RE = /실패|못\s?했어요|오류/;
const errLines = (t) => (t ?? '').split('\n').map((s) => s.trim()).filter((s) => ERR_RE.test(s));
const INVALID_MSG = '초대코드가 올바르지 않아요. 사장님께 코드를 다시 받아주세요.';
const CLOSED_MSG = '지금은 합류 신청을 받지 않는 매장이에요. 사장님께 확인해 주세요.';
const ADD_ROW = '[aria-label="코드로 매장 추가 — 초대코드 입력"]';
const CODE_INPUT = 'input[maxlength="6"]';

// 페이지의 fetch 를 감싸 ≥400 응답을 모은다(supabase-js 는 전역 fetch 를 부른다).
const FETCH_SPY = `(()=>{window.__qaBad=[];const f=window.fetch;window.fetch=async(...a)=>{const r=await f(...a);try{if(r.status>=400){const u=String((a[0]&&a[0].url)||a[0]).split('?')[0];window.__qaBad.push(r.status+' '+u.slice(u.indexOf('/',8)));}}catch(e){}return r;};})()`;

async function passwordSession(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}

/** 비어 있는 디버깅 포트. 다른 하니스가 9333 을 쓰고 있으면 그 브라우저에 붙지 않게 다음 번호로 민다. */
async function freePort(from, taken) {
  for (let p = from; p < from + 50; p++) {
    if (taken.includes(p)) continue;
    try { await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(500) }); } catch { return p; }
  }
  throw new Error('빈 디버깅 포트 없음');
}

const windows = [];
const ports = [];
async function openWindow(name, port, session, path) {
  const p = await freePort(port, ports);
  ports.push(p);
  const { page, close } = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width: 460, height: 900, port: p });
  windows.push(close);
  await page.seedSession(session);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_SPY });
  await page.goto(path);
  let ce = 0;
  let bad = 0;
  const w = {
    name, page, close,
    /** 지난 표시 이후 콘솔 에러·≥400 응답 수를 찍는다. */
    async mark(label) {
      const errs = page.errors.slice(ce);
      ce = page.errors.length;
      let b = [];
      try { const all = (await page.eval('window.__qaBad || []')) ?? []; b = all.slice(bad); bad = all.length; } catch { /* 이동 중 */ }
      const detail = [...errs.map((e) => `콘솔: ${String(e).split('\n')[0].slice(0, 140)}`), ...b.map((x) => `응답: ${x}`)];
      info(`[${name}] ${label} — 콘솔 에러 ${errs.length}건 · ≥400 응답 ${b.length}건${detail.length ? '\n      ' + detail.join('\n      ') : ''}`);
    },
    async reload() { await w.mark('새로고침 전'); await page.reload(); bad = 0; },
    async goto(to) { await w.mark('이동 전'); await page.goto(to); bad = 0; },
  };
  return w;
}

async function clickText(page, text, ms = 15000) {
  if (!(await page.waitFor(tagTextExpr(text), ms))) throw new Error(`글자 '${text}' 를 못 찾음`);
  await page.click('[data-qa-t="1"]');
}
/** 화면에 보이는 요소 중 글자가 정확히 text 인 가장 안쪽 요소에 표식을 단다. */
const tagTextExpr = (text) => `(()=>{const want=${JSON.stringify(text)};
  const all=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(e.innerText||'').trim()===want;});
  if(!all.length)return false;
  const leaf=all.filter(e=>!all.some(o=>o!==e&&e.contains(o)));
  document.querySelectorAll('[data-qa-t]').forEach(e=>e.removeAttribute('data-qa-t'));
  leaf[0].setAttribute('data-qa-t','1');return true;})()`;

/** 누를 준비만 한다(좌표 계산). 돌려준 함수를 부르면 곧바로 누른다 — 두 창을 거의 동시에 누를 때 쓴다. */
async function armClick(page, text, ms) {
  if (!(await page.waitFor(tagTextExpr(text), ms))) return null;
  await page.eval(`document.querySelector('[data-qa-t="1"]').scrollIntoView({block:'center'})`);
  const b = await page.box('[data-qa-t="1"]');
  if (!b) return null;
  const x = b.x + Math.min(b.w / 2, 40);
  const y = b.y + b.h / 2;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  return async () => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
}

/** 글자를 거의 동시에 두 번 누른다(두 번 제출 재현). */
async function doublePress(page, text) {
  await clickText(page, text);
  const b = await page.box('[data-qa-t="1"]');
  if (!b) return;
  const x = b.x + Math.min(b.w / 2, 40);
  const y = b.y + b.h / 2;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** 조건이 참이 될 때까지 화면 글자를 읽으며, 그동안 나타난 오류 문구(시작 때 없던 것)를 모은다. */
async function watch(page, pred, ms, seen = new Set()) {
  const base = new Set(errLines(await page.text().catch(() => '')));
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) {
    try {
      last = await page.text();
      for (const l of errLines(last)) if (!base.has(l)) seen.add(l);
      if (pred(last)) return { ok: true, sec: (Date.now() - t0) / 1000, seen, text: last };
    } catch { /* 이동 중 */ }
    await sleep(200);
  }
  return { ok: false, sec: (Date.now() - t0) / 1000, seen, text: last };
}

/** 직원 hub 에서 코드를 넣고 '합류 신청' 을 누른다. */
async function joinViaUi(J, code, { double = false } = {}) {
  const page = J.page;
  if (!(await page.waitFor(`!!document.querySelector(${JSON.stringify(CODE_INPUT)}) || !!document.querySelector(${JSON.stringify(ADD_ROW)})`, 30000))) {
    throw new Error('hub 코드 입력줄을 못 찾음');
  }
  if (!(await page.eval(`!!document.querySelector(${JSON.stringify(CODE_INPUT)})`))) {
    await page.click(ADD_ROW);
    if (!(await page.waitFor(`!!document.querySelector(${JSON.stringify(CODE_INPUT)})`, 5000))) throw new Error('코드 입력칸이 안 열림');
  }
  await page.eval(`document.querySelector(${JSON.stringify(CODE_INPUT)}).focus()`);
  await page.send('Input.insertText', { text: code });
  if ((await page.eval(`document.querySelector(${JSON.stringify(CODE_INPUT)}).value`)) !== code) throw new Error('코드 입력이 안 들어감');
  if (double) await doublePress(page, '합류 신청');
  else await clickText(page, '합류 신청');
}

const staffNum = (t) => { const m = (t ?? '').match(/합류한 직원 \((\d+)명\)/); return m ? Number(m[1]) : null; };
const pendNum = (t) => { const m = (t ?? '').match(/합류 신청 \((\d+)명\)/); return m ? Number(m[1]) : null; };

// ── DB 원본(service_role · 읽기) ─────────────────────────────────────────────
async function dbStaff(unit) {
  const { data: mem } = await admin.from('unit_members').select('user_id, role').eq('unit_id', unit);
  const staff = (mem ?? []).filter((m) => m.role === 'junior' || m.role === 'manager');
  const ids = (mem ?? []).map((m) => m.user_id);
  const { data: pr } = ids.length ? await admin.from('profiles').select('id, role, deleted_at').in('id', ids) : { data: [] };
  const byRole = (pr ?? []).filter((p) => p.role === 'junior' || p.role === 'manager').length;
  const active = staff.filter((m) => !(pr ?? []).find((p) => p.id === m.user_id)?.deleted_at).length;
  return { members: staff.length, active, byProfileRole: byRole };
}
async function dbPending(unit) {
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('pending_unit_id', unit);
  return count ?? 0;
}
async function members001() {
  const { data } = await admin.from('unit_members').select('user_id, role').eq('unit_id', UNIT);
  return JSON.stringify((data ?? []).map((m) => `${m.user_id}:${m.role}`).sort());
}
async function activeOf(c) {
  const { data } = await c.rpc('my_units');
  return (data ?? []).find((r) => r.is_active)?.unit_id ?? null;
}
async function switchTo(c, unit) {
  if (!unit || (await activeOf(c)) === unit) return;
  const { error } = await c.rpc('switch_active_unit', { p_unit_id: unit });
  if (error) console.log(`  ! 활성 매장 ${unit} 로 되돌리기 실패: ${error.message}`);
}

// ── 고정 계정 · 전제 ─────────────────────────────────────────────────────────
const oc = await login(SB, ANON, FIXED.owner);
const mc = await login(SB, ANON, FIXED.manager);
const jc = await login(SB, ANON, FIXED.junior);
const clients = { owner: oc, manager: mc, junior: jc };

/** 하니스 매장·슬롯 정리(멱등). 활성 매장이 그 매장을 가리키면 먼저 돌려놓는다. */
async function cleanup(ownerBack, juniorBack, label) {
  const { data: owned } = await admin.from('units').select('id, store_name').eq('owner_id', oc.uid);
  const ids = (owned ?? []).filter((u) => (u.store_name ?? '').startsWith('qa_jr_')).map((u) => u.id);
  if (ids.length) {
    await admin.from('profiles').update({ pending_unit_id: null }).in('pending_unit_id', ids);
    if (ids.includes(await activeOf(oc))) await switchTo(oc, ownerBack ?? UNIT);
    if (ids.includes(await activeOf(jc))) await switchTo(jc, juniorBack ?? UNIT);
    await admin.from('store_slots').delete().in('consumed_unit_id', ids);
    const { error } = await admin.from('units').delete().in('id', ids);
    if (error) console.log(`  ! 하니스 매장 삭제 실패: ${error.message}`);
  }
  const { data: slots } = await admin.from('store_slots').select('id, paid_until').eq('owner_id', oc.uid).is('consumed_at', null);
  const marked = (slots ?? []).filter((s) => /\.777/.test(s.paid_until)).map((s) => s.id);
  if (marked.length) await admin.from('store_slots').delete().in('id', marked);
  info(`정리(${label}): 하니스 매장 ${ids.length}개 · 남은 표식 슬롯 ${marked.length}개`);
}

section('0. 준비 — 전제 · 시작 상태 · 남은 하니스 데이터 정리');
const pre = await rolePrecondition(clients);
if (pre) { console.log(`  ✗ 전제 깨짐: ${pre} — 지난 실행이 원복을 못 했을 수 있어요`); console.log('\nRED 0/1'); process.exit(1); }
const ownerStart = await activeOf(oc);
const juniorStart = await activeOf(jc);
await cleanup(ownerStart, juniorStart, '시작');
const stateBefore = await stateLine(clients);
const m001Before = await members001();
info(`시작 상태: ${stateBefore}`);
{
  const { count } = await admin.from('join_attempts').select('uid', { count: 'exact', head: true })
    .eq('uid', jc.uid).eq('ok', false).gt('attempted_at', new Date(Date.now() - 10 * 60e3).toISOString());
  info(`staff2 최근 10분 실패 시도 ${count ?? 0}건(5건이면 잠김)`);
}

const ownerSession = await passwordSession(FIXED.owner);
const owner2Session = await passwordSession(FIXED.owner);
const juniorSession = await passwordSession(FIXED.junior);
/** 이 브라우저 세션만 그 매장으로 옮긴다(0285). 계정 값도 같이 바뀌므로 부른 뒤 계정 값을 되돌린다. */
async function sessionSwitch(session, u) {
  const r = await fetch(`${SB}/rest/v1/rpc/switch_session_unit`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_unit_id: u }),
  });
  if (!r.ok) throw new Error(`switch_session_unit ${r.status}: ${(await r.text()).slice(0, 120)}`);
}
async function accountActive(uid) {
  const { data } = await admin.from('profiles').select('active_unit_id').eq('id', uid).single();
  return data?.active_unit_id ?? null;
}

// 이 묶음이 끝까지 못 돌면 남은 단언을 ✗ 로 센다.
const PLANNED = ['K1-a', 'K1-b', 'K5-a', 'K2-auto', 'K2', 'K3', 'K4', 'K1-c', 'K2-c', 'K5-b', 'K5-c', 'K6-a', 'K6-b'];
const done = new Set();
const mark = (k) => done.add(k);
let unit = null;
let code = null;

try {
  // ── K1-a: store_001 명부(읽기만) ─────────────────────────────────────────
  section('K1-a. 명부 직원 수 == unit_members (store_001 · 읽기만)');
  await switchTo(oc, UNIT); // 시작 활성이 다른 매장이면 잠깐 옮긴다(끝에 되돌림)
  const S = await openWindow('S', 9333, ownerSession, '/owner/staff');
  {
    const db = await dbStaff(UNIT);
    const r = await watch(S.page, (t) => staffNum(t) === db.members, 40000);
    check('K1-a S 명부 \'합류한 직원 (N명)\' == unit_members(junior·manager) 수 [명]', r.ok,
      `화면=${staffNum(r.text)} · DB 멤버십=${db.members} · 탈퇴 제외=${db.active} · profiles.role 기준=${db.byProfileRole}`);
    const pend = await dbPending(UNIT);
    info(`store_001 합류 신청: 화면=${pendNum(r.text) ?? '섹션 없음(0)'} · DB pending=${pend}`);
    mark('K1-a');
    await S.mark('store_001 명부');
  }

  // ── 셋업: 하니스 매장 ────────────────────────────────────────────────────
  section(`셋업 — 하니스 매장 ${STORE_NAME}`);
  const until = new Date(Date.now() + 864e5);
  until.setUTCMilliseconds(777);
  const { error: slotErr } = await admin.from('store_slots').insert({ owner_id: oc.uid, paid_until: until.toISOString(), source: 'grant', plan: 'multi' });
  if (slotErr) throw new Error(`슬롯 적립 실패: ${slotErr.message}`);
  const { data: cs, error: csErr } = await oc.rpc('create_store', { p_store_name: STORE_NAME, p_industry: '카페·디저트', p_biz_no: null });
  if (csErr) throw new Error(`create_store 실패: ${csErr.message}`);
  ({ unit_id: unit, invite_code: code } = Array.isArray(cs) ? cs[0] : cs);
  await sessionSwitch(ownerSession, unit);
  await sessionSwitch(owner2Session, unit);
  const { error: backErr } = await oc.rpc('switch_active_unit', { p_unit_id: ownerStart });
  if (backErr) throw new Error(`사장 계정 활성 매장 되돌리기 실패: ${backErr.message}`);
  info(`매장 ${unit} · 코드 ${code} · S·S2 세션 = 새 매장 · 사장 계정 활성 = ${await accountActive(oc.uid)}`);

  // ── K1-b: 빈 매장 명부 ───────────────────────────────────────────────────
  section('K1-b. 새 매장 명부(직원 0명 · 신청 0명)');
  await S.reload();
  {
    const db = await dbStaff(unit);
    const r = await watch(S.page, (t) => t.includes(STORE_NAME) || staffNum(t) !== null, 40000);
    const r2 = await watch(S.page, (t) => staffNum(t) === db.members, 15000);
    check('K1-b S 명부 직원 수 == unit_members 수 [명]', r.ok && r2.ok, `화면=${staffNum(r2.text)} · DB=${db.members} · profiles.role 기준=${db.byProfileRole}`);
    check('K2(전) S \'합류 신청\' 섹션 없음 == pending 0 [명]', pendNum(r2.text) === null && (await dbPending(unit)) === 0, `화면=${pendNum(r2.text)}`);
    mark('K1-b');
    await S.mark('새 매장 명부');
  }

  // ── J: 합류 신청(두 번 누름) ─────────────────────────────────────────────
  section('K5-a. J 같은 코드로 합류 신청 두 번(거의 동시) → 대기 카드 · 오류 문구 0');
  const J = await openWindow('J', 9334, juniorSession, '/junior/hub');
  await J.page.waitFor(`document.body.innerText.includes('코드로 매장 추가')`, 40000);
  await J.mark('hub 진입');
  {
    const seen = new Set();
    const before = new Set((await J.page.text()).split('\n').map((s) => s.trim()));
    const w0 = watch(J.page, (t) => /승인 대기|승인을 기다/.test(t), 10000, seen);
    await joinViaUi(J, code, { double: true });
    const r = await w0;
    const pend = await dbPending(unit);
    check('K5-a DB 신청 1건(profiles.pending_unit_id) [건]', pend === 1, `pending=${pend}`);
    check('K5-a J 신청 뒤 화면에 승인 대기 표시(10초) [초]', r.ok,
      `${r.sec.toFixed(1)}초 · 신청 뒤 새 문구: ${r.text.split('\n').map((s) => s.trim()).filter((s) => s.length > 1 && !before.has(s)).join(' / ') || '없음'}`);
    check('K5-a J 두 번 신청 → 오류 문구 0건 [건]', seen.size === 0, seen.size ? `보인 문구: ${[...seen].join(' / ')}` : '');
    mark('K5-a');
    await J.mark('합류 신청 뒤');
  }

  // ── K2: S 에 신청이 새로고침 없이 뜨는가 · 수가 DB 와 같은가 ───────────────
  section('K2. S \'합류 신청 (N명)\' == profiles.pending_unit_id 수');
  {
    const db = await dbPending(unit);
    const r = await watch(S.page, (t) => pendNum(t) === db, 35000);
    check('K2-auto S 새로고침 없이 신청이 뜸(30초 폴링 한도) [초]', r.ok, `${r.sec.toFixed(1)}초 · 화면=${pendNum(r.text)} · DB=${db}`);
    mark('K2-auto');
    let shown = pendNum(r.text);
    if (!r.ok) { await S.reload(); const r2 = await watch(S.page, (t) => pendNum(t) === db, 30000); shown = pendNum(r2.text); }
    check('K2 S \'합류 신청 (N명)\' == pending_unit_id 수 [명]', shown === db, `화면=${shown} · DB=${db}`);
    mark('K2');
    await S.mark('신청 표시');
  }

  // 두 번째 사장 창(같은 계정 · 다른 기기) — K5-b 용. 승인 전에 신청 목록을 띄워 둔다.
  const S2 = await openWindow('S2', 9335, owner2Session, '/owner/staff');
  const s2Ready = await watch(S2.page, (t) => pendNum(t) === 1, 40000);
  info(`S2 신청 목록 준비 ${s2Ready.ok ? 'OK' : '실패'} (${s2Ready.sec.toFixed(1)}초)`);

  // ── K3·K4·K5-b: S 승인 + 곧바로 S2 승인 → J 소속 다시 읽기 · S 명부 +1 (새로고침 없이) ─────
  section('K3·K4·K5-b. S \'승인\' + S2 \'승인\'(두 기기 거의 동시) → J 자동 반영(25초) · S 명부 +1(30초)');
  let s2Pressed = false;
  const seenS2 = new Set();
  {
    const seenJ = new Set();
    const seenS = new Set();
    // S 는 좌표만 잡아 두고, S2 를 확인 클릭(최상단 요소 검사)으로 누른 직후 S 를 누른다 — 두 기기가 같은 신청을 거의 동시에 승인.
    const fireS = await armClick(S.page, '승인', 15000);
    if (!fireS) throw new Error('S 의 \'승인\' 버튼을 못 찾음');
    const jIdx = J.page.requests.length;
    const t0 = Date.now();
    const wJ = (async () => {
      while (Date.now() - t0 < 25000) {
        if (J.page.requests.slice(jIdx).includes('my_units')) return { ok: true, sec: (Date.now() - t0) / 1000 };
        await sleep(200);
      }
      return { ok: false, sec: (Date.now() - t0) / 1000 };
    })();
    const wJerr = watch(J.page, () => false, 6000, seenJ);
    const wS = watch(S.page, (t) => staffNum(t) === 1, 30000, seenS);
    const wS2 = watch(S2.page, () => false, 6000, seenS2);
    try { await clickText(S2.page, '승인', 3000); s2Pressed = true; } catch (e) { info(`S2 승인 못 누름: ${e.message}`); }
    await fireS();
    const [rJ, rS] = await Promise.all([wJ, wS, wJerr, wS2]);
    check('K3 J 새로고침 없이 소속을 다시 읽음(my_units · ≤25초) [초]', rJ.ok, `${rJ.sec.toFixed(1)}초`);
    // 다시 읽은 소속이 화면에 쓰이는가 — 앱 안 이동(새로고침 아님)으로 매장 목록을 연다.
    await J.page.click('[aria-label="매장 선택으로"]');
    const rList = await watch(J.page, (t) => t.includes(STORE_NAME), 10000);
    check('K3 J 앱 안 이동으로 연 매장 목록에 새 매장 이름 [문자열]', rList.ok, rList.ok ? `'${STORE_NAME}' · ${rList.sec.toFixed(1)}초` : '없음');
    check('K4 S 새로고침 없이 \'합류한 직원 (1명)\'(≤30초) [초]', rS.ok, `${rS.sec.toFixed(1)}초 · 화면=${staffNum(rS.text)}`);
    // S 의 오류 문구는 두 기기 경합(K5-b) 결과라 거기서 센다. 여기선 J 만.
    check('K3 승인 중 J 오류 문구 0건 [건]', seenJ.size === 0, [...seenJ].join(' / '));
    seenS.forEach((l) => seenS2.add(`(S) ${l}`));
    const db = await dbStaff(unit);
    check('K1-c 승인 뒤 S 명부 수 == unit_members 수 [명]', staffNum(rS.text) === db.members,
      `화면=${staffNum(rS.text)} · DB 멤버십=${db.members} · profiles.role 기준=${db.byProfileRole}`);
    check('K2-c 승인 뒤 S 신청 섹션 사라짐 == pending 0 [명]', pendNum(rS.text) === null && (await dbPending(unit)) === 0, `화면=${pendNum(rS.text)}`);
    ['K3', 'K4', 'K1-c', 'K2-c'].forEach(mark);
    await J.mark('승인 반영');
    await S.mark('승인 반영');
  }

  // ── K5-b: S2 의 두 번째 승인 결과 ────────────────────────────────────────
  {
    const s2After = await S2.page.text();
    const { data: mm } = await admin.from('unit_members').select('user_id').eq('unit_id', unit).eq('user_id', jc.uid);
    const nS = S.page.requests.filter((x) => x === 'approve_member').length;
    const nS2 = S2.page.requests.filter((x) => x === 'approve_member').length;
    if (!s2Pressed) info('S2 에 \'승인\' 버튼이 이미 없음(목록이 먼저 갱신됨) — 두 번째 승인을 누르지 못함');
    check('K5-b 두 기기 모두 approve_member 를 보냄 [회]', nS >= 1 && nS2 >= 1, `S=${nS} · S2=${nS2}`);
    check('K5-b 같은 신청 두 번 승인 → S·S2 오류 문구 0건 [건]', s2Pressed && nS2 >= 1 && seenS2.size === 0,
      `${s2Pressed ? '' : '(못 누름) '}보인 문구: ${[...seenS2].join(' / ') || '없음'} · 6초 뒤 S2 오류줄: ${errLines(s2After).join(' / ') || '없음'}`
      + ` · 6초 뒤 S2 신청 섹션=${pendNum(s2After) ?? '없음'} · DB 멤버십 행=${mm?.length} · DB pending=${await dbPending(unit)}`);
    mark('K5-b');
    await S2.mark('두 번째 승인');
  }
  info(`사장 계정 활성 매장 = ${await accountActive(oc.uid)}`);

  // ── K5-c: 이미 멤버인 코드로 다시 신청 ───────────────────────────────────
  section('K5-c. J 이미 합류한 매장 코드로 다시 신청 → 오류 문구 0');
  {
    const seen = new Set();
    await J.goto('/junior/hub');
    await J.page.waitFor(`document.body.innerText.includes('코드로 매장 추가')`, 40000);
    const before = new Set((await J.page.text()).split('\n').map((s) => s.trim()));
    const FEEDBACK = /이미 들어가|올바르지|받지 않는|실패|못\s?했어요|오류|잠겼/;
    const w = watch(J.page, (t) => t.split('\n').some((s) => FEEDBACK.test(s) && !before.has(s.trim())), 10000, seen);
    await joinViaUi(J, code);
    const r = await w;
    const msg = r.text.split('\n').map((s) => s.trim()).filter((s) => FEEDBACK.test(s) && !before.has(s));
    check('K5-c J 이미 멤버 코드 → 안내 문구가 뜨고 오류 문구 0건 [건]', r.ok && seen.size === 0,
      `뜬 문구: ${msg.join(' / ') || '없음(10초)'}${seen.size ? ' · 오류: ' + [...seen].join(' / ') : ''}`);
    mark('K5-c');
    await J.mark('이미 멤버 재신청');
  }

  // ── K6: 잘못된 코드 · 닫힌 매장 코드 ─────────────────────────────────────
  section('K6. 잘못된 코드 · 닫힌 매장 코드 → 안내 문구');
  {
    let bogus;
    for (;;) {
      bogus = String(Math.floor(100000 + Math.random() * 900000));
      const { data } = await admin.from('units').select('id').eq('invite_code', bogus);
      if (!data?.length) break;
    }
    await J.reload();
    const w = watch(J.page, (t) => t.includes(INVALID_MSG), 10000);
    await joinViaUi(J, bogus);
    const r = await w;
    check('K6-a 없는 코드 → 안내 문구 [문자열]', r.ok, r.ok ? `'${INVALID_MSG}'` : `화면 오류줄: ${errLines(r.text).join(' / ') || '없음'}`);
    mark('K6-a');
    await J.mark('잘못된 코드');

    const { error: delErr } = await admin.from('units').update({ deleted_at: new Date().toISOString() }).eq('id', unit);
    if (delErr) throw new Error(`닫힌 매장 만들기 실패: ${delErr.message}`);
    await J.reload();
    const w2 = watch(J.page, (t) => t.includes('합류 신청을 받지 않는 매장'), 10000);
    await joinViaUi(J, code);
    const r2 = await w2;
    const line = r2.text.split('\n').find((s) => s.includes('합류 신청을 받지 않는')) ?? '';
    check('K6-b 닫힌 매장 코드 → 안내 문구 [문자열]', r2.ok && line.trim() === CLOSED_MSG, `'${line.trim() || '없음'}'`);
    mark('K6-b');
    await J.mark('닫힌 매장 코드');
  }
} catch (e) {
  console.log(`  ! 중단: ${e.message}`);
} finally {
  for (const k of PLANNED) if (!done.has(k)) check(`${k} 못 돔`, false, '(앞 단계 중단)');
  for (const close of windows) await close();
  // 하니스가 연 브라우저 세션을 닫는다(auth.sessions → session_active_units cascade).
  for (const s of [ownerSession, owner2Session, juniorSession]) {
    await fetch(`${SB}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  }

  section('정리 · 끝 상태 == 시작 상태');
  await switchTo(oc, ownerStart);
  await switchTo(jc, juniorStart);
  await cleanup(ownerStart, juniorStart, '끝');
  await admin.from('join_attempts').delete().eq('uid', jc.uid).gte('attempted_at', RUN_START);
  const stateAfter = await stateLine(clients);
  check('S0 고정 계정 my_units(매장·역할·활성) 시작과 같음', stateAfter === stateBefore, stateAfter === stateBefore ? '' : `\n      전=${stateBefore}\n      후=${stateAfter}`);
  check('S0 store_001 unit_members 시작과 같음', (await members001()) === m001Before);
  const { data: left } = await admin.from('units').select('id').eq('owner_id', oc.uid).like('store_name', 'qa_jr_%');
  check('S0 하니스 매장 0개 남음', (left ?? []).length === 0, `${(left ?? []).length}개`);
}

console.log(`\n소요 ${((Date.now() - T0) / 1000).toFixed(0)}초`);
console.log(fail ? `RED ${pass}/${fail}` : `GREEN ${pass}/0`);
process.exit(fail ? 1 : 0);
