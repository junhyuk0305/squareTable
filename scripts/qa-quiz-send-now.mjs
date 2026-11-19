// 퀴즈 "지금 바로" 서버 판정 QA(0870 · B1 · 2026-11-19 사용자 결정) — 실 백엔드 대상·자가정리 · 엣지 호출 0회 · LLM 호출 0회.
//
// 무엇을 증명하나:
//   (a) ★0871(2026-11-19 사용자 결정 · 근무 시간 · 하루 1회 · 주 2회를 지웠다): 근무 밖 직원 · 오늘 근무 없는 직원 ·
//       오늘 이미 받은 직원 · 이번 주 2번 받은 직원의 오늘 행도 보낼 시각(send_at)이 지났으면 표시 없이 후보다.
//   (b) quiz_send_now 를 불러도 같은 행이 후보 1건 그대로다.
//   (c) 그 퀴즈를 다 푼 직원 · 나간 직원은 표시가 있어도 후보가 아니다.
//   (d) 미래 날짜 예약 행에는 표시를 세우지 않는다. ★0871: 오늘 안의 나중 시각(send_at > now) 행에도 세우지 않는다.
//   (e) 두 번 불러도 행 수가 같고 사람마다 후보 1건이다. 선점(claim) 뒤 다시 불러도 다시 나가지 않는다.
//   (f) 권한: 직원 세션 forbidden · anon 42501 · 남의 매장 퀴즈 quiz_not_found · 빈 인자 invalid_argument · 문항 0개 quiz_no_items.
// 엣지(push)는 부르지 않는다. 스윕이 고르는 것(due_quiz_sends)과 선점(claim_quiz_send)을 service_role 로 직접 잰다.
//
// 사용: node scripts/qa-quiz-send-now.mjs --local   (로컬 도커 · `npx supabase status` 키)
//       node scripts/qa-quiz-send-now.mjs --allow-remote   (.env + .env.seed · 라이브는 0870 적용 뒤)
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
  const st = Object.fromEntries(execFileSync('npx', ['-y', 'supabase@2.122.1', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
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
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const DOW = kst.getDay();
const minsNow = kst.getHours() * 60 + kst.getMinutes();
const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
const ON = [hhmm(minsNow - 10), hhmm(minsNow + 10)];   // 지금을 감싸는 근무
const OFF = [hhmm(minsNow + 60), hhmm(minsNow + 90)];  // 지금이 아닌 근무

// w = 근무 밖 · x = 오늘 근무 없음 · d = 오늘 이미 받음 · k = 이번 주 2번 받음 · done = 다 풂 · gone = 나감 · f = 미래 예약
// h = 오늘 나중 시각 예약(send_at 1시간 뒤 · 0871)
const PEOPLE = ['w', 'x', 'd', 'k', 'done', 'gone', 'f', 'h'];
// 0108 + 한 자리 순번 + 6자리(실행마다 다름) = 11자리. 0 = 사장 · 9 = 다른 매장 사장.
const qaPhones = [0, ...PEOPLE.map((_, i) => i + 1), 9].map((n) => `0108${n}${s.slice(0, 6)}`);
const units = [];
const made = { users: [], entries: [] };

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
async function store(owner, name) {
  const { data, error } = await owner.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
  if (error) throw new Error('create_store: ' + error.message);
  const unit = data?.[0]?.unit_id;
  units.push(unit);
  await admin.rpc('admin_activate_store', { p_unit_id: unit, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: unit });
  return { unit, code: data?.[0]?.invite_code };
}
async function course(owner, unit, id, nItems) {
  const { error } = await owner.from('training_courses').insert({
    id, unit_id: unit, key: id, name: `QA 지금 바로 ${id}`, min_items: 1, max_items: 5, due_days: null, position: 0, active: true,
  });
  if (error) throw new Error('training_courses: ' + error.message);
  for (let i = 0; i < nItems; i++) {
    const eid = `pb_${id}_${i}`;
    made.entries.push(eid);
    for (const q of [
      admin.from('playbook_entries').insert({ id: eid, unit_id: unit, category: 'Routine', title: `근거 ${i}`, status: 'published' }),
      admin.from('course_entries').insert({ course_id: id, entry_id: eid, unit_id: unit, position: i }),
      admin.from('quiz_items').insert({ id: `qi_${id}_${i}`, unit_id: unit, course_id: id, entry_ids: [eid], kind: 't0', format: 'mc4', status: 'active',
        payload: { ask: `문항 ${i}`, choices: ['가', '나'], answer_index: 1, explain: 'QA' } }),
    ]) { const { error: e } = await q; if (e) throw new Error(`문항 셋업 ${id}/${i}: ${e.message}`); }
  }
}

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const { c: owner } = await session(`qa_sn_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0], store_name: 'SN', industry: '카페·디저트' });
  const { unit: UNIT, code: CODE } = await store(owner, 'SN 지금 바로');
  const P = {};
  for (const [i, k] of PEOPLE.entries()) {
    P[k] = await session(`qa_sn_${k}_${s}@example.com`, { name: `QA직원${k}`, role: 'junior', phone: qaPhones[i + 1] });
    await joinAsStaff(P[k].c, CODE);
    await P[k].c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  await admin.from('unit_members').update({ created_at: ago(24 * 30) }).eq('unit_id', UNIT).neq('role', 'owner');
  check(`셋업: 매장 + 직원 ${PEOPLE.length}명`, !!UNIT, `unit=${UNIT}`);

  // 퀴즈 A(지금 바로 대상) · B(지난 발송 기록용) · Z(문항 0개). 합류 뒤에 만든다(입사 배정 없음).
  const QA_ = `tc_sna_${s}`, QB = `tc_snb_${s}`, QZ = `tc_snz_${s}`;
  await course(owner, UNIT, QA_, 2);
  await course(owner, UNIT, QB, 1);
  await course(owner, UNIT, QZ, 0);

  // 근무표를 쓰는 매장으로 만든다. w = 지금이 아닌 근무 · x = 오늘 근무 없음 · 나머지 = 지금 근무.
  const shifts = PEOPLE.filter((k) => k !== 'x').map((k) => ({
    id: `sh_sn_${k}_${s}`, unit_id: UNIT, staff_id: P[k].id, weekday: DOW,
    start_time: (k === 'w' ? OFF : ON)[0], end_time: (k === 'w' ? OFF : ON)[1],
  }));
  { const { error } = await admin.from('shift_templates').insert(shifts); if (error) throw new Error('shift insert: ' + error.message); }

  // 지난 발송(열어 둠 · 자동 정지와 섞이지 않게). d = 오늘 1건 · k = 이번 주 2건 · done = A 를 받아 다 풂.
  const sent = [
    { id: `qz_sn_d0_${s}`, course_id: QB, user_id: P.d.id, scheduled_on: dayOff(0), sent_at: ago(1), opened_at: ago(1) },
    { id: `qz_sn_k0_${s}`, course_id: QB, user_id: P.k.id, scheduled_on: dayOff(-2), sent_at: ago(48), opened_at: ago(48) },
    { id: `qz_sn_k1_${s}`, course_id: QB, user_id: P.k.id, scheduled_on: dayOff(-3), sent_at: ago(72), opened_at: ago(72) },
    { id: `qz_sn_dn_${s}`, course_id: QA_, user_id: P.done.id, scheduled_on: dayOff(-2), sent_at: ago(48), opened_at: ago(48), completed_at: ago(47) },
  ].map((r) => ({ unit_id: UNIT, origin: 'manual', ...r }));
  { const { error } = await admin.from('quiz_assignments').insert(sent); if (error) throw new Error('지난 발송 시드: ' + error.message); }

  // 사장이 오늘치 A 행을 넣는다(앱이 하는 것과 같다 · 표시 없음). f 는 내일 예약.
  // ★0871: 보낼 시각 = w·x·d·k 는 1분 전(지금 시각과 상관없이 잰다) · h 는 1시간 뒤 · 나머지는 없음(예약일 09:00 KST).
  const rowId = (k) => `qz_sn_${k}_${s}`;
  const sendAt = (k) => (['w', 'x', 'd', 'k'].includes(k) ? new Date(Date.now() - 60e3).toISOString() : k === 'h' ? new Date(Date.now() + 3600e3).toISOString() : null);
  const rows = PEOPLE.map((k) => ({ id: rowId(k), unit_id: UNIT, course_id: QA_, user_id: P[k].id, scheduled_on: k === 'f' ? dayOff(1) : dayOff(0), origin: 'manual', send_at: sendAt(k) }));
  { const { error } = await owner.from('quiz_assignments').insert(rows); if (error) throw new Error('A 행 insert: ' + error.message); }
  // 같은 퀴즈의 재확인 대기 행(어제치 · 근무 밖 직원 w). 지금 바로는 사장이 보낸 행만 건드린다(2026-11-19 · 검토 지적).
  const RECHECK = `qz_sn_rc_${s}`;
  { const { error } = await admin.from('quiz_assignments').insert({ id: RECHECK, unit_id: UNIT, course_id: QA_, user_id: P.w.id, scheduled_on: dayOff(-1), origin: 'recheck' }); if (error) throw new Error('재확인 행 시드: ' + error.message); }
  // gone 은 나간다(멤버십만 지운다 · 행은 남는다).
  await admin.from('unit_members').delete().eq('unit_id', UNIT).eq('user_id', P.gone.id);

  const due = async () => {
    const { data, error } = await admin.rpc('due_quiz_sends');
    if (error) throw new Error('due_quiz_sends: ' + error.message);
    return (data ?? []).filter((r) => r.out_unit_id === UNIT);
  };
  const picked = (list, k) => list.filter((r) => r.out_user_id === P[k].id).map((r) => r.out_assignment_id);
  const BYPASS = { w: '근무 밖', x: '오늘 근무 없음', d: '오늘 이미 받음', k: '이번 주 2번 받음' };

  console.log('— (a) ★0871: 표시 없는 오늘 행도 보낼 시각이 지났으면 후보다(근무·하루·주 규칙 없음) —');
  {
    const list = await due();
    for (const [k, why] of Object.entries(BYPASS)) {
      const ids = picked(list, k);
      check(`(a) ${why} · 예약 행도 후보다`, ids.length === 1 && ids[0] === rowId(k), JSON.stringify(ids));
    }
  }

  console.log('— (b) quiz_send_now 뒤에도 후보 그대로 —');
  const send = (c, id) => c.rpc('quiz_send_now', { p_course_id: id });
  const r1 = await send(owner, QA_);
  check('(b) 사장 호출 성공 · 반환 = 오늘 이하 미발송 행 6', !r1.error && r1.data === 6, r1.error?.message ?? `got=${r1.data}`);
  {
    const list = await due();
    for (const [k, why] of Object.entries(BYPASS)) {
      const ids = picked(list, k);
      check(`(b) ${why} · 지금 바로 행은 후보다`, ids.length === 1 && ids[0] === rowId(k), JSON.stringify(ids));
    }
    console.log('— (c) 다 푼 직원 · 나간 직원은 그대로 빠진다 —');
    check('(c) 다 푼 직원은 표시가 있어도 후보가 아니다', picked(list, 'done').length === 0, `후보 ${picked(list, 'done').length}`);
    check('(c) 나간 직원은 표시가 있어도 후보가 아니다', picked(list, 'gone').length === 0, `후보 ${picked(list, 'gone').length}`);
    const { data: rc } = await admin.from('quiz_assignments').select('send_now').eq('id', RECHECK).maybeSingle();
    check('(c) 재확인 대기 행은 표시가 안 선다(지금 규칙 그대로)', rc?.send_now === false, JSON.stringify(rc));
    // ★0871: 재확인 기능을 없앴다. 재확인 행은 근무와 상관없이 나가지 않는다.
    check('(c) 재확인 대기 행은 후보가 아니다(0871 재확인 없앰)', !list.some((r) => r.out_assignment_id === RECHECK));
  }

  console.log('— (d) 미래 예약 행에는 표시를 세우지 않는다 —');
  {
    const { data, error } = await admin.from('quiz_assignments').select('send_now').eq('id', rowId('f')).maybeSingle();
    check('(d) 내일 예약 행 send_now = false', !error && data?.send_now === false, error?.message ?? JSON.stringify(data));
    const list = await due();
    check('(d) 내일 예약 행은 후보가 아니다', picked(list, 'f').length === 0);
    // ★0871: 오늘 안의 나중 시각 예약은 지금 바로가 앞당기지 않는다.
    const { data: hRow, error: hErr } = await admin.from('quiz_assignments').select('send_now').eq('id', rowId('h')).maybeSingle();
    check('(d) 1시간 뒤 시각 예약 행 send_now = false(0871)', !hErr && hRow?.send_now === false, hErr?.message ?? JSON.stringify(hRow));
    check('(d) 1시간 뒤 시각 예약 행은 후보가 아니다(0871)', picked(list, 'h').length === 0);
  }

  console.log('— (e) 두 번 불러도 한 번만 간다 —');
  {
    const cnt = async () => (await admin.from('quiz_assignments').select('id', { count: 'exact', head: true }).eq('unit_id', UNIT).eq('course_id', QA_)).count;
    const before = await cnt();
    const r2 = await send(owner, QA_);
    check('(e) 두 번째 호출 반환 = 6(새 행 없음)', !r2.error && r2.data === 6, r2.error?.message ?? `got=${r2.data}`);
    check('(e) A 행 수가 그대로다', (await cnt()) === before, `전 ${before} · 후 ${await cnt()}`);
    const list = await due();
    const per = Object.keys(BYPASS).map((k) => picked(list, k).length);
    check('(e) 사람마다 후보 1건', per.every((n) => n === 1), per.join(','));
    let claimed = 0;
    for (const r of list.filter((x) => Object.keys(BYPASS).some((k) => x.out_user_id === P[k].id))) {
      const { data } = await admin.rpc('claim_quiz_send', { p_id: r.out_assignment_id });
      if (data === true) claimed++;
    }
    check('(e) 선점 4건', claimed === 4, `claimed=${claimed}`);
    const r3 = await send(owner, QA_);
    check('(e) 선점 뒤 호출 반환 = 2(다 푼 · 나간 직원 행만 남음)', !r3.error && r3.data === 2, r3.error?.message ?? `got=${r3.data}`);
    const after = await due();
    const again = Object.keys(BYPASS).map((k) => picked(after, k).length);
    check('(e) 선점 뒤 다시 불러도 다시 나가지 않는다', again.every((n) => n === 0), again.join(','));
  }

  console.log('— (f) 권한 · 오류 코드 —');
  {
    const j = await send(P.w.c, QA_);
    check('(f) 직원 세션 = forbidden', /forbidden/.test(j.error?.message ?? ''), j.error?.message ?? `data=${j.data}`);
    const a = await send(mk(), QA_);
    check('(f) anon = 42501', a.error?.code === '42501', a.error?.code ?? '거부 안 됨');
    const n = await owner.rpc('quiz_send_now', { p_course_id: null });
    check('(f) 빈 인자 = invalid_argument', /invalid_argument/.test(n.error?.message ?? ''), n.error?.message ?? `data=${n.data}`);
    const z = await send(owner, QZ);
    check('(f) 문항 0개 = quiz_no_items', /quiz_no_items/.test(z.error?.message ?? ''), z.error?.message ?? `data=${z.data}`);
    // 다른 매장 사장이 이 매장 퀴즈를 부른다.
    const { c: owner2 } = await session(`qa_sn_o2_${s}@example.com`, { name: 'QA사장2', role: 'owner', phone: qaPhones[PEOPLE.length + 1], store_name: 'SN2', industry: '카페·디저트' });
    await store(owner2, 'SN 다른 매장');
    const o = await send(owner2, QA_);
    check('(f) 남의 매장 퀴즈 = quiz_not_found', /quiz_not_found/.test(o.error?.message ?? ''), o.error?.message ?? `data=${o.data}`);
    const { data: other } = await admin.from('quiz_assignments').select('id').eq('unit_id', UNIT).eq('course_id', QA_).is('sent_at', null).eq('send_now', true);
    check('(f) 남의 호출이 이 매장 행을 바꾸지 않았다(표시 2행 그대로)', (other ?? []).length === 2, `n=${(other ?? []).length}`);
  }
}

async function cleanup() {
  for (const u of units.filter(Boolean)) {
    for (const t of ['quiz_attempt_items', 'quiz_attempts', 'quiz_assignments', 'quiz_items', 'course_entries', 'training_courses', 'shift_templates']) {
      await admin.from(t).delete().eq('unit_id', u);
    }
  }
  for (const id of made.entries) await admin.from('playbook_entries').delete().eq('id', id);
  for (const u of units.filter(Boolean)) { const r = await admin.from('units').delete().eq('id', u); if (r.error) console.error('  ! 정리 units:', r.error.message); }
  for (const id of made.users) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('  ! 정리 user:', r.error.message); }
  console.log(`  · 정리: 매장 ${units.length} · 계정 ${made.users.length}`);
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
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail} · skip 0 · 엣지 호출 0회 · LLM 호출 0회`);
process.exitCode = fail === 0 ? 0 : 1;
