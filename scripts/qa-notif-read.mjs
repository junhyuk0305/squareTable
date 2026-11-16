#!/usr/bin/env node
// qa-notif-read.mjs — 알림 읽음 규칙 하나(2026-11-16 · 실측 R-13 · 0810) 증명 · 로컬 도커 전용 · 자가정리
//
// 규칙(사용자 결정 2026-11-16):
//   알림 줄은 자기 자리(매장·공간)가 있다. 자리마다 읽은 시각이 하나다. 그 시각 뒤에 온 줄만 안 읽음이다.
//   허브가 맨 위다. 허브에서 읽으면 매장·공간에서도 읽은 것. 매장에서 읽으면 허브에서도 그 매장 줄은 읽은 것.
//   앱 배지 = 허브 숫자. 다른 기기에는 실시간으로 반영한다.
//
// 세 묶음:
//   P  판정(순수 · src TS 를 그대로 읽는다) — 공간 줄은 그 공간 시각만 · 합류 결과는 그 줄 자리 · 매장 안 합류 결과 = 그 매장 것만
//   S  스토어(markAllSeen · db 모의) — 서버 시각으로 바꾼다(기기 시계 아님) · 성공 뒤에만 성공 문구 · 실패면 그대로
//   B  서버(실세션 · 고정 QA 계정) — 매장 0개 공간 주인 · 여러 매장 사장의 다른 매장 멘션 · 멤버 아닌 자리 · 입력 검증 · RLS · 실시간
//
// 고정 계정의 읽은 시각(notif_seen · unit_member_prefs.notif_ack_at)은 시작 전에 적어 두고 끝나면 되돌린다(미리보기 상태 보존).
// 실행: node scripts/qa-notif-read.mjs --local      (--local 이 없으면 멈춘다 · 라이브 금지)
// 수정 전(origin/main 코드)이면 P·S 가 RED 다(ackOfUnit·markAllSeen 이 없다).
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { localEnv } from './lib/qa-fz-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); };
async function test(name, fn) {
  try { const r = await fn(); check(name, r !== false); }
  catch (e) { check(name, false, (e && e.message ? e.message : String(e)).split('\n')[0]); }
}

// ── TS 를 그대로 읽는 작은 로더(qa-race-client 와 같은 방식) · 무거운 의존은 빈 모의로 둔다 ──
const deep = new Proxy(function () {}, { get: (_t, k) => (k === '__esModule' ? false : k === Symbol.toPrimitive ? () => '' : deep), apply: () => deep });
const resolveSrc = (p) => { for (const c of [p + '.ts', p + '.tsx', p + '/index.ts', p]) if (existsSync(path.join(root, c)) && statSync(path.join(root, c)).isFile()) return c; throw new Error('파일 없음: ' + p); };
function load(p, real, mocks, cache = new Map()) {
  if (cache.has(p)) return cache.get(p).exports;
  const mod = { exports: {} };
  cache.set(p, mod);
  const src = ts.transpileModule(readFileSync(path.join(root, p), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) { const f = resolveSrc('src/' + name.slice(2)); return real.has(f) ? load(f, real, mocks, cache) : deep; }
    if (name.startsWith('.')) { const f = resolveSrc(path.posix.normalize(path.posix.join(path.posix.dirname(p), name))); return real.has(f) ? load(f, real, mocks, cache) : deep; }
    return req(name);
  };
  vm.runInNewContext(src, { require: localRequire, module: mod, exports: mod.exports, console, Date, Map, Set, Promise, setTimeout, clearTimeout, __DEV__: false }, { filename: p });
  return mod.exports;
}
const tsMsMock = { tsMs: (s) => Date.parse(s), todayStr: () => '2026-11-16' };
const T0 = '2026-11-16T01:00:00.000Z', T1 = '2026-11-16T02:00:00.000Z', T2 = '2026-11-16T03:00:00.000Z';

