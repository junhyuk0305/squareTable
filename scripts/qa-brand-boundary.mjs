// qa-brand-boundary.mjs — 본사(브랜드) 축 경계 하니스: 정본 §3-4 금지 행 = 전부 0행/거부 (2026-09-22)
//
// 본사 담당자(hq@pilot…)의 JWT 로 매장 테이블을 **직접** 읽는다 — 브랜드 축 RLS 정책이 하나도 없으니
// 전부 0행(또는 42501)이어야 한다. 하나라도 행이 나오면 방어선이 뚫린 것이다. 정의자 RPC 를 바꾸면 반드시 다시 돌린다.
//
// 전제: seed-brand-demo.mjs 상태(store_001 ↔ brand_pilot 연결, 요약 공개). 읽기만 하고 아무것도 바꾸지 않는다.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const e = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !e[m[1]]) e[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return e;
}
const env = loadEnv();
// ★대상 DB = .env 의 EXPO_PUBLIC_SUPABASE_URL(라이브). 읽기 전용 하니스라 위험 없음.
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) { console.error('FAIL: URL/ANON 필요(.env)'); process.exit(2); }

const PW = 'pilot1234';
const HQ = 'hq@pilot.squaretable.app';
const OWNER = 'owner@pilot.squaretable.app';
const JUNIOR = 'staff2@pilot.squaretable.app';
const UNIT = 'store_001';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
async function login(email) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return c;
}
// 0행이거나 컬럼 GRANT 차단(42501)이면 막힌 것이다(qa_harness_traps 5번).
const blocked = ({ data, error }) => (error ? error.code === '42501' : (data ?? []).length === 0);

