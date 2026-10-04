#!/usr/bin/env node
// qa-definer-filters.mjs — 정의자 함수와 RLS 정책 본문에 꼭 있어야 할 조건이 남아 있는지 본다 (로컬 도커 · 영구 검사)
//
// 왜: 같은 함수를 여러 마이그레이션이 차례로 다시 정의한다(마스터 계획 §4 함수 담당표). 뒤 파일이 옛 정본에서
//   복사해 시작하면 앞 수정(24시간 조건 · 적용 기간 · 본사 사본 숨김 · iap 슬롯만 배정)이 조용히 사라진다.
//   마이그레이션 안의 한 번짜리 자가점검은 다음 마이그레이션의 퇴행을 잡지 못한다(데이터 검토 H5 · 위험 §10-3·4).
//   그래서 매 단계 뒤에 지금 DB 의 pg_get_functiondef 본문으로 토큰을 단정한다.
//
// 읽기 전용이다. 계정을 만들지 않는다. docker exec psql 로만 읽으므로 로컬 도커에서만 돈다.
// 단계가 늘면(0246 archived_tenure_id · 0247 member_notices · 0248 archived_at) 아래 표에 토큰을 더한다.
import { execFileSync } from 'node:child_process';

const psql = (sql) => execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

try { psql('select 1'); } catch (e) {
  console.error('중단: 로컬 도커 DB(supabase_db_SquareTable)에 붙을 수 없다 —', String(e.stderr ?? e.message).trim());
  process.exit(2);
}

/** 이름이 같은 함수(오버로드 포함) 본문 전부. 없으면 빈 배열. */
const bodies = (name) => {
  const out = psql(`select string_agg(pg_get_functiondef(p.oid), E'\\n<<<FN>>>\\n') from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname = '${name}'`);
  return out ? out.split('\n<<<FN>>>\n') : [];
};

// 함수 → 꼭 있어야 할 토큰. 오버로드가 여럿이면 전부가 토큰을 가져야 한다.
const FN_TOKENS = {
  // P1-1 0234(Q4) · P4-1 0242(J1)
  owner_today: ['valid_from', '24 hours', 'shift_exceptions', 'owner_id = auth.uid()'],
  // P1-2 0235(Q5 · H8)
  sync_iap_slots: ["source = 'iap'", 'p_continuing'],
  // 0231(본사 사본 숨김)
  approve_member: ['brand_hidden'],
  // P4-1 0242 — 적용 기간을 모르는 판정이 하나라도 남으면 근무가 두 번 잡힌다(설계 01 §7-1)
  workers_at: ['valid_from', 'valid_to', 'shift_exceptions'],
  my_cross_summary: ['valid_from', 'shift_exceptions'],
  my_cross_summary_v2: ['valid_from', 'valid_to', 'shift_exceptions'],
  owner_labor_inputs: ['valid_from', 'shift_exceptions', 'owner_id = auth.uid()'],
  owner_labor_inputs_v2: ['valid_from', 'valid_to', 'shift_exceptions', 'owner_id = auth.uid()'],
  shift_templates_all: ['valid_from', 'unit_members', 'auth_can_manage'],
  transfer_shift: ['valid_from', 'shift_exceptions'],
  approve_swap: ['p_confirm_past', 'kst_today() - 35', 'transfer_shift', 'auth_can_manage'],
  due_quiz_sends: ['valid_to', 'workers_at'],
};

console.log('[1] 정의자 함수 본문 토큰');
for (const [fn, tokens] of Object.entries(FN_TOKENS)) {
  const defs = bodies(fn);
  if (defs.length === 0) { check(`${fn} 이 있다`, false, '함수 없음'); continue; }
  for (const t of tokens) {
    const missing = defs.filter((d) => !d.includes(t)).length;
    check(`${fn} ⊇ ${t}`, missing === 0, `${defs.length}개 정의 중 ${missing}개에 없음`);
  }
}

console.log('\n[2] RLS 정책 본문');
const pol = (table, name) => psql(`select coalesce(qual, '') || ' | ' || coalesce(with_check, '') from pg_policies
                                    where schemaname = 'public' and tablename = '${table}' and policyname = '${name}'`);
{
  const r = pol('shift_templates', 'st_read');
  check('shift_templates.st_read ⊇ valid_from (옛 앱에는 오늘 적용 중인 반복 행만)', r.includes('valid_from'), r || '정책 없음');
  check('shift_templates.st_read ⊇ kst_today', r.includes('kst_today'), r || '정책 없음');
  const w = psql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'shift_templates' and cmd = 'ALL'`);
  check('shift_templates 에 FOR ALL 정책이 없다(있으면 관리자에게 읽기 필터가 안 먹는다)', w === '0', `FOR ALL 정책 ${w}개`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
