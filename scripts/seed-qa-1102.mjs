// scripts/seed-qa-1102.mjs — 사람 실측용 매장 "테스트 카페"(store_6e18778f9e)의 계정 4개를 맞춘다.
//
// 왜 있나(2026-11-16 사용자 결정): 고정 QA 매장 store_001 은 하니스가 매일 쓰고 지워 화면이 실제 매장처럼 안 보인다.
//   사람이 직접 보는 실측은 하니스가 안 건드리는 이 매장에서 한다. 허용 목록(space_entry_allowlist)에는 넣지 않는다.
//   실제 새 사용자와 같은 화면을 보려는 것이다.
//
// 하는 일(멱등 · 매장의 노하우·근무·출근 같은 데이터는 건드리지 않는다):
//   ① 계정 4개를 만들거나 비밀번호를 test1234 로 맞춘다.
//   ② 화면 이름을 실제 같은 이름으로 맞춘다.
//   ③ 새 매니저는 실제 경로로 합류한다(join_by_invite · 0346 즉시 합류). 매니저는 사장 세션의 set_member_role 로 지정한다.
//   ④ 윤도윤은 계정만 만들고 합류시키지 않는다. 무료 매장 = 직원 2명까지(0336 · 매니저 포함)라 한예린·오세진으로 꽉 찬다.
//      실측에서 이 계정으로 초대 코드를 넣어 "다 찼어요" 안내를 본다(사용자 결정 11-16).
//   새 계정 두 개는 가짜 번호(0109988110x)라 문자를 못 받는다. 가입 때 번호 인증을 거친 것과 같게
//   phone_otps 에 인증됨 행(code_hash = 'qa-seed' · create-toss-reviewer 와 같은 표식)을 남긴다. 없으면 합류가 PHONE_NOT_VERIFIED 로 막힌다.
//
// 실행(main 체크아웃 · 라이브):
//   SEED_ALLOW_LIVE=1 node scripts/seed-qa-1102.mjs
// 삭제 보호 = scripts/cleanup-orphan-stores.mjs 의 PROTECT_UNITS · PROTECT_EMAIL(이 매장과 test.*.1102 계정).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertSeedTarget } from './lib/seed-target.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const readEnv = (file) => {
  try {
    const o = {};
    for (const line of readFileSync(join(__dir, '..', file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !m[1].startsWith('#')) o[m[1]] = m[2].trim();
    }
    return o;
  } catch { return {}; }
};
const envSeed = readEnv('.env.seed');
const envApp = readEnv('.env');
const URL = process.env.SUPABASE_URL || envSeed.SUPABASE_URL || envApp.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || envSeed.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || envApp.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SERVICE || !ANON) { console.error('✗ SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · EXPO_PUBLIC_SUPABASE_ANON_KEY 필요'); process.exit(1); }

const UNIT = 'store_6e18778f9e';
const PASSWORD = 'test1234';
const OWNER = { email: 'test.owner.1102@example.com', name: '정하윤' };
const STAFF = [
  { email: 'test.staff.1102@example.com', name: '한예린', role: 'junior' },
  { email: 'test.manager.1102@example.com', name: '오세진', role: 'manager', phone: '01099881102', birth: '1996-05-14' },
  { email: 'test.staff2.1102@example.com', name: '윤도윤', role: null, phone: '01099881103', birth: '2004-02-03' }, // 합류 안 함
];

assertSeedTarget(URL, 'seed-qa-1102.mjs');
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const session = async (email) => {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`로그인 실패 ${email}: ${error.message}`);
  return c;
};
const must = async (label, p) => {
  const { error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  console.log(`  ✓ ${label}`);
};

async function findUser(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u || data.users.length < 200) return u ?? null;
  }
}

/** 있으면 비밀번호만 맞추고, 없으면 만든다(새 계정만 · 기존 계정은 새로 만들지 않는다). */
async function ensureUser(email, meta) {
  const found = await findUser(email);
  if (found) {
    await must(`비밀번호 맞춤 ${email}`, db.auth.admin.updateUserById(found.id, { password: PASSWORD, email_confirm: true }));
    return found.id;
  }
  if (!meta) throw new Error(`계정이 없음: ${email}(기존 계정이어야 한다)`);
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: meta });
  if (error) throw new Error(`계정 생성 ${email}: ${error.message}`);
  console.log(`  ✓ 계정 생성 ${email}`);
  return data.user.id;
}

async function main() {
  const { data: unit, error: uErr } = await db.from('units').select('id, invite_code, owner_id').eq('id', UNIT).maybeSingle();
  if (uErr) throw uErr;
  if (!unit) throw new Error(`매장이 없음: ${UNIT}`);

  console.log('1) 사장');
  const ownerId = await ensureUser(OWNER.email);
  if (unit.owner_id !== ownerId) throw new Error(`${UNIT} 사장이 ${OWNER.email} 이 아니다`);
  await must('사장 이름', db.from('profiles').update({ name: OWNER.name }).eq('id', ownerId));
  const owner = await session(OWNER.email);

  for (const s of STAFF) {
    console.log(`2) ${s.name} (${s.email})`);
    const meta = s.phone ? { name: s.name, role: 'junior', phone: s.phone, birth_date: s.birth } : null;
    const uid = await ensureUser(s.email, meta);
    if (s.phone) {
      const at = new Date().toISOString();
      await must('번호 인증 기록', db.from('phone_otps').upsert(
        { phone: s.phone, code_hash: 'qa-seed', expires_at: at, verified_at: at }, { onConflict: 'phone', ignoreDuplicates: true }));
    }
    await must('이름', db.from('profiles').update({ name: s.name }).eq('id', uid));
    if (!s.role) { console.log('  · 합류하지 않는 계정'); continue; }

    const { data: mem } = await db.from('unit_members').select('role').eq('unit_id', UNIT).eq('user_id', uid).maybeSingle();
    if (!mem) {
      if (!s.birth) throw new Error(`${s.email} 이 ${UNIT} 멤버가 아니다(기존 직원이어야 한다)`);
      const c = await session(s.email);
      // 0346 부터 바로 합류한다(승인 단계 없음 · approve_member 를 부르면 not_pending).
      await must('join_by_invite', c.rpc('join_by_invite', { p_code: unit.invite_code, p_birth_date: s.birth }));
    }

    const { data: now } = await db.from('unit_members').select('role').eq('unit_id', UNIT).eq('user_id', uid).single();
    if (now.role !== s.role) await must(`역할 ${now.role} → ${s.role}`, owner.rpc('set_member_role', { p_uid: uid, p_role: s.role }));
  }

  const { data: rows } = await db.from('unit_members').select('user_id, role').eq('unit_id', UNIT);
  console.log(`\n✓ 끝 · ${UNIT} 멤버 ${rows.length}명 · ${rows.map((r) => r.role).sort().join(', ')}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
