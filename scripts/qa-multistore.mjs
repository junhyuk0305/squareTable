#!/usr/bin/env node
// qa-multistore.mjs — 다점포(0055) 라이브 증명.
// 한 사장이 2매장 생성 → my_units 2개 → 매장별 격리(unit_subscriptions) → 전환 → SPOF(비멤버 전환 거부).
// 자가정리: delete_my_account. 실행: node scripts/qa-multistore.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const URL = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('FAIL: SUPABASE URL/ANON 필요'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

async function main() {
  const owner = mk();
  const { error: upErr } = await owner.auth.signUp({ email: `qa_ms_${s}@example.com`, password: pw, options: { data: { name: 'QA다점포', role: 'owner', phone: `0106${s.slice(0, 7)}` } } });
  if (upErr) { console.error('signUp 실패', upErr.message); process.exit(2); }

  // 1) 1호점 생성
  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const store1 = c1?.[0]?.unit_id;
  check('1호점 create_store 성공', !e1 && !!store1, store1 ?? e1?.message);

  // 2) 2호점 생성 — 오너 다점포 완화가 already_in_store로 막지 않아야 함
  const { data: c2, error: e2 } = await owner.rpc('create_store', { p_store_name: 'QA 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
  const store2 = c2?.[0]?.unit_id;
  check('2호점 create_store 성공(다점포 완화)', !e2 && !!store2 && store2 !== store1, store2 ?? e2?.message);

  // 3) my_units → 2개, 활성=2호점(마지막 생성)
  const { data: units } = await owner.rpc('my_units');
  check('my_units 2개 반환', (units?.length ?? 0) === 2, `n=${units?.length}`);
  const active = units?.find((u) => u.is_active)?.unit_id;
  check('활성매장 = 방금 만든 2호점', active === store2, `active=${active}`);

  // 4) 격리: 활성(2호점)에서 unit_subscriptions는 2호점 것만
  const { data: sub2 } = await owner.from('unit_subscriptions').select('unit_id');
  check('활성 2호점: 구독행 1개(2호점만)', (sub2?.length ?? 0) === 1 && sub2?.[0]?.unit_id === store2, `rows=${sub2?.length} u=${sub2?.[0]?.unit_id}`);

  // 5) 1호점으로 전환
  const { error: swErr } = await owner.rpc('switch_active_unit', { p_unit_id: store1 });
  check('switch_active_unit(1호점) 성공', !swErr, swErr?.message ?? '');

  // 6) 전환 후 격리: 이제 1호점 것만 (auth_unit_id 전파 실증)
  const { data: sub1 } = await owner.from('unit_subscriptions').select('unit_id');
  check('전환 후: 구독행 1개(1호점만)', (sub1?.length ?? 0) === 1 && sub1?.[0]?.unit_id === store1, `rows=${sub1?.length} u=${sub1?.[0]?.unit_id}`);

  // 7) SPOF 가드: 비멤버 매장으로 전환 시도 → not_a_member 거부
  const { error: spoofErr } = await owner.rpc('switch_active_unit', { p_unit_id: 'store_notamember1' });
  check('SPOF: 비멤버 매장 전환 거부', /not_a_member/.test(spoofErr?.message ?? ''), spoofErr?.message ?? '(거부 안됨!)');

  // 8) SPOF 심화: active_unit_id를 직접 위조해도(정책이 동결) 유출 없음 — 동결 거부 확인
  const { error: tamperErr } = await owner.from('profiles').update({ active_unit_id: 'store_notamember1' }).eq('id', (await owner.auth.getUser()).data.user.id);
  check('active_unit_id 직접 위조 차단(정책 동결)', !!tamperErr, tamperErr ? `거부 ${tamperErr.code ?? ''}` : '(차단 안됨!)');

  // 9) ★0056 활성-단위 시맨틱: 활성(2호점)에서 rename_store → 주매장(1호점) 아닌 '활성'이 바뀐다.
  //    (0056 미적용이면 주매장에 적용돼 2호점 이름이 안 바뀜 → 이 프로브가 회귀를 잡는다.)
  await owner.rpc('switch_active_unit', { p_unit_id: store2 });
  await owner.rpc('rename_store', { p_name: 'QA_2호점_개명' });
  const { data: units2 } = await owner.rpc('my_units');
  const r1 = units2?.find((u) => u.unit_id === store1);
  const r2 = units2?.find((u) => u.unit_id === store2);
  check('0056: rename_store가 활성(2호점)에 적용', r2?.store_name === 'QA_2호점_개명' && r1?.store_name !== 'QA_2호점_개명', `s1="${r1?.store_name}" s2="${r2?.store_name}"`);

  // 정리
  try { await owner.rpc('delete_my_account'); } catch { /* best-effort */ }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
