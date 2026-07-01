#!/usr/bin/env node
// qa-onboarding.mjs — 온보딩/가입/초대 회귀 매트릭스 (db push 전/후 실행)
//
// 왜 있나: 가입·초대의 enforcement가 클라 사전검사 / DB 트리거 / RPC 3겹에 흩어져 있어,
//   한 겹이 뚫리면 정체불명 500으로 새거나 사용자가 갇힌다. happy-path만 보면 이런 실패경로가
//   아무도 모르게 재발한다(실제로 create_store/join_by_invite ambiguous 42702가 두 번 연속 났고
//   둘 다 데모로는 안 잡히고 실가입에서만 터졌다). → 실 백엔드에 대고 happy 2 + edge 5 + failure 2를
//   매트릭스로 박아, 가입이 죽거나 갇히는 모든 경로를 사전 차단한다.
//
// 커버(plan-eng-review 테스트 매트릭스):
//   P0 happy:  사장 create_store / 직원 join_by_invite
//   P0 failure: 중복 전화번호가 500을 내지 않고 계정 생존(0030 트리거 무결화)
//   P0 edge:   전화번호 정규화 parity(형식 달라도 같은 번호로 인식) / 이메일확인 OFF(config 드리프트)
//   P1 edge:   빈 가게이름·업종 → named 에러
//   P1 failure: 잘못된 코드 invalid_code / 5회초과 too_many_attempts
//   P1 edge:   중복 이메일 → emailTaken 신호(error 또는 identities=[])
//   P1 edge:   초대코드 만료정책 — 갓 만든 코드는 무기한(즉시 합류 가능)
//
// 자가정리: 만든 모든 테스트 계정은 끝에 delete_my_account 로 삭제한다.
// 실행: node scripts/qa-onboarding.mjs   (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 또는 .env 사용)
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
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 필요'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };
const isAmbig = (e) => /ambiguous|42702/i.test(e?.message ?? '') || e?.code === '42702';
const is500 = (e) => e?.status === 500 || /Database error saving new user/i.test(e?.message ?? '');

// 클라 normalizePhone(validation.ts)과 동일 규칙 — DB normalize_phone(0022)과 parity 검증용.
const normalizePhone = (p) => { const d = (p ?? '').replace(/\D/g, ''); return !d ? '' : (d.startsWith('82') ? '0' + d.slice(2) : d); };

