#!/usr/bin/env node
// qa-profile-update.mjs — 프로필 자가수정 회귀 (0050 적용 전/후 실행)
//
// 왜 있나: 0032 profiles_update WITH CHECK가 profiles를 재귀 SELECT → 42P17로
//   설정의 이름/소개/전화 저장이 전원 불능이었다(가입 QA는 자가수정 미검증이라 못 잡음).
//   이 테스트는 (1) 본인 name/bio 저장이 되고 (2) role/unit_id 자기변경은 여전히 막히는지를
//   실 백엔드에 대고 못박아 재발을 차단한다.
//
// 실행: node scripts/qa-profile-update.mjs   (.env anon 사용, service_role 있으면 하드정리)
//   적용 전: FAIL (42P17)  →  0050 적용 후: PASS
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const f of ['.env', '.env.seed']) {
      try { for (const line of readFileSync(join(root, f), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim(); } } catch {}
    }
  } catch {}
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON) { console.error('FAIL: env 없음'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m} ${x}`); c ? pass++ : fail++; };
const rid = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

(async () => {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const ph = '010' + String(Math.floor(1e7 + Math.random() * 8e7));
  await seedVerifiedPhones(URL, SRV, [ph]); // 0088 게이트 라이브 — 미인증 번호는 create_store가 차단
  const { data: su, error: se } = await c.auth.signUp({ email: `pu_${rid}@example.com`, password: 'Test!2345', options: { data: { name: '원래이름', role: 'owner', phone: ph, phone_last4: ph.slice(-4), birth_date: '1990-01-15' } } });
  if (se || !su.session) { console.error('FAIL signUp:', se?.message); process.exit(2); }
  await c.rpc('create_store', { p_store_name: `PU_${rid}`, p_industry: '카페·디저트', p_biz_no: null });
  const uid = su.user.id;

  // 1) 본인 name/bio 저장 → 성공해야
  // ⚠️ returning 은 명시 컬럼만 — 0065부터 birth_date 는 컬럼 권한에서 제외라 select('*')는 의도적으로 42501.
  //    (앱 실경로 db.ts 도 전부 명시 컬럼 — select('*') 금지가 규약이다.)
  const r1 = await c.from('profiles').update({ name: '수정된이름', bio: '소개글' }).eq('id', uid).select('id,name,bio');
  ok(!r1.error && (r1.data?.length || 0) === 1, '본인 name/bio 저장 성공', r1.error ? `(❌ ${r1.error.code} ${r1.error.message.slice(0, 40)})` : `rows=${r1.data.length}`);
  const { data: after } = await c.from('profiles').select('name,bio,role,unit_id').eq('id', uid).single();
  ok(after?.name === '수정된이름' && after?.bio === '소개글', '저장값 반영 확인', `name=${after?.name}`);

  // 2) 본인 전화 갱신 → 성공해야
  const ph2 = '010' + String(Math.floor(1e7 + Math.random() * 8e7));
  const r2 = await c.from('profiles').update({ phone: ph2, phone_last4: ph2.slice(-4) }).eq('id', uid).select('id,phone');
  ok(!r2.error && (r2.data?.length || 0) === 1, '본인 전화번호 갱신 성공', r2.error ? `(❌ ${r2.error.code})` : `rows=${r2.data.length}`);

  // 3) role 자기변경(owner→junior 아무거나) → 동결로 막혀야 (0행 또는 에러), role 유지
  const r3 = await c.from('profiles').update({ role: 'junior' }).eq('id', uid).select();
  const { data: chk3 } = await c.from('profiles').select('role').eq('id', uid).single();
  ok((r3.error || (r3.data?.length || 0) === 0) && chk3?.role === 'owner', 'role 자기변경 차단(동결 유지)', r3.error ? `(차단 ${r3.error.code})` : `rows=${r3.data.length} role=${chk3?.role}`);

  // 4) unit_id 자기변경(다른 매장으로) → 동결로 막혀야
  const r4 = await c.from('profiles').update({ unit_id: 'store_ATTACKER' }).eq('id', uid).select();
  const { data: chk4 } = await c.from('profiles').select('unit_id').eq('id', uid).single();
  ok((r4.error || (r4.data?.length || 0) === 0) && chk4?.unit_id !== 'store_ATTACKER', 'unit_id 자기변경 차단(동결 유지)', r4.error ? `(차단 ${r4.error.code})` : `unit=${chk4?.unit_id}`);

  // 5) pending_unit_id 자기변경(승인게이트 우회 시도) → 막혀야
  const r5 = await c.from('profiles').update({ pending_unit_id: 'store_VICTIM' }).eq('id', uid).select();
  const { data: chk5 } = await c.from('profiles').select('pending_unit_id').eq('id', uid).single();
  ok((r5.error || (r5.data?.length || 0) === 0) && chk5?.pending_unit_id !== 'store_VICTIM', 'pending_unit_id 자기변경 차단', r5.error ? `(차단 ${r5.error.code})` : `pending=${chk5?.pending_unit_id}`);

  // 정리
  try { await c.rpc('delete_my_account'); } catch {}
  await cleanupSeededPhones(URL, SRV, [ph]);
  if (SRV) {
    const a = createClient(URL, SRV, { auth: { persistSession: false } });
    await a.from('units').delete().like('store_name', 'PU_%');
    let p = 1; for (;;) { const res = await fetch(`${URL}/auth/v1/admin/users?page=${p}&per_page=200`, { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } }); const j = await res.json(); const us = j.users || []; for (const u of us) if ((u.email || '').startsWith('pu_')) await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } }); if (us.length < 200) break; p++; }
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗', e.message); process.exit(2); });
