#!/usr/bin/env node
// qa-owner-alerts.mjs — 사장 알림(0191 좌석 잠김 · 0193 AI 사용량 80%·100%) 라이브 증명.
//
// 크론이 실제로 부르는 입구(엣지 push mode='task_reminders')를 service_role 로 그대로 친다.
// 회차 시간은 기다리지 않고 seat_lock_episodes.started_at 을 과거로 옮겨 시뮬레이션한다.
//
//   ① 잠김 발생 → 1회차 1행 · 수신자 = 사장 1명(직원 4명은 수신자가 아니다)
//   ② 재실행 멱등 — 같은 회차가 두 번 생기지 않는다
//   ③ +2일 → 2회차 · +4일 → 3회차 · +10일 → 4회차 없음(최대 3회)
//   ④ RLS — 사장은 읽고 직원은 0행
//   ⑤ 중간 해소 → 주기 닫힘 · 닫힌 주기는 시간이 지나도 회차가 안 늘어난다
//   ⑥ 다시 잠김 → 새 주기 · 1회차부터
//   ⑦ AI 80%·100% — 임계선을 넘는 호출에서 월 1회씩, 넘은 뒤 호출은 추가 행 없음
//   ⑧ 기본 야간 방해금지(0194) — 개인 방해금지를 안 켠 매장은 22:00~08:00(KST) 선점 안 함(유실 아님, 낮에 그대로 나감)
//   ⑨ 사장이 방해금지를 직접 켠 매장은 기본 야간 차단에서 빠진다 — 새벽에도 즉시 선점
//   ⑩ 닫힌 매장 직원 알림(0196) — 잠기면 직원 전원에게 1회 · 재실행 멱등 · 재닫힘은 새 행
//
// ⚠️ 스윕은 **전역**이다 — 다른 매장의 미발송 알림도 같이 나간다(크론이 5분 안에 보낼 것을 앞당길 뿐).
// 실행: node scripts/qa-owner-alerts.mjs   (.env + .env.seed)
// 자가정리: delete_my_account + app_config 원복(finally).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 파일 없음 */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('FAIL: URL/ANON/SERVICE_ROLE env 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

const kstMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
  .format(new Date()).slice(0, 7);

async function getConfig(key) {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setConfig(key, value) {
  const { data, error } = await admin.from('app_config')
    .update({ value: String(value), updated_at: new Date().toISOString() }).eq('key', key).select('value');
  if (error || data?.length !== 1) throw new Error(`setConfig(${key}) 실패: ${error?.message ?? 'no row'}`);
}

let seq = 0;
const seededPhones = [];
const cleanup = [];
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 17) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const { data, error } = await c.auth.signUp({
    email: `qa_oa_${s}_${seq}@example.com`, password: pw,
    options: { data: { name, role, phone, birth_date: '1990-01-15' } },
  });
  if (error || !data.session) throw new Error(`signUp(${name}) 실패: ${error?.message}`);
  cleanup.push(c);
  return { c, uid: data.user.id };
}
async function adminActivate(unitId, days, plan) {
  const { data, error } = await admin.rpc('admin_activate_store', { p_unit_id: unitId, p_days: days, p_plan: plan });
  if (error) throw new Error(`admin_activate_store 실패: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}
async function expire(unitId) {
  const { error } = await admin.from('unit_subscriptions')
    .update({ paid_until: new Date(Date.now() - 60_000).toISOString() }).eq('unit_id', unitId);
  if (error) throw new Error(`expire 실패: ${error.message}`);
}
// 크론과 같은 입구.
async function sweep() {
  const res = await fetch(`${URL}/functions/v1/push`, { method: 'POST', headers: SH, body: JSON.stringify({ mode: 'task_reminders' }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`sweep 실패: ${res.status} ${JSON.stringify(body)}`);
  return body;
}
async function alerts(unitId, kind) {
  const { data, error } = await admin.from('owner_alerts')
    .select('id, period, step, title, claimed_at, recipients').eq('unit_id', unitId).eq('kind', kind).order('id');
  if (error) throw new Error(`owner_alerts 읽기 실패: ${error.message}`);
  return data ?? [];
}
async function episodes(unitId) {
  const { data, error } = await admin.from('seat_lock_episodes').select('id, started_at, closed_at').eq('unit_id', unitId).order('id');
  if (error) throw new Error(`seat_lock_episodes 읽기 실패: ${error.message}`);
  return data ?? [];
}
async function shiftEpisode(id, days) {
  const { error } = await admin.from('seat_lock_episodes')
    .update({ started_at: new Date(Date.now() - days * 864e5 - 60_000).toISOString() }).eq('id', id);
  if (error) throw new Error(`shiftEpisode 실패: ${error.message}`);
}
async function edgeAnswer(client) {
  const { data } = await client.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify({ task: 'answer', payload: { query: '마감은 몇 시에 하나요', sops: [] } }),
  });
  return res.status;
}
async function seedAiUsage(unitId, used) {
  const { error } = await admin.from('ai_usage_monthly').upsert({ unit_id: unitId, month: kstMonth, used }, { onConflict: 'unit_id,month' });
  if (error) throw new Error(`seedAiUsage 실패: ${error.message}`);
}
// 오늘(KST) 벽시계 hh:mm 을 ISO 로 — sweep_owner_alerts(p_now) 에 야간/주간을 결정적으로 주입한다.
function kstToday(hh, mm) {
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  return new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`).toISOString();
}
// 크론 입구(엣지)를 거치지 않고 RPC 를 직접 부른다 — p_now 는 엣지가 실어 나르지 않는 테스트 전용 파라미터.
async function sweepAt(iso) {
  const { error } = await admin.rpc('sweep_owner_alerts', { p_now: iso });
  if (error) throw new Error(`sweep_owner_alerts(p_now) 실패: ${error.message}`);
}

