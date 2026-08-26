#!/usr/bin/env node
// qa-swap-transfer.mjs — 교대 승인이 근무를 **실제로** 옮기는가 (0178 · 0179 / 감사 #41 · 작업 6)
//
// 무엇을 못박나:
//   ① 지정 발송(0178) — 목록에 없는 사람은 수락 못 한다. 셀프 수락 차단(0128)은 그대로.
//   ② **선착순** — 두 명이 동시에 눌러도 한 명만 성공한다(0행을 성공으로 치면 둘 다 수락한 줄 안다).
//   ③ 승인하면 근무가 **실제로** 수락자에게 넘어간다(파생 치환이 아니라 행 이전).
//   ④ ★#41 회귀 — 넘어간 날의 근무를 고쳐도 **원 담당자의 매주 반복은 안 망가진다**.
//   ⑤ ★부분 교대 — 앞·뒤·**가운데(조각 3개)**. 조각 합 = 원본, 겹침·유실 없음.
//   ⑥ 요일 반복을 하루만 쪼개도 **다음 주 같은 요일은 원본 그대로**.
//
// ★이중 적용 확인이 이 하니스의 핵심이다: 실제 이전을 했는데 파생 치환이 남아 있으면 담당자가
//   두 번 바뀐다. workers_at(서버 판정)이 **정확히 한 명**을 돌려주는지로 잰다.
//
// 실행: node scripts/qa-swap-transfer.mjs   자가정리(계정·OTP 시드 정리).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

const phones = ['0191', '0192', '0193', '0194'].map((p) => `${p}${s.slice(0, 7)}`);
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const span = (a, b) => ((toMin(b) - toMin(a)) + 1440) % 1440;

