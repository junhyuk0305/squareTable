// 퀴즈 '다시 알리기' 서버 판정 QA(0348) — 실 백엔드 대상·자가정리 · LLM 호출 0회.
//
// 무엇을 증명하나(2026-11-03 사용자 결정):
//   (a) 다시 알리기 대기 행(origin manual · 안 나감)은 그 행이 생긴 뒤 같은 (퀴즈, 사람)이 완료하면 due_quiz_sends 후보가 아니다.
//   (b) 2/4 푼 상태에서 다시 알리기가 나가면 이어 풀기가 기본이다. 새 발송 진행 = 2/4 · 남은 2문항만 나오고 · 그걸로 완료된다.
//   (c) 같은 상황에서 quiz_assignment_restart 를 부르면 0/4 부터 다시 센다. 남의 발송·두 번째 호출은 false.
//   (d) 옛 앱 경로(새 RPC 안 부름 · 옛 서명 quiz_staff_record(p_rows))도 (b) 와 같다.
//   (e) 재확인(origin recheck)은 그대로다. 완료 뒤에도 후보로 남고 · 나가면 0 부터 센다.
//   + 직원은 count_from 을 직접 못 쓴다(RLS) · 이어 풀기 행만 count_from < sent_at 이다(버튼 조건의 서버 근거).
//
// 사용: node scripts/qa-quiz-resend.mjs --local   (로컬 도커 · `npx supabase status` 키)
//       node scripts/qa-quiz-resend.mjs --allow-remote   (.env + .env.seed · 라이브는 0348 적용 뒤)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { guardResolvedUrls } from './lib/local-target-guard.mjs';
import { joinAsStaff } from './lib/qa-staff.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const LOCAL = process.argv.includes('--local');
let URL_, ANON, SRV;
if (LOCAL) {
  const st = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  URL_ = st.API_URL; ANON = st.ANON_KEY; SRV = st.SERVICE_ROLE_KEY;
  if (!URL_ || !/^http:\/\/127\.0\.0\.1:/.test(URL_)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL_); process.exit(2); }
} else {
  const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
  URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  SRV = env.SUPABASE_SERVICE_ROLE_KEY;
  guardResolvedUrls([URL_]);
}
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed 또는 --local)'); process.exit(2); }
console.log(`— 대상 ${LOCAL ? '로컬' : '원격(.env)'} ${URL_} —`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOff = (n) => ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + n));
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const PEOPLE = ['a', 'b', 'c', 'd', 'e', 'f'];
const qaPhones = [`0100${s.slice(0, 7)}`, ...PEOPLE.map((_, i) => `010${i + 1}${s.slice(0, 7)}`)];
let UNIT = null;
const made = { users: [], entries: [] };

// 실세션: 계정은 service_role 로 만들고, 세션은 매직링크(generateLink → verifyOtp)로 받는다(AGENTS ⑥).
async function session(email, meta) {
  const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { birth_date: '1994-03-03', ...meta } });
  if (ce) throw new Error(`createUser(${email}): ${ce.message}`);
  made.users.push(cu.user.id);
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (le) throw new Error(`generateLink(${email}): ${le.message}`);
  const c = mk();
  const { error: ve } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (ve) throw new Error(`verifyOtp(${email}): ${ve.message}`);
  return { c, id: cu.user.id };
}

