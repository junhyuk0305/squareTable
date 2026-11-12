#!/usr/bin/env node
// qa-attendance-roundtrip.mjs — 출근 → 퇴근이 DB 까지 가고, 사장은 읽고, 다른 매장 사장은 못 읽는가 · 로컬 도커 전용
//
// 왜 있나(2026-11-02 급여 제거): 근무 내역 화면(TimesheetView)과 출퇴근 화면을 크게 고쳤는데,
//   출근·퇴근 버튼이 실제로 DB 에 남는지 보는 하니스가 없었다(계획 §2 공백).
// 무엇을 못박나:
//   [1] 출근 — 직원 실세션이 db.ts upsertAttendance 와 같은 쓰기(attendance upsert … select('id'))로 1행을 남긴다.
//       서버는 '지금 시각' 출근을 수정으로 보지 않는다(edited_by null · 0322). 다시 읽으면 findOpenRecord 가 그 기록을 찾는다.
//   [2] 퇴근 — 같은 행을 닫는다(이중 행 없음). 근무 분은 서버가 출퇴근 시각으로 센다. 수정 이력이 남지 않는다.
//   [3] 사장 — fetchAttendance(매장 최근 기록)·fetchAttendanceMonth(직원·이번 달) 와 같은 읽기로 그 기록을 본다.
//   [4] 다른 매장 사장 — 같은 읽기로 0행이다. 그 기록을 덮어쓰려 하면 막히고 DB 는 그대로다.
//   [5] 자가정리 — 만든 매장·계정·OTP 시드를 지우고, 남은 행이 없는지 본다.
// 세션: 계정은 service_role 로 만들고, 로그인은 매직링크(generateLink → verifyOtp)로 실세션을 받는다(AGENTS.md ⑥).
// 판정 함수(findOpenRecord · minutesBetween · todayStr · MAX_SHIFT_MIN)는 앱의 src/lib/utils/attendance.ts 를 그대로 쓴다.
// ★로컬 전용: 키는 `npx supabase status` 에서만 읽고 주소가 127.0.0.1 이 아니면 멈춘다(qa-local-target.mjs). 라이브 경로가 없다.
// 실행: node scripts/qa-attendance-roundtrip.mjs   (npm run qa:attendance-roundtrip)
import { createClient } from '@supabase/supabase-js';
import { localEnv, assertLocalUrl } from './qa-local-target.mjs';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { findOpenRecord, minutesBetween, todayStr, MAX_SHIFT_MIN } from '../src/lib/utils/attendance.ts';

const env = localEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
assertLocalUrl(URL_);
if (!ANON || !SRV) { console.error('중단: 로컬 키를 못 읽었다(npx supabase status)'); process.exit(2); }

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SRV, opts);
const s = String(Date.now()).slice(-9);
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

// db.ts 와 같은 칸·같은 조건(fetchAttendance · fetchAttendanceMonth). 바꾸면 여기도 같이 바꾼다.
const COLS = 'id, staff_id, date, check_in, check_out, work_minutes, edited_by';
const readRecent = (c) => c.from('attendance').select(COLS).order('date', { ascending: false }).limit(1000);
const readMonth = (c, staffId, ym) => c.from('attendance').select(COLS)
  .eq('staff_id', staffId).gte('date', `${ym}-01`).lte('date', `${ym}-31`).order('date', { ascending: false }).limit(1000);
// db.ts upsertAttendance 와 같은 쓰기. writeStrict 는 0행을 실패로 본다 — 여기서도 행 수를 본다.
const upsertAttendance = (c, rec, unitId) => c.from('attendance').upsert({ ...rec, unit_id: unitId }).select('id');

const phones = ['0161', '0162', '0163'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];

/** 계정을 만들고 매직링크로 로그인한 실세션 클라이언트를 돌려준다. */
async function sessionUser(i, name, role, birth) {
  const email = `qa_attrt_${i}_${s}@example.com`;
  const cu = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { name, role, phone: phones[i], birth_date: birth },
  });
  if (cu.error || !cu.data.user) throw new Error(`${name} createUser: ${cu.error?.message ?? 'no user'}`);
  users.push(cu.data.user.id);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(`${name} generateLink: ${link.error?.message ?? 'no token'}`);
  const c = createClient(URL_, ANON, opts);
  const v = await c.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
  if (v.error || !v.data.session) throw new Error(`${name} verifyOtp: ${v.error?.message ?? 'no session'}`);
  return { c, id: cu.data.user.id };
}
async function store(O, name) {
  const { data, error } = await O.c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.unit_id) throw new Error('create_store: ' + (error?.message ?? 'no row'));
  units.push(row.unit_id);
  const sw = await O.c.rpc('switch_active_unit', { p_unit_id: row.unit_id });
  if (sw.error) throw new Error('switch_active_unit: ' + sw.error.message);
  return row;
}

