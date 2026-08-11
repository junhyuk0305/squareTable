#!/usr/bin/env node
// qa-shift-dated.mjs — 0138 날짜 지정 근무(하루짜리)의 라이브 증명.
//
// 왜 별도 게이트인가: 기존 근무표 게이트(qa:swap-guard·qa:task-reminder)는 **요일 반복 행만** 만든다.
// 그래서 0138 이 통째로 깨져 있어도 전부 green 이 나온다(AGENTS.md: 건너뛴 것을 통과로 세지 않는다).
// 여기서 보는 것:
//   ① 날짜 지정 행이 실제로 저장되는가 (weekday=null + shift_date)
//   ② CHECK 가 모순 행(둘 다 있음 / 둘 다 없음)을 거부하는가
//   ③ shiftsOn(클라 SSOT) 판정이 "그 날짜에만" 잡고 다음 주 같은 요일엔 안 잡는가
//   ④ workers_at(SQL 판)이 같은 판정을 하는가 — 업무 리마인더 수신자가 어긋나면 조용히 틀린다
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
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed: ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

/** useScheduleStore.shiftsOn 의 필터 판정만 뽑은 것 — 두 구현이 같은 답을 내는지 보려고 복제한다. */
const matchesDay = (t, date, wd) => (t.shift_date ? t.shift_date === date : t.weekday === wd);

const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

const qaPhones = ['0161', '0162'].map((p) => `${p}${s.slice(0, 7)}`);
await seedVerifiedPhones(URL, SRV, qaPhones);
const cleanup = [];
try {
  const O = mk(); await signUpSession(O, `qa_sd_o_${s}@example.com`, { name: 'SD사장', role: 'owner', phone: qaPhones[0] }); cleanup.push(O);
  const { data: c1 } = await O.rpc('create_store', { p_store_name: 'SD 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const UNIT = c1?.[0]?.unit_id, code1 = c1?.[0]?.invite_code;
  const J = mk(); const jId = await signUpSession(J, `qa_sd_j_${s}@example.com`, { name: 'SD직원', role: 'junior', phone: qaPhones[1] }); cleanup.push(J);
  await J.rpc('join_by_invite', { p_code: code1 }); await O.rpc('approve_member', { p_uid: jId });

  // 오늘(KST)을 기준일로 삼는다 — workers_at 이 KST 날짜/시각으로 도는 함수라 축을 맞춘다.
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  const nextWeek = addDays(day, 7);

  // ── ① 날짜 지정 행 저장 ──────────────────────────────────
  const datedId = `sd_dated_${s}`;
  const ins = await O.from('shift_templates')
    .insert({ id: datedId, unit_id: UNIT, staff_id: jId, weekday: null, shift_date: day, start_time: '09:00', end_time: '18:00' })
    .select('id, weekday, shift_date');
  check('① 날짜 지정 근무 저장(weekday=null + shift_date)',
    !ins.error && ins.data?.[0]?.shift_date === day && ins.data?.[0]?.weekday === null,
    ins.error?.message ?? `weekday=${ins.data?.[0]?.weekday} date=${ins.data?.[0]?.shift_date}`);

  // 대조군: 같은 요일 반복 행도 하나 둔다(두 종류가 섞여도 판정이 갈리는지 보려고).
  const repeatId = `sd_repeat_${s}`;
  const ins2 = await O.from('shift_templates')
    .insert({ id: repeatId, unit_id: UNIT, staff_id: jId, weekday: wd, shift_date: null, start_time: '19:00', end_time: '22:00' })
    .select('id');
  check('① 대조군: 요일 반복 근무 저장', !ins2.error && (ins2.data?.length ?? 0) === 1, ins2.error?.message ?? '');

  // ── ② CHECK 가 모순 행을 막는가 ───────────────────────────
  const both = await O.from('shift_templates')
    .insert({ id: `sd_both_${s}`, unit_id: UNIT, staff_id: jId, weekday: wd, shift_date: day, start_time: '01:00', end_time: '02:00' })
    .select('id');
  check('② 둘 다 채운 행 거부(23514)', both.error?.code === '23514', `code=${both.error?.code ?? 'none'}`);

  const neither = await O.from('shift_templates')
    .insert({ id: `sd_none_${s}`, unit_id: UNIT, staff_id: jId, weekday: null, shift_date: null, start_time: '01:00', end_time: '02:00' })
    .select('id');
  check('② 둘 다 빈 행 거부(23514)', neither.error?.code === '23514', `code=${neither.error?.code ?? 'none'}`);

  // ── ③ 클라 판정(shiftsOn) — 그 날짜에만 ───────────────────
  const { data: rows } = await O.from('shift_templates').select('id, weekday, shift_date').eq('unit_id', UNIT);
  const onDay = (rows ?? []).filter((t) => matchesDay(t, day, wd)).map((t) => t.id).sort();
  const onNext = (rows ?? []).filter((t) => matchesDay(t, nextWeek, wd)).map((t) => t.id).sort();
  check('③ 기준일: 날짜 지정 + 요일 반복 둘 다 잡힘',
    onDay.length === 2 && onDay.includes(datedId) && onDay.includes(repeatId), `ids=${onDay.join(',')}`);
  check('③ 다음 주 같은 요일: 요일 반복만 잡힘(날짜 지정은 빠짐)',
    onNext.length === 1 && onNext[0] === repeatId, `ids=${onNext.join(',')}`);

  // ── ④ SQL 판정(workers_at) — 같은 답이어야 한다 ───────────
  // service_role 전용 함수라 svc 로 부른다(0118 의 grant 그대로).
  const w1 = await svc.rpc('workers_at', { p_unit: UNIT, p_day: day, p_time: '10:00' });
  check('④ workers_at: 기준일 10:00 → 날짜 지정 근무자 잡힘',
    !w1.error && (w1.data ?? []).includes(jId), w1.error?.message ?? `n=${(w1.data ?? []).length}`);

  const w2 = await svc.rpc('workers_at', { p_unit: UNIT, p_day: nextWeek, p_time: '10:00' });
  check('④ workers_at: 다음 주 같은 요일 10:00 → 없음(날짜 지정은 하루뿐)',
    !w2.error && (w2.data ?? []).length === 0, w2.error?.message ?? `n=${(w2.data ?? []).length} ${JSON.stringify(w2.data)}`);

  const w3 = await svc.rpc('workers_at', { p_unit: UNIT, p_day: nextWeek, p_time: '20:00' });
  check('④ workers_at: 다음 주 20:00 → 요일 반복 근무자는 그대로 잡힘',
    !w3.error && (w3.data ?? []).includes(jId), w3.error?.message ?? `n=${(w3.data ?? []).length}`);
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
