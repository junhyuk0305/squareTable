#!/usr/bin/env node
// qa-complete-profile.mjs — 소셜 로그인(OAuth) 프로필 완성 회귀 (0066 complete_profile)
//
// 왜 있나: OAuth 사용자는 가입 폼을 안 거쳐 handle_new_user 트리거가 phone/birth_date=null 인 결손
//   프로필을 만든다. 이 상태면 create_store/join_by_invite 가 birth_date_required 로 막혀 사용자가 갇힌다.
//   complete_profile(0066) 이 그 결손을 채워 '갇힘'을 푼다. 이 테스트는 실 백엔드에 대고
//   [트랩 존재 → 완성 → 해제]를 증명한다(데모 금지, 라이브 증명 — AGENTS.md).
//
// 매트릭스:
//   A OAuth 사장: create_store 트랩(birth_date_required) → complete_profile → create_store 성공 + role='owner'
//   B 필수 강제: birth_date 없이 complete_profile → birth_date_required
//   C OAuth 직원: join_by_invite 트랩 → complete_profile → join_by_invite 성공(승인대기)
//   D 전화 중복: 이미 쓰는 번호로 complete_profile → 예외 없이 phone=null 보류(계정 생존)
//
// 자가정리: 만든 테스트 계정은 끝에 delete_my_account 로 삭제.
// 실행: node scripts/qa-complete-profile.mjs
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
const normalizePhone = (p) => { const d = (p ?? '').replace(/\D/g, ''); return !d ? '' : (d.startsWith('82') ? '0' + d.slice(2) : d); };

