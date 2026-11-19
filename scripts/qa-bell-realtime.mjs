#!/usr/bin/env node
// qa-bell-realtime.mjs — 벨 원천 표 실시간(세션 C · C1 · 0900 · 2026-11-19) 증명 · 로컬 도커 전용 · 격리 매장 · 자가정리
//
// 사용자 결정(2026-11-19): "바로 와야 해." 앱을 켠 채로 직원 합류함·나감·인원 초과·매니저 지정·근무 변경·입금 결과가 벨에 뜬다.
// 세 묶음:
//   C  코드(정적) — 구독 함수가 그 표·그 이벤트를 듣는다 · DELETE 는 안 듣는다 · 레이아웃 한 곳에서 건다
//   P  publication — 세 표가 supabase_realtime 멤버 · 앱이 구독하는 표 전부 ⊂ publication(⑤)
//   R  실세션 실시간(격리 매장 둘 · 사장 둘) — 합류·나감·사장 알림·입금 결과가 내 매장 사장에게 10초 안에 온다 · 남의 매장 사장에게는 안 간다
// 수정 전(0900 전 DB · origin/main 코드)이면 C·P·R 이 RED 다.
// 실행: node scripts/qa-bell-realtime.mjs --local      (--local 이 없으면 멈춘다 · 라이브 금지 · AI 호출 0회 · 엣지 안 씀)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localEnv, makeLocal, makeWorld, cleanupWorld, ok } from './lib/qa-fz-local.mjs';
import { joinAsStaff } from './lib/qa-staff.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, okk, extra = '') => { if (okk) pass++; else fail++; console.log(`  ${okk ? 'PASS' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); };
async function test(name, fn) {
  try { const r = await fn(); check(name, r !== false); }
  catch (e) { check(name, false, (e && e.message ? e.message : String(e)).split('\n')[0]); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// ══ C 코드 ══
console.log('— C 코드(정적) —');
const db = read('src/lib/db.ts');
const fnBody = (name) => { const i = db.indexOf(`export function ${name}(`); return i < 0 ? '' : db.slice(i, db.indexOf('\n}\n', i)); };
const listens = (body, table) => [...body.matchAll(new RegExp(`event: '([A-Z*]+)', schema: 'public', table: '${table}'`, 'g'))].map((m) => m[1]);
await test('C1 근무표 구독이 member_notices INSERT 를 듣는다(DELETE·* 는 안 듣는다)', () => {
  const ev = listens(fnBody('subscribeSchedule'), 'member_notices');
  if (ev.join() !== 'INSERT') throw new Error(`events=${ev.join() || '없음'}`);
});
await test('C2 subscribeOwnerAlerts = owner_alerts INSERT 만', () => {
  const ev = listens(fnBody('subscribeOwnerAlerts'), 'owner_alerts');
  if (ev.join() !== 'INSERT') throw new Error(`events=${ev.join() || '없음'}`);
});
await test('C3 subscribePaymentClaims = payment_claims INSERT·UPDATE(DELETE 없음)', () => {
  const ev = listens(fnBody('subscribePaymentClaims'), 'payment_claims').sort();
  if (ev.join() !== 'INSERT,UPDATE') throw new Error(`events=${ev.join() || '없음'}`);
});
await test('C4 사장 레이아웃이 두 스토어 구독을 걸고 푼다 · 화면은 안 건다', () => {
  const lay = read('src/app/owner/_layout.tsx');
  if (!/useOwnerAlertStore\.getState\(\)\.subscribe\(\)/.test(lay) || !/usePaymentClaimStore\.getState\(\)\.subscribe\(\)/.test(lay)) throw new Error('레이아웃 구독 없음');
  if (!/offOa\(\);/.test(lay) || !/offPc\(\);/.test(lay)) throw new Error('해제 없음');
});

// ══ P publication ══
const env = localEnv();
const L = makeLocal(env);
console.log('— P publication —');
// 앱이 구독하는 표 전수 = db.ts 의 table 리터럴 + WORK_TABLES. 0900 자가점검 목록과 같은 출처다.
const subscribed = new Set([...db.matchAll(/table: '([a-z_]+)'/g)].map((m) => m[1]));
const work = db.match(/const WORK_TABLES[^=]*=\s*\[([^\]]+)\]/)?.[1] ?? '';
for (const m of work.matchAll(/'([a-z_]+)'/g)) subscribed.add(m[1]);
const pub = new Set(L.psql(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`).split('\n').map((s) => s.trim()).filter(Boolean));
await test('P1 member_notices · owner_alerts · payment_claims 가 publication 멤버', () => {
  const miss = ['member_notices', 'owner_alerts', 'payment_claims'].filter((t) => !pub.has(t));
  if (miss.length) throw new Error(`빠짐 ${miss.join(',')}`);
});
await test(`P2 앱이 구독하는 표 ${subscribed.size}개 ⊂ publication(⑤)`, () => {
  const miss = [...subscribed].filter((t) => !pub.has(t));
  if (miss.length) throw new Error(`빠짐 ${miss.join(',')}`);
});

// ══ R 실세션 실시간 ══
console.log('— R 실세션 실시간(격리 매장 둘) —');
const worlds = [];
try {
  const A = await makeWorld(L, env, { tag: 'bra', staffN: 1, joinN: 0 });
  worlds.push(A);
  const B = await makeWorld(L, env, { tag: 'brb', staffN: 1, joinN: 0 });
  worlds.push(B);

  // 구독자: A 사장 · B 사장(격리 확인용). 앱과 같은 필터 없는 구독(RLS 만 거른다).
  const listen = async (who, tag) => {
    await who.c.realtime.setAuth();
    const got = [];
    const push = (t) => (p) => got.push({ t, ev: p.eventType, row: p.new ?? {} });
    await new Promise((resolve, reject) => {
      who.c.channel(`${tag}_${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_notices' }, push('member_notices'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'owner_alerts' }, push('owner_alerts'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payment_claims' }, push('payment_claims'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payment_claims' }, push('payment_claims'))
        .subscribe((st) => { if (st === 'SUBSCRIBED') resolve(); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') reject(new Error(`구독 ${st}`)); });
    });
    return got;
  };
  // B 직원은 먼저 합류해 둔다 — R7(근무 변경 알림을 받는 쪽 = 직원)에 쓴다.
  await joinAsStaff(B.staff[0].c, B.code);
  await ok(B.staff[0].c.rpc('switch_active_unit', { p_unit_id: B.unit }), 'switch B staff');
  const gotA = await listen(A.owner, 'bra');
  const gotB = await listen(B.owner, 'brb');
  const gotBs = await listen(B.staff[0], 'brs');
  await sleep(2000); // 구독 등록이 서버에 닿을 시간
  const waitFor = async (got, pred) => { for (let i = 0; i < 40; i++) { if (got.some(pred)) return true; await sleep(250); } return false; };

  const st = A.staff[0];
  await test('R1 직원 합류 → A 사장이 member_joined 를 10초 안에 받는다', async () => {
    await joinAsStaff(st.c, A.code);
    await ok(st.c.rpc('switch_active_unit', { p_unit_id: A.unit }), 'switch staff');
    if (!(await waitFor(gotA, (e) => e.t === 'member_notices' && e.row.kind === 'member_joined' && e.row.unit_id === A.unit))) {
      throw new Error(`못 받음(받은 ${gotA.length}: ${gotA.map((e) => e.t + ':' + (e.row.kind ?? e.ev)).join(',') || '없음'})`);
    }
  });
  await test('R2 직원 나감 → A 사장이 left 를 10초 안에 받는다', async () => {
    await ok(st.c.rpc('leave_store'), 'leave_store');
    if (!(await waitFor(gotA, (e) => e.t === 'member_notices' && e.row.kind === 'left' && e.row.unit_id === A.unit))) {
      throw new Error(`못 받음(받은 ${gotA.length}: ${gotA.map((e) => e.t + ':' + (e.row.kind ?? e.ev)).join(',') || '없음'})`);
    }
  });
  await test('R3 사장 알림 새 회차 → A 사장이 10초 안에 받는다', async () => {
    await ok(L.admin.from('owner_alerts').insert({ unit_id: A.unit, kind: 'ai_cap', period: '2099-01', step: 80, title: 'QA 사용량', body: 'QA' }), 'owner_alerts insert');
    if (!(await waitFor(gotA, (e) => e.t === 'owner_alerts' && e.row.unit_id === A.unit))) throw new Error(`못 받음(받은 ${gotA.length})`);
  });
  await test('R4 입금 신고 확인(상태 UPDATE) → A 사장이 10초 안에 받는다', async () => {
    const row = await ok(L.admin.from('payment_claims').insert({ unit_id: A.unit, claimed_by: A.owner.id, plan: 'single', amount_krw: 1, depositor_name: 'QA' }).select('id').single(), 'payment_claims insert');
    await ok(L.admin.from('payment_claims').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: 'qa' }).eq('id', row.id), 'payment_claims update');
    if (!(await waitFor(gotA, (e) => e.t === 'payment_claims' && e.ev === 'UPDATE' && e.row.status === 'approved' && e.row.id === row.id))) throw new Error(`못 받음(받은 ${gotA.length})`);
  });
  // 근무를 바꾼 뒤 따로 부르는 notify_shift_changed(useScheduleStore notifyShiftChanged)가 넣는 행 → 받는 직원이 그 INSERT 로 다시 읽는다.
  //   예전엔 근무 표 이벤트로 hydrate 가 먼저 돌아 이 행을 못 읽을 수 있었다(점검 목록 1번). 이제 이 INSERT 가 한 번 더 읽게 한다.
  await test('R7 근무 변경 알림(shift_changed) → 받는 직원이 10초 안에 받는다 · 사장은 안 받는다', async () => {
    const r = await ok(B.owner.c.rpc('notify_shift_changed', { p_staff: B.staff[0].id, p_date: new Date().toISOString().slice(0, 10), p_onward: false }), 'notify_shift_changed');
    if (r !== true) throw new Error(`notify_shift_changed = ${r}`);
    if (!(await waitFor(gotBs, (e) => e.t === 'member_notices' && e.row.kind === 'shift_changed' && e.row.unit_id === B.unit))) throw new Error(`못 받음(받은 ${gotBs.length})`);
    if (gotB.some((e) => e.row.kind === 'shift_changed')) throw new Error('사장이 직원 행을 받았다');
  });
  await sleep(1500); // 늦게 오는 이벤트까지 기다린 뒤 격리를 본다
  await test('R5 격리: B 사장은 A 매장 행을 하나도 못 받는다(RLS)', () => {
    const leak = gotB.filter((e) => e.row.unit_id === A.unit || e.row.claimed_by === A.owner.id);
    if (leak.length) throw new Error(`샘 ${leak.length}: ${leak.map((e) => e.t).join(',')}`);
  });
  await test('R6 격리: A 사장은 직원 본인 행(남의 member_notices)을 못 받는다', () => {
    const others = gotA.filter((e) => e.t === 'member_notices' && e.row.user_id && e.row.user_id !== A.owner.id);
    if (others.length) throw new Error(`샘 ${others.length}: ${others.map((e) => e.row.kind).join(',')}`);
  });
  await A.owner.c.removeAllChannels();
  await B.owner.c.removeAllChannels();
  await B.staff[0].c.removeAllChannels();
} catch (e) {
  check('셋업', false, String(e?.message ?? e).split('\n')[0]);
} finally {
  const cl = await cleanupWorld(L, env, worlds).catch((e) => ({ left: `정리 실패 ${e.message}` }));
  check('정리: 남은 행 0', cl.left === 0, `남은 ${cl.left}`);
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — pass ${pass} · fail ${fail} · skip 0 · AI 호출 0회`);
process.exit(fail ? 1 : 0);
