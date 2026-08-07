#!/usr/bin/env node
// setup-task-reminder-cron.mjs — 할일 시간대 알림(0118) 크론을 1회 등록한다.
//
// 왜 마이그레이션이 직접 안 하나: 크론이 엣지 push 를 부르려면 service_role 키가 필요한데,
//   그 키가 .sql 에 박히면 커밋할 수 없다. → 키는 Vault 에 넣고 크론은 Vault 에서 읽는다.
//   그 Vault 적재 + cron.schedule 을 하는 게 0118 의 schedule_task_reminder_cron(url, key) RPC 다.
//   이 스크립트는 .env/.env.seed 에서 URL·키를 읽어 그 RPC 를 한 번 호출할 뿐이다(멱등 — 다시 돌려도 안전).
//
// 선행: Supabase Database→Extensions 에서 **pg_cron 과 pg_net 활성화**(안 켜져 있으면 그 사실을 알려준다).
// 실행: node scripts/setup-task-reminder-cron.mjs
// 확인: node scripts/qa-task-reminder.mjs (크론 등록 여부까지 검사한다)

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
const { data, error } = await admin.rpc('schedule_task_reminder_cron', { p_url: URL, p_key: SERVICE });

if (error) {
  console.error('FAIL: schedule_task_reminder_cron 호출 실패 —', error.message);
  console.error('  0118 마이그레이션이 적용됐는지 먼저 확인하세요: npx supabase migration list');
  process.exit(1);
}
if (data !== 'ok') {
  console.error('FAIL:', data);
  process.exit(1);
}
console.log('PASS: 크론 task-reminders 등록 완료(5분 주기). 키는 Vault 에만 저장됐어요.');
