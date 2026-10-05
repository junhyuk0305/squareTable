#!/usr/bin/env node
// qa-brand-history.mjs — 끝난 본사 연결을 사장과 본사가 본다 (0250 · Q28 · Q29 · 로컬 도커 전용)
//
// 무엇을 못박나:
//   [1] 권한 — my_brand_history · brand_ended_units 는 anon 이 못 부른다. 끝나기 전(연결 중)은 이력이 아니다.
//   [2] my_brand_history() — 사장 본인 매장의 끝난 연결만(본사 이름 · 끝난 날 · 누가 · 사유). 남의 매장 0 ·
//       직원·본사 담당자 0 · 180일이 지나면 빠진다 · 돌려주는 칸은 정해진 6개뿐.
//   [3] brand_ended_units() — 본사 담당자가 자기 브랜드에서 끝난 매장과 사유만. 다른 브랜드 0 · 사장·직원 0 ·
//       칸은 5개뿐(직원 수·숙지율 같은 운영 숫자 없음) · 다시 연결된 매장은 빠진다 · 여러 번 끝났으면 마지막 한 줄.
//   [4] 끝난 뒤 본사는 그 매장의 운영 데이터(질문·노하우·요약 표·직접 조회)를 못 읽는다. 끝나기 전엔 읽혔다(셋업 확인).
//   [5] 앱·웹 — 점주 brand-link 빈 화면의 "끝난 연결" 카드 · 본사 /hq/stores 의 "연결 끝난 매장" 목록 · 문구 순수 함수.
//
// 지금(0249)은 두 RPC 가 없다. 점주는 본사가 끊으면 "연결된 본사가 없어요"만 보고(Q29),
//   해제 시트가 "사유는 본사에 그대로 전해져요"라고 하지만 본사엔 사유를 볼 곳이 없다(Q28).
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-brand-history.mjs   자가정리(계정·매장·브랜드·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error(`중단: 로컬 도커 전용 하니스다(계정을 가입시킨다). 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = mk();
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

const phones = ['0131', '0132', '0133', '0134', '0135'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const B1 = `brand_qa_bh1_${s}`, B2 = `brand_qa_bh2_${s}`;
const B1_NAME = 'QA이력본사';
const OWNER_COLS = ['brand_name', 'end_reason', 'ended_at', 'ended_by', 'store_name', 'unit_id'];
const BRAND_COLS = ['end_reason', 'ended_at', 'ended_by', 'store_name', 'unit_id'];

const errOf = (r) => (r.error ? `${r.error.code ?? ''} ${r.error.message}` : '');
const rowsOf = (r) => (r.error ? null : (r.data ?? []));
const ids = (r) => (r.error ? `오류 ${errOf(r)}` : (r.data ?? []).map((x) => x.unit_id).sort().join(','));
const keysOf = (r) => (r.error || !(r.data ?? []).length ? '' : Object.keys(r.data[0]).sort().join(','));
const blocked = (r) => (r.error ? r.error.code === '42501' : (r.data ?? []).length === 0);

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const up = async (i, name, role, birth) => {
    const c = mk();
    const r = await c.auth.signUp({
      email: `qa_bh_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: birth } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    const u = { c, id: r.data.user?.id, name };
    users.push(u);
    return u;
  };
  const O1 = await up(0, 'QA이력사장1', 'owner', '1980-01-01');
  const O2 = await up(1, 'QA이력사장2', 'owner', '1980-01-01');
  const X = await up(2, 'QA다른본사사장', 'owner', '1980-01-01');
  const H = await up(3, 'QA본사담당', 'owner', '1980-01-01');
  const J = await up(4, 'QA이력직원', 'junior', '2000-01-01');

  const mkStore = async (U, name) => {
    const { data: st, error } = await U.c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    const row = Array.isArray(st) ? st[0] : st;
    if (error || !row?.unit_id) throw new Error('create_store: ' + (error?.message ?? 'no row'));
    units.push(row.unit_id);
    await U.c.rpc('switch_active_unit', { p_unit_id: row.unit_id });
    return row;
  };
  const st1 = await mkStore(O1, 'QA이력카페1');
  const S1 = st1.unit_id;
  const S2 = (await mkStore(O2, 'QA이력카페2')).unit_id;
  const SX = (await mkStore(X, 'QA다른본사카페')).unit_id;
  {
    const j = await J.c.rpc('join_by_invite', { p_code: st1.invite_code });
    if (j.error) throw new Error('join_by_invite: ' + j.error.message);
    const a = await O1.c.rpc('approve_member', { p_uid: J.id });
    if (a.error) throw new Error('approve_member: ' + a.error.message);
    await J.c.rpc('switch_active_unit', { p_unit_id: S1 });
  }
  // 본사 두 곳 — 우리(내부 콘솔)가 만드는 것과 같이 service_role 로 넣는다.
  {
    const b = await admin.from('brands').insert([{ id: B1, name: B1_NAME }, { id: B2, name: 'QA다른본사' }]);
    if (b.error) throw new Error('brands: ' + b.error.message);
    const m = await admin.from('brand_members').insert({ brand_id: B1, user_id: H.id });
    if (m.error) throw new Error('brand_members: ' + m.error.message);
    const u = await admin.from('brand_units').insert([
      { brand_id: B1, unit_id: S1, payer: 'store', visibility: 'ops' },
      { brand_id: B1, unit_id: S2, payer: 'store', visibility: 'ops' },
      { brand_id: B2, unit_id: SX, payer: 'store', visibility: 'ops' },
    ]);
    if (u.error) throw new Error('brand_units: ' + u.error.message);
  }
  // 운영 데이터 — 직원 J 가 S1 에 남긴 대기 질문 1건(옛 앱 insertUnknown 그대로).
  {
    const { error } = await J.c.from('unknown_queries').insert({
      id: `uq_bh_${s}`, unit_id: S1, junior_id: J.id, junior_name: J.name, query_text: 'QA 마감 정산은 어떻게 해요?',
      asked_at: new Date().toISOString(), presumed_category: null, presumed_subcategory: null, match_attempted: true,
      best_match_confidence: 0.2, best_match_entry_id: null, status: 'pending_owner_answer', fallback_action: null,
      owner_notified_at: null, owner_will_answer: false, similar_queries_count: 0, ai_general_answer: '', anonymous: true,
    });
    if (error) throw new Error('insertUnknown: ' + error.message);
  }
  console.log(`셋업 — 본사 ${B1}(S1 ${S1} · S2 ${S2}) · 다른 본사 ${B2}(SX ${SX}) · S1 직원 1명`);

  const hist = (U) => U.c.rpc('my_brand_history');
  const ended = (U) => U.c.rpc('brand_ended_units');

  // ═══════ 1. 권한 · 끝나기 전 ═══════
  console.log('\n[1] 권한 · 끝나기 전에는 이력이 아니다');
  {
    const a1 = await anon.rpc('my_brand_history');
    check('1-1 anon 은 my_brand_history 를 못 부른다', !!a1.error, a1.error ? errOf(a1) : `${(a1.data ?? []).length}행`);
    const a2 = await anon.rpc('brand_ended_units');
    check('1-2 anon 은 brand_ended_units 를 못 부른다', !!a2.error, a2.error ? errOf(a2) : `${(a2.data ?? []).length}행`);
    const h0 = await hist(O1);
    check('1-3 연결 중인 매장은 사장 이력에 없다(0행)', !!rowsOf(h0) && h0.data.length === 0, errOf(h0) || ids(h0));
    const e0 = await ended(H);
    check('1-4 연결 중인 매장은 본사 끝난 목록에 없다(0행)', !!rowsOf(e0) && e0.data.length === 0, errOf(e0) || ids(e0));
    // 셋업 확인 — 끝나기 전에는 본사가 운영 공개 매장의 질문과 요약 행을 읽는다(그래야 [4]의 0행이 의미가 있다).
    const q0 = await H.c.rpc('brand_unit_questions', { p_unit_id: S1 });
    check('1-5 (셋업) 끝나기 전 본사는 S1 질문을 읽는다', (rowsOf(q0) ?? []).length === 1, errOf(q0) || `${(q0.data ?? []).length}행`);
    const p0 = await H.c.rpc('brand_overview_page', { p_units: [S1] });
    check('1-6 (셋업) 끝나기 전 본사 요약 표에 S1 이 있다', (rowsOf(p0) ?? []).length === 1, errOf(p0));
  }

  // 끝내기 — 사장이 사유를 골라 끊고(S1 · SX), 본사가 끊는다(S2 · 웹은 사유 'brand').
  {
    const e1 = await O1.c.rpc('end_brand_unit', { p_unit_id: S1, p_reason: 'privacy' });
    const e2 = await H.c.rpc('end_brand_unit', { p_unit_id: S2, p_reason: 'brand' });
    const e3 = await X.c.rpc('end_brand_unit', { p_unit_id: SX, p_reason: 'self_manage' });
    if (e1.error || e2.error || e3.error) throw new Error('end_brand_unit: ' + (errOf(e1) || errOf(e2) || errOf(e3)));
  }

  // ═══════ 2. 사장 my_brand_history ═══════
  console.log('\n[2] my_brand_history — 사장 본인 매장의 끝난 연결만');
  {
    const h1 = await hist(O1);
    const r1 = (rowsOf(h1) ?? [])[0];
    check('2-1 사장1 은 S1 한 줄을 본다', ids(h1) === S1, ids(h1));
    check('2-2 그 줄 = 본사 이름 · 사장이 끊음 · 사유 privacy · 끝난 날',
      !!r1 && r1.brand_name === B1_NAME && r1.ended_by === 'owner' && r1.end_reason === 'privacy' && !!r1.ended_at && r1.store_name === 'QA이력카페1',
      JSON.stringify(r1));
    check('2-3 돌려주는 칸은 6개뿐(운영 숫자 없음)', keysOf(h1) === OWNER_COLS.join(','), keysOf(h1));
    const h2 = await hist(O2);
    const r2 = (rowsOf(h2) ?? [])[0];
    check('2-4 사장2 는 본사가 끊은 S2 를 본다(누가 = brand)', ids(h2) === S2 && r2?.ended_by === 'brand' && r2?.end_reason === 'brand', JSON.stringify(r2 ?? errOf(h2)));
    const hx = await hist(X);
    check('2-5 ★다른 사장은 자기 매장(SX)만 — S1·S2 0', ids(hx) === SX, ids(hx));
    const hj = await hist(J);
    check('2-6 직원은 0행(사장 전용)', !!rowsOf(hj) && hj.data.length === 0, errOf(hj) || ids(hj));
    const hh = await hist(H);
    check('2-7 본사 담당자는 사장 이력 0행', !!rowsOf(hh) && hh.data.length === 0, errOf(hh) || ids(hh));
    // 180일이 지나면 빠진다.
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    await admin.from('brand_units').update({ ended_at: old }).eq('unit_id', S2).eq('status', 'ended');
    const h2b = await hist(O2);
    check('2-8 180일이 지난 연결은 빠진다', !!rowsOf(h2b) && h2b.data.length === 0, errOf(h2b) || ids(h2b));
    await admin.from('brand_units').update({ ended_at: new Date().toISOString() }).eq('unit_id', S2).eq('status', 'ended');
  }

  // ═══════ 3. 본사 brand_ended_units ═══════
  console.log('\n[3] brand_ended_units — 본사는 자기 브랜드의 끝난 매장과 사유만');
  {
    const e = await ended(H);
    check('3-1 ★본사는 S1·S2 를 보고 다른 브랜드 SX 는 못 본다', ids(e) === [S1, S2].sort().join(','), ids(e));
    check('3-2 칸은 5개뿐(직원 수·숙지율·질문 같은 운영 숫자 없음)', keysOf(e) === BRAND_COLS.join(','), keysOf(e));
    const by = Object.fromEntries((rowsOf(e) ?? []).map((r) => [r.unit_id, r]));
    check('3-3 S1 = 점주가 끊음 · 사유 privacy', by[S1]?.ended_by === 'owner' && by[S1]?.end_reason === 'privacy' && by[S1]?.store_name === 'QA이력카페1', JSON.stringify(by[S1]));
    check('3-4 S2 = 본사가 끊음 · 사유 brand', by[S2]?.ended_by === 'brand' && by[S2]?.end_reason === 'brand', JSON.stringify(by[S2]));
    for (const [n, U] of [['사장', O1], ['직원', J], ['다른 본사 매장 사장', X]]) {
      const r = await ended(U);
      check(`3-5 ${n} 은 0행(본사 담당자 전용)`, !!rowsOf(r) && r.data.length === 0, errOf(r) || ids(r));
    }
  }

  // ═══════ 4. 끝난 뒤 운영 데이터 ═══════
  console.log('\n[4] 끝난 뒤 본사는 S1 운영 데이터를 못 읽는다(사유·날짜만)');
  {
    const q = await H.c.rpc('brand_unit_questions', { p_unit_id: S1 });
    check('4-1 질문 0행', !!rowsOf(q) && q.data.length === 0, errOf(q) || `${(q.data ?? []).length}행`);
    const en = await H.c.rpc('brand_unit_entries', { p_unit_id: S1 });
    check('4-2 노하우 0행', !!rowsOf(en) && en.data.length === 0, errOf(en) || `${(en.data ?? []).length}행`);
    const p = await H.c.rpc('brand_overview_page', { p_units: [S1] });
    check('4-3 요약 표에 S1 없음(직원 수·숙지율 0)', !!rowsOf(p) && p.data.length === 0, errOf(p) || `${(p.data ?? []).length}행`);
    const pd = await H.c.rpc('brand_payer_dates');
    check('4-4 요금 날짜에 S1 없음', !!rowsOf(pd) && !pd.data.some((r) => r.unit_id === S1), errOf(pd));
    for (const t of ['unknown_queries', 'attendance', 'playbook_entries', 'unit_members', 'wages']) {
      const r = await H.c.from(t).select('unit_id').eq('unit_id', S1).limit(5);
      check(`4-5 ${t} 직접 조회 0행`, blocked(r), r.error ? errOf(r) : `${(r.data ?? []).length}행`);
    }
    const bu = await H.c.from('brand_units').select('id').eq('unit_id', S1);
    check('4-6 brand_units 직접 조회 0행(사유는 RPC 로만)', blocked(bu), bu.error ? errOf(bu) : `${(bu.data ?? []).length}행`);
  }

  // ═══════ 3'. 다시 연결 · 여러 번 끝남 ═══════
  console.log("\n[3'] 다시 연결된 매장은 빠지고, 여러 번 끝났으면 마지막 한 줄");
  {
    await admin.from('brand_units').insert({ brand_id: B1, unit_id: S2, payer: 'store', visibility: 'summary' });
    const e = await ended(H);
    check('3-6 다시 연결된 S2 는 끝난 목록에서 빠진다', ids(e) === S1, ids(e));
    await admin.from('brand_units').insert({ brand_id: B1, unit_id: S1, payer: 'store', visibility: 'summary' });
    const r = await H.c.rpc('end_brand_unit', { p_unit_id: S1, p_reason: 'brand' });
    if (r.error) throw new Error('end_brand_unit 2: ' + r.error.message);
    const e2 = await ended(H);
    const row = (rowsOf(e2) ?? []).filter((x) => x.unit_id === S1);
    check('3-7 S1 이 두 번 끝나도 한 줄 · 마지막 사유(brand)', row.length === 1 && row[0].end_reason === 'brand', JSON.stringify(rowsOf(e2) ?? errOf(e2)));
    const h1 = await hist(O1);
    const hr = (rowsOf(h1) ?? []).filter((x) => x.unit_id === S1);
    check('3-8 사장 이력도 같은 본사는 마지막 한 줄', hr.length === 1 && hr[0].ended_by === 'brand', JSON.stringify(rowsOf(h1) ?? errOf(h1)));
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
}