// ══ P 판정 ══
console.log('— P 판정(순수) —');
const real = new Set(['src/lib/utils/notifications.ts', 'src/lib/utils/spaceNotifications.ts']);
const N = load('src/lib/utils/notifications.ts', real, { '@/lib/utils/attendance': tsMsMock });
const SN = load('src/lib/utils/spaceNotifications.ts', real, { '@/lib/utils/attendance': tsMsMock });
await test('P1 공간 줄은 그 공간의 읽은 시각만 본다(매장 시각이 늦어도 안 꺼진다)', () => {
  const raw = [{ unitId: 'sp1', source: 'space_question', payload: { id: 'q1', asked_at: T1, junior_name: '손님' } }];
  const byStore = SN.buildSpaceNotifRows(raw, N.ackOfUnit({ st1: T2 }));
  const bySpace = SN.buildSpaceNotifRows(raw, N.ackOfUnit({ sp1: T2 }));
  if (byStore[0]?.unread !== true) throw new Error('매장 시각이 공간 줄을 껐다');
  if (bySpace[0]?.unread !== false) throw new Error('공간 시각이 공간 줄을 못 껐다');
});
await test('P2 매장 0개 계정도 그 자리 시각이 있으면 꺼진다(예전 = 매장 ack 최대값 → 0개면 영원히 안 읽음)', () => {
  const raw = [{ unitId: 'sp1', source: 'space_deleted', payload: { id: '9', created_at: T1, title: '공간이 삭제됐어요' } }];
  if (SN.buildSpaceNotifRows(raw, N.ackOfUnit({}))[0]?.unread !== true) throw new Error('시각 없음인데 읽음');
  if (SN.buildSpaceNotifRows(raw, N.ackOfUnit({ sp1: T2 }))[0]?.unread !== false) throw new Error('자리 시각이 못 껐다');
});
await test('P3 합류 결과는 그 줄 자리(반려한 매장)의 시각만 본다', () => {
  const notices = [{ id: 1, unit_id: 'B', kind: 'rejected', store_name: 'B점', body: '', created_at: T1 }];
  if (N.buildJoinNotifRows(notices, N.ackOfUnit({ A: T2 }))[0]?.unread !== true) throw new Error('다른 매장 시각이 껐다');
  if (N.buildJoinNotifRows(notices, N.ackOfUnit({ B: T2 }))[0]?.unread !== false) throw new Error('그 자리 시각이 못 껐다');
});
await test('P4 매장 안 화면의 합류 결과 = 그 매장 것만(다른 자리 것은 허브)', () => {
  const ns = [{ unit_id: 'A' }, { unit_id: 'B' }, { unit_id: 'A' }];
  const a = N.joinNoticesOfUnit(ns, 'A');
  if (a.length !== 2 || N.joinNoticesOfUnit(ns, null).length !== 0) throw new Error(`A=${a.length}`);
});
await test('P5 읽은 시각과 같거나 앞선 줄은 읽음 · 뒤는 안 읽음', () =>
  N.isAfterAck(T1, T1) === false && N.isAfterAck(T0, T1) === false && N.isAfterAck(T2, T1) === true && N.isAfterAck(T1, null) === true);

