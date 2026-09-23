// seed-brand-demo.mjs — 본사(브랜드) QA 고정 계정. 멱등.
//
// 만드는 것: 브랜드 1개 + 본사 담당자 1명. **그게 전부다.**
//   연결 매장·공개 수준·배포 상태는 그 테이블들(`brand_units` 등)이 생기는 단계(P3~)에서 여기에 더한다.
//
// 왜 필요한가: 이게 없으면 본사 대시보드를 **제품과 다른 경로**로 열어야 한다(브라우저에 개발용
//   플래그를 심는 식). 그러면 "로그인하면 본사로 간다"는 판정 자체가 QA 대상에서 빠진다.
//
//   node scripts/seed-brand-demo.mjs     (.env + .env.seed 의 SERVICE_ROLE 필요)
//
// 계정(메모리 feedback_qa_use_fixed_accounts 에 기재):
//   본사 담당자  hq@pilot.squaretable.app / pilot1234   브랜드 brand_pilot "스퀘어 F&B"
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertSeedTarget } from './lib/seed-target.mjs';

function loadEnv() {
  const e = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !e[m[1]]) e[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return e;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env + .env.seed)');
  process.exit(1);
}

const BRAND_ID = 'brand_pilot';
const BRAND_NAME = '스퀘어 F&B';
const HQ_EMAIL = 'hq@pilot.squaretable.app';
const PASSWORD = 'pilot1234';

assertSeedTarget(URL_, 'seed-brand-demo.mjs');
const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('본사(브랜드) QA 시드');

// ── 브랜드 ───────────────────────────────────────────────────────────
{
  const { error } = await db.from('brands').upsert(
    { id: BRAND_ID, name: BRAND_NAME, biz_no: null, status: 'active' },
    { onConflict: 'id' },
  );
  if (error) {
    console.error('✗ brands upsert 실패 —', error.message);
    console.error('  0208 마이그레이션이 올라갔는지 확인: npx supabase migration list');
    process.exit(1);
  }
  console.log(`  · 브랜드: ${BRAND_ID} "${BRAND_NAME}"`);
}

// ── 본사 담당자 계정 ─────────────────────────────────────────────────
let hqId;
{
  const { data, error } = await db.auth.admin.createUser({
    email: HQ_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    // ★role 은 'junior' 로 둔다 — 본사 권한은 `profiles.role` 이 아니라 `brand_members` 가 정본이다.
    //   여기에 'owner' 를 넣으면 매장이 없는데 사장 화면으로 새는 경로가 생긴다.
    user_metadata: { name: '본사 담당자', role: 'junior' },
  });
  if (error) {
    if (/already.*registered|exists/i.test(error.message)) {
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      hqId = list.users.find((u) => u.email === HQ_EMAIL)?.id;
      console.log(`  · 기존 계정 사용: ${HQ_EMAIL}`);
    } else {
      console.error('✗ 계정 생성 실패 —', error.message);
      process.exit(1);
    }
  } else {
    hqId = data.user.id;
    console.log(`  · 계정 생성: ${HQ_EMAIL} / ${PASSWORD}`);
  }
  if (!hqId) {
    console.error('✗ 담당자 user_id 를 못 찾았다');
    process.exit(1);
  }
  // 재실행 시 알려진 비번 보장(다른 시드와 같은 규칙).
  await db.auth.admin.updateUserById(hqId, { password: PASSWORD });
}

// ── 담당자 ↔ 브랜드 ──────────────────────────────────────────────────
{
  const { error } = await db
    .from('brand_members')
    .upsert({ brand_id: BRAND_ID, user_id: hqId }, { onConflict: 'brand_id,user_id' });
  if (error) {
    console.error('✗ brand_members upsert 실패 —', error.message);
    process.exit(1);
  }
  console.log('  · 담당자 연결 완료');
}

