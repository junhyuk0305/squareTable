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

console.log(`\n완료 — 웹에서 ${HQ_EMAIL} / ${PASSWORD} 로 로그인하면 본사 대시보드로 들어간다.`);