// ══ S 스토어 ══
console.log('— S 스토어(markAllSeen · db 모의) —');
function setupPrefs(dbImpl) {
  const toasts = [];
  const calls = [];
  const db = new Proxy({}, { get: (_t, n) => (n === '__esModule' ? undefined : (...a) => { calls.push({ n, a }); return dbImpl[n] ? dbImpl[n](...a) : Promise.resolve({ data: [], error: null }); }) });
  const mod = load('src/lib/store/useMemberPrefsStore.ts', new Set(['src/lib/store/useMemberPrefsStore.ts', 'src/lib/store/tenantEpoch.ts']), {
    '@/lib/db': db, '@/lib/supabase': { HAS_SUPABASE: true }, '@/lib/utils/attendance': tsMsMock,
    '@/lib/store/useToastStore': { showToast: (m, tone) => toasts.push({ m, tone }) },
  });
  return { s: mod.useMemberPrefsStore, toasts, calls };
}
const SERVER_AT = '2020-01-01T00:00:00.000Z'; // 기기 시계와 일부러 멀다 → 기기 시계를 쓰면 바로 드러난다
await test('S1 성공 = 보낸 자리 전부를 서버 시각으로 · 성공 문구는 저장 뒤 한 번', async () => {
  let resolve;
  const { s, toasts, calls } = setupPrefs({ markNotifsSeen: () => new Promise((r) => { resolve = r; }) });
  const p = s.getState().markAllSeen(['A', 'sp1', 'A'], ['f1']);
  await new Promise((r) => setTimeout(r, 0));
  if (toasts.length !== 0) throw new Error('저장 전에 문구가 떴다');
  if (s.getState().ackByUnit.A) throw new Error('저장 전에 로컬을 바꿨다(기기 시계)');
  resolve(SERVER_AT);
  const ok = await p;
  const a = s.getState().ackByUnit;
  if (!ok || a.A !== SERVER_AT || a.sp1 !== SERVER_AT) throw new Error(JSON.stringify(a));
  const sent = calls.find((c) => c.n === 'markNotifsSeen')?.a;
  if (JSON.stringify(sent) !== JSON.stringify([['A', 'sp1'], ['f1']])) throw new Error('보낸 값 ' + JSON.stringify(sent));
  if (toasts.length !== 1 || toasts[0].tone !== 'good') throw new Error(JSON.stringify(toasts));
});
await test('S2 실패 = 로컬 그대로 · 실패 문구만(성공 문구 없음)', async () => {
  const { s, toasts } = setupPrefs({ markNotifsSeen: async () => null });
  s.setState({ ackByUnit: { A: T0 } });
  const ok = await s.getState().markAllSeen(['A'], []);
  if (ok || s.getState().ackByUnit.A !== T0) throw new Error('바뀜');
  if (toasts.length !== 1 || toasts[0].tone !== 'warn') throw new Error(JSON.stringify(toasts));
});
await test('S3 실시간 반영(applySeen)은 늦은 값만 받는다', () => {
  const { s } = setupPrefs({});
  s.setState({ ackByUnit: { A: T1 } });
  s.getState().applySeen('A', T0);
  if (s.getState().ackByUnit.A !== T1) throw new Error('뒤로 갔다');
  s.getState().applySeen('A', T2);
  s.getState().applySeen('B', T1);
  return s.getState().ackByUnit.A === T2 && s.getState().ackByUnit.B === T1;
});
await test('S4 불러오기 = 자리마다 max(0078 notif_ack_at, 0810 seen_at) · 멤버 아닌 자리도', async () => {
  const { s } = setupPrefs({
    fetchMemberPrefs: async () => ({ data: [{ unit_id: 'A', nickname: null, color: null, muted: false, quiet_enabled: false, quiet_start: '22:00', quiet_end: '08:00', notif_ack_at: T2 }], error: null }),
    fetchNotifSeen: async () => ({ data: [{ unit_id: 'A', seen_at: T1 }, { unit_id: 'B', seen_at: T1 }], error: null }),
  });
  await s.getState().hydrate();
  const a = s.getState().ackByUnit;
  if (a.A !== T2 || a.B !== T1) throw new Error(JSON.stringify(a));
});

// ══ B 서버(로컬 실세션) ══
console.log('— B 서버(로컬 · 실세션) —');
const env = localEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const psql = (sql) => execFileSync('docker', ['exec', '-i', env.DB_CONTAINER, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
async function signIn(email) {
  const c = createClient(env.URL_, env.ANON, opts);
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'QaTest1234!' });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return { c, uid: data.user.id };
}
const EMAILS = ['qa.space@example.com', 'qa.owner@example.com', 'qa.staff1@example.com'];
const uidsSql = EMAILS.map((e) => `'${e}'`).join(',');
// 되돌릴 값 적어 두기
const snap = JSON.parse(psql(`select coalesce(json_build_object(
  'seen', (select coalesce(json_agg(s), '[]') from notif_seen s join auth.users a on a.id = s.user_id where a.email in (${uidsSql})),
  'ack',  (select coalesce(json_agg(json_build_object('user_id', p.user_id, 'unit_id', p.unit_id, 'notif_ack_at', p.notif_ack_at)), '[]') from unit_member_prefs p join auth.users a on a.id = p.user_id where a.email in (${uidsSql})),
  'prefs_keys', (select coalesce(json_agg(json_build_object('user_id', p.user_id, 'unit_id', p.unit_id)), '[]') from unit_member_prefs p join auth.users a on a.id = p.user_id where a.email in (${uidsSql}))
), '{}')`));
const tag = 'qanr' + String(Date.now()).slice(-7);
let space, owner, staff;
try {
  space = await signIn('qa.space@example.com');
  owner = await signIn('qa.owner@example.com');
  staff = await signIn('qa.staff1@example.com');
} catch (e) { console.log('  SKIP B 전체 · ' + e.message + ' (seed-demo · qa-local-accounts 먼저)'); skip++; }

