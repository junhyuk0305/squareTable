// qa-quiz-live-refresh.mjs — 퀴즈 목록·상세가 띄운 채로 바뀌는가(2026-11-19 B2 · B1 화면 문구).
//
// 사장 창 둘(목록 /owner/training · 상세 /owner/quiz/<id>)을 띄워 두고, 탭을 다시 열거나 새로고침하지 않은 채
// 발송 원장(quiz_assignments)만 바꾼다. 화면이 구독(subscribeQuizAssignments)으로 다시 읽어 바뀌어야 GREEN.
//   ① 사장 세션으로 "지금 바로" 행을 넣는다(send_now) → 상세 "5분 안에 가요" · 목록 "곧 발송"
//   ② service_role 로 sent_at 을 찍는다(크론 claim 과 같은 열) → 상세 결과 칸(완료 0/1) · 목록 "완료 0/1명"
//   ③ service_role 로 completed_at 을 찍는다(직원이 다 푼 것과 같은 열) → 상세 "1/1" · 목록 "완료 1/1명" · 응시 완료 칸
// 수정 전(구독 없음)에는 ①~③ 이 새로고침 없이 바뀌지 않아 RED 다.
//
//   node scripts/qa-quiz-live-refresh.mjs   (개발 서버 http://localhost:8081 · QA_ORIGIN · .env + .env.seed · 로컬 도커)
//
// ★AI 호출 0회 · 엣지 안 씀. ★고정 계정(owner·staff2) · store_001 · 하니스 데이터 = 이름 접두사 qa_live_ (시작·끝 정리).
//   재료 노하우·문항은 하니스가 만들고 지운다. ★고정 계정·브라우저를 써서 여정 하니스(qa:core·qa:crawl)와 동시에 돌리지 않는다.
// ★건너뛴 것은 통과로 세지 않는다. 마지막 줄 GREEN|RED — PASS · FAIL · SKIP.
import './lib/require-local-target.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { guardMainOrigin } from './lib/require-main-origin.mjs';
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
guardMainOrigin(ORIGIN);
if (!SB || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const admin = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const STORAGE_KEY = storageKeyFor(SB);
const PREFIX = 'qa_live_';
const STAMP = String(Date.now()).slice(-6);
const NAME = `${PREFIX}${STAMP}`;
const CID = `tc_${PREFIX}${STAMP}`;
const EID = `pb_${PREFIX}${STAMP}`;
const QID = `qi_${PREFIX}${STAMP}`;
const AID = `qz_${PREFIX}${STAMP}`;
/** 구독 → 다시 읽기까지 기다리는 한도. 새로고침은 하지 않는다. */
const LIVE_MS = 15000;

let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { if (ok) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); } };
const section = (t) => console.log(`\n── ${t}`);
const J_ = JSON.stringify;
const kstYmd = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const bodyHas = (re) => `new RegExp(${J_(re.source)}).test(document.body.innerText)`;