// ═══════ 5. 앱 · 웹 ═══════
console.log('\n[5] 앱 brand-link "끝난 연결" 카드 · 본사 /hq/stores "연결 끝난 매장" · 문구');
{
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  const db = read('src/lib/brand/brandDb.ts');
  check('5-1 brandDb myBrandHistory → my_brand_history', /export const myBrandHistory[\s\S]{0,200}'my_brand_history'/.test(db));
  check('5-2 brandDb fetchBrandEndedUnits → brand_ended_units', /export const fetchBrandEndedUnits[\s\S]{0,200}'brand_ended_units'/.test(db));
  const link = read('src/app/owner/brand-link.tsx');
  check('5-3 brand-link 빈 화면에 testID brand-link-ended 카드 · 문구는 endedLinkLine', /testID="brand-link-ended"/.test(link) && /endedLinkLine\(/.test(link));
  check('5-4 brand-link 카드에 "내 노하우 보기" → /owner/knowledge', /내 노하우 보기/.test(link) && /\/owner\/knowledge/.test(link));
  const store = read('src/lib/store/useOwnerBrandStore.ts');
  check('5-5 useOwnerBrandStore 가 myBrandHistory 를 읽는다(계정 전환 때 같이 비워진다)', /myBrandHistory\(\)/.test(store) && /history/.test(store));
  // ★2026-10-05 검토: 계정을 바꾼 뒤 늦게 온 A 의 응답이 B 화면에 A 의 끝난 연결을 그렸다. 첫 await 전에 세대를 잡고 바뀌었으면 쓰지 않는다.
  const hyd = store.slice(store.indexOf('hydrate: coalesce('));
  check('5-5b ★hydrate 가 첫 await 전에 currentTenantEpoch() 를 잡고, 세대가 바뀌었으면 set 하지 않는다(계정 전환)',
    /currentTenantEpoch\(\)[\s\S]*?await Promise\.all/.test(hyd) && /if \(isStaleEpoch\(epoch\)\) return;[\s\S]*?set\(patch\)/.test(hyd));
  const hq = read('src/app/hq/stores/index.tsx');
  check('5-6 /hq/stores 에 testID hq-stores-ended · 사유는 endReasonLabel', /hq-stores-ended/.test(hq) && /endReasonLabel\(/.test(hq) && /연결 끝난 매장/.test(hq));

  // 순수 함수 — visibility.ts 를 임시 트랜스파일해 실제 함수를 부른다.
  const OUT = join(ROOT, '.qa-out', 'brand-history');
  mkdirSync(OUT, { recursive: true });
  const js = ts.transpileModule(read('src/lib/brand/visibility.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const fp = join(OUT, 'visibility.mjs');
  writeFileSync(fp, js, 'utf8');
  const V = await import(pathToFileURL(fp));
  const label = typeof V.endReasonLabel === 'function' ? V.endReasonLabel : null;
  const line = typeof V.endedLinkLine === 'function' ? V.endedLinkLine : null;
  check('5-7 endReasonLabel — 점주가 고른 사유는 해제 시트 문구 그대로',
    !!label && label('privacy') === '공개 범위가 부담돼요' && label('contract_ended') === '본사와 계약이 끝났어요', label ? label('privacy') : '함수 없음');
  check('5-8 endReasonLabel — 본사가 끊음 · 동의 거절 · 모르는 값 · 없음',
    !!label && label('brand') === '본사가 끝냈어요' && label('consent_declined') === '바뀐 관계에 동의하지 않았어요'
      && label('<script>') === '그 밖의 이유' && label(null) === '사유 없음',
    label ? [label('brand'), label('consent_declined'), label('<script>'), label(null)].join(' | ') : '함수 없음');
  check('5-9 endedLinkLine — 한국 날짜(UTC 16:30 = 다음 날)로 설계 문구 그대로',
    !!line && line('파일럿커피', '2026-10-04T16:30:00Z') === '파일럿커피 본사와 연결이 10월 5일에 끝났어요. 받은 노하우는 그대로 있어요.',
    line ? line('파일럿커피', '2026-10-04T16:30:00Z') : '함수 없음');
}

for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
try { await admin.from('brands').delete().in('id', [B1, B2]); } catch { /* best-effort */ }
for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
