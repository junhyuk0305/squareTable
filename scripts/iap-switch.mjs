// scripts/iap-switch.mjs — 인앱결제 판매 스위치(0187 app_config.iap_enabled) 조회·전환.
//
// 왜 스크립트인가: 네이티브는 OTA 가 없어 빌드 상수로는 되돌릴 수 없다. 문제가 생겼을 때
// **앱을 다시 내지 않고** 판매를 멈추는 경로가 이것 하나다. 급할 때 SQL 을 기억해서 치지 않게 한다.
//
//   상태:      npm run iap:status
//   판매 중단: npm run iap:off
//   판매 재개: npm run iap:on
//
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요 — app_config 는 RLS deny 라 service_role 만 만진다)
//
// ⚠️ 이 스위치는 **새로 파는 것만** 멈춘다. 이미 산 사람은 스토어가 계속 청구한다.
//    진짜 중단은 스토어 콘솔에서 상품을 내리고 기존 구독을 취소·환불하는 일이다.
// ⚠️ 전면 무료(billing_free_mode)와 다른 스위치다: 이건 "앱에서 파는가", 저건 "돈을 받는가".

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const KEYS = ['iap_enabled', 'billing_free_mode'];

async function read() {
  const { data, error } = await db.from('app_config').select('key, value, updated_at').in('key', KEYS);
  if (error) {
    console.error('✗ 조회 실패:', error.message);
    process.exit(1);
  }
  const row = (k) => data.find((d) => d.key === k);
  return { iap: row('iap_enabled'), free: row('billing_free_mode') };
}

function show({ iap, free }) {
  const on = iap?.value === 'true';
  console.log('\n■ 인앱결제 판매 스위치(app_config.iap_enabled)');
  if (!iap) console.log('    행 없음 → 판매 안 함(fail-closed). 0187 이 아직 적용되지 않았을 수 있다.');
  else console.log(`    ${on ? '🟢 판매 중' : '⛔ 판매 중단'}  (마지막 변경 ${iap.updated_at})`);
  console.log('■ 전면 무료 모드(billing_free_mode) — 다른 스위치다');
  console.log(`    ${free?.value === 'true' ? '🟢 무료(과금 게이팅 우회)' : '⚪ 평시(과금 적용)'}`);
  console.log('\n  ⚠️ 판매를 멈춰도 이미 산 구독은 스토어가 계속 청구한다 — 콘솔에서 상품을 내려야 진짜 중단이다.');
  console.log('  앱은 세션 갱신 시점에 이 값을 다시 읽는다(즉시 반영이 아니라 다음 갱신부터).\n');
}

async function set(value) {
  const { error } = await db
    .from('app_config')
    .upsert({ key: 'iap_enabled', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    console.error('✗ 변경 실패:', error.message);
    process.exit(1);
  }
  console.log(`\n✅ iap_enabled = ${value}`);
}

const cmd = process.argv[2];
if (cmd === 'on' || cmd === 'off') {
  await set(cmd === 'on' ? 'true' : 'false');
  show(await read());
} else if (!cmd || cmd === 'status') {
  show(await read());
} else {
  console.error('사용법: node scripts/iap-switch.mjs [status|on|off]');
  process.exit(1);
}
