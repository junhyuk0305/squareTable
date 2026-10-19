#!/usr/bin/env node
// check-client-trust.mjs — "서버가 앱의 주장을 믿는다" 모양이 다시 생기지 않게 막는 정적 게이트 (로컬 도커 · 2026-10-19)
//
// 규칙 정본 = .claude/rules/client-trust.md. 네 가지를 본다.
//   ① 작성자 열: authenticated 가 insert/update 할 수 있는 테이블의 신원 열(작성자·처리자)은
//      정책이 auth.uid() 로 묶거나 BEFORE 트리거가 덮어써야 한다.
//   ② 역할 판정: 정책 안에서 role 을 직접 비교하지 않는다(auth_can_manage · auth_is_owner · auth_owns_unit 헬퍼).
//   ③ 엣지: push 가 클라 body 의 title/body 를 그대로 발송하지 않는다.
//   ④ 열 단위 쓰기: authenticated 가 테이블 전체 UPDATE 권한을 가진 테이블은 아래 검토 목록에 있어야 한다.
//      새 테이블은 컬럼 grant(내용 열만)로 열거나, 이유를 적어 목록에 더한다.
//
// 읽기 전용. docker exec psql 로 로컬 DB(마이그레이션 전체 재생본)를 읽는다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
try { psql('select 1;'); } catch { console.log('중단: 로컬 도커 DB 가 없다'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : (fail++, console.log('  FAIL', n, extra)); };

// 신원 열 — 이 이름의 열은 "누가 했나"다. 앱이 정하면 사칭이 된다.
const IDENTITY_COLS = ['author_id', 'junior_id', 'junior_name', 'created_by', 'proposer_id', 'proposer_name', 'staff_id', 'requester_id', 'claimed_by',
  'user_id', 'added_by', 'edited_by', 'reviewed_by', 'answered_by', 'decided_by', 'accepted_by', 'redeemed_by', 'archived_by', 'creator_id'];
// jsonb 안의 신원 키(work_feed.data.authorId · work_done.data.by)
const JSONB_IDENTITY = { work_feed: ['authorId', 'authorName', 'authorRole'], work_done: ['by'] };
// 신원 열이지만 앱이 정하는 게 맞는 경우(대상 지정 등). 이유를 적는다.
const IDENTITY_EXEMPT = {
  'attendance.staff_id': '관리자가 남의 기록을 넣는다 — 정책이 staff_id = auth.uid() 또는 auth_can_manage 로 묶는다',
  'swap_requests.accepted_by': 'swap_requests_client_guard 가 직접 변경을 거부한다',
  'work_room_members.user_id': '방에 넣을 사람(대상)이다',
  'quiz_assignments.user_id': '관리자가 보낼 대상이다',
  'training_requests.staff_id': '관리자가 요청할 대상이다',
  'wages.staff_id': '사장이 정할 대상이다',
  'shift_templates.staff_id': '관리자가 근무를 넣을 대상이다',
  'work_templates.owner_id': '할 일 담당자(대상)다',
  // 관리자 전용 쓰기 테이블(정책이 auth_can_manage). 직원은 못 쓴다 — 이번 범위(직원 사칭) 밖이고, 덮으면 기능이 깨지는 열이 있다.
  'playbook_entries.creator_id': '관리자 전용 · 제안 승인 때 제안한 직원을 작성자로 적는다(덮으면 크레딧이 사라진다)',
  'playbook_entries.archived_by': '관리자 전용 · 보관은 정의자 RPC 가 적는다',
  'quiz_items.created_by': '관리자 전용', 'quiz_assignments.created_by': '관리자 전용', 'quiz_links.created_by': '관리자 전용 · insert 는 null 또는 본인',
  'shift_templates.edited_by': '관리자 전용',
  'payment_claims.reviewed_by': 'insert 정책이 null 을 강제하고 update 정책이 없다(검토는 내부 콘솔 service_role)',
};

const policies = psql(`select tablename, cmd, translate(coalesce(qual,''), E'\\n\\t', '  '), translate(coalesce(with_check,''), E'\\n\\t', '  '), array_to_string(roles, ',') from pg_policies where schemaname = 'public'`)
  .split('\n').filter(Boolean).map((l) => { const [t, cmd, qual, wc, roles] = l.split('\t'); return { t, cmd, qual, wc, roles }; });
const cols = new Map();
for (const l of psql(`select table_name, column_name from information_schema.columns where table_schema = 'public'`).split('\n').filter(Boolean)) {
  const [t, c] = l.split('\t'); if (!cols.has(t)) cols.set(t, new Set()); cols.get(t).add(c);
}
// BEFORE 트리거 함수 본문(테이블별로 이어 붙임)
const trig = new Map();
for (const l of psql(`select c.relname, replace(p.prosrc, E'\\n', ' ') from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
                      where not t.tgisinternal and (t.tgtype & 2) = 2 and c.relnamespace = 'public'::regnamespace`).split('\n').filter(Boolean)) {
  const i = l.indexOf('\t'); const t = l.slice(0, i); trig.set(t, (trig.get(t) ?? '') + ' ' + l.slice(i + 1));
}
const writable = new Set(psql(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE'))`).split('\n').filter(Boolean));

// ── ① 신원 열 ────────────────────────────────────────────────────────────────
for (const t of writable) {
  const ps = policies.filter((p) => p.t === t && ['INSERT', 'UPDATE', 'ALL'].includes(p.cmd) && /authenticated|public/.test(p.roles));
  if (!ps.length) continue;
  const body = trig.get(t) ?? '';
  for (const c of IDENTITY_COLS) {
    if (!cols.get(t)?.has(c) || IDENTITY_EXEMPT[`${t}.${c}`]) continue;
    const bound = ps.every((p) => new RegExp(`\\b${c}\\s*=\\s*\\(+\\s*SELECT auth\\.uid\\(\\)`).test(p.wc || p.qual))
      || new RegExp(`new\\.${c}\\s*:=`, 'i').test(body);
    check(`① ${t}.${c} 를 서버가 정한다`, bound, `${t}.${c}: 정책이 auth.uid() 로 묶지 않고 BEFORE 트리거도 덮어쓰지 않는다`);
  }
  for (const k of JSONB_IDENTITY[t] ?? []) {
    check(`① ${t}.data.${k} 를 서버가 정한다`, body.includes(`'${k}'`), `${t}.data.${k}: BEFORE 트리거가 덮어쓰지 않는다`);
  }
}

// ── ② 정책 안 role 직접 비교 ─────────────────────────────────────────────────
const ROLE_EXEMPT = new Set(['profiles']); // profiles_update 의 role = auth_role() 은 판정이 아니라 "role 열 못 바꿈" 잠금이다
for (const p of policies) {
  if (ROLE_EXEMPT.has(p.t)) continue;
  const txt = `${p.qual} ${p.wc}`;
  check(`② ${p.t} ${p.cmd} 정책이 역할 헬퍼를 쓴다`, !/\brole\s*(=|<>|IN\b|= ANY)/i.test(txt), `${p.t} ${p.cmd}: role 직접 비교 → auth_can_manage()/auth_is_owner()/auth_owns_unit()`);
}

// ── ③ 엣지가 클라 문구를 그대로 보내지 않는다 ─────────────────────────────────
{
  const src = readFileSync('supabase/functions/push/index.ts', 'utf8');
  check('③ push 엣지가 payload.title/body 를 발송 문구로 쓰지 않는다', !/clip\(payload\.(title|body)/.test(src) && !/title:\s*payload\.title/.test(src),
    'push/index.ts: 클라 body 의 title/body 를 그대로 싣는다 → 서버가 사건 행에서 문구를 만든다');
}

// ── ④ 테이블 전체 UPDATE 권한 ───────────────────────────────────────────────
// 검토한 테이블과 이유. 여기 없는 테이블이 authenticated 전체 UPDATE 를 가지면 실패한다.
const FULL_UPDATE_REVIEWED = {
  attendance: '트리거(attendance_staff_edit_guard)가 edited_by·work_minutes 를 정하고 이력을 남긴다',
  chat_queries: '본인 행 · 관리자',
  course_entries: '관리자 전용', playbook_entries: '관리자 전용', quiz_assignments: '관리자 전용', quiz_items: '관리자 전용', quiz_links: '관리자 전용',
  schedule_config: '관리자 전용', shift_exceptions: '관리자 전용', shift_templates: '관리자 전용', store_parts: '관리자 전용',
  training_courses: '관리자 전용', training_items: '관리자 전용', wages: '사장 전용',
  knowhow_understanding: '본인 행 · 트리거가 verified_at 을 채점 기록으로 판정',
  notification_prefs: '본인 행', push_device_tokens: '본인 행', push_subscriptions: '본인 행', unit_member_prefs: '본인 행', work_room_prefs: '본인 행',
  playbook_suggestions: '관리자 전용 update · insert 는 트리거가 초기 상태 강제',
  swap_requests: 'swap_requests_client_guard', unknown_queries: 'guard_unknown_query_write',
  work_feed: '트리거(work_feed_stamp_author)가 작성자·읽음·반응을 정한다',
  work_templates: '작성자 · 관리자', work_done: '트리거(work_done_stamp)가 by 를 정한다',
  task_understanding: '본인 행(옛 테이블 · 앱 쓰기 없음)',
  playbook_embeddings: '관리자 전용(0321) · 색인 본문은 ai 엣지(service_role)가 쓴다',
};
const fullUpdate = psql(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and has_table_privilege('authenticated', c.oid, 'UPDATE')
  and not exists (select 1 from information_schema.column_privileges cp where cp.table_schema = 'public' and cp.table_name = c.relname
                   and cp.grantee = 'authenticated' and cp.privilege_type = 'UPDATE' and false)`).split('\n').filter(Boolean);
const colGranted = new Set(psql(`select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE'`).split('\n').filter(Boolean));
for (const t of fullUpdate) {
  if (!colGranted.has(t)) continue; // 컬럼 단위 grant 만 있는 테이블(전체 권한 없음)
  const hasPolicy = policies.some((p) => p.t === t && ['UPDATE', 'ALL'].includes(p.cmd));
  if (!hasPolicy) continue; // 정책이 없으면 RLS 가 막는다
  check(`④ ${t} 전체 UPDATE 를 검토했다`, !!FULL_UPDATE_REVIEWED[t], `${t}: authenticated 가 모든 열을 update 할 수 있다 → 컬럼 grant 로 내용 열만 열거나 FULL_UPDATE_REVIEWED 에 이유를 적는다`);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
