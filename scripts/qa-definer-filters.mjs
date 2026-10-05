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
  owner_today: ['valid_from', '24 hours', 'shift_exceptions', 'owner_id = auth.uid()', 'archived_tenure_id'],
  // P1-2 0235(Q5 · H8)
  sync_iap_slots: ["source = 'iap'", 'p_continuing'],
  // 0231(본사 사본 숨김) · P4-6 0247(Q22 승인·반려 알림) · P5-1 0248(J10 노하우가 전부 보관된 코스는 첫 퀴즈로 고르지 않는다)
  approve_member: ['brand_hidden', 'insert into public.member_notices', 'archived_at'],
  reject_member: ['insert into public.member_notices', "'rejected'", 'not_pending'],
  // P4-1 0242 — 적용 기간을 모르는 판정이 하나라도 남으면 근무가 두 번 잡힌다(설계 01 §7-1)
  workers_at: ['valid_from', 'valid_to', 'shift_exceptions', 'archived_tenure_id'],
  //   _v2 둘의 shift_day_marks · wage_rates 는 P4-4 0245. RLS 는 활성 매장만 보이므로 허브·다매장 직원은 이 경로로만 다른 매장 몫을 받는다.
  my_cross_summary: ['valid_from', 'shift_exceptions', 'archived_tenure_id'],
  my_cross_summary_v2: ['valid_from', 'valid_to', 'shift_exceptions', 'shift_day_marks', 'wage_rates', 'archived_tenure_id'],
  owner_labor_inputs: ['valid_from', 'shift_exceptions', 'owner_id = auth.uid()', 'archived_tenure_id'],
  owner_labor_inputs_v2: ['valid_from', 'valid_to', 'shift_exceptions', 'owner_id = auth.uid()', 'shift_day_marks', 'wage_rates', 'archived_tenure_id'],
  shift_templates_all: ['valid_from', 'unit_members', 'auth_can_manage', 'archived_tenure_id'],
  transfer_shift: ['valid_from', 'shift_exceptions', 'archived_tenure_id'],
  approve_swap: ['p_confirm_past', 'kst_today() - 35', 'transfer_shift', 'auth_can_manage', 'archived_tenure_id'],
  due_quiz_sends: ['valid_to', 'workers_at', 'archived_at'],
  // P4-2 0243(J2) — 나누기가 요청을 안 옮기면 지난 날짜 요청이 엉뚱한 구간에 붙는다(데이터 H6). 승인은 사장만(J2 원문).
  copy_past_segment: ['shift_exceptions', 'swap_requests', 'shift_change_requests', 'shift_day_marks'],
  request_shift_time: ['valid_from', 'shift_exceptions', 'kst_today() - 35', 'kst_today() + 60', 'auth.uid()', 'archived_tenure_id'],
  decide_shift_time: ['auth_is_owner', 'for update', "status <> 'pending'", 'p_confirm_past', 'kst_today() - 35', 'override_shift_day', "edited_by = 'staff'", 'archived_tenure_id'],
  // P4-3 0244(J1-b) — 시급 이력. 사장만 · 활성 매장 멤버만 · 지난 날짜는 확인(Q4). 일일 맞춤은 지금 멤버만(퇴사자 wages 되살리기 금지).
  set_wage_from: ['auth_is_owner', 'auth_unit_id', 'unit_members', 'p_confirm_past', 'wage_rates', 'archived_tenure_id'],
  sync_wages_from_rates: ['unit_members', 'wage_rates', 'archived_tenure_id'],
  //   0246 — 옛 앱 시급 저장 트리거도 재입사자의 옛 이력을 "이력 있음"으로 세지 않는다(옛 시급이 되살아나지 않게).
  wages_to_wage_rates: ['wage_rates', 'archived_tenure_id'],
  // P4-4 0245(J1-c) — 결근 표시. 사장만(급여 영향 · 0201) · 활성 매장 근무만 · 그날 서는 근무만 · 지난 날짜는 확인(Q4).
  mark_shift_day: ['auth_is_owner', 'auth_unit_id', 'p_confirm_past', 'valid_from', 'shift_exceptions', 'archived_tenure_id'],
  clear_shift_day: ['auth_is_owner', 'auth_unit_id', 'p_confirm_past', 'archived_tenure_id'],
  // P4-5 0246 — 재직 기간. 표시(archived_tenure_id)된 옛 재직 기간 행은 정의자 함수도 읽거나 고치지 않는다.
  owner_overview: ['owner_id = auth.uid()', 'archived_tenure_id', 'archived_at is null'],
  edit_shift_from: ['archived_tenure_id', 'p_confirm_past'],
  end_shift_from: ['archived_tenure_id', 'p_confirm_past'],
  override_shift_day: ['archived_tenure_id', 'p_confirm_past'],
  shift_first_series: ['archived_tenure_id', 'unit_members'],
  end_staff_tenure: ['archived_tenure_id', 'valid_to'],
  my_units_notif_data: ['archived_tenure_id', 'swap_requests'],
  //   정리 함수 하나로 모은다(내보내기 · 나가기 · 다시 열기 · 탈퇴). 근무표는 지우지 않고 닫는다(end_staff_tenure).
  close_member_tenure: ['for update', 'member_tenures', 'end_staff_tenure', 'work_room_members', 'unit_kept_seats', 'unit_member_prefs',
    'quiz_assignments', 'sent_at is null', 'left_reason', "status = 'open', accepted_by = null", 'final_hourly_wage', 'active_unit_id', "kind = 'store'",
    // P4-6 0247 — 내보냄은 그 직원에게, 나감·탈퇴는 그 매장 사장 멤버십에게만(Q22 · F-2).
    'insert into public.member_notices', 'if p_notify', "role = 'owner'"],
  //   다시 들어오는 순간 옛 재직 기간 행 7종에 표시 · 시급 비움 · former_staff 행 삭제.
  member_tenure_open: ['archived_tenure_id', 'attendance', 'shift_templates', 'wage_rates', 'shift_day_marks', 'shift_change_requests',
    'chat_queries', 'swap_requests', 'final_hourly_wage', 'delete from public.wages', 'delete from public.former_staff', "kind = 'store'"],
  remove_staff: ['close_member_tenure', "'removed'", 'cannot_remove_self', 'staff_not_found'],
  leave_store: ['close_member_tenure', "'left'", 'owner_cannot_leave'],
  reopen_store: ['close_member_tenure', "'reopen'", 'pending_unit_id = null', 'unit_access_locked', 'consumed_at = now()'],
  delete_my_account: ['close_member_tenure', "'account_deleted'", 'delete from auth.sessions', 'phone = null'],
  // P4-6 0247 — 알림 스윕은 먼저 claim(skip locked) · 하루 지난 것은 버린다. 3년 크론은 dry-run 이 기본이고 실행마다 기록한다.
  sweep_member_notices: ['skip locked', "interval '1 day'", 'claimed_at'],
  purge_expired_tenures: ['p_dry_run', 'retention_purge_log', "interval '3 years'", "interval '6 months'", "interval '5 years'",
    'archived_tenure_id', 'expired_former_members', 'name_snapshot', 'purge_dry_run_rollback'],
  //   3년 대상 = 지금 그 매장 멤버가 아니고 · 열린 기간이 없고 · 가장 최근 닫힌 기간이 3년을 넘은 사람(재입사자 기록을 지우지 않는다).
  expired_former_members: ['unit_members', 'bool_and(t.left_at is not null)', 'max(t.left_at)'],
  // P5-1 0248(J10) — 보관한 노하우(archived_at)는 직원 화면 · AI 검색 · 퀴즈 출제·발송 · 개요 수 · 복사 · 본사 읽기에서 빠진다.
  match_playbook: ['archived_at is null', 'brand_hidden_at is null'],
  my_knowhow_entries: ['archived_at is null', 'brand_hidden_at is null'],
  owner_knowhow_entries: ['archived_at is null', 'owner_id = (select auth.uid())'],
  owner_knowhow_stats: ['archived_at is null', 'owner_id = auth.uid()'],
  my_growth: ['archived_at is null'],
  list_unit_knowhow: ['archived_at is null', 'not_owner'],
  copy_knowhow_between: ['archived_at is null', 'not_owner_source', 'not_owner_target'],
  brand_unit_entries: ['archived_at is null', 'brand_has_unit'],
  brand_overview_rows: ['archived_at is null', 'p_brand is not null or p_units is not null'],
  quiz_items_for: ['archived_at is not null', 'brand_hidden_at is not null'],
  quiz_link_items: ['archived_at is not null', 'brand_hidden_at is not null'],
  quiz_item_counts: ['archived_at is not null', 'brand_hidden_at is not null'],
  quiz_link_resolve: ['archived_at is null', 'brand_hidden_at is not null', 'revoked_at is null'],
  enqueue_knowhow_rechecks: ['archived_at is null', 'brand_hidden_at is null'],
  archive_knowhow: ['auth_owns_unit', 'brand_copy_use_hide', "'draft'", 'archived_by', 'entry_not_found'],
  archived_knowhow: ['auth_owns_unit', 'archived_at is not null', 'auth_unit_id'],
  knowhow_usage: ['auth_owns_unit', 'quiz_attempts', 'work_template_knowhow', 'course_entries'],
  // P5-2 0249(Q23 · 보안 M3) — 같은 질문은 활성 매장의 대기 질문에만 · 1인 1행 · 개수는 새로 들어갈 때만 +1.
  //   해결 트리거는 원 질문자 + askers 중 지금 멤버에게만 · 답한 사람은 뺀다.
  ask_same_question: ['auth_unit_id', "'pending_owner_answer'", 'on conflict', 'similar_queries_count + 1', 'for update'],
  tg_unknown_query_answered: ['unknown_query_askers', 'insert into public.member_notices', "'question_answered'", 'unit_members', 'answered_by', "'resolved_with_entry'"],
};