async function passwordSession(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: J_({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}

async function cleanup(tag) {
  const { data: cs } = await admin.from('training_courses').select('id').eq('unit_id', UNIT).like('name', `${PREFIX}%`);
  const ids = (cs ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from('quiz_assignments').delete().in('course_id', ids);
    await admin.from('quiz_items').delete().in('course_id', ids);
    await admin.from('course_entries').delete().in('course_id', ids);
    await admin.from('training_courses').delete().in('id', ids);
  }
  await admin.from('playbook_entries').delete().eq('unit_id', UNIT).like('id', `pb_${PREFIX}%`);
  console.log(`  · 정리(${tag}): 퀴즈 ${ids.length}`);
}

/** 목록 화면에서 이 퀴즈 줄의 글자(이름이 든 가장 작은 버튼). 없으면 null. */
const rowText = (page) => page.eval(`(()=>{const els=[...document.querySelectorAll('[role="button"]')].filter(e=>(e.innerText||'').includes(${J_(NAME)})&&e.getBoundingClientRect().width>0);
  const leaf=els.filter(e=>!els.some(o=>o!==e&&e.contains(o)));return leaf.length?leaf[0].innerText:null;})()`);
const waitRow = (page, re, ms = LIVE_MS) => page.waitFor(`(()=>{const els=[...document.querySelectorAll('[role="button"]')].filter(e=>(e.innerText||'').includes(${J_(NAME)})&&e.getBoundingClientRect().width>0);
  return els.some(e=>new RegExp(${J_(re.source)}).test(e.innerText));})()`, ms);

const ownerC = await login(SB, ANON, FIXED.owner);
const juniorC = await login(SB, ANON, FIXED.junior);
const wins = [];
let prevOwner = null;
try {
  section('0. 준비');
  const pre = await rolePrecondition({ owner: ownerC, junior: juniorC });
  check('0-1 store_001 역할이 시드와 같다', !pre, pre ?? '');
  if (pre) throw new Error('전제 불일치');
  prevOwner = await ensureActive(ownerC);
  await cleanup('시작');
  const { data: hasCol } = await admin.from('quiz_assignments').select('send_now').limit(1);
  const SEND_NOW_COL = Array.isArray(hasCol);
  if (!SEND_NOW_COL) { skip++; console.log('  - skip send_now 열 없음(0930 적용 전) · ① 문구 검사는 예약 문구로 본다'); }

  for (const q of [
    admin.from('playbook_entries').insert({ id: EID, unit_id: UNIT, category: 'Routine', title: `${NAME} 근거`, status: 'published' }),
    ownerC.from('training_courses').insert({ id: CID, unit_id: UNIT, key: `q_${CID}`, name: NAME, min_items: 1, max_items: 5, due_days: null, position: 0, active: true, audience: 'staff', start_at: kstYmd() }),
    admin.from('course_entries').insert({ course_id: CID, entry_id: EID, unit_id: UNIT, position: 0 }),
    admin.from('quiz_items').insert({ id: QID, unit_id: UNIT, course_id: CID, entry_ids: [EID], kind: 't0', format: 'mc4', status: 'active',
      payload: { ask: `${NAME} 문항`, choices: ['가', '나'], answer_index: 1, explain: 'QA' } }),
  ]) { const { error } = await q; if (error) throw new Error(`셋업: ${error.message}`); }
  check('0-2 재료(노하우 1 · 퀴즈 1 · 문항 1)', true);

  const sess = await passwordSession(FIXED.owner);
  for (const port of [9371, 9372]) {
    const w = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width: 460, height: 900, port });
    await w.page.seedSession(sess);
    wins.push(w);
  }
  const [L, D] = wins.map((w) => w.page);
  await L.goto('/owner/training');
  await D.goto(`/owner/quiz/${CID}`);
  // 셋업이 start_at 을 넣어 상태는 '예약'이다(초안 아님). 여기서는 줄이 보이는지만 본다.
  check('0-3 목록에 이 퀴즈 줄', await waitRow(L, new RegExp(NAME), 30000), (await rowText(L)) ?? '');
  check('0-4 상세 = 아직 아무에게도 안 보냈어요', await D.waitFor(bodyHas(/아직 아무에게도 안 보냈어요/), 30000));
  await sleep(2000); // 구독 연결

  section('① 지금 바로 행이 생긴다(새로고침 없음)');
  const row = { id: AID, unit_id: UNIT, course_id: CID, user_id: juniorC.uid, scheduled_on: kstYmd() };
  const { error: insErr } = await ownerC.from('quiz_assignments').insert(row);
  if (insErr) throw new Error(`발송 행: ${insErr.message}`);
  if (SEND_NOW_COL) {
    const { error } = await admin.from('quiz_assignments').update({ send_now: true }).eq('id', AID);
    if (error) throw new Error(`send_now: ${error.message}`);
    check('①-1 상세 = 5분 안에 가요', await D.waitFor(bodyHas(/5분 안에 가요/), LIVE_MS));
    check('①-2 목록 = 곧 발송 · 5분 안에 가요', await waitRow(L, /곧 발송[\s\S]*5분 안에 가요|5분 안에 가요[\s\S]*곧 발송/), (await rowText(L)) ?? '');
  } else {
    check('①-1 상세 = 예약 문구(M월 D일에 보내요)', await D.waitFor(bodyHas(/월 \d+일에 보내요/), LIVE_MS));
  }

  section('② 발송이 나간다(sent_at)');
  const { error: sentErr } = await admin.from('quiz_assignments').update({ sent_at: new Date().toISOString() }).eq('id', AID);
  if (sentErr) throw new Error(`sent_at: ${sentErr.message}`);
  check('②-1 상세 = 결과 칸(빈 상태가 사라진다)', await D.waitFor(`!${bodyHas(/5분 안에 가요|아직 아무에게도 안 보냈어요/)}&&${bodyHas(/완료/)}`, LIVE_MS));
  check('②-2 목록 = 완료 0/1명', await waitRow(L, /완료 0\/1명/), (await rowText(L)) ?? '');

  section('③ 직원이 다 푼다(completed_at)');
  const { error: doneErr } = await admin.from('quiz_assignments').update({ completed_at: new Date().toISOString() }).eq('id', AID);
  if (doneErr) throw new Error(`completed_at: ${doneErr.message}`);
  // 전원이 풀면 그 퀴즈는 '응시 중' 칸에서 '응시 완료' 칸으로 옮겨 간다(training.tsx 두 칸). 칸 전환은 화면 상태만
  // 바꾸고 다시 읽지 않으므로, 옮겨 간 뒤 칸을 눌러 보는 것도 새로고침 없는 갱신의 증거다.
  const rowGone = await L.waitFor(`(()=>![...document.querySelectorAll('[role="button"]')].some(e=>(e.innerText||'').includes(${J_(NAME)})&&e.getBoundingClientRect().width>0))()`, LIVE_MS);
  check('③-0 목록 = 응시 중 칸에서 빠진다(전원 완료)', rowGone);
  await L.eval(`(()=>{const t=[...document.querySelectorAll('[role="tab"],[role="button"]')].find(e=>/^\\s*응시 완료/.test(e.innerText||'')&&e.getBoundingClientRect().width>0);if(t)t.click();return !!t;})()`);
  check('③-1 목록(응시 완료 칸) = 완료 1/1명', await waitRow(L, /완료 1\/1명/), (await rowText(L)) ?? '');
  check('③-2 상세 링 = 1/1', await D.waitFor(bodyHas(/1\s*\/\s*1/), LIVE_MS));
  // 같은 순간 같은 값: 목록 "완료 1/1명" 과 상세 링 1/1 이 둘 다 발송 원장(completed_at) 기준이다(metrics.staffProgress).
  const lt = (await rowText(L)) ?? '', dt = await D.text();
  check('③-3 목록·상세 완료 수가 같다', /완료 1\/1명/.test(lt) && /1\s*\/\s*1/.test(dt));
  const errs = [...L.errors.splice(0), ...D.errors.splice(0)];
  check('③-4 콘솔 에러 0', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) {
  fail++;
  console.log('  ✗ 중단:', e.message);
} finally {
  for (const w of wins) await w.close().catch(() => {});
  await cleanup('끝').catch((e) => console.log('  ! 정리 실패', e.message));
  await restoreActive(ownerC, prevOwner);
}
console.log(`\nqa-quiz-live-refresh: ${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail} · SKIP ${skip} · AI 호출 0회`);
process.exit(fail === 0 ? 0 : 1);