try {
  const H = await login(HQ);
  const O = await login(OWNER);
  const J = await login(JUNIOR);

  console.log('\n① 본사 JWT 의 매장 테이블 직접 읽기 — 전부 0행/42501');
  // ★본사 담당자는 자기 작업실(units.kind='brand_workspace', 0215)의 멤버라 units·unit_members·profiles 에
  //   그 작업실 행을 정상적으로 본다 — 매장이 아니므로 경계 위반이 아니다(brand-boundary 규칙 '작업실 제외 필터').
  //   검사 대상은 '매장'이므로 작업실과 그 소유자를 분모에서 뺀다. id 는 하드코딩하지 않고 유도한다.
  const ws = await H.from('units').select('id, owner_id').eq('kind', 'brand_workspace');
  const wsIds = (ws.data ?? []).map((r) => r.id);
  const wsOwners = (ws.data ?? []).map((r) => r.owner_id);
  const exceptWs = (q, col) => (wsIds.length ? q.not(col, 'in', `(${wsIds.join(',')})`) : q);

  const tables = [
    ['playbook_entries', 'id'], ['training_courses', 'id'],
    ['quiz_items', 'id'], ['knowhow_understanding', 'entry_id'], ['wages', 'staff_id'], ['attendance', 'id'],
    ['work_rooms', 'id'], ['unknown_queries', 'id'], ['chat_queries', 'id'], ['work_feed', 'id'],
    ['unit_subscriptions', 'unit_id'], ['owner_alerts', 'id'],
    ['brands', 'id'], ['brand_members', 'user_id'], ['brand_invites', 'id'], ['brand_units', 'id'], ['brand_events', 'id'],
  ];
  // ★라이브러리 내용(노하우·퀴즈)도 같은 이유로 뺀다 — 담당자가 쓴 본사 노하우는 작업실 행이다(2026-10-02:
  //   화면에서 노하우를 하나 쓰자 ①playbook_entries 가 1행으로 '위반'이 됐다. 매장 행이 아니다).
  const LIBRARY = new Set(['playbook_entries', 'training_courses', 'quiz_items']);
  for (const [t, col] of tables) {
    const q = H.from(t).select(col);
    const r = await (LIBRARY.has(t) ? exceptWs(q, 'unit_id') : q).limit(5);
    check(`①${t} 직접 조회 차단`, blocked(r), r.error ? `${r.error.code} ${r.error.message}` : `${(r.data ?? []).length}행`);
  }
  const un = await H.from('units').select('id').neq('kind', 'brand_workspace').limit(5);
  check('①units 직접 조회 차단(작업실 제외)', blocked(un), un.error ? `${un.error.code} ${un.error.message}` : `${(un.data ?? []).length}행`);
  const um = await exceptWs(H.from('unit_members').select('user_id'), 'unit_id').limit(5);
  check('①unit_members 직접 조회 차단(작업실 제외)', blocked(um), um.error ? `${um.error.code} ${um.error.message}` : `${(um.data ?? []).length}행`);

  const me = (await H.auth.getUser()).data.user.id;
  const pr = await H.from('profiles').select('id, name, phone')
    .not('id', 'in', `(${[me, ...wsOwners].join(',')})`).limit(5);
  check('①profiles(남의 이름·전화) 차단', blocked(pr), pr.error ? pr.error.code : `${(pr.data ?? []).length}행`);

  console.log('\n② 수준별 컬럼 — 요약(store_001)');
  const ov = await H.rpc('brand_overview');
  const row = (ov.data ?? []).find((r) => r.unit_id === UNIT);
  check('②연결 매장이 보인다', !!row, ov.error?.message ?? '시드 상태 확인: seed-brand-demo.mjs');
  check('②요약 수준: 운영 컬럼 null', !!row && row.visibility === 'summary' && row.tasks_done_30d === null && row.quiz_courses === null, JSON.stringify(row));
  const cols = row ? Object.keys(row) : [];
  const forbidden = ['staff_names', 'phone', 'wage', 'hourly_wage', 'attendance', 'junior_name', 'junior_id', 'score', 'chat'];
  check('②응답에 개인 축 컬럼이 없다', cols.length > 0 && !cols.some((c) => forbidden.some((f) => c.toLowerCase().includes(f))), cols.join(','));
  const ent = await H.rpc('brand_unit_entries', { p_unit_id: UNIT });
  check('②요약 수준: 노하우 본문 0행', !ent.error && (ent.data ?? []).length === 0, ent.error?.message);
  const qs = await H.rpc('brand_unit_questions', { p_unit_id: UNIT });
  check('②요약 수준: 질문 내용 0행', !qs.error && (qs.data ?? []).length === 0, qs.error?.message);

  console.log('\n③ 미연결·다른 브랜드 매장은 어느 RPC 로도 0');
  for (const u of ['store_002_demo', 'store_starter_demo', 'ws_brand_pilot', 'nope_unit']) {
    const e = await H.rpc('brand_unit_entries', { p_unit_id: u });
    const q = await H.rpc('brand_unit_questions', { p_unit_id: u });
    check(`③${u} 본문·질문 0행`, !e.error && !q.error && (e.data ?? []).length === 0 && (q.data ?? []).length === 0, e.error?.message ?? q.error?.message);
  }
  check('③brand_overview 에 다른 브랜드·작업실 없음', !(ov.data ?? []).some((r) => r.unit_id === 'store_002_demo' || String(r.unit_id).startsWith('ws_')));

  console.log('\n④ 담당자 아닌 계정은 본사 RPC 가 닫혀 있다');
  const oo = await O.rpc('brand_overview');
  check('④사장 brand_overview 0행', !oo.error && (oo.data ?? []).length === 0, oo.error?.message);
  const jo = await J.rpc('brand_overview');
  check('④직원 brand_overview 0행', !jo.error && (jo.data ?? []).length === 0, jo.error?.message);
  const oi = await O.rpc('brand_invite_member');
  check('④사장 brand_invite_member 거부', /not_brand_member/.test(oi.error?.message ?? ''), oi.error?.message);
  const jr = await J.rpc('request_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  check('④직원 request_visibility 거부', /not_brand_member/.test(jr.error?.message ?? ''), jr.error?.message);
  const jv = await J.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  check('④직원 set_brand_visibility 거부(not_owner)', /not_owner/.test(jv.error?.message ?? ''), jv.error?.message);
  const jm = await J.rpc('my_brand_view');
  check('④직원 my_brand_view 0행(사장 전용)', !jm.error && (jm.data ?? []).length === 0, jm.error?.message);

  console.log('\n⑤ 내부 함수는 클라이언트에서 실행 불가');
  for (const [fn, args] of [
    ['brand_log', { p_brand: 'brand_pilot', p_unit: null, p_kind: 'x', p_payload: {} }],
    ['admin_create_brand_workspace', { p_brand_id: 'brand_pilot', p_system_user_id: '00000000-0000-0000-0000-000000000000' }],
    ['brand_has_unit', { p_brand: 'brand_pilot', p_unit: UNIT }],
    ['brand_alert', { p_unit: UNIT, p_kind: 'brand_deploy', p_period: 'x', p_title: 'x', p_body: 'x' }],
    ['brand_visibility', { p_unit: UNIT }],
    // brand_overview 의 본문(0217) — 인자로 남의 브랜드를 넣을 수 있으므로 반드시 막혀야 한다.
    ['brand_overview_rows', { p_brand: 'brand_other', p_units: null }],
  ]) {
    const r = await H.rpc(fn, args);
    check(`⑤${fn} 실행 거부`, !!r.error && /permission denied|42501/.test(`${r.error.code} ${r.error.message}`), r.error ? `${r.error.code}` : '실행됨');
  }

  // ★`auth_owns_unit` 은 **막으면 안 된다** — 2026-09-23 실측으로 확인한 회귀다.
  //   0198 의 스토리지 정책 2개(photos_tenant_read·photos_auth_upload)가 이 함수를 술어로 쓰고,
  //   정책 술어는 **호출자(authenticated) 권한으로 평가**된다. 0211 이 revoke 한 뒤로 활성 매장이
  //   아닌 폴더를 읽거나 올리려 하면 `permission denied for function auth_owns_unit` 로 죽었다
  //   (= 다점포 사장의 노하우 사진 복사 경로. 0198 이 생긴 이유 그 자체). 0215 에서 다시 grant 한다.
  //   경계 관점에서 안전한 이유: 이 함수는 **자기 소유 여부**만 답한다(auth.uid() 기준). 남의 매장을
  //   물으면 false 라 새는 정보가 없다 — 그래서 '실행 가능 + 남의 매장은 false' 를 잰다.
  {
    const own = await O.rpc('auth_owns_unit', { p_unit: UNIT });
    check('⑤auth_owns_unit 은 실행 가능해야 한다(스토리지 정책 술어 · 0215)', !own.error && own.data === true, own.error?.message ?? String(own.data));
    const other = await J.rpc('auth_owns_unit', { p_unit: UNIT });
    check('⑤auth_owns_unit 은 남의 매장에 false(정보 누출 없음)', !other.error && other.data === false, other.error?.message ?? String(other.data));
    const photo = await O.storage.from('playbook-photos').createSignedUrl('store_zzz_notmine/x.jpg', 60);
    check('⑤사진 정책이 함수 권한 오류로 죽지 않는다(없는 파일 오류여야 한다)',
      !/permission denied for function/.test(photo.error?.message ?? ''), photo.error?.message);
  }

  await H.auth.signOut(); await O.auth.signOut(); await J.auth.signOut();
} catch (e) {
  fail++;
  console.log('\n✗ 하니스 중단:', String(e).slice(0, 300));
}
console.log(`\n── 결과 ── pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
