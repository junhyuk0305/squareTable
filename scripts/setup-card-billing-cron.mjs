#!/usr/bin/env node
// setup-card-billing-cron.mjs — 카드 정기결제(0208) 갱신 크론을 1회 등록한다(매시 7분 → 엣지 card-billing action=renew).
//
// 왜 마이그레이션이 직접 안 하나: 크론이 엣지를 부르려면 service_role 키가 필요한데 .sql 에 박으면 커밋할 수 없다.
//   → 0208 의 schedule_card_billing_cron(url, key) RPC 가 키를 Vault 에 넣고 크론은 Vault 에서 읽는다(0118 과 같은 방식).
//   이 스크립트는 .env/.env.seed 에서 URL·키를 읽어 그 RPC 를 한 번 호출할 뿐이다(멱등 — 다시 돌려도 안전).
//
// 선행: 0208 적용 · 엣지 card-billing 배포 · TOSS_SECRET_KEY 시크릿 · pg_cron/pg_net 활성화(0118 때 이미 켬)
// 실행: node scripts/setup-card-billing-cron.mjs
// 확인: select jobname, schedule from cron.job where jobname = 'card-billing-renew';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 파일 없음 */ }
  }
  return env;
}

const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요해요(.env / .env.seed).');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.rpc('schedule_card_billing_cron', { p_url: URL, p_key: SERVICE });
if (error) {
  console.error('FAIL: schedule_card_billing_cron 호출 실패 —', error.message);
  console.error('  0208 마이그레이션이 적용됐는지 먼저 확인하세요: npx supabase migration list');
  process.exit(1);
}
if (data !== 'ok') {
  console.error('FAIL:', data);
  process.exit(1);
}
console.log('OK: card-billing-renew 크론 등록(매시 7분). 첫 실행 결과는 Edge Functions → card-billing 로그에서 확인.');
