#!/usr/bin/env node
// qa-swap-guard.mjs — updateSwap 0행 유령 성공 재현(스키마 정정: template_id). 임시 QA.
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
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed: ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const qaPhones = ['0151', '0152', '0153'].map((p) => `${p}${s.slice(0, 7)}`);
await seedVerifiedPhones(URL, SRV, qaPhones);
const cleanup = [];
try {
  const O = mk(); const oId = await signUpSession(O, `qa_p7s_o_${s}@example.com`, { name: 'P7S사장', role: 'owner', phone: qaPhones[0] }); cleanup.push(O);
  const { data: c1 } = await O.rpc('create_store', { p_store_name: 'P7S 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const S1 = c1?.[0]?.unit_id, code1 = c1?.[0]?.invite_code;
  const J = mk(); const jId = await signUpSession(J, `qa_p7s_j_${s}@example.com`, { name: 'P7S직원', role: 'junior', phone: qaPhones[1] }); cleanup.push(J);
  await J.rpc('join_by_invite', { p_code: code1 }); await O.rpc('approve_member', { p_uid: jId });

  const day = new Date().toISOString().slice(0, 10);
  const shiftId = `p7s_sh_${s}`;
  const si = await O.from('shift_templates').insert({ id: shiftId, unit_id: S1, staff_id: jId, weekday: 1, start_time: '09:00', end_time: '18:00' }).select('id');
  check('setup: 시프트 생성', !si.error && (si.data?.length ?? 0) === 1, si.error?.message ?? '');

  const swapId = `p7s_sw_${s}`;
  // ★ swap_insert 는 requester_id = auth.uid() 를 요구한다 — 요청자 본인(직원)이 만든다.
  const ins = await J.from('swap_requests').insert({
    id: swapId, unit_id: S1, kind: 'cover', requester_id: jId, date: day, template_id: shiftId, status: 'open',
  }).select('id');
  check('setup: 교대요청 생성(open)', !ins.error && (ins.data?.length ?? 0) === 1, ins.error?.message ?? '');

  // 대조군: 행이 살아있을 때 승인 → 1행이어야 한다(writeStrict 오탐 없음 확인)
  const ok = await O.from('swap_requests').update({ status: 'approved' }).eq('id', swapId).select('id');
  check('대조군: 정상 승인은 1행(오탐 아님)', (ok.data?.length ?? 0) === 1, `rows=${ok.data?.length} err=${ok.error?.code ?? '-'}`);

  // 본 실험: 뒤에서 행 삭제 후 승인 → 0행이어야 writeStrict가 막는다
  await svc.from('swap_requests').delete().eq('id', swapId);
  const ghost = await O.from('swap_requests').update({ status: 'approved' }).eq('id', swapId).select('id');
  check('★P0 updateSwap: 사라진 행 승인 → 0행(=writeStrict false)',
    !ghost.error && (ghost.data?.length ?? 0) === 0, `rows=${ghost.data?.length} err=${ghost.error?.code ?? '-'}`);

  // 직원이 남의 교대를 승인하려 하면? (상태전이는 사장만)
  const swap2 = `p7s_sw2_${s}`;
  const i2 = await J.from('swap_requests').insert({ id: swap2, unit_id: S1, kind: 'cover', requester_id: jId, date: day, template_id: shiftId, status: 'open' }).select('id');
  check('setup2: 두번째 교대요청(open)', (i2.data?.length ?? 0) === 1, i2.error?.message ?? '');
  const jUp = await J.from('swap_requests').update({ status: 'approved' }).eq('id', swap2).select('id');
  console.log(`  [직원 승인 시도] rows=${jUp.data?.length ?? 0} err=${jUp.error?.code ?? '-'} ${jUp.error?.message ?? ''}`);
  check('직원: 교대 승인(approved) 전이 차단', (jUp.data?.length ?? 0) === 0, `rows=${jUp.data?.length}`);

  // 직원이 본인 요청을 본인이 수락(accepted)? — 자기수락 방지(0128 swap_no_self_accept)
  const jSelf = await J.from('swap_requests').update({ status: 'accepted', accepted_by: jId }).eq('id', swap2).select('id, status, accepted_by');
  console.log(`  [본인 수락 시도] rows=${jSelf.data?.length ?? 0} ${JSON.stringify(jSelf.data ?? jSelf.error?.message)}`);
  check('★0128: 본인 요청 셀프 수락 거부', (jSelf.data?.length ?? 0) === 0 && /swap_no_self_accept/.test(jSelf.error?.message ?? ''), jSelf.error?.code ?? '-');

  // ★과잉 차단 확인 — 진짜 경로(동료가 수락)는 그대로 통과해야 한다. 0128 이 정상 흐름을 막으면 기능이 죽는다.
  const K = mk();
  const kId = await signUpSession(K, `qa_p7s_k_${s}@example.com`, { name: 'P7S동료', role: 'junior', phone: qaPhones[2] });
  cleanup.push(K);
  await K.rpc('join_by_invite', { p_code: code1 }); await O.rpc('approve_member', { p_uid: kId });
  const kAcc = await K.from('swap_requests').update({ status: 'accepted', accepted_by: kId }).eq('id', swap2).select('id, status, accepted_by');
  check('★회귀: 동료 수락은 정상 통과', (kAcc.data?.length ?? 0) === 1 && kAcc.data[0].status === 'accepted',
    `rows=${kAcc.data?.length} ${kAcc.error?.message ?? ''}`);
  // 그 뒤 사장 확정도 되는지 — 상태머신 끝까지
  const oApp = await O.from('swap_requests').update({ status: 'approved' }).eq('id', swap2).select('id, status');
  check('★회귀: 사장 확정까지 도달', (oApp.data?.length ?? 0) === 1 && oApp.data[0].status === 'approved', `rows=${oApp.data?.length}`);
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
