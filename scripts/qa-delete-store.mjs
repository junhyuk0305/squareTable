#!/usr/bin/env node
// qa-delete-store.mjs — delete_store(0061) 라이브 증명: 소유검증(크로스테넌트)·마지막매장·직원존재·cascade.
// 실행: node --env-file=.env.seed scripts/qa-delete-store.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
function loadEnv() { const env = { ...process.env }; try { const root = join(dirname(fileURLToPath(import.meta.url)), '..'); for (const f of ['.env', '.env.seed']) for (const l of readFileSync(join(root, f), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim(); } } catch {} return env; }
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SRV) { console.error('env 부족(.env.seed 필요)'); process.exit(2); }
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const rid = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  PASS', n, x)) : (fail++, console.log('  FAIL', n, x)); };
const phone = () => '010' + String(Math.floor(1e7 + Math.random() * 8e7));
async function mkOwner(tag) { const c = mk(); const { data, error } = await c.auth.signUp({ email: `ds_${tag}_${rid}@example.com`, password: pw, options: { data: { name: `DS_${tag}`, role: 'owner', phone: phone(), birth_date: '1990-01-15' } } }); if (error || !data.session) throw new Error(`${tag} signUp ${error?.message}`); return { c, uid: data.user.id }; }
async function store(c, n) { const { data, error } = await c.rpc('create_store', { p_store_name: n, p_industry: '카페·디저트', p_biz_no: null }); if (error) throw new Error(error.message); return (Array.isArray(data) ? data[0] : data).unit_id; }
// 유료화(0062) 후 2호점+ 생성은 기존 소유 매장 전부 multi 여야 한다 — 전역 스위치 토글 대신
// 실제 유료 경로(admin_activate_store)로 테스트 매장만 승격한다(프로덕션 페이월 무접촉).
async function promoteMulti(unit) { const { error } = await admin.rpc('admin_activate_store', { p_unit_id: unit, p_days: 1, p_plan: 'multi' }); if (error) throw new Error(`multi 승격(${unit}): ${error.message}`); }

async function main() {
  const O = await mkOwner('O');
  const A = await store(O.c, `DS_A_${rid}`);
  await promoteMulti(A);
  const B = await store(O.c, `DS_B_${rid}`); // 활성=B
  // A에 노하우 1건(cascade 검증용)
  const eid = `pb_${rid}_ds`;
  await O.c.from('playbook_entries').insert({ id: eid, unit_id: A, creator_id: O.uid, creator_name: 'DS', category: 'Know-how', title: 'x', square: {}, status: 'published' });
  // ★A로 전환 후 넣어야 RLS 통과 → 다시 B로
  await O.c.rpc('switch_active_unit', { p_unit_id: A });
  await O.c.from('playbook_entries').upsert({ id: eid, unit_id: A, creator_id: O.uid, creator_name: 'DS', category: 'Know-how', title: 'x', square: {}, status: 'published' });
  await O.c.rpc('switch_active_unit', { p_unit_id: B });

  const X = await mkOwner('X');
  const C = await store(X.c, `DS_C_${rid}`);

  // 1) 크로스테넌트: X는 O의 매장 A를 못 지운다
  const { error: xErr } = await X.c.rpc('delete_store', { p_unit_id: A });
  check('X→delete_store(A) 거부(not_owner)', /not_owner/.test(xErr?.message ?? ''), xErr?.message ?? '(삭제됨!)');
  const { data: aStill } = await admin.from('units').select('id').eq('id', A).maybeSingle();
  check('A 매장 여전히 존재(유출/파괴 없음)', !!aStill);

  // 2) O가 A 삭제 → 성공, 목록 1개(B), A 노하우 cascade 삭제
  const { error: dErr } = await O.c.rpc('delete_store', { p_unit_id: A });
  check('O→delete_store(A) 성공', !dErr, dErr?.message ?? '');
  const { data: units } = await O.c.rpc('my_units');
  check('삭제 후 내 매장 1개(B)', (units?.length ?? 0) === 1 && units?.[0]?.unit_id === B, `n=${units?.length}`);
  const { count: khLeft } = await admin.from('playbook_entries').select('id', { count: 'exact', head: true }).eq('unit_id', A);
  check('A 노하우 cascade 삭제(0건)', (khLeft ?? -1) === 0, `left=${khLeft}`);

  // 3) 마지막 매장 삭제 금지
  const { error: lastErr } = await O.c.rpc('delete_store', { p_unit_id: B });
  check('마지막 매장 삭제 거부(last_store)', /last_store/.test(lastErr?.message ?? ''), lastErr?.message ?? '(삭제됨!)');

  // 4) 직원 있는 매장 삭제 금지
  await promoteMulti(B); // A 삭제 후 O 소유=B뿐 — D 생성 전 B도 multi 필요
  const D = await store(O.c, `DS_D_${rid}`); // O: B, D
  const J = await mkOwner('J'); // 실유저(주니어로 멤버십만 부여)
  await admin.from('unit_members').insert({ user_id: J.uid, unit_id: D, role: 'junior' });
  const { error: staffErr } = await O.c.rpc('delete_store', { p_unit_id: D });
  check('직원 있는 매장 삭제 거부(store_has_staff)', /store_has_staff/.test(staffErr?.message ?? ''), staffErr?.message ?? '(삭제됨!)');

  // 정리
  for (const cli of [O.c, X.c, J.c]) { try { await cli.rpc('delete_my_account'); } catch {} }
  for (const uid of [O.uid, X.uid, J.uid]) { try { await admin.auth.admin.deleteUser(uid); } catch {} }
  for (const u of [A, B, C, D]) { try { await admin.from('units').delete().eq('id', u); } catch {} }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