if (space && owner && staff) {
  const spaceId = psql(`select m.unit_id from unit_members m join units u on u.id = m.unit_id where m.user_id = '${space.uid}' and u.kind = 'space' and u.deleted_at is null limit 1`);
  const ownerUnits = psql(`select string_agg(m.unit_id, ',' order by m.unit_id) from unit_members m join units u on u.id = m.unit_id where m.user_id = '${owner.uid}' and u.kind = 'store' and u.deleted_at is null`).split(',').filter(Boolean);
  const ownerActive = psql(`select unit_id from profiles where id = '${owner.uid}'`);
  const ownerOther = ownerUnits.find((u) => u !== ownerActive);
  const staffUnits = psql(`select coalesce(string_agg(unit_id, ','), '') from unit_members where user_id = '${staff.uid}'`).split(',').filter(Boolean);
  const notStaffUnit = ownerUnits.find((u) => !staffUnits.includes(u));
  const seenOf = (uid, unit) => psql(`select coalesce((select seen_at::text from notif_seen where user_id = '${uid}' and unit_id = '${unit}'), '')`);
  const ackOf = (uid, unit) => psql(`select coalesce((select notif_ack_at::text from unit_member_prefs where user_id = '${uid}' and unit_id = '${unit}'), '')`);
  const qid = `${tag}_q`, fid = `${tag}_f`;
  try {
    await test('B1 매장 0개 공간 주인: 안 읽은 공간 줄 → 허브 전체 읽음(그 공간 자리) → 꺼짐', async () => {
      if (!spaceId) throw new Error('qa.space 공간 없음');
      if (psql(`select count(*) from unit_members m join units u on u.id = m.unit_id where m.user_id = '${space.uid}' and u.kind = 'store'`) !== '0') throw new Error('qa.space 가 매장을 가졌다(전제 깨짐)');
      psql(`insert into unknown_queries (id, unit_id, query_text, status, asked_at) values ('${qid}', '${spaceId}', 'QA 읽음 하니스 질문', 'pending_owner_answer', now())`);
      const rows = (await space.c.rpc('my_space_notif_data')).data ?? [];
      const mine = rows.filter((r) => (r.unit_id ?? r.unitId) === spaceId);
      if (!mine.some((r) => JSON.stringify(r).includes(qid))) throw new Error('공간 줄이 안 왔다');
      const prefs = (await space.c.from('unit_member_prefs').select('unit_id, notif_ack_at')).data ?? [];
      const seen = (await space.c.from('notif_seen').select('unit_id, seen_at')).data ?? [];
      const byUnit = {};
      for (const p of prefs) byUnit[p.unit_id] = p.notif_ack_at;
      for (const s of seen) if (!byUnit[s.unit_id] || Date.parse(s.seen_at) > Date.parse(byUnit[s.unit_id])) byUnit[s.unit_id] = s.seen_at;
      const raw = [{ unitId: spaceId, source: 'space_question', payload: { id: qid, asked_at: new Date().toISOString(), junior_name: '손님' } }];
      if (SN.buildSpaceNotifRows(raw, N.ackOfUnit(byUnit))[0]?.unread !== true) throw new Error('전제: 안 읽음이어야 한다');
      const { data: at, error } = await space.c.rpc('mark_notifs_seen', { p_unit_ids: [spaceId], p_feed_ids: [] });
      if (error || typeof at !== 'string') throw new Error('rpc ' + (error?.message ?? typeof at));
      const s2 = seenOf(space.uid, spaceId);
      if (!s2) throw new Error('notif_seen 없음');
      const askedAt = psql(`select asked_at::text from unknown_queries where id = '${qid}'`);
      if (SN.buildSpaceNotifRows([{ ...raw[0], payload: { ...raw[0].payload, asked_at: askedAt } }], N.ackOfUnit({ [spaceId]: at }))[0]?.unread !== false) throw new Error('안 꺼짐');
      // 공간 주인은 그 공간 멤버라 0078 축도 같이 옮긴다(옛 앱 기기 호환)
      if (!ackOf(space.uid, spaceId)) throw new Error('0078 축 안 옮김');
    });
    await test('B2 돌려주는 시각 = 서버 시각(DB now 와 2초 안)', async () => {
      const { data: at } = await space.c.rpc('mark_notifs_seen', { p_unit_ids: [spaceId], p_feed_ids: [] });
      const dbNow = Date.parse(psql('select now()::text'));
      return Math.abs(Date.parse(at) - dbNow) < 2000;
    });
    await test('B3 여러 매장 사장: 활성 아닌 매장 멘션 read_by 도 쓴다(옛 mark_all_feed_read 는 0)', async () => {
      if (!ownerOther) throw new Error('qa.owner 두 번째 매장 없음');
      psql(`insert into work_feed (id, unit_id, feed_date, data, mentions) values ('${fid}', '${ownerOther}', current_date, '{"kind":"message","text":"@사장 QA 읽음"}'::jsonb, array['${owner.uid}'])`);
      const old = await owner.c.rpc('mark_all_feed_read', { p_feed_ids: [fid] });
      if (old.data !== 0) throw new Error('옛 함수가 다른 매장 줄을 셌다 = 전제 바뀜 ' + old.data);
      const { error } = await owner.c.rpc('mark_notifs_seen', { p_unit_ids: ownerUnits, p_feed_ids: [fid] });
      if (error) throw new Error(error.message);
      const rb = psql(`select (data->'read_by') @> to_jsonb('${owner.uid}'::text) from work_feed where id = '${fid}'`);
      if (rb !== 't') throw new Error('read_by 안 씀');
      for (const u of ownerUnits) if (!seenOf(owner.uid, u) || !ackOf(owner.uid, u)) throw new Error('자리 시각 빠짐 ' + u);
    });
    await test('B4 매장 화면 전체 읽음 = 그 매장 자리만(다른 매장 시각은 그대로)', async () => {
      const before = seenOf(owner.uid, ownerOther);
      await new Promise((r) => setTimeout(r, 30));
      const { error } = await owner.c.rpc('mark_notifs_seen', { p_unit_ids: [ownerActive], p_feed_ids: [] });
      if (error) throw new Error(error.message);
      return seenOf(owner.uid, ownerOther) === before && seenOf(owner.uid, ownerActive) > before;
    });
    await test('B5 멤버 아닌 자리 = 내 읽은 시각만(0078 멤버 설정 행은 안 만든다) · 없는 자리는 건너뜀', async () => {
      if (!notStaffUnit) throw new Error('직원이 멤버가 아닌 매장 없음');
      const { error } = await staff.c.rpc('mark_notifs_seen', { p_unit_ids: [notStaffUnit, `${tag}_none`], p_feed_ids: [] });
      if (error) throw new Error(error.message);
      if (!seenOf(staff.uid, notStaffUnit)) throw new Error('seen 없음');
      if (ackOf(staff.uid, notStaffUnit)) throw new Error('멤버 아닌데 0078 행이 생겼다');
      if (seenOf(staff.uid, `${tag}_none`)) throw new Error('없는 자리를 썼다');
    });
    await test('B6 남의 멘션 read_by 는 못 쓴다(멤버 아닌 매장 줄)', async () => {
      await staff.c.rpc('mark_notifs_seen', { p_unit_ids: [notStaffUnit], p_feed_ids: [fid] });
      return psql(`select (data->'read_by') @> to_jsonb('${staff.uid}'::text) from work_feed where id = '${fid}'`) !== 't';
    });
    await test('B7 입력 검증: 자리 501개 = invalid_argument · 로그인 없음 = 거부', async () => {
      const big = Array.from({ length: 501 }, (_, i) => `x${i}`);
      const r1 = await staff.c.rpc('mark_notifs_seen', { p_unit_ids: big, p_feed_ids: [] });
      const anon = createClient(env.URL_, env.ANON, opts);
      const r2 = await anon.rpc('mark_notifs_seen', { p_unit_ids: [spaceId], p_feed_ids: [] });
      return /invalid_argument/.test(r1.error?.message ?? '') && !!r2.error;
    });
    await test('B8 RLS: 남의 읽은 시각은 안 보인다 · 직접 쓰기는 막힌다', async () => {
      const { data } = await staff.c.from('notif_seen').select('user_id');
      const others = (data ?? []).filter((r) => r.user_id !== staff.uid).length;
      const w = await staff.c.from('notif_seen').insert({ user_id: staff.uid, unit_id: spaceId, seen_at: new Date().toISOString() });
      return others === 0 && !!w.error;
    });
    await test('B9 실시간: 같은 계정 다른 기기에서 전체 읽음 → 이 기기가 10초 안에 받는다', async () => {
      const other = await signIn('qa.space@example.com');
      // 앱 클라는 세션을 저장해 실시간에도 토큰이 붙는다. 하니스 클라는 저장하지 않으므로 구독 전에 직접 붙인다.
      await space.c.realtime.setAuth((await space.c.auth.getSession()).data.session.access_token);
      const events = [];
      const subscribed = new Promise((resolve) => {
        space.c.channel(`${tag}_rt`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'notif_seen', filter: `user_id=eq.${space.uid}` }, (p) => events.push(p.new))
          .subscribe((st) => { if (st === 'SUBSCRIBED') resolve(); });
      });
      await subscribed;
      await new Promise((r) => setTimeout(r, 2000)); // 구독 등록이 서버에 닿을 시간
      const { data: at } = await other.c.rpc('mark_notifs_seen', { p_unit_ids: [spaceId], p_feed_ids: [] });
      // 이번 쓰기의 값(at)이 와야 한다 — 앞선 쓰기가 늦게 와도 통과로 세지 않는다.
      const hit = () => events.some((e) => e.unit_id === spaceId && Date.parse(e.seen_at) === Date.parse(at));
      for (let i = 0; i < 40 && !hit(); i++) await new Promise((r) => setTimeout(r, 250));
      await space.c.removeAllChannels();
      if (!hit()) throw new Error(`10초 안에 못 받음(받은 이벤트 ${events.length})`);
    });
  } finally {
    // 되돌리기 — 넣은 행 지우기 · 읽은 시각 원래대로
    psql(`delete from unknown_queries where id = '${qid}'; delete from work_feed where id = '${fid}';`);
    psql(`delete from notif_seen where user_id in (select id from auth.users where email in (${uidsSql}));`);
    for (const r of snap.seen ?? []) psql(`insert into notif_seen (user_id, unit_id, seen_at) values ('${r.user_id}', '${r.unit_id}', '${r.seen_at}')`);
    const keep = new Set((snap.prefs_keys ?? []).map((k) => `${k.user_id}|${k.unit_id}`));
    const nowKeys = psql(`select coalesce(string_agg(p.user_id || '|' || p.unit_id, ','), '') from unit_member_prefs p join auth.users a on a.id = p.user_id where a.email in (${uidsSql})`).split(',').filter(Boolean);
    for (const k of nowKeys) if (!keep.has(k)) { const [u, unit] = k.split('|'); psql(`delete from unit_member_prefs where user_id = '${u}' and unit_id = '${unit}'`); }
    for (const r of snap.ack ?? []) psql(`update unit_member_prefs set notif_ack_at = ${r.notif_ack_at ? `'${r.notif_ack_at}'` : 'null'} where user_id = '${r.user_id}' and unit_id = '${r.unit_id}'`);
    console.log('  (정리: 질문·멘션 행 지움 · 고정 계정 읽은 시각 되돌림)');
  }
}

const total = pass + fail + skip;
console.log(`\n${fail === 0 && skip === 0 ? 'GREEN' : 'RED'} qa-notif-read — PASS ${pass} · FAIL ${fail} · SKIP ${skip} / ${total} · AI 호출 0회`);
process.exit(fail === 0 && skip === 0 ? 0 : 1);
