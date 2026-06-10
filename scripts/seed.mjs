// scripts/seed.mjs — 파일럿 매장 1개를 DB에 심고 로그인 계정을 만든다.
// service_role 키로 RLS를 우회하므로 절대 클라이언트/깃에 올리지 말 것.
//
// 실행:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   SEED_OWNER_EMAIL=owner@store.com SEED_STAFF_EMAIL=staff@store.com \
//   SEED_PASSWORD=pilot1234 \
//   node scripts/seed.mjs
//
// 멱등: 다시 돌려도 안전(계정은 이미 있으면 건너뜀, 데이터는 upsert).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(__dir, '..', 'src', 'data', p), 'utf8'));

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@pilot.squaretable.app';
const STAFF_EMAIL = process.env.SEED_STAFF_EMAIL ?? 'staff@pilot.squaretable.app';
const PASSWORD = process.env.SEED_PASSWORD ?? 'pilot1234';

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const UNIT_ID = 'store_001';

async function ensureUser(email, meta) {
  // 이미 있으면 그 유저 반환, 없으면 생성(이메일 확인 생략 → 바로 로그인 가능).
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: meta,
  });
  if (error) {
    if (/already.*registered|exists/i.test(error.message)) {
      const { data: list } = await db.auth.admin.listUsers();
      const found = list.users.find((u) => u.email === email);
      console.log(`  · 기존 계정 사용: ${email}`);
      return found;
    }
    throw error;
  }
  console.log(`  · 계정 생성: ${email} / 비번 ${PASSWORD}`);
  return data.user;
}

async function main() {
  const ctx = read('context-pack.json');
  const entries = read('playbook-entries.json');
  const unknowns = read('unknown-queries.json');
  const chats = read('chat-queries.json');

  console.log('1) 매장 upsert');
  await db.from('units').upsert({
    id: UNIT_ID,
    store_name: ctx.store_name,
    industry: ctx.industry,
    subcategory: ctx.subcategory,
    invite_code: '482193',
    context: ctx,
  }).throwOnError();

  console.log('2) 계정 프로비저닝');
  const owner = await ensureUser(OWNER_EMAIL, { name: '김영자', role: 'owner', unit_id: UNIT_ID });
  const staff = await ensureUser(STAFF_EMAIL, { name: '박지원', role: 'junior', unit_id: UNIT_ID });

  // 트리거가 profiles를 만들지만, 멱등 위해 unit_id 보정.
  await db.from('profiles').update({ unit_id: UNIT_ID, role: 'owner', name: '김영자' }).eq('id', owner.id);
  await db.from('profiles').update({ unit_id: UNIT_ID, role: 'junior', name: '박지원' }).eq('id', staff.id);
  await db.from('units').update({ owner_id: owner.id }).eq('id', UNIT_ID);

  console.log(`3) 플레이북 ${entries.length}건 upsert`);
  await db.from('playbook_entries')
    .upsert(entries.map((e) => ({ ...e, unit_id: UNIT_ID })))
    .throwOnError();

  console.log(`4) 미답변 큐 ${unknowns.length}건 upsert`);
  await db.from('unknown_queries')
    .upsert(unknowns.map((u) => ({ ...u, unit_id: UNIT_ID })))
    .throwOnError();

  console.log(`5) 채팅 기록 ${chats.length}건 upsert`);
  await db.from('chat_queries')
    .upsert(chats.map((c) => ({ ...c, unit_id: UNIT_ID })))
    .throwOnError();

  console.log('\n✓ 시드 완료');
  console.log(`  사장님 로그인: ${OWNER_EMAIL} / ${PASSWORD}`);
  console.log(`  알바 로그인:   ${STAFF_EMAIL} / ${PASSWORD}`);
}

main().catch((e) => {
  console.error('✗ 시드 실패:', e.message ?? e);
  process.exit(1);
});