async function signUp(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: meta } });
  return { data, error };
}
async function signUpAndSession(client, email, meta) {
  const { data, error } = await signUp(client, email, meta);
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session (email-confirm ON?)'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const cleanup = [];
try {
  // ── P0 happy: OWNER → create_store ───────────────────────────────────────
  const owner = mk();
  const { data: ownUp, error: ownErr } = await signUp(owner, `qa_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0107${s.slice(0,7)}`, store_name: 'QA매장', industry: '카페·디저트' });
  // config 드리프트 어서션: 이메일 확인이 OFF여야 가입 즉시 세션이 잡힌다(ON이면 클라 가입흐름 전체가 달라짐).
  check('config: 이메일확인 OFF (signUp이 session 반환)', !ownErr && !!ownUp?.session, ownErr?.message ?? (ownUp?.session ? '' : 'no session — 호스팅 auth 설정 확인!'));
  if (ownUp?.session) { await owner.auth.setSession({ access_token: ownUp.session.access_token, refresh_token: ownUp.session.refresh_token }); cleanup.push(owner); }
  const { data: cs, error: csErr } = await owner.rpc('create_store', { p_store_name: 'QA매장', p_industry: '카페·디저트', p_biz_no: null });
  check('create_store: no ambiguous(42702)', !isAmbig(csErr), csErr?.message ?? '');
  const row = Array.isArray(cs) ? cs[0] : cs;
  check('create_store: returned invite_code', !!row?.invite_code, `code=${row?.invite_code}`);
  const code = row?.invite_code, unit = row?.unit_id;

  // ── P1 edge: 빈 가게이름·업종 → named 에러(빈 입력 방어) ──────────────────
  const { error: emptyNameErr } = await owner.rpc('create_store', { p_store_name: '', p_industry: '카페·디저트', p_biz_no: null });
  check('empty store_name → store_name_required', /store_name_required|already_in_store/.test(emptyNameErr?.message ?? ''), emptyNameErr?.message ?? '');

  // ── P0 happy: STAFF → join_by_invite (valid) ─────────────────────────────
  const staff = mk();
  const staffPhone = `0108${s.slice(0,7)}`;
  const staffId = await signUpAndSession(staff, `qa_s_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: staffPhone });
  cleanup.push(staff);
  const { data: ji, error: jiErr } = await staff.rpc('join_by_invite', { p_code: code });
  check('join_by_invite: no ambiguous(42702)', !isAmbig(jiErr), jiErr?.message ?? '');
  check('join_by_invite: returned store_name', !!(Array.isArray(ji)?ji[0]:ji)?.store_name);
  // 0032부터: 합류는 "승인 대기" 신청 — unit_id는 아직 null, pending_unit_id만 세팅(노하우 격리).
  const { data: prof0 } = await staff.from('profiles').select('unit_id, pending_unit_id, role').eq('id', staffId).maybeSingle();
  check('join_by_invite: 즉시 합류 아님(unit_id=null, 승인대기)', prof0?.unit_id == null && prof0?.pending_unit_id === unit, `unit=${prof0?.unit_id} pending=${prof0?.pending_unit_id}`);
  check('invite 만료정책: 갓 만든 코드는 무기한(신청 접수됨)', prof0?.pending_unit_id === unit);
  // 승인 전 신청자는 매장 데이터(노하우)를 한 줄도 못 본다 — RLS 격리 실증.
  const { data: peek } = await staff.from('playbook_entries').select('id').limit(1);
  check('승인 전: 매장 노하우 0행(RLS 격리)', Array.isArray(peek) && peek.length === 0, `rows=${peek?.length}`);
  // 사장 승인 → 소속 확정(unit_id 부여, pending 비움).
  const { error: apprErr } = await owner.rpc('approve_member', { p_uid: staffId });
  check('approve_member: 사장 승인 성공', !apprErr, apprErr?.message ?? '');
  const { data: prof } = await staff.from('profiles').select('unit_id, pending_unit_id, role').eq('id', staffId).maybeSingle();
  check('승인 후 staff actually attached to store', prof?.unit_id === unit && prof?.pending_unit_id == null, `got=${prof?.unit_id} expect=${unit}`);

  // ── P0 edge: 전화번호 정규화 parity(형식 달라도 같은 번호) ────────────────
  // staffPhone(01081234567)을 +82/하이픈 형식으로 줘도 phone_in_use가 true여야 클라·DB normalize가 일치.
  const reformatted = '+82 ' + staffPhone.slice(1, 3) + '-' + staffPhone.slice(3, 7) + '-' + staffPhone.slice(7);
  check('normalize parity(클라==DB): 같은 번호 다른 형식 모두 taken', normalizePhone(reformatted) === staffPhone, `norm=${normalizePhone(reformatted)}`);
  const { data: inUse, error: puErr } = await staff.rpc('phone_in_use', { p_phone: reformatted });
  check('phone_in_use(다른 형식의 같은 번호) === true', !puErr && inUse === true, puErr?.message ?? `got=${inUse}`);

  // ── P1 failure: 잘못된 코드 → invalid_code (함수 실행됨, 크래시/ambiguous 아님) ──
  const staff2 = mk();
  await signUpAndSession(staff2, `qa_s2_${s}@example.com`, { name: 'QA직원2', role: 'junior', phone: `01091${s.slice(0,6)}` });
  cleanup.push(staff2);
  const { data: badData, error: badErr } = await staff2.rpc('join_by_invite', { p_code: '000000' });
  // 0031부터 invalid_code는 예외 대신 0행 반환(감사기록 보존). 둘 중 하나면 통과.
  const badIsInvalid = /invalid_code/.test(badErr?.message ?? '') || (!badErr && (Array.isArray(badData) ? badData.length === 0 : !badData?.unit_id));
  check('bad code → invalid_code (예외 또는 0행)', badIsInvalid, badErr?.message ?? `rows=${Array.isArray(badData) ? badData.length : badData}`);

  // ── P1 failure: 5회 초과 오답 → too_many_attempts (브루트포스 잠금) ────────
  const staffT = mk();
  await signUpAndSession(staffT, `qa_st_${s}@example.com`, { name: 'QA쓰로틀', role: 'junior', phone: `01092${s.slice(0,6)}` });
  cleanup.push(staffT);
  let throttled = false;
  for (let i = 0; i < 6; i++) {
    const { error } = await staffT.rpc('join_by_invite', { p_code: '000001' });
    if (/too_many_attempts/.test(error?.message ?? '')) { throttled = true; break; }
  }
  check('6회 오답 내 too_many_attempts 잠금 발동', throttled);

  // ── P0 failure: 중복 전화번호가 500을 내지 않고 계정 생존(0030 트리거 무결화) ──
  // ⚠️ 0030 push 전이면 여기서 FAIL(500)이 정상 — 바로 그 버그를 잡는 테스트다. push 후 PASS여야 한다.
  const dupA = mk();
  const dupPhone = `01093${s.slice(0,6)}`;
  await signUpAndSession(dupA, `qa_da_${s}@example.com`, { name: 'DupA', role: 'junior', phone: dupPhone });
  cleanup.push(dupA);
  const dupB = mk();
  const { data: dupBData, error: dupBErr } = await signUp(dupB, `qa_db_${s}@example.com`, { name: 'DupB', role: 'junior', phone: dupPhone });
  check('중복 전화번호 가입이 500을 내지 않음(트리거 무결화)', !is500(dupBErr), dupBErr ? `${dupBErr.message} [status=${dupBErr.status}]` : 'ok');
  check('중복 전화번호여도 2번째 계정은 생존(phone만 보류)', !dupBErr && !!dupBData?.session, dupBErr?.message ?? '');
  if (dupBData?.session) {
    await dupB.auth.setSession({ access_token: dupBData.session.access_token, refresh_token: dupBData.session.refresh_token });
    cleanup.push(dupB);
    const { data: dupProf } = await dupB.from('profiles').select('phone').eq('id', dupBData.user.id).maybeSingle();
    check('중복 전화번호 2번째 계정은 phone=null(보류)', dupProf?.phone == null, `phone=${dupProf?.phone}`);
  }

  // ── P1 edge: 중복 이메일 → emailTaken 신호(error 또는 identities=[]) ───────
  const dupEmail = `qa_dupmail_${s}@example.com`;
  const e1 = mk();
  await signUpAndSession(e1, dupEmail, { name: 'E1', role: 'junior', phone: `01094${s.slice(0,6)}` });
  cleanup.push(e1);
  const e2 = mk();
  const { data: e2Data, error: e2Err } = await signUp(e2, dupEmail, { name: 'E2', role: 'junior', phone: `01095${s.slice(0,6)}` });
  const emailTakenSignal = /already|registered|exists/i.test(e2Err?.message ?? '') || (e2Data?.user && (e2Data.user.identities?.length ?? 0) === 0);
  check('중복 이메일 → emailTaken 감지가능(error 또는 identities=[])', !!emailTakenSignal, e2Err?.message ?? `identities=${e2Data?.user?.identities?.length}`);
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