const cleanup = [];
try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = mk(), A = mk(), B = mk(), C = mk();
  cleanup.push(A, B, C, O);
  const up = async (c, i, name, role, birth) => {
    const r = await c.auth.signUp({
      email: `qa_swt_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: birth } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    return r.data.user?.id;
  };
  const oId = await up(O, 0, 'QA교대사장', 'owner', '1980-01-01');
  const aId = await up(A, 1, 'QA교대A', 'junior', '2000-01-01');
  const bId = await up(B, 2, 'QA교대B', 'junior', '2000-02-02');
  const cId = await up(C, 3, 'QA교대C', 'junior', '2000-03-03');

  const { data: st, error: e1 } = await O.rpc('create_store', { p_store_name: 'QA교대카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = row.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.rpc('switch_active_unit', { p_unit_id: UNIT });
  for (const [c, id] of [[A, aId], [B, bId], [C, cId]]) {
    await c.rpc('join_by_invite', { p_code: row.invite_code });
    const { error } = await O.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  // 오늘(KST) 기준. workers_at 이 KST 날짜/시각으로 도는 함수라 축을 맞춘다.
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  console.log(`셋업 — 매장 ${UNIT} · 사장 + A/B/C · 기준일 ${day}(요일 ${wd})`);

  /** A 의 매주 반복 근무 하나(12:00~18:00). */
  const mkRepeat = async (id) => {
    const { error } = await O.from('shift_templates').insert({
      id, unit_id: UNIT, staff_id: aId, weekday: wd, shift_date: null, start_time: '12:00', end_time: '18:00',
    });
    if (error) throw new Error('shift insert: ' + error.message);
  };
  /** A 가 올리는 대타 요청. targets=지정 목록(null 이면 전체 공개), part=[시작,끝] 또는 null. */
  const mkSwap = async (id, tplId, date, targets, part) => {
    const { error } = await A.from('swap_requests').insert({
      id, unit_id: UNIT, kind: 'cover', requester_id: aId, date, template_id: tplId,
      target_staff_ids: targets, part_start: part?.[0] ?? null, part_end: part?.[1] ?? null,
      note: '', status: 'open',
    });
    if (error) throw new Error('swap insert: ' + error.message);
  };
  const shiftsOfDay = async (date) => {
    const { data } = await admin.from('shift_templates').select('id, staff_id, weekday, shift_date, start_time, end_time').eq('unit_id', UNIT);
    const exc = (await admin.from('shift_exceptions').select('template_id, date').eq('unit_id', UNIT)).data ?? [];
    const excluded = new Set(exc.filter((e) => e.date === date).map((e) => e.template_id));
    const d = new Date(`${date}T00:00:00Z`).getUTCDay();
    return (data ?? [])
      .filter((t) => (t.shift_date ? t.shift_date === date : t.weekday === d))
      .filter((t) => t.shift_date !== null || !excluded.has(t.id))
      .sort((x, y) => x.start_time.localeCompare(y.start_time));
  };

  // ═══════ 1. 지정 발송 · 셀프 수락 차단 ═══════
  console.log('\n[1] 지정 발송 · 수락 권한');
  const TPL1 = `swt_t1_${s}`, SW1 = `swt_s1_${s}`;
  await mkRepeat(TPL1);
  await mkSwap(SW1, TPL1, day, [bId, cId], null);
  {
    const r = await O.rpc('accept_swap', { p_id: SW1 });   // 사장은 지정 목록에 없다
    check('1-1 ★지정 목록에 없는 사람은 수락 못 한다', !r.error && r.data === false, r.error?.message ?? `rpc=${r.data}`);
  }
  {
    const r = await A.rpc('accept_swap', { p_id: SW1 });   // 본인 요청
    check('1-2 회귀: 본인 요청 셀프 수락 차단(0128)', !r.error && r.data === false, r.error?.message ?? `rpc=${r.data}`);
  }
  {
    // ★선착순 — 둘이 **동시에** 누른다. 정확히 한 명만 true 여야 한다.
    const [rb, rc] = await Promise.all([B.rpc('accept_swap', { p_id: SW1 }), C.rpc('accept_swap', { p_id: SW1 })]);
    const wins = [rb.data, rc.data].filter((x) => x === true).length;
    check('1-3 ★두 명이 동시에 수락 → 한 명만 성공(선착순)', wins === 1, `B=${rb.data} C=${rc.data} err=${rb.error?.message ?? rc.error?.message ?? '-'}`);
  }
  const winner = (await admin.from('swap_requests').select('accepted_by, status').eq('id', SW1).maybeSingle()).data;
  check('1-4 수락자·상태가 정확히 한 벌로 남는다', winner?.status === 'accepted' && !!winner?.accepted_by, JSON.stringify(winner));

  // ═══════ 2. 승인 = 실제 이전 ═══════
  console.log('\n[2] 승인하면 근무가 실제로 넘어간다');
  {
    const r = await A.rpc('approve_swap', { p_id: SW1 });
    check('2-1 직원은 승인 못 한다', !r.error && r.data === false, r.error?.message ?? `rpc=${r.data}`);
  }
  {
    const r = await O.rpc('approve_swap', { p_id: SW1 });
    check('2-2 사장 승인 = 성공', !r.error && r.data === true, r.error?.message ?? `rpc=${r.data}`);
  }
  {
    const rows = await shiftsOfDay(day);
    const mine = rows.filter((t) => t.staff_id === aId);
    const his = rows.filter((t) => t.staff_id === winner.accepted_by);
    check('2-3 ★그날 근무자가 수락자로 바뀐다(원 담당자는 그날 없음)',
      his.length === 1 && mine.length === 0 && his[0].start_time === '12:00' && his[0].end_time === '18:00',
      JSON.stringify(rows));
  }
  {
    // ★이중 적용 검사 — 파생 치환이 남아 있으면 여기서 인원이 늘거나 원 담당자가 섞인다.
    const w = await admin.rpc('workers_at', { p_unit: UNIT, p_day: day, p_time: '13:00' });
    check('2-4 ★workers_at 이 수락자 **한 명만** 돌려준다(이중 적용 없음)',
      !w.error && (w.data ?? []).length === 1 && w.data[0] === winner.accepted_by, w.error?.message ?? JSON.stringify(w.data));
  }
  {
    const next = addDays(day, 7);
    const rows = await shiftsOfDay(next);
    check('2-5 ★다음 주 같은 요일은 원 담당자 그대로(반복이 안 망가짐)',
      rows.length === 1 && rows[0].staff_id === aId && rows[0].id === TPL1, JSON.stringify(rows));
  }
  {
    // ★#41 회귀 — 넘어간 날의 근무를 고친다. 원 담당자의 **매주 반복**은 그대로여야 한다.
    const dated = (await shiftsOfDay(day))[0];
    await O.from('shift_templates').update({ end_time: '17:00' }).eq('id', dated.id);
    const base = (await admin.from('shift_templates').select('start_time, end_time, staff_id, weekday').eq('id', TPL1).maybeSingle()).data;
    check('2-6 ★#41: 넘어간 날을 고쳐도 원 담당자의 매주 반복은 안 망가진다',
      base?.start_time === '12:00' && base?.end_time === '18:00' && base?.staff_id === aId && base?.weekday === wd,
      JSON.stringify(base));
  }

  // ═══════ 3. 부분 교대 — 앞·뒤·가운데 ═══════
  console.log('\n[3] 부분 교대 (조각 2개 / 2개 / ★3개)');
  const cases = [
    { tag: '앞부분 12:00~15:00', part: ['12:00', '15:00'], pieces: 2, off: 1 },
    { tag: '뒷부분 15:00~18:00', part: ['15:00', '18:00'], pieces: 2, off: 2 },
    { tag: '★가운데 14:00~16:00', part: ['14:00', '16:00'], pieces: 3, off: 3 },
  ];
  for (const c of cases) {
    const date = addDays(day, c.off * 7);   // 같은 요일의 다른 주 — 반복 하나로 여러 케이스를 본다
    const swId = `swt_p${c.off}_${s}`;
    await mkSwap(swId, TPL1, date, [bId], c.part);
    const ra = await B.rpc('accept_swap', { p_id: swId });
    const rp = await O.rpc('approve_swap', { p_id: swId });
    const rows = await shiftsOfDay(date);
    const total = rows.reduce((a, t) => a + span(t.start_time, t.end_time), 0);
    const his = rows.filter((t) => t.staff_id === bId);
    const overlap = rows.some((x, i) => rows.some((y, j) => i < j && span(x.start_time, y.start_time) < span(x.start_time, x.end_time) && span(y.start_time, x.start_time) < span(y.start_time, y.end_time)));
    check(`3-${c.off}a ${c.tag} → 조각 ${c.pieces}개`,
      !ra.error && ra.data === true && !rp.error && rp.data === true && rows.length === c.pieces,
      `accept=${ra.data} approve=${rp.data} rows=${JSON.stringify(rows.map((r) => `${r.start_time}~${r.end_time}:${r.staff_id === aId ? 'A' : 'B'}`))}`);
    check(`3-${c.off}b ${c.tag} → 조각 합 = 원본 360분 · 겹침 없음`,
      total === 360 && !overlap, `합=${total} 겹침=${overlap}`);
    check(`3-${c.off}c ${c.tag} → 넘긴 구간만 수락자 것`,
      his.length === 1 && his[0].start_time === c.part[0] && his[0].end_time === c.part[1],
      JSON.stringify(his));
  }
  {
    const next = addDays(day, 28);   // 위 케이스가 안 건드린 주
    const rows = await shiftsOfDay(next);
    check('3-4 ★쪼갠 주를 지나도 다음 주 반복은 원본 그대로',
      rows.length === 1 && rows[0].id === TPL1 && rows[0].staff_id === aId && rows[0].end_time === '18:00',
      JSON.stringify(rows));
  }

  // ═══════ 4. 구간이 근무 밖이면 승인 자체가 안 된다 ═══════
  console.log('\n[4] 잘못된 구간은 서버가 막는다');
  {
    const date = addDays(day, 35);
    const swId = `swt_bad_${s}`;
    await mkSwap(swId, TPL1, date, [bId], ['10:00', '13:00']);   // 12:00 시작 근무의 밖
    await B.rpc('accept_swap', { p_id: swId });
    const rp = await O.rpc('approve_swap', { p_id: swId });
    const st2 = (await admin.from('swap_requests').select('status').eq('id', swId).maybeSingle()).data;
    check('4-1 ★근무 밖 구간은 승인 거부 + 상태가 안 바뀐다(반쪽 승인 없음)',
      !rp.error && rp.data === false && st2?.status === 'accepted', `rpc=${rp.data} status=${st2?.status}`);
    const rows = await shiftsOfDay(date);
    check('4-2 거부됐으면 근무표도 그대로', rows.length === 1 && rows[0].id === TPL1, JSON.stringify(rows));
  }

  // ═══════ 5. 되돌리기 — 쪼갠 날을 원래대로 ═══════
  console.log('\n[5] 되돌리기(쪼갠 근무표 합치기)');
  {
    const date = addDays(day, 7);   // 3-1 에서 쪼갠 날
    const del = await O.from('shift_exceptions').delete().eq('template_id', TPL1).eq('date', date).select('template_id');
    const rows = await shiftsOfDay(date);
    check('5-1 사장이 예외를 지우면 원본 반복이 그 날에 돌아온다',
      !del.error && (del.data ?? []).length === 1 && rows.some((t) => t.id === TPL1),
      del.error?.message ?? JSON.stringify(rows.map((r) => r.id)));
    const bad = await B.from('shift_exceptions').delete().eq('template_id', TPL1).eq('date', addDays(day, 14)).select('template_id');
    check('5-2 직원은 예외를 못 지운다(관리자만)', !bad.error && (bad.data ?? []).length === 0, `rows=${(bad.data ?? []).length}`);
  }

  // ═══════ 6. 직원 자가수정 — 내 근무의 시각만 ═══════
  console.log('\n[6] 직원 자가수정 (0178)');
  {
    const TPL_B = `swt_tb_${s}`;
    await O.from('shift_templates').insert({ id: TPL_B, unit_id: UNIT, staff_id: bId, weekday: (wd + 1) % 7, shift_date: null, start_time: '09:00', end_time: '15:00' });
    const ok = await B.rpc('update_my_shift_time', { p_id: TPL_B, p_start: '10:00', p_end: '16:00' });
    const after = (await admin.from('shift_templates').select('start_time, end_time, edited_by, staff_id, weekday').eq('id', TPL_B).maybeSingle()).data;
    check('6-1 직원이 자기 근무 시각을 고친다 = 성공', !ok.error && ok.data === true && after?.start_time === '10:00' && after?.end_time === '16:00',
      ok.error?.message ?? JSON.stringify(after));
    check('6-2 ★고친 근무에 표가 남는다(사장 화면 “직원 수정”)', after?.edited_by === 'staff', `edited_by=${after?.edited_by}`);
    const bad = await C.rpc('update_my_shift_time', { p_id: TPL_B, p_start: '08:00', p_end: '20:00' });
    const after2 = (await admin.from('shift_templates').select('start_time, end_time').eq('id', TPL_B).maybeSingle()).data;
    check('6-3 ★남의 근무는 못 고친다', !bad.error && bad.data === false && after2?.start_time === '10:00', `rpc=${bad.data} ${JSON.stringify(after2)}`);
    const zero = await B.rpc('update_my_shift_time', { p_id: TPL_B, p_start: '10:00', p_end: '10:00' });
    check('6-4 근무 0분은 거부', !zero.error && zero.data === false, `rpc=${zero.data}`);
    const night = await B.rpc('update_my_shift_time', { p_id: TPL_B, p_start: '22:00', p_end: '02:00' });
    check('6-5 자정 넘김은 허용(심야 근무)', !night.error && night.data === true, `rpc=${night.data}`);
    const direct = await B.from('shift_templates').update({ staff_id: cId }).eq('id', TPL_B).select('id');
    check('6-6 ★직원이 근무표를 직접 UPDATE 하지는 못한다(st_write 는 관리자 전용 유지)',
      !direct.error && (direct.data ?? []).length === 0, `rows=${(direct.data ?? []).length} err=${direct.error?.code ?? '-'}`);
  }
  // ═══════ 7. 매장 격리 — 새 테이블도 RLS 가 유일한 방어선이다 ═══════
  console.log('\n[7] shift_exceptions 매장 격리');
  {
    // 매장 간 격리는 audit-crosstenant 가 두 매장으로 본다. 여기서는 **로그인 안 한 눈**에 안 보이는지만.
    const anon = mk();
    const seen = await anon.from('shift_exceptions').select('template_id');
    check('7-1 anon 은 예외를 못 본다(RLS 기본 차단)', !seen.error ? (seen.data ?? []).length === 0 : true,
      `rows=${(seen.data ?? []).length} err=${seen.error?.code ?? '-'}`);
    const bad = await B.from('shift_exceptions').insert({ template_id: TPL1, unit_id: UNIT, date: addDays(day, 60) }).select('template_id');
    check('7-2 ★직원은 예외를 심지 못한다(관리자만)', !!bad.error || (bad.data ?? []).length === 0,
      `rows=${(bad.data ?? []).length} err=${bad.error?.code ?? '-'}`);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL_, SRV, phones).catch(() => {});
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
