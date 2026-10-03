// qa-fixed-accounts.mjs — 고정 계정 하니스 공용(qa:draft · qa:roles, 2026-10-03)
//
// 계정을 만들지 않는다(메모리 feedback_qa_use_fixed_accounts · 사용자 결정 "하니스를 수정해. 고정계정만 쓰도록").
// 축 A(pilot1234) 사장·매니저·직원 + 타 테넌트용 미연결 점주(owner-solo, P9 예외 계정)를 로그인만 해서 쓴다.
// service_role 없이 돈다 — 정리는 사장 권한(RLS)으로 한다. 그래서 .env 만 있으면 된다.
//
// 이 파일이 하는 일은 셋이다.
//   ① 시작 전 전제 확인 — store_001 의 역할이 시드와 같은지(다르면 지난 실행이 원복을 못 한 것 → 중단).
//   ② 활성 매장을 store_001 로 맞추고, 바꿨다면 끝에 되돌린다(서버 판정이 auth_unit_id() 를 본다).
//   ③ 전후 상태 문자열(my_units 의 매장·역할·활성)을 만들어 하니스가 같음을 단정하게 한다.
import { createClient } from '@supabase/supabase-js';

export const PW = 'pilot1234';
export const UNIT = 'store_001';
export const FIXED = {
  owner:   'owner@pilot.squaretable.app',      // 김영자 · store_001 소유
  manager: 'staff@pilot.squaretable.app',      // 박지원 · store_001 매니저(unit_members.role)
  junior:  'staff2@pilot.squaretable.app',     // 이수민 · store_001 직원
  other:   'owner-solo@pilot.squaretable.app', // 타 테넌트 점주 · store_29c18aee3d
};
// 시드 상태의 store_001 역할. 이것과 다르면 시작하지 않는다.
const EXPECTED_ROLE = { owner: 'owner', manager: 'manager', junior: 'junior' };

export async function login(url, anon, email) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  c.uid = data.user.id;
  return c;
}

/** 계정별 my_units 를 "매장:역할:활성" 으로 줄 세운 문자열. 전후 비교용. */
export async function stateLine(clients) {
  const out = [];
  for (const [k, c] of Object.entries(clients)) {
    const { data, error } = await c.rpc('my_units');
    if (error) throw new Error(`${k} my_units: ${error.message}`);
    const rows = (data ?? []).map((r) => `${r.unit_id}:${r.role}:${r.is_active ? 'A' : '-'}`).sort();
    out.push(`${k}=[${rows.join(',')}]`);
  }
  return out.join(' ');
}

/** store_001 역할이 시드와 같은지. 다르면 이유 문자열, 같으면 null. */
export async function rolePrecondition(clients) {
  for (const [k, want] of Object.entries(EXPECTED_ROLE)) {
    const c = clients[k];
    if (!c) continue;
    const { data } = await c.rpc('my_units');
    const row = (data ?? []).find((r) => r.unit_id === UNIT);
    if (row?.role !== want) return `${FIXED[k]} 의 ${UNIT} 역할=${row?.role ?? '없음'} (기대 ${want})`;
  }
  return null;
}

/** 활성 매장을 UNIT 으로 맞춘다. 바꿨으면 원래 매장 id 를, 아니면 null 을 돌려준다. */
export async function ensureActive(c) {
  const { data } = await c.rpc('my_units');
  const cur = (data ?? []).find((r) => r.is_active)?.unit_id ?? null;
  if (cur === UNIT) return null;
  const { error } = await c.rpc('switch_active_unit', { p_unit_id: UNIT });
  if (error) throw new Error(`활성 매장 전환 실패: ${error.message}`);
  console.log(`  · 활성 매장 ${cur} → ${UNIT} (끝나면 되돌림)`);
  return cur;
}

export async function restoreActive(c, prev) {
  if (!prev) return;
  const { error } = await c.rpc('switch_active_unit', { p_unit_id: prev });
  if (error) console.log(`  ! 활성 매장 되돌리기 실패(${prev}): ${error.message}`);
}