let origFree = null, origTrial = null;
async function restore() {
  if (origFree !== null) await setConfig('billing_free_mode', origFree).catch(() => console.error('  !! billing_free_mode 원복 실패'));
  if (origTrial !== null) await setConfig('signup_trial_days', origTrial).catch(() => console.error('  !! signup_trial_days 원복 실패'));
}

async function main() {
  origFree = await getConfig('billing_free_mode');
  origTrial = await getConfig('signup_trial_days');
  console.log(`  … 시작 시 billing_free_mode=${origFree} signup_trial_days=${origTrial} (끝나면 원복)`);
  await setConfig('signup_trial_days', 0);
  await setConfig('billing_free_mode', 'false');

  try {
    // ── 준비: 사장 + 직원 4명(유료로 열어 승인 → 만료 = 1명 잠김) ──
    const O = await signUp('owner', 'QA알림사장');
    const { data: cs, error: ce } = await O.c.rpc('create_store', { p_store_name: 'QA 알림점', p_industry: '카페·디저트', p_biz_no: null });
    if (ce) throw new Error(`create_store 실패: ${ce.message}`);
    const unit = cs[0].unit_id;
    await adminActivate(unit, 30, 'single');
    const staff = [];
    for (let i = 1; i <= 4; i++) {
      const j = await signUp('junior', `QA알림직원${i}`);
      const { error: je } = await j.c.rpc('join_by_invite', { p_code: cs[0].invite_code });
      if (je) throw new Error(`join_by_invite 실패: ${je.message}`);
      const { error: ae } = await O.c.rpc('approve_member', { p_uid: j.uid });
      if (ae) throw new Error(`approve_member 실패: ${ae.message}`);
      staff.push(j);
    }
    await expire(unit);
    const { data: ep } = await O.c.rpc('effective_plan', { p_unit: unit });
    check('준비: 만료 → 무료 매장(직원 4명)', ep === 'free', `ep=${ep}`);

    // ① 잠김 발생 → 1회차
    await sweep();
    let a = await alerts(unit, 'seat_lock');
    check('① 잠김 발생 → 1회차 1행', a.length === 1 && a[0].step === 1, JSON.stringify(a.map((x) => x.step)));
    check('① 문구 = 잠긴 인원 1명', /직원 1명이 앱을 못 쓰고 있어요/.test(a[0]?.title ?? ''), a[0]?.title);
    check('① 선점됨(발송 시도)', !!a[0]?.claimed_at, String(a[0]?.claimed_at));
    check('① 수신자 = 사장 1명뿐(직원 4명 제외)', a[0]?.recipients === 1, `recipients=${a[0]?.recipients}`);

    // ② 재실행 멱등
    await sweep();
    a = await alerts(unit, 'seat_lock');
    check('② 재실행해도 1행', a.length === 1, `rows=${a.length}`);

    // ③ +2일 / +4일 / +10일
    let eps = await episodes(unit);
    const ep1 = eps.find((e) => !e.closed_at);
    check('열린 주기 1개', eps.filter((e) => !e.closed_at).length === 1, JSON.stringify(eps));
    await shiftEpisode(ep1.id, 2);
    await sweep();
    a = await alerts(unit, 'seat_lock');
    check('③ +2일 → 2회차', a.map((x) => x.step).join() === '1,2', a.map((x) => x.step).join());
    await sweep();
    check('③ +2일 재실행 멱등', (await alerts(unit, 'seat_lock')).length === 2);
    await shiftEpisode(ep1.id, 4);
    await sweep();
    a = await alerts(unit, 'seat_lock');
    check('③ +4일 → 3회차', a.map((x) => x.step).join() === '1,2,3', a.map((x) => x.step).join());
    await shiftEpisode(ep1.id, 10);
    await sweep();
    check('③ +10일 → 4회차 없음(최대 3회)', (await alerts(unit, 'seat_lock')).length === 3);

    // ④ RLS
    const { data: ownRows } = await O.c.from('owner_alerts').select('id').eq('unit_id', unit);
    check('④ 사장은 자기 매장 알림을 읽는다', (ownRows ?? []).length === 3, `rows=${ownRows?.length}`);
    const { data: jrRows } = await staff[0].c.from('owner_alerts').select('id').eq('unit_id', unit);
    check('④ 직원은 0행', (jrRows ?? []).length === 0, `rows=${jrRows?.length}`);
    const { error: insErr } = await O.c.from('owner_alerts').insert({ unit_id: unit, kind: 'seat_lock', period: 'x', step: 9, title: 't', body: 'b' });
    check('④ 사장도 직접 쓰기 불가', !!insErr, insErr?.message ?? '써짐');

    // ⑤ 중간 해소 → 닫힘 · 닫힌 주기는 회차가 안 늘어난다
    // (새 주기로 확인해야 "닫혀서 멈춤"과 "3회 상한"이 구별된다 → 재잠김 후 1회차 상태에서 해소)
    await adminActivate(unit, 30, 'single');
    await sweep();
    eps = await episodes(unit);
    check('⑤ 해소 → 주기 닫힘', eps.every((e) => !!e.closed_at), JSON.stringify(eps));

    // ⑥ 다시 잠김 → 새 주기 1회차
    await expire(unit);
    await sweep();
    eps = await episodes(unit);
    const ep2 = eps.find((e) => !e.closed_at);
    check('⑥ 재잠김 → 새 주기', !!ep2 && ep2.id !== ep1.id, JSON.stringify(eps));
    a = (await alerts(unit, 'seat_lock')).filter((x) => x.period === String(ep2?.id));
    check('⑥ 새 주기 1회차', a.length === 1 && a[0].step === 1, JSON.stringify(a.map((x) => x.step)));

    await adminActivate(unit, 30, 'single');
    await sweep();
    await shiftEpisode(ep2.id, 3);
    await sweep();
    a = (await alerts(unit, 'seat_lock')).filter((x) => x.period === String(ep2.id));
    check('⑤ 중간 해소 후 +3일 지나도 2회차 없음', a.length === 1, `rows=${a.length}`);

    // ⑦ AI 80%·100% (0193) — 유료(single) 캡 3,000 기준
    const { data: qs } = await O.c.rpc('ai_quota_status');
    const cap = (Array.isArray(qs) ? qs[0] : qs)?.cap_count;
    check('⑦ 유료 캡 = 3000', cap === 3000, `cap=${cap}`);
    const t80 = Math.ceil(cap * 0.8);
    await seedAiUsage(unit, t80 - 2);
    check('⑦ 80% 직전 답변 200', (await edgeAnswer(O.c)) === 200);
    check('⑦ 80% 전에는 행 없음', (await alerts(unit, 'ai_cap')).length === 0);
    check('⑦ 80% 넘는 답변 200', (await edgeAnswer(O.c)) === 200);
    let ai = await alerts(unit, 'ai_cap');
    check('⑦ 80% 1행', ai.length === 1 && ai[0].step === 80 && ai[0].period === kstMonth, JSON.stringify(ai));
    await edgeAnswer(O.c);
    check('⑦ 80% 넘은 뒤 호출은 추가 행 없음', (await alerts(unit, 'ai_cap')).length === 1);
    await seedAiUsage(unit, cap - 1);
    check('⑦ 100% 넘는 답변 200', (await edgeAnswer(O.c)) === 200);
    ai = await alerts(unit, 'ai_cap');
    check('⑦ 100% 1행', ai.map((x) => x.step).join() === '80,100', ai.map((x) => x.step).join());
    check('⑦ 100% 이후 402', (await edgeAnswer(O.c)) === 402);
    check('⑦ 402 는 행을 늘리지 않는다', (await alerts(unit, 'ai_cap')).length === 2);
    await sweep();
    ai = await alerts(unit, 'ai_cap');
    check('⑦ AI 알림도 스윕이 선점·사장 1명', ai.every((x) => !!x.claimed_at && x.recipients === 1), JSON.stringify(ai));

    // ⑧ 기본 야간 방해금지(0194) — 개인 방해금지를 안 켠 매장은 새벽엔 선점 안 함(별도 매장 — 앞 주기와 안 섞이게)
    const N = await signUp('owner', 'QA야간사장');
    const { data: csN, error: ceN } = await N.c.rpc('create_store', { p_store_name: 'QA 야간점', p_industry: '카페·디저트', p_biz_no: null });
    if (ceN) throw new Error(`create_store 실패: ${ceN.message}`);
    const unitN = csN[0].unit_id;
    await adminActivate(unitN, 30, 'single');
    for (let i = 1; i <= 4; i++) {
      const j = await signUp('junior', `QA야간직원${i}`);
      const { error: je } = await j.c.rpc('join_by_invite', { p_code: csN[0].invite_code });
      if (je) throw new Error(`join_by_invite 실패: ${je.message}`);
      const { error: ae } = await N.c.rpc('approve_member', { p_uid: j.uid });
      if (ae) throw new Error(`approve_member 실패: ${ae.message}`);
    }
    await expire(unitN);

    await sweepAt(kstToday(2, 30)); // 새벽 2:30 — 회차·1회차 행은 생기지만 선점은 안 된다
    let na = await alerts(unitN, 'seat_lock');
    check('⑧ 새벽엔 알림 행이 생겨도 선점 안 됨', na.length === 1 && !na[0].claimed_at, JSON.stringify(na));

    await sweepAt(kstToday(2, 35)); // 야간 재실행에도 그대로 미선점(유실도 중복도 아님)
    na = await alerts(unitN, 'seat_lock');
    check('⑧ 야간 재실행에도 선점 안 됨', na.length === 1 && !na[0].claimed_at, JSON.stringify(na));

    await sweepAt(kstToday(9, 0)); // 낮이 되면 큐에 남아 있던 알림을 그대로 보낸다 — 유실 없음
    na = await alerts(unitN, 'seat_lock');
    check('⑧ 낮이 되면 선점됨(유실 없음)', na.length === 1 && !!na[0].claimed_at, JSON.stringify(na));

    // ⑨ 사장이 방해금지를 직접 켠 매장은 기본 야간 차단에서 빠진다 — 개인 설정이 기본값을 이긴다
    const P = await signUp('owner', 'QA개인설정사장');
    const { data: csP, error: ceP } = await P.c.rpc('create_store', { p_store_name: 'QA 개인설정점', p_industry: '카페·디저트', p_biz_no: null });
    if (ceP) throw new Error(`create_store 실패: ${ceP.message}`);
    const unitP = csP[0].unit_id;
    await adminActivate(unitP, 30, 'single');
    for (let i = 1; i <= 4; i++) {
      const j = await signUp('junior', `QA개인직원${i}`);
      const { error: je } = await j.c.rpc('join_by_invite', { p_code: csP[0].invite_code });
      if (je) throw new Error(`join_by_invite 실패: ${je.message}`);
      const { error: ae } = await P.c.rpc('approve_member', { p_uid: j.uid });
      if (ae) throw new Error(`approve_member 실패: ${ae.message}`);
    }
    const { error: prefErr } = await P.c.rpc('save_unit_member_prefs', {
      p_unit_id: unitP, p_nickname: null, p_color: null, p_muted: false,
      p_quiet_enabled: true, p_quiet_start: '01:00', p_quiet_end: '05:00',
    });
    if (prefErr) throw new Error(`save_unit_member_prefs 실패: ${prefErr.message}`);
    await expire(unitP);

    await sweepAt(kstToday(2, 30)); // 자기 방해금지 시간(01:00~05:00) 안이라도 기본 차단은 안 걸린다
    const pa = await alerts(unitP, 'seat_lock');
    check('⑨ 방해금지를 직접 켠 매장은 새벽에도 즉시 선점', pa.length === 1 && !!pa[0].claimed_at, JSON.stringify(pa));

    // ⑩ 닫힌 매장 직원 알림(0196 sweep_unit_closures) — 같은 크론 틱에서 돈다. 멱등 = 두 번 돌려도 1행.
    //    unitP 는 만료돼 무료다. 사장 P 에게 유료 매장이 하나 생기면(★0196 규칙) unitP 는 잠긴다 = 이전 매장.
    const { error: slotErr } = await admin.from('store_slots').insert({ owner_id: P.uid, paid_until: new Date(Date.now() + 30 * 864e5).toISOString(), claim_id: null, source: 'grant' });
    if (slotErr) throw new Error(`store_slots insert 실패: ${slotErr.message}`);
    const { data: csQ, error: ceQ } = await P.c.rpc('create_store', { p_store_name: 'QA 유료점', p_industry: '카페·디저트', p_biz_no: null });
    if (ceQ) throw new Error(`create_store(유료점) 실패: ${ceQ.message}`);
    const { data: lockedP } = await P.c.rpc('unit_access_locked', { p_unit: unitP });
    check('⑩ 유료 매장이 생기자 무료 매장은 잠긴다(이전 매장)', lockedP === true, `locked=${lockedP}`);
    const closures = async () => {
      const { data, error } = await admin.from('unit_closure_alerts').select('id, closed_key, title, claimed_at, recipients').eq('unit_id', unitP).order('id');
      if (error) throw new Error(`unit_closure_alerts 읽기 실패: ${error.message}`);
      return data ?? [];
    };
    const sw1 = await sweep();
    let cl = await closures();
    check('⑩ 잠김 → 직원 알림 1행 · 선점됨', cl.length === 1 && !!cl[0].claimed_at, JSON.stringify(cl));
    check('⑩ 문구 = "○○점 이용이 끝났어요"', /QA 개인설정점 이용이 끝났어요/.test(cl[0]?.title ?? ''), cl[0]?.title);
    check('⑩ 수신자 = 직원 4명(사장 제외)', cl[0]?.recipients === 4, `recipients=${cl[0]?.recipients} sweep=${JSON.stringify(sw1?.closureSwept)}`);
    await sweep();
    cl = await closures();
    check('⑩ 재실행 멱등 — 같은 닫힘에 두 번 보내지 않는다', cl.length === 1, `rows=${cl.length}`);
    // 다시 열렸다 또 닫히면(만료일이 달라짐) 새 행 = 다시 한 번만.
    await adminActivate(unitP, 30, 'multi');
    await sweep();
    check('⑩ 다시 열리면 행이 늘지 않는다', (await closures()).length === 1);
    await expire(unitP);
    await sweep();
    await sweep();
    cl = await closures();
    check('⑩ 다시 닫히면 새 닫힘으로 1행 더(총 2행)', cl.length === 2 && cl.every((x) => !!x.claimed_at), JSON.stringify(cl.map((x) => x.closed_key)));
    void csQ;
  } finally {
    await restore();
    console.log('  … app_config 원복');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main()
  .catch(async (e) => { console.error('FATAL:', e?.message ?? e); fail += 1; await restore(); })
  .finally(async () => {
    for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
    await cleanupSeededPhones(URL, SERVICE, seededPhones);
    process.exit(fail === 0 ? 0 : 1);
  });