const due = async () => {
  const { data, error } = await admin.rpc('due_quiz_sends');
  if (error) throw new Error('due_quiz_sends: ' + error.message);
  return (data ?? []).filter((r) => r.out_unit_id === UNIT);
};
const progressOf = async (c, aid) => {
  const { data, error } = await c.rpc('quiz_assignment_progress');
  if (error) throw new Error('quiz_assignment_progress: ' + error.message);
  return (data ?? []).find((r) => r.assignment_id === aid);
};
const show = (p) => (p ? `${p.answered_items}/${p.total_items} ${p.state}` : '행 없음');

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const { c: owner, id: ownerId } = await session(`qa_qr_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0], store_name: 'QR', industry: '카페·디저트' });
  const { data: c1, error: cse } = await owner.rpc('create_store', { p_store_name: 'QR 다시알리기', p_industry: '카페·디저트', p_biz_no: null });
  if (cse) throw new Error('create_store: ' + cse.message);
  UNIT = c1?.[0]?.unit_id;
  const CODE = c1?.[0]?.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });

  const P = {};
  for (const [i, k] of PEOPLE.entries()) {
    P[k] = await session(`qa_qr_${k}_${s}@example.com`, { name: `QA직원${k}`, role: 'junior', phone: qaPhones[i + 1] });
    await joinAsStaff(P[k].c, CODE);
    await P[k].c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  check('셋업: 매장 + 직원 6명 합류', !!UNIT, `unit=${UNIT}`);

  // 퀴즈 1개 · 문항 4개(노하우 4개). 합류 뒤에 만들어 입사 트리거가 배정하지 않게 한다.
  const QUIZ = `tc_qr_${s}`;
  const { error: tcErr } = await owner.from('training_courses').insert({
    id: QUIZ, unit_id: UNIT, key: `qr_${s}`, name: 'QR 다시 알리기', min_items: 1, max_items: 5, due_days: null, position: 0, active: true,
  });
  if (tcErr) throw new Error('training_courses: ' + tcErr.message);
  const ITEMS = [];
  for (let i = 0; i < 4; i++) {
    const eid = `pb_qr_${i}_${s}`, qid = `qi_qr_${i}_${s}`;
    made.entries.push(eid);
    for (const q of [
      admin.from('playbook_entries').insert({ id: eid, unit_id: UNIT, category: 'Routine', title: `QR 근거 ${i}`, status: 'published', updated_at: daysAgo(5) }),
      admin.from('course_entries').insert({ course_id: QUIZ, entry_id: eid, unit_id: UNIT, position: i }),
      admin.from('quiz_items').insert({ id: qid, unit_id: UNIT, course_id: QUIZ, entry_ids: [eid], kind: 't0', format: 'mc4', status: 'active',
        payload: { ask: `QR 문항 ${i}`, choices: ['가', '나'], answer_index: 1, explain: 'QA' } }),
    ]) { const { error } = await q; if (error) throw new Error(`문항 셋업 ${i}: ${error.message}`); }
    ITEMS.push(qid);
  }

  const asg = (id, uid, on, origin = 'manual') => ({ id, unit_id: UNIT, course_id: QUIZ, user_id: uid, scheduled_on: on, origin });
  // 첫 발송 = 이틀 전에 나감(열어 둠 · 자동 정지와 섞이지 않게). 사장 세션이 만들고, 나간 시각은 service_role 이 찍는다.
  const firstSend = async (k) => {
    const id = `qz_qr_${k}1_${s}`;
    const { error } = await owner.from('quiz_assignments').insert(asg(id, P[k].id, dayOff(-2)));
    if (error) throw new Error(`첫 발송 ${k}: ${error.message}`);
    const { error: ue } = await admin.from('quiz_assignments').update({ sent_at: daysAgo(2), opened_at: daysAgo(2) }).eq('id', id);
    if (ue) throw new Error(`첫 발송 sent_at ${k}: ${ue.message}`);
    return id;
  };
  const answer = async (k, itemIds, tag, legacy = false) => {
    const rows = itemIds.map((id, i) => ({ item_id: id, response: 1, ord: i }));
    const { error } = legacy
      ? await P[k].c.rpc('quiz_staff_record', { p_rows: rows })
      : await P[k].c.rpc('quiz_staff_record_v2', { p_rows: rows, p_course_id: QUIZ, p_request_id: `qr_${tag}_${s}` });
    if (error) throw new Error(`답 ${k}/${tag}: ${error.message}`);
  };
  // 다시 알리기 = 사장이 새 발송 행을 넣는다(quiz/[id].tsx remind) → 크론이 claim_quiz_send 로 낸다.
  const remind = async (k, origin = 'manual') => {
    const id = `qz_qr_${k}2_${s}`;
    const ins = origin === 'manual' ? owner.from('quiz_assignments').insert(asg(id, P[k].id, dayOff(0)))
      : admin.from('quiz_assignments').insert(asg(id, P[k].id, dayOff(0), origin));
    const { error } = await ins;
    if (error) throw new Error(`다시 알리기 ${k}: ${error.message}`);
    return id;
  };
  const claim = async (id) => {
    const { data, error } = await admin.rpc('claim_quiz_send', { p_id: id });
    if (error || data !== true) throw new Error(`claim ${id}: ${error?.message ?? data}`);
  };
  const countFrom = async (id) => {
    const { data, error } = await admin.from('quiz_assignments').select('sent_at, count_from').eq('id', id).maybeSingle();
    return error ? { error: error.message } : data;
  };

  // ── (a) 다시 알리기 대기 → 그 뒤 완료 → 안 보냄 ───────────────────────────
  console.log('— (a) 다시 알리기 대기 행이 생긴 뒤 완료하면 보내지 않는다 —');
  {
    const a1 = await firstSend('a');
    const r = await remind('a');
    await answer('a', ITEMS, 'a-all');
    const { data: done } = await P.a.c.rpc('mark_quiz_completed', { p_id: a1 });
    check('(a) 셋업: 첫 발송으로 다 풀고 완료 true', done === true, `got=${done}`);
    const cand = (await due()).filter((x) => x.out_assignment_id === r);
    check('(a) 완료자에게 다시 알리기 행이 후보가 아니다', cand.length === 0, `후보 ${cand.length}건`);
  }

  // ── (b) 2/4 → 다시 알리기 → 이어 풀기 기본 ─────────────────────────────
  console.log('— (b) 푸는 중 다시 알리기 = 이어 풀기 —');
  {
    await firstSend('b');
    await answer('b', ITEMS.slice(0, 2), 'b-half');
    const r = await remind('b');
    await claim(r);
    const p = await progressOf(P.b.c, r);
    check('(b) 새 발송 진행 = 2/4 todo', p?.answered_items === 2 && p?.total_items === 4 && p?.state === 'todo', show(p));
    const cf = await countFrom(r);
    check('(b) 이어 풀기 행은 count_from < sent_at(버튼 조건)', !!cf?.count_from && cf.count_from < cf.sent_at, JSON.stringify(cf));
    const { data: items } = await P.b.c.rpc('quiz_assignment_items', { p_assignment_id: r, p_limit: 20 });
    const ids = (items ?? []).map((x) => x.id).sort();
    check('(b) 남은 2문항만 나온다', ids.length === 2 && ids.every((id) => ITEMS.slice(2).includes(id)), ids.join(','));
    await answer('b', ITEMS.slice(2), 'b-rest');
    const { data: done } = await P.b.c.rpc('mark_quiz_completed', { p_id: r });
    check('(b) 남은 2문항으로 완료 true', done === true, `got=${done}`);
  }

  // ── (c) 같은 상황에서 처음부터 다시 풀기 ─────────────────────────────────
  console.log('— (c) 처음부터 다시 풀기 —');
  {
    await firstSend('c');
    await answer('c', ITEMS.slice(0, 2), 'c-half');
    const r = await remind('c');
    await claim(r);
    const { data: other, error: oe } = await P.b.c.rpc('quiz_assignment_restart', { p_assignment_id: r });
    check('(c) 남의 발송은 다시 풀기 false', !oe && other === false, oe?.message ?? `got=${other}`);
    const { data: ok, error: re } = await P.c.c.rpc('quiz_assignment_restart', { p_assignment_id: r });
    check('(c) 본인 다시 풀기 true', !re && ok === true, re?.message ?? `got=${ok}`);
    const p = await progressOf(P.c.c, r);
    check('(c) 진행 = 0/4 todo', p?.answered_items === 0 && p?.total_items === 4 && p?.state === 'todo', show(p));
    const cf = await countFrom(r);
    check('(c) 다시 푼 행은 count_from >= sent_at(버튼 사라짐)', !!cf?.count_from && cf.count_from >= cf.sent_at, JSON.stringify(cf));
    const { data: again } = await P.c.c.rpc('quiz_assignment_restart', { p_assignment_id: r });
    check('(c) 두 번째 호출은 false(이미 처음부터)', again === false, `got=${again}`);
    const { error: bad } = await P.c.c.rpc('quiz_assignment_restart', { p_assignment_id: null });
    check('(c) 빈 인자는 invalid_argument', /invalid_argument/.test(bad?.message ?? ''), bad?.message ?? '거부 안 됨');
    await answer('c', ITEMS.slice(0, 2), 'c-redo');
    const { data: early } = await P.c.c.rpc('mark_quiz_completed', { p_id: r });
    check('(c) 다시 푼 2문항으로는 완료 false', early === false, `got=${early}`);
    await answer('c', ITEMS.slice(2), 'c-rest');
    const { data: done } = await P.c.c.rpc('mark_quiz_completed', { p_id: r });
    check('(c) 4문항을 다 풀면 완료 true', done === true, `got=${done}`);
  }

  // ── (d) 옛 앱 경로 = (b) ───────────────────────────────────────────────
  console.log('— (d) 옛 앱(새 RPC 안 부름 · 옛 서명 제출) —');
  {
    await firstSend('d');
    await answer('d', ITEMS.slice(0, 2), 'd-half', true);
    const r = await remind('d');
    await claim(r);
    const p = await progressOf(P.d.c, r);
    check('(d) 새 발송 진행 = 2/4 todo', p?.answered_items === 2 && p?.total_items === 4 && p?.state === 'todo', show(p));
    await answer('d', ITEMS.slice(2), 'd-rest', true);
    const { data: done } = await P.d.c.rpc('mark_quiz_completed', { p_id: r });
    check('(d) 남은 2문항으로 완료 true', done === true, `got=${done}`);
  }

  // ── (e) 재확인은 그대로 ───────────────────────────────────────────────
  console.log('— (e) 재확인(origin recheck)은 그대로 —');
  {
    const e1 = await firstSend('e');
    const r = await remind('e', 'recheck');
    await answer('e', ITEMS, 'e-all');
    const { data: done } = await P.e.c.rpc('mark_quiz_completed', { p_id: e1 });
    check('(e) 셋업: 완료 true', done === true, `got=${done}`);
    const cand = (await due()).filter((x) => x.out_assignment_id === r);
    check('(e) 완료 뒤에도 재확인 행은 후보다', cand.length === 1, `후보 ${cand.length}건`);

    await firstSend('f');
    await answer('f', ITEMS.slice(0, 2), 'f-half');
    const rf = await remind('f', 'recheck');
    await claim(rf);
    const p = await progressOf(P.f.c, rf);
    check('(e) 푸는 중 재확인이 나가면 0/4 부터(노하우가 바뀌어 다시 푼다)', p?.answered_items === 0 && p?.total_items === 4, show(p));
    const cf = await countFrom(rf);
    check('(e) 재확인 행은 이어 풀기가 아니다(count_from 없음)', !cf?.error && !cf?.count_from, JSON.stringify(cf));
  }

  // ── 쓰기 경계 ─────────────────────────────────────────────────────────
  console.log('— 쓰기 경계 —');
  {
    const { data: up, error: upErr } = await P.b.c.from('quiz_assignments').update({ count_from: new Date().toISOString() }).eq('unit_id', UNIT).select();
    check('직원은 count_from 을 직접 못 쓴다(RLS 0행 · 열은 있다)', !upErr && (up ?? []).length === 0, upErr?.message ?? `updated=${up?.length}`);
    const anon = mk();
    const { error: ae } = await anon.rpc('quiz_assignment_restart', { p_assignment_id: 'x' });
    check('anon 은 다시 풀기를 못 부른다(권한 42501)', ae?.code === '42501', ae?.code ?? '거부 안 됨');
  }
  void ownerId;
}

async function cleanup() {
  if (UNIT) {
    for (const t of ['quiz_attempt_items', 'quiz_attempts', 'quiz_assignments', 'quiz_items', 'knowhow_understanding', 'course_entries', 'training_courses']) {
      await admin.from(t).delete().eq('unit_id', UNIT);
    }
  }
  for (const id of made.entries) await admin.from('playbook_entries').delete().eq('id', id);
  if (UNIT) { const r = await admin.from('units').delete().eq('id', UNIT); if (r.error) console.error('  ! 정리 units:', r.error.message); }
  for (const id of made.users) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('  ! 정리 user:', r.error.message); }
  console.log(`  · 정리: 매장 ${UNIT ? 1 : 0} · 계정 ${made.users.length}`);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('  ✗ 예외:', e?.message ?? e);
} finally {
  await cleanup().catch((e) => console.error('  ! 정리 실패:', e?.message ?? e));
  await cleanupSeededPhones(URL_, SRV, qaPhones).catch(() => {});
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} / fail ${fail} · LLM 호출 0회`);
process.exitCode = fail === 0 ? 0 : 1;