let ATT_ID = null;
try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const OA = await sessionUser(0, 'QA출퇴근사장', 'owner', '1980-01-01');
  const J = await sessionUser(1, 'QA출퇴근직원', 'junior', '2000-01-01');
  const OB = await sessionUser(2, 'QA남의매장사장', 'owner', '1981-01-01');
  const A = await store(OA, 'QA출퇴근카페');
  const B = await store(OB, 'QA남의카페');
  const jn = await J.c.rpc('join_by_invite', { p_code: A.invite_code });
  if (jn.error) throw new Error('join_by_invite: ' + jn.error.message);
  const ap = await OA.c.rpc('approve_member', { p_uid: J.id });
  if (ap.error) throw new Error('approve_member: ' + ap.error.message);
  const sj = await J.c.rpc('switch_active_unit', { p_unit_id: A.unit_id });
  if (sj.error) throw new Error('직원 switch_active_unit: ' + sj.error.message);
  const today = todayStr();
  const ym = today.slice(0, 7);
  console.log(`셋업 — 매장 A ${A.unit_id}(사장 + 직원) · 매장 B ${B.unit_id}(다른 사장) · 오늘(KST) ${today}`);

  // ═══════ [1] 출근 ═══════
  console.log('\n[1] 출근 — 직원 실세션 · db.ts upsertAttendance 와 같은 쓰기');
  {
    const before = await readRecent(J.c);
    check('1-0 출근 전: 직원 읽기 성공 · 열린 기록 없음(출근 버튼)', !before.error && findOpenRecord(before.data ?? [], J.id) === undefined,
      before.error?.message ?? JSON.stringify(before.data));
    // 앱은 지금 시각으로 찍는다. 근무 분을 0 이 아닌 값으로 재려고 8분 전으로 둔다 — 서버의 '지금' 판정 폭(±10분) 안이라 버튼으로 본다.
    ATT_ID = `att_${J.id}_${Date.now()}_0`;
    const rec = { id: ATT_ID, staff_id: J.id, date: today, check_in: new Date(Date.now() - 8 * 60000).toISOString(), check_out: null, work_minutes: 0 };
    const w = await upsertAttendance(J.c, rec, A.unit_id);
    check('1-1 ★출근 쓰기가 1행을 남긴다(0행 = 앱은 실패로 되돌린다)', !w.error && (w.data ?? []).length === 1, w.error?.message ?? `rows=${(w.data ?? []).length}`);
    const db = (await admin.from('attendance').select('*').eq('id', ATT_ID).maybeSingle()).data;
    check('1-2 ★DB 에 기록이 있다 · 매장 A · 퇴근 없음 · 근무 0분', db?.unit_id === A.unit_id && db?.staff_id === J.id && db?.date === today
      && !!db?.check_in && db?.check_out === null && db?.work_minutes === 0, JSON.stringify(db));
    check('1-3 출근 버튼은 수정이 아니다(edited_by null · 0322)', db?.edited_by === null, `edited_by=${db?.edited_by}`);
    const after = await readRecent(J.c);
    const open = findOpenRecord(after.data ?? [], J.id);
    check('1-4 ★직원이 다시 읽으면 findOpenRecord 가 그 기록을 찾는다(퇴근 버튼)', !after.error && open?.id === ATT_ID, JSON.stringify(open ?? after.error));
  }

  // ═══════ [2] 퇴근 ═══════
  console.log('\n[2] 퇴근 — 같은 행을 닫는다');
  {
    const cur = await readRecent(J.c);
    const open = findOpenRecord(cur.data ?? [], J.id);
    if (!open) throw new Error('퇴근할 열린 기록이 없다');
    // useAttendanceStore.checkOut 과 같은 모양 — 열린 기록에 퇴근 시각과 앱이 센 분을 얹는다.
    const out = new Date().toISOString();
    const updated = { ...open, check_out: out, work_minutes: Math.min(MAX_SHIFT_MIN, minutesBetween(open.check_in, out)) };
    const w = await upsertAttendance(J.c, updated, A.unit_id);
    check('2-1 ★퇴근 쓰기가 1행을 남긴다', !w.error && (w.data ?? []).length === 1, w.error?.message ?? `rows=${(w.data ?? []).length}`);
    const db = (await admin.from('attendance').select('*').eq('id', ATT_ID).maybeSingle()).data;
    const serverMin = db?.check_in && db?.check_out ? Math.round((Date.parse(db.check_out) - Date.parse(db.check_in)) / 60000) : null;
    check('2-2 ★DB 기록에 퇴근 시각이 남는다', !!db?.check_out && Math.abs(Date.parse(db.check_out) - Date.parse(out)) < 1000, JSON.stringify(db));
    check('2-3 ★근무 분 = 출퇴근 시각 차(서버 계산 · 8분)', db?.work_minutes === serverMin && serverMin >= 7 && serverMin <= 9, `work_minutes=${db?.work_minutes} 시각차=${serverMin}`);
    check('2-4 퇴근 버튼도 수정이 아니다(edited_by null)', db?.edited_by === null, `edited_by=${db?.edited_by}`);
    const mine = await admin.from('attendance').select('id').eq('unit_id', A.unit_id).eq('staff_id', J.id);
    check('2-5 이중 행이 없다(직원 기록 1행)', (mine.data ?? []).length === 1, `rows=${(mine.data ?? []).length}`);
    const again = await readRecent(J.c);
    check('2-6 ★다시 읽으면 열린 기록이 없다(출근 버튼으로 돌아온다)', !again.error && findOpenRecord(again.data ?? [], J.id) === undefined,
      JSON.stringify(again.error ?? again.data));
    const edits = await admin.from('attendance_edits').select('id').eq('attendance_id', ATT_ID);
    check('2-7 출근·퇴근 버튼은 수정 이력을 남기지 않는다(attendance_edits 0행)', !edits.error && (edits.data ?? []).length === 0,
      edits.error?.message ?? `rows=${(edits.data ?? []).length}`);
  }

  // ═══════ [3] 사장 읽기 ═══════
  console.log('\n[3] 같은 매장 사장 — 앱과 같은 읽기로 그 기록을 본다');
  {
    const r = await readRecent(OA.c);
    const hit = (r.data ?? []).find((x) => x.id === ATT_ID);
    check('3-1 ★사장 fetchAttendance 경로(매장 최근 기록)에 그 기록이 있다 · 퇴근·근무 분 그대로', !r.error && !!hit?.check_out && hit?.work_minutes > 0,
      r.error?.message ?? JSON.stringify(hit ?? null));
    const m = await readMonth(OA.c, J.id, ym);
    check('3-2 ★사장 fetchAttendanceMonth 경로(직원·이번 달)에도 있다', !m.error && (m.data ?? []).some((x) => x.id === ATT_ID),
      m.error?.message ?? `rows=${(m.data ?? []).length}`);
  }

  // ═══════ [4] 다른 매장 사장 ═══════
  console.log('\n[4] 다른 매장 사장 — 못 읽고 못 고친다(RLS)');
  {
    const r = await readRecent(OB.c);
    check('4-1 ★다른 매장 사장 fetchAttendance 경로에 그 기록이 없다', !r.error && !(r.data ?? []).some((x) => x.id === ATT_ID || x.staff_id === J.id),
      r.error?.message ?? `rows=${(r.data ?? []).length}`);
    const m = await readMonth(OB.c, J.id, ym);
    check('4-2 ★직원·이번 달로 찍어 읽어도 0행', !m.error && (m.data ?? []).length === 0, m.error?.message ?? `rows=${(m.data ?? []).length}`);
    const byId = await OB.c.from('attendance').select('id').eq('id', ATT_ID);
    check('4-3 id 로 찍어 읽어도 0행', !byId.error && (byId.data ?? []).length === 0, byId.error?.message ?? `rows=${(byId.data ?? []).length}`);
    const forged = { id: ATT_ID, staff_id: J.id, date: today, check_in: new Date(Date.now() - 600 * 60000).toISOString(), check_out: new Date().toISOString(), work_minutes: 600 };
    const w = await upsertAttendance(OB.c, forged, A.unit_id);
    check('4-4 ★다른 매장 사장이 그 기록을 덮어쓰려 하면 막힌다(오류 또는 0행)', !!w.error || (w.data ?? []).length === 0,
      w.error ? `code=${w.error.code}` : `rows=${(w.data ?? []).length}`);
    const db = (await admin.from('attendance').select('unit_id, work_minutes, edited_by').eq('id', ATT_ID).maybeSingle()).data;
    check('4-5 ★DB 기록은 그대로다(매장 A · 근무 분 · 수정 표시 없음)', db?.unit_id === A.unit_id && db?.work_minutes < 600 && db?.edited_by === null, JSON.stringify(db));
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  // 매장을 먼저 지운다(자식 행 cascade) → 계정 → OTP 시드.
  for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* 아래에서 남은 행으로 잡는다 */ } }
  for (const id of users) { try { await admin.auth.admin.deleteUser(id); } catch { /* 아래에서 남은 행으로 잡는다 */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}

console.log('\n[5] 자가정리');
{
  const leftUnits = units.length ? (await admin.from('units').select('id').in('id', units)).data ?? [] : [];
  const leftAtt = ATT_ID ? (await admin.from('attendance').select('id').eq('id', ATT_ID)).data ?? [] : [];
  const leftProf = users.length ? (await admin.from('profiles').select('id').in('id', users)).data ?? [] : [];
  check('5-1 만든 매장·출퇴근 기록·계정이 남지 않는다', leftUnits.length === 0 && leftAtt.length === 0 && leftProf.length === 0,
    `units=${leftUnits.length} attendance=${leftAtt.length} profiles=${leftProf.length}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed, skip 0`);
process.exit(fail ? 1 : 0);
