#!/usr/bin/env node
// qa-junior-multistore.mjs — Phase 0(직원 다매장) 크로스테넌트 + 라이프사이클 실증.
// 0067 마이그레이션(멤버십 SSOT=unit_members 통일) 적용 후 green이어야 한다.
//
// 실증:
//  · 격리: 직원 my_units=본인 소속만 / 자기매장 전환 OK / 같은오너 비소속·타테넌트 전환 거부 / active 직접위조 동결
//  · 다점포: 직원이 2번째 매장에 추가 합류(already_in_store 완화) → my_units 2개 → 전환 → RLS 활성매장만 열람
//  · ★보안: 내보내기(remove_staff)·나가기(leave_store) 후 그 매장 재전환 거부(멤버십 삭제로 재접근 차단)
//  · 회귀: 오너 전환 정상
// 자가정리: delete_my_account. 실행: node scripts/qa-junior-multistore.mjs (.env + .env.seed 필요)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const denied = async (client, unit) => /not_a_member/.test((await client.rpc('switch_active_unit', { p_unit_id: unit })).error?.message ?? '');
const ok = async (client, unit) => !(await client.rpc('switch_active_unit', { p_unit_id: unit })).error;

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// 0088 게이트 라이브 — 아래 signUp 이 쓰는 번호 전부를 '인증됨'으로 선등록해야 create_store/join 통과.
const qaPhones = [`0106${s.slice(0, 7)}`, `0105${s.slice(0, 7)}`, `0108${s.slice(0, 7)}`];
await seedVerifiedPhones(URL, SRV, qaPhones);

