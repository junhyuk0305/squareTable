#!/usr/bin/env node
// qa-onboarding.mjs — 온보딩 RPC 회귀 스모크 테스트 (db push 전/후 실행)
//
// 왜 있나: create_store / join_by_invite 는 RETURNS TABLE(unit_id, store_name, ...) 의
//   OUT 파라미터가 profiles.unit_id / units.store_name 컬럼과 이름이 겹쳐, 본문에서
//   테이블 한정 없이 unit_id/store_name 을 참조하면 plpgsql variable_conflict(42702,
//   "column reference ... is ambiguous")로 매 호출 터진다. 이 부류 버그가 create_store(0028)·
//   join_by_invite(0029) 두 번 연속 났고, 둘 다 데모(mock)로는 안 잡히고 실가입에서만 터졌다.
//   → 실 백엔드에 대고 사장 가입→가게생성→직원 가입→코드합류 전 경로를 돌려 42702/합류실패를 사전 차단.
//
// 자가정리: 만든 테스트 계정(owner/staff/staff2)은 끝에 delete_my_account 로 모두 삭제한다.
// 실행: node scripts/qa-onboarding.mjs   (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 또는 .env 사용)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// .env 로드(있으면) — EXPO_PUBLIC_* 우선.
function loadEnv() {
  const env = { ...process.env };
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* no .env */ }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 필요'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };
const isAmbig = (e) => /ambiguous|42702/i.test(e?.message ?? '') || e?.code === '42702';

async function signUpAndSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: meta } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session (email-confirm ON?)'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const cleanup = [];
try {
  // 1) OWNER → create_store
  const owner = mk();
  await signUpAndSession(owner, `qa_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0107${s.slice(0,7)}`, store_name: 'QA매장', industry: '카페·디저트' });
  cleanup.push(owner);
  const { data: cs, error: csErr } = await owner.rpc('create_store', { p_store_name: 'QA매장', p_industry: '카페·디저트', p_biz_no: null });
  check('create_store: no ambiguous(42702)', !isAmbig(csErr), csErr?.message ?? '');
  const row = Array.isArray(cs) ? cs[0] : cs;
  check('create_store: returned invite_code', !!row?.invite_code, `code=${row?.invite_code}`);
  const code = row?.invite_code, unit = row?.unit_id;

  // 2) STAFF → join_by_invite (valid)
  const staff = mk();
  const staffId = await signUpAndSession(staff, `qa_s_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: `0108${s.slice(0,7)}` });
  cleanup.push(staff);
  const { data: ji, error: jiErr } = await staff.rpc('join_by_invite', { p_code: code });
  check('join_by_invite: no ambiguous(42702)', !isAmbig(jiErr), jiErr?.message ?? '');
  check('join_by_invite: returned store_name', !!(Array.isArray(ji)?ji[0]:ji)?.store_name);
  const { data: prof } = await staff.from('profiles').select('unit_id, role').eq('id', staffId).maybeSingle();
  check('staff actually attached to store', prof?.unit_id === unit, `got=${prof?.unit_id} expect=${unit}`);

  // 3) STAFF2 → bad code must be invalid_code (function ran), not ambiguous/crash
  const staff2 = mk();
  await signUpAndSession(staff2, `qa_s2_${s}@example.com`, { name: 'QA직원2', role: 'junior', phone: `0109${s.slice(0,7)}` });
  cleanup.push(staff2);
  const { error: badErr } = await staff2.rpc('join_by_invite', { p_code: '000000' });
  check('bad code → invalid_code (function executed)', /invalid_code/.test(badErr?.message ?? ''), badErr?.message ?? '');
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  // 자가정리: 테스트 계정 + 매장 파기
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