// ── 실증: 그 계정으로 로그인해서 my_brand() 가 실제로 답하는지 ────────
// 시드가 "넣었다"고 말하고 끝내면, 판정 경로(RLS·정의자 함수)가 막혀 있어도 모른다.
{
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) {
    console.log('  ⚠ ANON 키가 없어 판정 실증은 건너뜀');
  } else {
    const asUser = createClient(URL_, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signErr } = await asUser.auth.signInWithPassword({ email: HQ_EMAIL, password: PASSWORD });
    if (signErr) {
      console.error('✗ 담당자 로그인 실패 —', signErr.message);
      process.exit(1);
    }
    const { data, error } = await asUser.rpc('my_brand');
    if (error || !data?.length || data[0].brand_id !== BRAND_ID) {
      console.error('✗ my_brand() 가 브랜드를 안 돌려준다 —', error?.message ?? JSON.stringify(data));
      process.exit(1);
    }
    console.log(`  ✓ 판정 실증: my_brand() → ${data[0].brand_id} "${data[0].brand_name}"`);

    // 경계 실증 — 담당자가 매장 테이블을 직접 읽어도 0행이어야 한다(브랜드 축은 매장을 안 연다).
    const { data: units } = await asUser.from('units').select('id').limit(5);
    const { data: entries } = await asUser.from('playbook_entries').select('id').limit(5);
    const leaked = (units?.length ?? 0) + (entries?.length ?? 0);
    if (leaked > 0) {
      console.error(`✗ 경계 위반: 담당자가 매장 데이터를 ${leaked}행 읽었다`);
      process.exit(1);
    }
    console.log('  ✓ 경계 실증: 담당자의 units·playbook_entries 직접 조회 0행');
    await asUser.auth.signOut();
  }
}

