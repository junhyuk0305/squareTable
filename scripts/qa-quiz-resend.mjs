// 퀴즈 '다시 알리기' 서버 판정 QA(0348) — 실 백엔드 대상·자가정리 · LLM 호출 0회.
//
// 무엇을 증명하나(2026-11-03 사용자 결정):
//   (a) 다시 알리기 대기 행(origin manual · 안 나감)은 그 행이 생긴 뒤 같은 (퀴즈, 사람)이 완료하면 due_quiz_sends 후보가 아니다.
//   (b) 2/4 푼 상태에서 다시 알리기가 나가면 이어 풀기가 기본이다. 새 발송 진행 = 2/4 · 남은 2문항만 나오고 · 그걸로 완료된다.
//   (c) 같은 상황에서 quiz_assignment_restart 를 부르면 0/4 부터 다시 센다. 남의 발송·두 번째 호출은 false.
//   (d) 옛 앱 경로(새 RPC 안 부름 · 옛 서명 quiz_staff_record(p_rows))도 (b) 와 같다.
//   (e) 재확인(origin recheck)은 그대로다. 완료 뒤에도 후보로 남고 · 나가면 0 부터 센다.
//   + 직원은 count_from 을 직접 못 쓴다(RLS) · 이어 풀기 행만 count_from < sent_at 이다(버튼 조건의 서버 근거).
//   (f) quiz_resend → 다음 스윕 후보에 바로 든다 · claim 으로 sent_at · 이어 풀기 트리거를 탄다.
//   (g) 10분 안 두 번째 → resend_cooldown · 새 행·후보 0.  (h) 10분 뒤 → 다시 보낸다(오늘 이미 받았어도).
//   (i) 옛 앱 예약 행(사장 insert)은 완료 순간 지워진다 · 재확인 행·나간 행·응시 기록은 남는다.
//   (j) 여러 명 중 일부 쿨다운·일부 7일 상한 → 사람별 결과(sent · cooldown · queued) · 7일 상한 행은 후보가 아니다 · 직원은 forbidden.
//   (k) 그 퀴즈를 끝낸 사람의 join 행은 후보가 아니다.  (l) 재합류 join 발송은 앞 회차를 이어 푼다(실제 remove_staff → join_by_invite).
//   + 쿨다운 상수 서버 = 앱(schedule.ts) · 앱 상수가 없으면 skip 으로 찍는다.
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
let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOff = (n) => ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + n));
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const PEOPLE = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i', 'j1', 'j2', 'j3', 'k1', 'k2', 'l'];
// 010 + 두 자리 순번 + 6자리(실행마다 다름) = 11자리. 0번 = 사장.
const qaPhones = [0, ...PEOPLE.map((_, i) => i + 1)].map((n) => `010${String(n).padStart(2, '0')}${s.slice(0, 6)}`);
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

  // ── (f)~(j) 즉시 다시 알리기(quiz_resend) · 10분 쿨다운 · 완료 시 대기 행 삭제 ─────────
  // 배달은 크론 스윕과 같은 길이다: quiz_resend 가 행에 resend_at 을 찍고 스윕을 앞당긴다 → due_quiz_sends → claim_quiz_send → 푸시.
  // 여기서는 스윕 한 번을 due() + claim 으로 재현한다(엣지 배달 자체는 qa:quiz-schedule ⑦ 이 잰다).
  const resend = (users) => owner.rpc('quiz_resend', { p_course_id: QUIZ, p_user_ids: users.map((k) => P[k].id) });
  const resultOf = (data, k) => (data ?? []).find((r) => r.user_id === P[k].id)?.result;
  // 조회 오류를 빈 목록으로 삼키면 "지워졌다"가 거짓 통과한다(수정 전 RED 에서 실제로 그랬다). 오류는 던진다.
  const rowsOf = async (k) => {
    const { data, error } = await admin.from('quiz_assignments').select('id, sent_at, resend_at, origin, count_from, scheduled_on').eq('unit_id', UNIT).eq('user_id', P[k].id);
    if (error) throw new Error(`rowsOf(${k}): ${error.message}`);
    return data ?? [];
  };

  console.log('— (f) 다시 알리기 → 바로 나간다 —');
  let gResend = null;
  {
    const g1 = `qz_qr_g1_${s}`;
    await owner.from('quiz_assignments').insert(asg(g1, P.g.id, dayOff(-8)));
    await admin.from('quiz_assignments').update({ sent_at: daysAgo(8), opened_at: daysAgo(8) }).eq('id', g1);
    await answer('g', ITEMS.slice(0, 2), 'g-half');
    const { data, error } = await resend(['g']);
    check('(f) quiz_resend 결과 = sent', !error && resultOf(data, 'g') === 'sent', error?.message ?? JSON.stringify(data));
    const cand = (await due()).filter((x) => x.out_user_id === P.g.id);
    check('(f) 다음 스윕 후보에 바로 든다(알림 1건)', cand.length === 1, `후보 ${cand.length}건`);
    gResend = cand[0]?.out_assignment_id ?? null;
    if (gResend) await claim(gResend);
    const row = (await rowsOf('g')).find((r) => r.id === gResend);
    check('(f) sent_at 이 찍히고 이어 풀기 트리거를 탄다(count_from < sent_at)', !!row?.sent_at && !!row?.count_from && row.count_from < row.sent_at, JSON.stringify(row));
  }

  console.log('— (g) 10분 안 두 번째 → resend_cooldown —');
  {
    const before = (await rowsOf('g')).length;
    const { error } = await resend(['g']);
    check('(g) 한 사람이 쿨다운이면 resend_cooldown 으로 끝난다', /resend_cooldown/.test(error?.message ?? ''), error?.message ?? '막히지 않음');
    const cand = (await due()).filter((x) => x.out_user_id === P.g.id);
    check('(g) 새 행 0 · 후보 0', (await rowsOf('g')).length === before && cand.length === 0, `행 ${before}→${(await rowsOf('g')).length} · 후보 ${cand.length}`);
  }

  console.log('— (h) 10분 지난 뒤 → 다시 보낸다(하루 1회는 사장의 다시 알리기를 막지 않는다) —');
  {
    const back = new Date(Date.now() - 11 * 60_000).toISOString();
    if (gResend) await admin.from('quiz_assignments').update({ sent_at: back, resend_at: back }).eq('id', gResend);
    const { data, error } = await resend(['g']);
    check('(h) 10분 뒤에는 sent', !error && resultOf(data, 'g') === 'sent', error?.message ?? JSON.stringify(data));
    const cand = (await due()).filter((x) => x.out_user_id === P.g.id);
    check('(h) 오늘 이미 받았어도 후보에 든다', cand.length === 1, `후보 ${cand.length}건`);
  }

  console.log('— (i) 옛 앱 예약 행 → 완료 순간 삭제 · 재확인 행은 남는다 —');
  {
    const i1 = await firstSend('i');
    const old = `qz_qr_i2_${s}`, rc = `qz_qr_i3_${s}`;
    // 옛 앱 다시 알리기 = 사장 세션이 내일 날짜 행을 직접 넣는다(quiz/[id].tsx 옛 remind · insertQuizAssignments).
    const { error: oe } = await owner.from('quiz_assignments').insert(asg(old, P.i.id, dayOff(1)));
    check('(i) 옛 앱 경로 insert 는 그대로 된다', !oe, oe?.message ?? '');
    await admin.from('quiz_assignments').insert(asg(rc, P.i.id, dayOff(2), 'recheck'));
    await answer('i', ITEMS, 'i-all');
    const { data: done } = await P.i.c.rpc('mark_quiz_completed', { p_id: i1 });
    const ids = (await rowsOf('i')).map((r) => r.id);
    check('(i) 완료 true', done === true, `got=${done}`);
    check('(i) 안 나간 manual 행은 지워진다', !ids.includes(old), ids.join(','));
    check('(i) 재확인 행·나간 행은 남는다', ids.includes(rc) && ids.includes(i1), ids.join(','));
    const { count } = await admin.from('quiz_attempt_items').select('id', { count: 'exact', head: true }).eq('unit_id', UNIT).eq('staff_id', P.i.id);
    check('(i) 응시 기록은 그대로(4)', count === 4, `count=${count}`);
  }

  console.log('— (j) 여러 명 중 일부 쿨다운 · 일부 7일 상한 → 사람별 결과 —');
  {
    // j1 = 2분 전에 일반 발송을 받음(쿨다운 아님 · 기준은 다시 알리기뿐) · j2 = 2분 전에 다시 알리기를 받음(쿨다운)
    // j3 = 최근 7일에 2번 받음(7일 상한 → 줄에 선다)
    const put = async (id, k, on, sentAt, extra = {}) => {
      await owner.from('quiz_assignments').insert(asg(id, P[k].id, on));
      await admin.from('quiz_assignments').update({ sent_at: sentAt, opened_at: sentAt, ...extra }).eq('id', id);
    };
    const twoMin = new Date(Date.now() - 2 * 60_000).toISOString();
    await put(`qz_qr_j1_${s}`, 'j1', dayOff(0), twoMin);
    await put(`qz_qr_j2_${s}`, 'j2', dayOff(0), twoMin, { resend_at: twoMin });
    await put(`qz_qr_j3a_${s}`, 'j3', dayOff(-3), daysAgo(3));
    await put(`qz_qr_j3b_${s}`, 'j3', dayOff(-4), daysAgo(4));
    const { data, error } = await resend(['j1', 'j2', 'j3']);
    check('(j) 일부가 막혀도 오류로 끝나지 않는다', !error, error?.message ?? '');
    check('(j) j1 sent · j2 cooldown · j3 queued', resultOf(data, 'j1') === 'sent' && resultOf(data, 'j2') === 'cooldown' && resultOf(data, 'j3') === 'queued', JSON.stringify(data));
    const cand = await due();
    check('(j) 후보 = j1 만(j3 는 7일 상한이 풀릴 때 나간다)', cand.some((x) => x.out_user_id === P.j1.id) && !cand.some((x) => x.out_user_id === P.j3.id || x.out_user_id === P.j2.id), cand.map((x) => x.out_user_id).join(','));
    const { error: se } = await P.j1.c.rpc('quiz_resend', { p_course_id: QUIZ, p_user_ids: [P.j1.id] });
    check('(j) 직원은 다시 알리기를 못 부른다(forbidden)', /forbidden/.test(se?.message ?? ''), se?.message ?? '거부 안 됨');
  }

  // ── (k)(l) 입사(join) 행 · 오류 탐지 11-03 10번 ──────────────────────────
  console.log('— (k) 이 퀴즈를 이미 끝낸 사람에게 join 행은 안 나간다 —');
  {
    // k1 = join 대기 행이 먼저 있고 다른 발송으로 끝냄 · k2 = 끝낸 뒤 join 행이 생김(재합류와 같은 모양)
    const k1 = await firstSend('k1');
    await admin.from('quiz_assignments').insert(asg(`qz_qr_k1j_${s}`, P.k1.id, dayOff(0), 'join'));
    await answer('k1', ITEMS, 'k1-all');
    const { data: d1 } = await P.k1.c.rpc('mark_quiz_completed', { p_id: k1 });
    const k2 = await firstSend('k2');
    await answer('k2', ITEMS, 'k2-all');
    const { data: d2 } = await P.k2.c.rpc('mark_quiz_completed', { p_id: k2 });
    await admin.from('quiz_assignments').insert(asg(`qz_qr_k2j_${s}`, P.k2.id, dayOff(0), 'join'));
    check('(k) 셋업: 둘 다 완료 true', d1 === true && d2 === true, `${d1}/${d2}`);
    const cand = (await due()).filter((x) => x.out_user_id === P.k1.id || x.out_user_id === P.k2.id);
    check('(k) 완료자의 join 행은 후보가 아니다(완료 전·후에 생긴 것 모두)', cand.length === 0, cand.map((x) => x.out_assignment_id).join(','));
    const ids = [...(await rowsOf('k1')), ...(await rowsOf('k2'))].map((r) => r.id);
    check('(k) join 행은 지우지 않는다(완료 시 삭제는 manual 만)', ids.includes(`qz_qr_k1j_${s}`) && ids.includes(`qz_qr_k2j_${s}`), ids.join(','));
  }

  console.log('— (l) 재합류 join 발송은 앞 회차를 이어 푼다 —');
  {
    await firstSend('l');
    await answer('l', ITEMS.slice(0, 2), 'l-half');
    const { error: re } = await owner.rpc('remove_staff', { p_staff_id: P.l.id });
    if (re) throw new Error('remove_staff: ' + re.message);
    await joinAsStaff(P.l.c, CODE);
    await P.l.c.rpc('switch_active_unit', { p_unit_id: UNIT });
    const join = (await rowsOf('l')).find((r) => r.origin === 'join' && !r.sent_at);
    check('(l) 셋업: 재합류가 이 퀴즈의 join 행을 만들었다(실제 _admit_member 경로)', !!join, JSON.stringify(await rowsOf('l')));
    if (join) {
      await claim(join.id);
      const p = await progressOf(P.l.c, join.id);
      check('(l) 재합류 발송 진행 = 2/4(이어 풀기)', p?.answered_items === 2 && p?.total_items === 4, show(p));
    }
  }

  // ── 쓰기 경계 ─────────────────────────────────────────────────────────
  console.log('— 쓰기 경계 —');
  {
    const { data: up, error: upErr } = await P.b.c.from('quiz_assignments').update({ count_from: new Date().toISOString() }).eq('unit_id', UNIT).select();
    check('직원은 count_from 을 직접 못 쓴다(RLS 0행 · 열은 있다)', !upErr && (up ?? []).length === 0, upErr?.message ?? `updated=${up?.length}`);
    const anon = mk();
    const { error: ae } = await anon.rpc('quiz_assignment_restart', { p_assignment_id: 'x' });
    check('anon 은 다시 풀기를 못 부른다(권한 42501)', ae?.code === '42501', ae?.code ?? '거부 안 됨');
    const { error: ae2 } = await anon.rpc('quiz_resend', { p_course_id: QUIZ, p_user_ids: [P.a.id] });
    check('anon 은 다시 알리기를 못 부른다(권한 42501)', ae2?.code === '42501', ae2?.code ?? '거부 안 됨');
  }

  // ── 쿨다운 상수: 서버 quiz_resend_cooldown() = 앱 schedule.ts RESEND_COOLDOWN_MINUTES(화면 문구) ──
  {
    const { data: iv, error: ie } = await admin.rpc('quiz_resend_cooldown');
    const serverMin = /^(\d+):(\d+):(\d+)$/.test(iv ?? '') ? (() => { const [h, m] = iv.split(':').map(Number); return h * 60 + m; })() : NaN;
    let clientMin = NaN;
    try { clientMin = Number(readFileSync(here('../src/lib/quiz/schedule.ts'), 'utf8').match(/export const RESEND_COOLDOWN_MINUTES\s*=\s*(\d+)/)?.[1]); } catch { /* 없음 */ }
    if (!Number.isFinite(clientMin)) { skip++; console.log('  - skip 쿨다운 상수 대조(schedule.ts 에 RESEND_COOLDOWN_MINUTES 없음 · 앱 브랜치 머지 전)', `서버 ${serverMin}분`); }
    else check('쿨다운 상수 서버 = 앱', !ie && serverMin === clientMin, ie?.message ?? `서버 ${serverMin} · 앱 ${clientMin}`);
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
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} / fail ${fail}${skip ? ` · skip ${skip} (앱 상수 없음 · 통과로 안 셈)` : ''} · LLM 호출 0회`);
process.exitCode = fail === 0 ? 0 : 1;