// OAuth 결손 프로필 시뮬레이션: birth_date/phone 메타 없이 가입 → 트리거가 phone=null, birth_date=null 로 생성.
async function signUpOAuthLike(client, email, name) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { name } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session (email-confirm ON?)'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const cleanup = [];
try {
  // ── A: OAuth 사장 — 트랩 → 완성 → create_store 성공 ────────────────────────
  const owner = mk();
  const oid = await signUpOAuthLike(owner, `qa_cp_o_${s}@example.com`, 'CP사장');
  cleanup.push(owner);
  const { data: p0 } = await owner.from('profiles').select('phone').eq('id', oid).maybeSingle();
  check('A0 OAuth 결손 프로필: phone=null', p0?.phone == null, `phone=${p0?.phone}`);

  const { error: trapErr } = await owner.rpc('create_store', { p_store_name: 'CP매장', p_industry: '카페·디저트', p_biz_no: null, p_birth_date: null });
  check('A1 완성 전 create_store 트랩(birth_date_required)', /birth_date_required/.test(trapErr?.message ?? ''), trapErr?.message ?? '(에러 없음!)');

  const ownPhone = `0107${s.slice(0, 7)}`;
  const { error: cpErr } = await owner.rpc('complete_profile', { p_name: 'CP사장', p_phone: ownPhone, p_birth_date: '1990-01-15' });
  check('A2 complete_profile 성공', !cpErr, cpErr?.message ?? '');
  const { data: p1 } = await owner.from('profiles').select('phone').eq('id', oid).maybeSingle();
  check('A3 완성 후 phone 기록됨', normalizePhone(p1?.phone) === normalizePhone(ownPhone), `phone=${p1?.phone}`);

  const { data: cs, error: csErr } = await owner.rpc('create_store', { p_store_name: 'CP매장', p_industry: '카페·디저트', p_biz_no: null, p_birth_date: null });
  const row = Array.isArray(cs) ? cs[0] : cs;
  check('A4 완성 후 create_store 성공(트랩 해제)', !csErr && !!row?.invite_code, csErr?.message ?? `code=${row?.invite_code}`);
  const code = row?.invite_code;
  const { data: p2 } = await owner.from('profiles').select('role').eq('id', oid).maybeSingle();
  check('A5 create_store 로 role=owner 승격', p2?.role === 'owner', `role=${p2?.role}`);

  // ── B: birth_date 필수 강제 ────────────────────────────────────────────────
  const b = mk();
  const bid = await signUpOAuthLike(b, `qa_cp_b_${s}@example.com`, 'CP필수');
  cleanup.push(b);
  const { error: reqErr } = await b.rpc('complete_profile', { p_name: 'CP필수', p_phone: `0106${s.slice(0, 7)}`, p_birth_date: null });
  check('B1 birth_date 없이 완성 → birth_date_required', /birth_date_required/.test(reqErr?.message ?? ''), reqErr?.message ?? '(에러 없음!)');

  // ── C: OAuth 직원 — 트랩 → 완성 → join_by_invite 성공(승인대기) ────────────
  const staff = mk();
  const sid = await signUpOAuthLike(staff, `qa_cp_s_${s}@example.com`, 'CP직원');
  cleanup.push(staff);
  const { error: jTrap } = await staff.rpc('join_by_invite', { p_code: code });
  check('C1 완성 전 join 트랩(birth_date_required)', /birth_date_required/.test(jTrap?.message ?? ''), jTrap?.message ?? '(에러 없음!)');
  const { error: scpErr } = await staff.rpc('complete_profile', { p_name: 'CP직원', p_phone: `0108${s.slice(0, 7)}`, p_birth_date: '1992-03-03' });
  check('C2 직원 complete_profile 성공', !scpErr, scpErr?.message ?? '');
  const { data: ji, error: jErr } = await staff.rpc('join_by_invite', { p_code: code });
  check('C3 완성 후 join_by_invite 성공(트랩 해제)', !jErr && !!(Array.isArray(ji) ? ji[0] : ji)?.store_name, jErr?.message ?? '');

  // ── D: 전화번호 중복 → 예외 없이 phone=null 보류(계정 생존) ─────────────────
  const dupPhone = `0109${s.slice(0, 7)}`;
  const d1 = mk();
  const d1id = await signUpOAuthLike(d1, `qa_cp_d1_${s}@example.com`, 'CPdup1');
  cleanup.push(d1);
  await d1.rpc('complete_profile', { p_name: 'CPdup1', p_phone: dupPhone, p_birth_date: '1991-05-05' });
  const d2 = mk();
  const d2id = await signUpOAuthLike(d2, `qa_cp_d2_${s}@example.com`, 'CPdup2');
  cleanup.push(d2);
  const { error: dupErr } = await d2.rpc('complete_profile', { p_name: 'CPdup2', p_phone: dupPhone, p_birth_date: '1993-06-06' });
  check('D1 중복 번호 완성이 예외를 던지지 않음(계정 생존)', !dupErr, dupErr?.message ?? '');
  const { data: pd2 } = await d2.from('profiles').select('phone').eq('id', d2id).maybeSingle();
  check('D2 중복 번호는 보류(phone=null)', pd2?.phone == null, `phone=${pd2?.phone}`);

  // ── E: 완성화면의 실제 순서(사장) — create_store 가 생년월일을 직접 기록하며 성공 → complete_profile ──
  // 결손(birth_date=null) 프로필에 create_store(p_birth_date=지정) 를 바로 불러도 통과해야 한다(트랩 없음).
  const eo = mk();
  await signUpOAuthLike(eo, `qa_cp_e_${s}@example.com`, 'CP순서');
  cleanup.push(eo);
  const { data: eCs, error: eCsErr } = await eo.rpc('create_store', { p_store_name: 'CP순서매장', p_industry: '카페·디저트', p_biz_no: null, p_birth_date: '1988-08-08' });
  const eRow = Array.isArray(eCs) ? eCs[0] : eCs;
  check('E1 결손 프로필에 create_store(생년월일 지정) 바로 성공(완성화면 순서)', !eCsErr && !!eRow?.invite_code, eCsErr?.message ?? `code=${eRow?.invite_code}`);
  const { error: eCpErr } = await eo.rpc('complete_profile', { p_name: 'CP순서', p_phone: `0105${s.slice(0, 7)}`, p_birth_date: '1988-08-08' });
  check('E2 이어서 complete_profile(이름/전화) 성공', !eCpErr, eCpErr?.message ?? '');
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