// ── P2(0209~0212): 작업실 · 연결 매장 · 다른 브랜드(경계용) ──────────────────
// 연결 매장은 고정 계정의 기존 매장만 쓴다(계정 신설 금지). 있는 것만 연결하고 없으면 건너뛴다.
//   store_001(사장 김영자)      가맹 · 요약 공개 · payer=brand
//   store_appreview(심사 데모)  가맹 · 운영 공개 · payer=store
//   store_eval(평가 픽스처)     직영 · 운영 공개 · payer=brand (초대자=담당자 표시)
//   brand_other                 담당자 0명 · store_002_demo 연결 — "다른 브랜드가 안 보인다" 실증용
{
  // 시스템 계정 + 작업실(멱등). 시스템 계정은 사람이 로그인하지 않는다.
  const SYS_EMAIL = `system+${BRAND_ID}@squaretable.app`;
  let sysId = null;
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email: SYS_EMAIL,
    password: `sys-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    email_confirm: true,
    user_metadata: { name: `${BRAND_NAME} 시스템`, role: 'owner' },
  });
  if (cErr) {
    if (/already.*registered|exists/i.test(cErr.message)) {
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      sysId = list.users.find((u) => u.email === SYS_EMAIL)?.id ?? null;
    } else {
      console.error('✗ 시스템 계정 생성 실패 —', cErr.message);
      process.exit(1);
    }
  } else {
    sysId = created.user.id;
  }
  const { data: ws, error: wsErr } = await db.rpc('admin_create_brand_workspace', { p_brand_id: BRAND_ID, p_system_user_id: sysId });
  if (wsErr) { console.error('✗ 작업실 생성 실패 —', wsErr.message); process.exit(1); }
  console.log(`  · 작업실: ${ws} (시스템 계정 ${SYS_EMAIL})`);

  // 사장 김영자(store_001)의 전화번호 — 매장 초대는 점주 번호로 간다(정본 §3-5 B). 시드 계정은 OTP 를 안 거쳐
  // 번호가 비어 있을 수 있어 QA 번호를 채운다(실계정은 가입 시 인증된 번호가 이미 있다). 있으면 건드리지 않는다.
  {
    const { data: ownerUnit } = await db.from('units').select('owner_id').eq('id', 'store_001').maybeSingle();
    if (ownerUnit?.owner_id) {
      const { data: op } = await db.from('profiles').select('phone').eq('id', ownerUnit.owner_id).maybeSingle();
      if (op && !op.phone) {
        const { error: pe } = await db.from('profiles').update({ phone: '01055550001' }).eq('id', ownerUnit.owner_id);
        console.log(pe ? `  ⚠ 사장 전화번호 채우기 실패 — ${pe.message}` : '  · 사장(store_001) QA 전화번호 채움');
      }
    }
  }

  // 계약 값(정본 §4-D: 브랜드별 계약가·기본 payer).
  await db.from('brands').update({ price_per_store_krw: 25000, default_payer: 'brand', biz_no: '1234567890' }).eq('id', BRAND_ID);

  // 연결 매장 — 있는 것만. 이미 active 면 그대로 둔다(멱등).
  const want = [
    { unit: 'store_001', payer: 'brand', visibility: 'summary', direct: false },
    { unit: 'store_appreview', payer: 'store', visibility: 'ops', direct: false },
    { unit: 'store_eval', payer: 'brand', visibility: 'ops', direct: true },
  ];
  for (const w of want) {
    const { data: u } = await db.from('units').select('id, owner_id').eq('id', w.unit).is('deleted_at', null).maybeSingle();
    if (!u) { console.log(`  · ${w.unit} 없음 — 건너뜀`); continue; }
    const { data: cur } = await db.from('brand_units').select('id, brand_id').eq('unit_id', w.unit).eq('status', 'active').maybeSingle();
    if (cur && cur.brand_id === BRAND_ID) { console.log(`  · ${w.unit} 이미 연결됨`); continue; }
    if (cur) await db.from('brand_units').update({ status: 'ended', ended_at: new Date().toISOString(), end_reason: 'seed_reset' }).eq('id', cur.id);
    const { error } = await db.from('brand_units').insert({
      brand_id: BRAND_ID, unit_id: w.unit, payer: w.payer, visibility: w.visibility,
      invited_by: w.direct ? hqId : null, accepted_by: u.owner_id,
    });
    if (error) { console.error(`✗ ${w.unit} 연결 실패 —`, error.message); process.exit(1); }
    console.log(`  · 연결: ${w.unit} (${w.direct ? '직영' : '가맹'} · ${w.visibility} · payer=${w.payer})`);
  }

  // 다른 브랜드(담당자 0명) + store_002_demo — 있으면 연결. 경계 하니스가 "안 보인다"를 잰다.
  await db.from('brands').upsert({ id: 'brand_other', name: '다른 본사(경계용)', status: 'active' }, { onConflict: 'id' });
  const { data: u2 } = await db.from('units').select('id, owner_id').eq('id', 'store_002_demo').is('deleted_at', null).maybeSingle();
  if (u2) {
    const { data: cur2 } = await db.from('brand_units').select('id, brand_id').eq('unit_id', 'store_002_demo').eq('status', 'active').maybeSingle();
    if (!cur2) {
      await db.from('brand_units').insert({ brand_id: 'brand_other', unit_id: 'store_002_demo', payer: 'brand', visibility: 'ops', accepted_by: u2.owner_id });
      console.log('  · brand_other ← store_002_demo 연결');
    }
  }

  // 실증: 담당자로 brand_overview() — 다른 브랜드 매장은 없고, my_units 는 비어야 한다(작업실이 매장으로 안 샘).
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (anon) {
    const asUser = createClient(URL_, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    await asUser.auth.signInWithPassword({ email: HQ_EMAIL, password: PASSWORD });
    const { data: ov, error: ovErr } = await asUser.rpc('brand_overview');
    if (ovErr) { console.error('✗ brand_overview 실패 —', ovErr.message); process.exit(1); }
    const ids = (ov ?? []).map((r) => r.unit_id);
    if (ids.includes('store_002_demo')) { console.error('✗ 경계 위반: 다른 브랜드 매장이 보인다'); process.exit(1); }
    const { data: mu } = await asUser.rpc('my_units');
    if ((mu ?? []).length) { console.error('✗ 담당자의 my_units 가 비어 있지 않다(작업실이 매장으로 샘)'); process.exit(1); }
    console.log(`  ✓ brand_overview: ${ids.join(', ') || '(0곳)'} · 다른 브랜드 0 · my_units 0`);
    await asUser.auth.signOut();
  }
}

console.log(`\n완료 — 웹에서 ${HQ_EMAIL} / ${PASSWORD} 로 로그인하면 본사 대시보드로 들어간다.`);
