#!/usr/bin/env node
// qa-notif-ack.mjs — 알림 '모두 읽기'(0078 notif_ack_at) + 제안 반려 사유(owner_note) 라이브 검증
//                    (실 배포 백엔드 대상·자가정리)
//
// 왜 있나: 합류신청·질문·제안·교대 같은 '처리형' 알림은 read_by 로 읽음 처리가 불가능해 배지가 안 사라졌다.
//   0078 이 (user, unit) 단위 ack 시각(ack_notifications RPC)을 도입 — 이 하네스는 그 계약을 실세션으로 증명한다.
//   함께: 제안 반려 사유(owner_note)가 사장 반려 → 직원 조회(RLS)까지 왕복하는지.
//
// 커버:
//   T1  ack_notifications RPC 존재 + 사장 ack 성공(행 생성·notif_ack_at 기록)
//   T2  fetchMemberPrefs 경로(select notif_ack_at) — 0078 컬럼 라이브
//   T3  재호출 시 notif_ack_at 전진(모두 읽기 반복 가능)
//   T4  비멤버 ack 거부(not_a_member)
//   T5  직원 제안 → 사장 owner_note 반려 → 직원이 자기 제안에서 사유 조회(RLS 왕복)
//
// 실행: node scripts/qa-notif-ack.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  // .env.seed 는 phone_otps 인증 시드용 service_role 키 확보 목적(없으면 시드 스킵 — 게이트 미적용 환경).
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
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY; // 있으면 phone_otps 시드(게이트 0088 대비)
if (!URL || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 필요'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// 0088 게이트 라이브 — 아래 signUp 이 쓰는 번호(ph 61~63) 전부를 '인증됨'으로 선등록.
const qaPhones = ['61', '62', '63'].map((tag) => `010${tag}${s.slice(0, 6)}`);
const seededRes = await seedVerifiedPhones(URL, SERVICE, qaPhones);
if (seededRes.skipped) console.log(`  (phone_otps 시드 스킵: ${seededRes.skipped})`);

const cleanup = [];
try {
  const ph = (tag) => `010${tag}${s.slice(0, 6)}`;

  // ── 셋업: 매장 A(사장+직원1) + 무소속 계정 B ──────────────────────────────
  const owner = mk();
  await signUpSession(owner, `qa_na_o_${s}@example.com`, { name: 'NAOwner', role: 'owner', phone: ph('61'), store_name: 'NA', industry: '카페·디저트' });
  cleanup.push(owner);
  const { data: cs, error: csErr } = await owner.rpc('create_store', { p_store_name: 'NA', p_industry: '카페·디저트', p_biz_no: null });
  if (csErr) throw new Error(`create_store: ${csErr.message}`);
  const row = Array.isArray(cs) ? cs[0] : cs;
  const unitId = row.unit_id;
  const code = row.invite_code;

  const staff = mk();
  const staffId = await signUpSession(staff, `qa_na_s_${s}@example.com`, { name: 'NAStaff', role: 'junior', phone: ph('62') });
  cleanup.push(staff);
  await staff.rpc('join_by_invite', { p_code: code });
  await owner.rpc('approve_member', { p_uid: staffId });

  const outsider = mk();
  await signUpSession(outsider, `qa_na_x_${s}@example.com`, { name: 'NAOut', role: 'owner', phone: ph('63'), store_name: 'NAX', industry: '카페·디저트' });
  cleanup.push(outsider);

  console.log(`\n[셋업 완료] unit=${unitId}\n`);

  // ── T1 ack RPC — 사장 ack 성공 + 행 생성 ──────────────────────────────────
  const a1 = await owner.rpc('ack_notifications', { p_unit_id: unitId });
  check('T1a ack_notifications RPC 성공(0078 적용)', !a1.error, a1.error?.message ?? '');
  const r1 = await owner.from('unit_member_prefs').select('unit_id, notif_ack_at').eq('unit_id', unitId);
  const ack1 = r1.data?.[0]?.notif_ack_at;
  check('T1b 내 (user,unit) 행에 notif_ack_at 기록', !r1.error && !!ack1, r1.error?.message ?? String(ack1));

  // ── T2 앱 fetch 경로와 동일한 select — 0078 컬럼 라이브 ────────────────────
  const r2 = await owner.from('unit_member_prefs').select('unit_id, nickname, color, muted, quiet_enabled, quiet_start, quiet_end, notif_ack_at');
  check('T2 fetchMemberPrefs select(notif_ack_at 포함) 성공', !r2.error && Array.isArray(r2.data), r2.error?.message ?? '');

  // ── T3 재호출 시 시각 전진 ─────────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 1100));
  const a3 = await owner.rpc('ack_notifications', { p_unit_id: unitId });
  const r3 = await owner.from('unit_member_prefs').select('notif_ack_at').eq('unit_id', unitId);
  const ack3 = r3.data?.[0]?.notif_ack_at;
  check('T3 재호출 시 notif_ack_at 전진', !a3.error && !!ack3 && ack3 > ack1, `${ack1} → ${ack3}`);

  // ── T4 비멤버 ack 거부 ─────────────────────────────────────────────────────
  const a4 = await outsider.rpc('ack_notifications', { p_unit_id: unitId });
  check('T4 비멤버 ack 거부(not_a_member)', !!a4.error && /not_a_member/.test(a4.error.message), a4.error?.message ?? '거부 안 됨');

  // ── T5 제안 반려 사유 왕복(직원 제안 → 사장 owner_note 반려 → 직원 조회) ───
  const sugId = `sug_qa_${s}`;
  const ins = await staff.from('playbook_suggestions').insert({
    id: sugId, unit_id: unitId, kind: 'new', proposer_id: staffId, proposer_name: 'NAStaff',
    text: 'QA 제안 — 픽업대 물기 30분마다 닦기', status: 'pending', created_at: new Date().toISOString(),
  });
  check('T5a 직원 제안 등록', !ins.error, ins.error?.message ?? '');
  const rej = await owner.from('playbook_suggestions').update({
    status: 'rejected', owner_note: '이미 비슷한 노하우가 있어요', reviewed_at: new Date().toISOString(),
  }).eq('id', sugId).select('id');
  check('T5b 사장 반려 + owner_note 저장', !rej.error && rej.data?.length === 1, rej.error?.message ?? `rows=${rej.data?.length}`);
  const back = await staff.from('playbook_suggestions').select('status, owner_note, reviewed_at').eq('id', sugId);
  const b = back.data?.[0];
  check('T5c 직원이 자기 제안에서 반려 사유 조회(RLS)', !back.error && b?.status === 'rejected' && b?.owner_note === '이미 비슷한 노하우가 있어요' && !!b?.reviewed_at, back.error?.message ?? JSON.stringify(b));
} catch (e) {
  fail++;
  console.error('EXCEPTION:', e.message);
} finally {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* 이미 삭제/실패 무해 */ }
  }
  await cleanupSeededPhones(URL, SERVICE, qaPhones);
}

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — notif-ack QA · 통과 ${pass} / 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
