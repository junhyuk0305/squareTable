// scripts/activate-store.mjs — 입금 확인 후 매장 구독을 수동 active 전환(계좌이체 수동과금 운영 경로).
// service_role 키로 admin_activate_store RPC 호출(RLS 우회, 클라 노출 금지). 0036 마이그레이션 적용 후 사용.
//
// 목록 보기(누가 만료/체험/유료인지):
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/activate-store.mjs
//
// 활성화(입금 확인 후):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/activate-store.mjs <unit_id> [일수(기본 30)]
//
// 강제 만료:
//   node scripts/activate-store.mjs --expire <unit_id>
//
// AI 월 카운터 초기화(유료→무료 다운그레이드 시 필수 — 유료 기간 누적 사용량이 무료 캡 300을
// 넘어 있으면 즉시 402로 잠기므로, free 로 전환할 땐 함께 실행):
//   node scripts/activate-store.mjs --reset-ai <unit_id>

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const fmt = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '—');

async function list() {
  const { data: units, error } = await db
    .from('units')
    .select('id, store_name, unit_subscriptions(status, plan, trial_ends_at, paid_until)')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('✗ 조회 실패:', error.message);
    process.exit(1);
  }
  console.log(`\n총 ${units.length}개 매장\n`);
  console.log('unit_id'.padEnd(20), 'status'.padEnd(10), 'plan'.padEnd(8), 'trial_ends'.padEnd(18), 'paid_until'.padEnd(18), 'store');
  console.log('-'.repeat(98));
  for (const u of units) {
    const s = Array.isArray(u.unit_subscriptions) ? u.unit_subscriptions[0] : u.unit_subscriptions;
    console.log(
      String(u.id).padEnd(20),
      String(s?.status ?? '(none)').padEnd(10),
      String(s?.plan ?? 'free').padEnd(8),
      fmt(s?.trial_ends_at).padEnd(18),
      fmt(s?.paid_until).padEnd(18),
      u.store_name ?? '',
    );
  }
  console.log('\n활성화: node scripts/activate-store.mjs <unit_id> [일수]\n');
}

async function activate(unitId, days, plan) {
  const params = { p_unit_id: unitId, p_days: days };
  if (plan) params.p_plan = plan; // 생략 시 기존 plan 유지(0062)
  const { data, error } = await db.rpc('admin_activate_store', params);
  if (error) {
    console.error('✗ 활성화 실패:', error.message);
    process.exit(1);
  }
  const row = Array.isArray(data) ? data[0] : data;
  console.log(`✓ 활성화 완료 — ${unitId}: status=${row?.status}, plan=${row?.plan}, paid_until=${fmt(row?.paid_until)} (+${days}일)`);
}

async function expire(unitId) {
  const { error } = await db.rpc('admin_expire_store', { p_unit_id: unitId });
  if (error) {
    console.error('✗ 만료 처리 실패:', error.message);
    process.exit(1);
  }
  console.log(`✓ 만료 처리 완료 — ${unitId}`);
}

async function resetAi(unitId) {
  // 해당 매장의 ai_usage_monthly 전체 삭제(service_role, RLS 우회). consume_ai_quota 가 다음 답변에서 새로 시작.
  const { error } = await db.from('ai_usage_monthly').delete().eq('unit_id', unitId);
  if (error) {
    console.error('✗ AI 카운터 초기화 실패:', error.message);
    process.exit(1);
  }
  console.log(`✓ AI 월 카운터 초기화 완료 — ${unitId}`);
}

const args = process.argv.slice(2);
if (args[0] === '--reset-ai') {
  if (!args[1]) {
    console.error('✗ 사용법: node scripts/activate-store.mjs --reset-ai <unit_id>');
    process.exit(1);
  }
  await resetAi(args[1]);
} else if (args[0] === '--expire') {
  if (!args[1]) {
    console.error('✗ 사용법: node scripts/activate-store.mjs --expire <unit_id>');
    process.exit(1);
  }
  await expire(args[1]);
} else if (args.length === 0) {
  await list();
} else {
  const unitId = args[0];
  const days = Number.isFinite(Number(args[1])) && args[1] ? parseInt(args[1], 10) : 30;
  const plan = args[2] ?? null;
  if (plan && !['free', 'single', 'multi'].includes(plan)) {
    console.error(`✗ plan 은 free|single|multi 중 하나예요: ${plan}`);
    process.exit(1);
  }
  await activate(unitId, days, plan);
}