// 함수 → 있으면 안 되는 토큰(옛 경로를 다시 여는 퇴행).
const FN_FORBIDDEN = {
  // P4-2 0243 — 옛 앱의 직원 자가수정은 항상 false 다. 근무표를 직접 쓰는 줄이 돌아오면 승인 없이 급여가 바뀐다.
  update_my_shift_time: ['update public.shift_templates'],
  // P4-5 0246 — 나갈 때 근무표·교대 이력을 통째로 지우던 줄(0132 · 0235 J4 임시판)과 former_staff 쓰기가 돌아오면 안 된다.
  remove_staff: ['insert into public.former_staff', 'delete from public.shift_templates'],
  leave_store: ['insert into public.former_staff'],
  delete_my_account: ['insert into public.former_staff'],
  reopen_store: ['insert into public.former_staff', 'delete from public.shift_templates', 'delete from public.swap_requests'],
  close_member_tenure: ['delete from public.wages', 'delete from public.attendance', 'insert into public.former_staff'],
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
for (const [fn, tokens] of Object.entries(FN_FORBIDDEN)) {
  const defs = bodies(fn);
  if (defs.length === 0) { check(`${fn} 이 있다`, false, '함수 없음'); continue; }
  for (const t of tokens) {
    const found = defs.filter((d) => d.includes(t)).length;
    check(`${fn} ∌ ${t}`, found === 0, `${defs.length}개 정의 중 ${found}개에 있음`);
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
{
  const r = pol('shift_day_marks', 'sdm_read');
  check('shift_day_marks.sdm_read ⊇ auth_can_manage · auth.uid (관리자 또는 본인만 · 동료 결근 표시 비공개)',
    r.includes('auth_can_manage') && r.includes('auth.uid()'), r || '정책 없음');
}

// ── P4-5 0246 재직 기간 ──────────────────────────────────────────────────────
// 표시 대상 표 7개. 모든 정책(select · insert/update 의 using · with check · delete)에 archived_tenure_id is null.
const TENURE_TABLES = ['attendance', 'shift_templates', 'wage_rates', 'shift_day_marks', 'shift_change_requests', 'chat_queries', 'swap_requests'];
{
  for (const t of TENURE_TABLES) {
    const out = psql(`select policyname || '|' || cmd || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
                        from pg_policies where schemaname = 'public' and tablename = '${t}' order by policyname`);
    const pols = out ? out.split('\n') : [];
    const missing = pols.filter((line) => {
      const [, , q, w] = line.split('|');
      return (q !== '-' && !q.includes('archived_tenure_id IS NULL')) || (w !== '-' && !w.includes('archived_tenure_id IS NULL'));
    }).map((line) => line.split('|')[0]);
    check(`${t} 정책 ${pols.length}개 모두 ⊇ archived_tenure_id IS NULL (using · with check)`, pols.length > 0 && missing.length === 0,
      pols.length ? `빠진 정책: ${missing.join(', ')}` : '정책 없음');
  }
}

console.log('\n[3] 0246 member_tenures · 표시 열 · 정리 함수 권한');
{
  const has = psql(`select to_regclass('public.member_tenures') is not null`);
  check('member_tenures 표가 있다', has === 't', has);
  if (has === 't') {
    check('member_tenures RLS 켜짐', psql(`select relrowsecurity from pg_class where oid = 'public.member_tenures'::regclass`) === 't');
    const pols = psql(`select cmd || '|' || coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename = 'member_tenures'`);
    check('member_tenures 정책 = select 하나 · 같은 매장 사장만(auth_is_owner · auth_unit_id)',
      pols.split('\n').length === 1 && pols.startsWith('SELECT|') && pols.includes('auth_is_owner') && pols.includes('auth_unit_id'), pols);
    for (const r of ['anon', 'authenticated']) {
      const v = psql(`select has_table_privilege('${r}', 'public.member_tenures', 'INSERT,UPDATE,DELETE,TRUNCATE')`);
      check(`member_tenures: ${r} 쓰기 권한 없음`, v === 'f', v);
    }
    check('member_tenures: 열린 기간 부분 유니크 (unit_id, user_id) where left_at is null',
      psql(`select count(*) from pg_indexes where schemaname = 'public' and tablename = 'member_tenures'
              and indexdef ilike '%unique%' and indexdef ilike '%(unit_id, user_id)%' and indexdef ilike '%left_at IS NULL%'`) === '1');
  }
  for (const t of TENURE_TABLES) {
    const fk = psql(`select coalesce(string_agg(c.confdeltype::text || ':' || c.confrelid::regclass::text, ','), '') from pg_constraint c
                      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                     where c.conrelid = 'public.${t}'::regclass and c.contype = 'f' and a.attname = 'archived_tenure_id'`);
    check(`${t}.archived_tenure_id → member_tenures FK · NO ACTION(데이터 M4)`, fk === 'a:member_tenures', fk || '열·FK 없음');
    const ix = psql(`select count(*) from pg_indexes where schemaname = 'public' and tablename = '${t}'
                       and indexdef ilike '%(archived_tenure_id)%' and indexdef ilike '%archived_tenure_id IS NOT NULL%'`);
    check(`${t}.archived_tenure_id 부분 인덱스`, ix === '1', `indexes=${ix}`);
  }
  for (const fn of ['close_member_tenure(text, uuid, text, boolean)', 'member_tenure_open()']) {
    const exists = psql(`select to_regprocedure('public.${fn}') is not null`);
    check(`${fn} 이 있다`, exists === 't');
    if (exists === 't') {
      for (const r of ['anon', 'authenticated']) {
        const v = psql(`select has_function_privilege('${r}', 'public.${fn}', 'execute')`);
        check(`${fn}: ${r} 실행 불가(내부 전용)`, v === 'f', v);
      }
      check(`${fn}: 정의자 · search_path=public`,
        psql(`select p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = 'public.${fn}'::regprocedure`) === 't');
    }
  }
  const trg = psql(`select coalesce(string_agg(pg_get_triggerdef(t.oid), ' '), '') from pg_trigger t
                     where t.tgrelid = 'public.unit_members'::regclass and t.tgname = 'trg_member_tenure_open' and not t.tgisinternal`);
  check('unit_members AFTER INSERT 트리거 trg_member_tenure_open (junior · manager)',
    trg.includes('AFTER INSERT') && trg.includes('junior') && trg.includes('manager'), trg || '없음');
  const bak = psql(`select to_regclass('public._bak_wages_0246') is not null`);
  check('_bak_wages_0246 이 있다(롤백 근거)', bak === 't');
  if (bak === 't') {
    check('_bak_wages_0246: RLS 켜짐 · 정책 0개 · anon/authenticated 권한 0',
      psql(`select c.relrowsecurity and not exists (select 1 from pg_policies where tablename = '_bak_wages_0246')
                   and not has_table_privilege('anon', 'public._bak_wages_0246', 'SELECT,INSERT,UPDATE,DELETE')
                   and not has_table_privilege('authenticated', 'public._bak_wages_0246', 'SELECT,INSERT,UPDATE,DELETE')
              from pg_class c where c.oid = 'public._bak_wages_0246'::regclass`) === 't');
  }
}

console.log('\n[4] 0246 정의자 함수 전수 — 대상 표를 읽는데 표시 조건이 없는 것 0개(허용 목록 제외)');
{
  // 허용 목록 = 표시된 행에 닿지 않는 이유가 있는 함수. 새 정의자 함수가 대상 표를 읽으면 여기서 걸린다.
  const ALLOW = {
    copy_past_segment: '내부 헬퍼 — 표시 안 된 행(RLS 통과한 직접 쓰기 · 표시 확인을 거친 RPC)만 나눈다',
    split_shift_at: '내부 헬퍼 — edit_shift_from 이 표시 확인 뒤에 부른다',
    add_shift_series: '새 행만 넣는다 · 담당자는 지금 멤버',
    shift_series_guard: '옛 앱 직접 쓰기(authenticated) 트리거 — RLS 가 표시된 행을 이미 막는다',
    due_quiz_sends: '0248 담당 · 근무 판정은 workers_at(표시 조건 있음) · "근무표를 쓰는 매장" 판정은 닫힌 행 제외로 충분',
    accept_swap: "표시된 교대는 모두 끝난 상태다(정리 함수가 open·accepted 를 지우거나 되돌린다) · status = 'open' 만 받는다",
    purge_old_records: '보관 기한 삭제 — 표시와 무관하게 나이로 지운다',
    purge_retention_global: '보관 기한 삭제 — 표시와 무관하게 나이로 지운다',
    recompute_playbook_stats: '노하우 사용 통계(개인 기록이 아니다)',
  };
  const re = `\\m(public\\.)?(${TENURE_TABLES.join('|')})\\M`;
  const out = psql(`select p.proname from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
                       and pg_get_functiondef(p.oid) ~ '${re}'
                       and position('archived_tenure_id' in pg_get_functiondef(p.oid)) = 0
                     order by 1`);
  const bad = (out ? out.split('\n') : []).filter((n) => !(n in ALLOW));
  check('표시 조건 없는 정의자 함수 0개', bad.length === 0, bad.join(', '));
  // 데이터: 매장의 직원 멤버십 수 = 열린 재직 기간 수(트리거·백필이 같이 맞는다)
  if (psql(`select to_regclass('public.member_tenures') is not null`) === 't') {
    const d = psql(`select (select count(*) from public.unit_members m join public.units u on u.id = m.unit_id
                             where u.kind = 'store' and m.role in ('junior', 'manager'))
                        || '|' || (select count(*) from public.member_tenures where left_at is null)`);
    const [a, b] = d.split('|');
    check('직원 멤버십 수 = 열린 재직 기간 수', a === b, `members=${a} open=${b}`);
  }
}

console.log('\n[5] 0247 member_notices · retention_purge_log · 스윕·크론 권한');
{
  const has = (t) => psql(`select to_regclass('public.${t}') is not null`) === 't';
  check('member_notices 표가 있다', has('member_notices'));
  if (has('member_notices')) {
    check('member_notices RLS 켜짐', psql(`select relrowsecurity from pg_class where oid = 'public.member_notices'::regclass`) === 't');
    const pols = psql(`select cmd || '|' || coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename = 'member_notices'`);
    check('member_notices 정책 = select 하나 · 본인만(auth.uid())', pols.split('\n').length === 1 && pols.startsWith('SELECT|') && pols.includes('auth.uid()'), pols);
    for (const r of ['anon', 'authenticated']) {
      const v = psql(`select has_table_privilege('${r}', 'public.member_notices', 'INSERT,UPDATE,DELETE,TRUNCATE')`);
      check(`member_notices: ${r} 쓰기 권한 없음`, v === 'f', v);
    }
    const ck = psql(`select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.member_notices'::regclass and c.contype = 'c'
                       and pg_get_constraintdef(c.oid) ilike '%kind%'`);
    check('member_notices.kind CHECK ⊇ approved · rejected · removed · left · account_deleted · question_answered',
      ['approved', 'rejected', 'removed', 'left', 'account_deleted', 'question_answered'].every((k) => ck.includes(`'${k}'`)), ck || 'CHECK 없음');
  }
  check('retention_purge_log 표가 있다', has('retention_purge_log'));
  if (has('retention_purge_log')) {
    check('retention_purge_log: RLS 켜짐 · 정책 0개 · anon/authenticated 권한 0',
      psql(`select c.relrowsecurity and not exists (select 1 from pg_policies where tablename = 'retention_purge_log')
                   and not has_table_privilege('anon', 'public.retention_purge_log', 'SELECT,INSERT,UPDATE,DELETE')
                   and not has_table_privilege('authenticated', 'public.retention_purge_log', 'SELECT,INSERT,UPDATE,DELETE')
              from pg_class c where c.oid = 'public.retention_purge_log'::regclass`) === 't');
  }
  for (const fn of ['sweep_member_notices(timestamp with time zone)', 'purge_expired_tenures(boolean)']) {
    const exists = psql(`select to_regprocedure('public.${fn}') is not null`);
    check(`${fn} 이 있다`, exists === 't');
    if (exists !== 't') continue;
    for (const r of ['anon', 'authenticated']) {
      check(`${fn}: ${r} 실행 불가`, psql(`select has_function_privilege('${r}', 'public.${fn}', 'execute')`) === 'f');
    }
    check(`${fn}: service_role 실행 가능`, psql(`select has_function_privilege('service_role', 'public.${fn}', 'execute')`) === 't');
    check(`${fn}: 정의자 · search_path=public`,
      psql(`select p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = 'public.${fn}'::regprocedure`) === 't');
  }
  for (const fn of ['approve_member(uuid)', 'reject_member(uuid)']) {
    check(`${fn}: anon 실행 불가 · authenticated 실행 가능(옛 앱)`,
      psql(`select not has_function_privilege('anon', 'public.${fn}', 'execute') and has_function_privilege('authenticated', 'public.${fn}', 'execute')`) === 't');
  }
  // 크론은 pg_cron 이 있을 때만 등록된다(로컬 도커에는 없다). 있으면 dry-run(true)으로 등록돼 있어야 한다(P4-8 전까지).
  if (psql(`select exists (select 1 from pg_extension where extname = 'pg_cron')`) === 't') {
    const cmd = psql(`select coalesce((select command from cron.job where jobname = 'purge-former-tenures'), '')`);
    check('크론 purge-former-tenures = purge_expired_tenures(true)', /purge_expired_tenures\(true\)/.test(cmd), cmd || '잡 없음');
  } else {
    console.log('  SKIP 크론 등록 확인(pg_cron 없음 · 로컬 도커)');
  }
}

console.log('\n[6] 0248 노하우 보관 — 열 · 정책 · 트리거 · 권한');
{
  const col = psql(`select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'playbook_entries'
                      and column_name in ('archived_at', 'archived_by')`);
  check('playbook_entries.archived_at · archived_by 열이 있다', col === '2', `cols=${col}`);
  for (const name of ['playbook_entries_read', 'playbook_entries_write']) {
    const r = pol('playbook_entries', name);
    const [q, w] = r.split(' | ');
    check(`playbook_entries.${name} ⊇ archived_at IS NULL (using${w ? ' · with check' : ''})`,
      !!q && q.includes('archived_at IS NULL') && (!w || w.includes('archived_at IS NULL')), r || '정책 없음');
    check(`playbook_entries.${name} ⊇ brand_hidden_at · auth_owns_unit (0231 유지)`, r.includes('brand_hidden_at') && r.includes('auth_owns_unit'), r || '정책 없음');
  }
  const other = psql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'playbook_entries'
                        and cmd in ('SELECT', 'ALL', 'DELETE') and permissive = 'PERMISSIVE'
                        and policyname not in ('playbook_entries_read', 'playbook_entries_write')`);
  check('playbook_entries 에 보관 술어 없는 SELECT·DELETE 정책이 더 없다', other === '0', `정책 ${other}개`);
  const trg = (name) => psql(`select coalesce(string_agg(pg_get_triggerdef(t.oid), ' '), '') from pg_trigger t
                                where t.tgrelid = 'public.playbook_entries'::regclass and t.tgname = '${name}' and not t.tgisinternal`);
  const del = trg('trg_playbook_entry_soft_delete');
  check('BEFORE DELETE 트리거 trg_playbook_entry_soft_delete (옛 앱 삭제 = 보관)', del.includes('BEFORE DELETE') && del.includes('FOR EACH ROW'), del || '없음');
  const grd = trg('trg_playbook_entry_archive_guard');
  check('BEFORE UPDATE OF archived_at 가드 트리거', grd.includes('BEFORE UPDATE OF archived_at'), grd || '없음');
  const fdef = (fn) => psql(`select coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                                                where p.pronamespace = 'public'::regnamespace and p.proname = '${fn}'), '')`);
  const sd = fdef('tg_playbook_entry_soft_delete');
  check('삭제 트리거 함수: current_user 판정 · 본사 사본 · 초안 제외 · archive_knowhow · return null',
    ['current_user', 'authenticated', 'brand_entry_id', "'draft'", 'archive_knowhow', 'return null'].every((t) => sd.includes(t)), sd ? '토큰 빠짐' : '없음');
  check('삭제 트리거 함수는 정의자가 아니다(current_user 가 호출자여야 한다)',
    psql(`select coalesce((select (not p.prosecdef)::text from pg_proc p
                             where p.pronamespace = 'public'::regnamespace and p.proname = 'tg_playbook_entry_soft_delete'), 'none')`) === 'true');
  const gd = fdef('tg_playbook_entry_archive_guard');
  check('가드 함수: service_role 예외(auth.uid() is null) · 소유주 · 본사 사본 거부',
    ['auth.uid() is null', 'auth_owns_unit', 'brand_copy_use_hide', 'not_owner'].every((t) => gd.includes(t)), gd ? '토큰 빠짐' : '없음');
  for (const fn of ['archive_knowhow(text, boolean)', 'archived_knowhow()', 'knowhow_usage(text)']) {
    const exists = psql(`select to_regprocedure('public.${fn}') is not null`);
    check(`${fn} 이 있다`, exists === 't');
    if (exists !== 't') continue;
    check(`${fn}: anon 실행 불가 · authenticated 실행 가능`,
      psql(`select not has_function_privilege('anon', 'public.${fn}', 'execute') and has_function_privilege('authenticated', 'public.${fn}', 'execute')`) === 't');
    check(`${fn}: 정의자 · search_path=public`,
      psql(`select p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = 'public.${fn}'::regprocedure`) === 't');
  }
  check('부분 인덱스 (unit_id) where archived_at is null',
    psql(`select count(*) from pg_indexes where schemaname = 'public' and tablename = 'playbook_entries'
            and indexdef ilike '%(unit_id)%' and indexdef ilike '%archived_at IS NULL%'`) === '1');
}

console.log('\n[7] 0249 같은 질문 — askers 표 · RPC 권한 · 해결 트리거');
{
  const has = psql(`select to_regclass('public.unknown_query_askers') is not null`) === 't';
  check('unknown_query_askers 표가 있다', has);
  if (has) {
    check('unknown_query_askers RLS 켜짐', psql(`select relrowsecurity from pg_class where oid = 'public.unknown_query_askers'::regclass`) === 't');
    const pols = psql(`select cmd || '|' || coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename = 'unknown_query_askers'`);
    check('unknown_query_askers 정책 = select 하나 · 본인만(auth.uid())', pols.split('\n').length === 1 && pols.startsWith('SELECT|') && pols.includes('auth.uid()'), pols);
    for (const r of ['anon', 'authenticated']) {
      check(`unknown_query_askers: ${r} 쓰기 권한 없음`, psql(`select has_table_privilege('${r}', 'public.unknown_query_askers', 'INSERT,UPDATE,DELETE,TRUNCATE')`) === 'f');
    }
  }
  const fn = 'ask_same_question(text)';
  const exists = psql(`select to_regprocedure('public.${fn}') is not null`) === 't';
  check(`${fn} 이 있다`, exists);
  if (exists) {
    check(`${fn}: anon 실행 불가 · authenticated 실행 가능`,
      psql(`select not has_function_privilege('anon', 'public.${fn}', 'execute') and has_function_privilege('authenticated', 'public.${fn}', 'execute')`) === 't');
    check(`${fn}: 정의자 · search_path=public`,
      psql(`select p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = 'public.${fn}'::regprocedure`) === 't');
  }
  check('같은 질문 한 사람을 돌려주는 question_askers 가 없다(보안 M3)',
    psql(`select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'question_askers'`) === '0');
  const trg = psql(`select coalesce(string_agg(pg_get_triggerdef(t.oid), ' '), '') from pg_trigger t
                      where t.tgrelid = 'public.unknown_queries'::regclass and t.tgname = 'trg_unknown_query_answered' and not t.tgisinternal`);
  check('AFTER UPDATE 트리거 trg_unknown_query_answered', trg.includes('AFTER UPDATE') && trg.includes('FOR EACH ROW'), trg || '없음');
  const tf = 'tg_unknown_query_answered()';
  if (psql(`select to_regprocedure('public.${tf}') is not null`) === 't') {
    check(`${tf}: 정의자 · search_path=public · anon/authenticated 실행 불가`,
      psql(`select p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}'))
                   and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
              from pg_proc p where p.oid = 'public.${tf}'::regprocedure`) === 't');
  } else check(`${tf} 이 있다`, false);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