const cleanup = [];
try {
  // ── 오너 O: S1(→multi) + S2, 타 테넌트 O2: S3 ─────────────────────────────
  const owner = mk();
  await signUpSession(owner, `qa_jms_o_${s}@example.com`, { name: 'QA오너', role: 'owner', phone: `0106${s.slice(0, 7)}`, store_name: 'JMS1', industry: '카페·디저트' });
  cleanup.push(owner);
  const { data: c1 } = await owner.rpc('create_store', { p_store_name: 'JMS 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const S1 = c1?.[0]?.unit_id, code1 = c1?.[0]?.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: S1, p_days: 1, p_plan: 'multi' });
  const { data: c2 } = await owner.rpc('create_store', { p_store_name: 'JMS 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
  const S2 = c2?.[0]?.unit_id, code2 = c2?.[0]?.invite_code;
  check('setup: S1·S2 생성 + 초대코드', !!S1 && !!S2 && S1 !== S2 && !!code1 && !!code2, `S1=${S1} S2=${S2}`);

  const owner2 = mk();
  await signUpSession(owner2, `qa_jms_o2_${s}@example.com`, { name: 'QA오너2', role: 'owner', phone: `0105${s.slice(0, 7)}`, store_name: 'JMS3', industry: '카페·디저트' });
  cleanup.push(owner2);
  const { data: c3 } = await owner2.rpc('create_store', { p_store_name: 'JMS 3호점', p_industry: '카페·디저트', p_biz_no: null });
  const S3 = c3?.[0]?.unit_id;
  check('setup: 타 테넌트 S3', !!S3 && S3 !== S1 && S3 !== S2, `S3=${S3}`);

  // ── 직원 J: S1 합류 승인 ─────────────────────────────────────────────────
  const J = mk();
  const jId = await signUpSession(J, `qa_jms_j_${s}@example.com`, { name: 'QA알바', role: 'junior', phone: `0108${s.slice(0, 7)}` });
  cleanup.push(J);
  await J.rpc('join_by_invite', { p_code: code1 });
  await owner.rpc('switch_active_unit', { p_unit_id: S1 });
  const { error: appr1 } = await owner.rpc('approve_member', { p_uid: jId });
  check('setup: 직원 S1 합류 승인', !appr1, appr1?.message ?? '');

  // ── 격리(단일 소속) ──────────────────────────────────────────────────────
  let u = (await J.rpc('my_units')).data;
  check('★직원 my_units = S1 하나(타 매장 미노출)', (u?.length ?? 0) === 1 && u?.[0]?.unit_id === S1, `ids=[${(u ?? []).map((x) => x.unit_id)}]`);
  check('★직원: 자기 매장 S1 전환 성공', await ok(J, S1));
  check('★직원: 같은 오너 비소속 S2 전환 거부(not_a_member)', await denied(J, S2));
  check('★직원: 타 테넌트 S3 전환 거부(not_a_member)', await denied(J, S3));
  const { error: tamper } = await J.from('profiles').update({ active_unit_id: S2 }).eq('id', jId);
  check('★직원: active_unit_id 직접 위조 차단(RLS 동결)', !!tamper, tamper ? `거부 ${tamper.code ?? ''}` : '(차단 안됨!)');

  // ── 다점포: J가 S2에도 합류(already_in_store 완화) ───────────────────────
  const { error: ji2 } = await J.rpc('join_by_invite', { p_code: code2 });
  check('★직원: 2번째 매장 S2 합류 신청 허용', !ji2, ji2?.message ?? '');
  await owner.rpc('switch_active_unit', { p_unit_id: S2 });
  const { error: appr2 } = await owner.rpc('approve_member', { p_uid: jId });
  check('★직원: S2 합류 승인', !appr2, appr2?.message ?? '');
  // ★명부 가시성(0095): 승인 직후 S2 활성 사장이 J의 profiles 행을 읽어야 직원 목록에 보인다.
  // approve 는 profiles.unit_id(주매장 S1)를 보존하므로 멤버십(unit_members) 분기가 read 정책에 필요.
  { const { data } = await owner.from('profiles').select('id').eq('id', jId);
    check('★S2 사장 직원목록: 승인 직후 J 프로필 열람', (data?.length ?? 0) === 1, `rows=${data?.length ?? 0}`); }
  u = (await J.rpc('my_units')).data;
  const ids2 = (u ?? []).map((x) => x.unit_id).sort();
  check('★직원 my_units = S1+S2 둘', ids2.length === 2 && ids2.includes(S1) && ids2.includes(S2), `ids=[${ids2}]`);
  check('★직원: S2 전환 성공(승인됨)', await ok(J, S2));
  const jVis = (await J.from('units').select('id')).data;
  check('★직원: 활성 S2일 때 RLS로 S2만 열람', (jVis?.length ?? 0) === 1 && jVis?.[0]?.id === S2, `rows=${jVis?.length}`);

  // ── ★보안: 내보내면 재접근 불가 ─────────────────────────────────────────
  await owner.rpc('switch_active_unit', { p_unit_id: S2 });
  const { error: rm } = await owner.rpc('remove_staff', { p_staff_id: jId });
  check('★내보내기(remove_staff) 성공', !rm, rm?.message ?? '');
  u = (await J.rpc('my_units')).data;
  check('★내보낸 뒤 my_units에서 S2 사라짐(S1만)', (u ?? []).every((x) => x.unit_id !== S2) && (u ?? []).some((x) => x.unit_id === S1), `ids=[${(u ?? []).map((x) => x.unit_id)}]`);
  check('★내보낸 매장 S2 재전환 거부(not_a_member)', await denied(J, S2));

  // ── ★보안: 스스로 나가면 재접근 불가 ────────────────────────────────────
  await J.rpc('switch_active_unit', { p_unit_id: S1 });
  const { error: lv } = await J.rpc('leave_store');
  check('★나가기(leave_store) 성공', !lv, lv?.message ?? '');
  u = (await J.rpc('my_units')).data;
  check('★나간 뒤 my_units 비어있음', (u?.length ?? 0) === 0, `n=${u?.length}`);
  check('★나간 매장 S1 재전환 거부(not_a_member)', await denied(J, S1));

  // ── 회귀: 오너 전환 정상 ─────────────────────────────────────────────────
  check('회귀: 오너 S1 전환 여전히 성공', await ok(owner, S1));
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
