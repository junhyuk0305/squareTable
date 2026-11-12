#!/usr/bin/env node
// check-once-rows.mjs — "하나만 있어야 하는 행"을 막는 unique 인덱스가 빠지지 않게 보는 게이트 (로컬 도커 · 2026-11-12 · 결함 전수 점검 S6)
//
// 목록 정본 = 산출물/결함전수점검_2026-11-12/레이스지도_1차_2026-11-12.md 7절의 "있음" 줄.
//   잠금만으로는 직접 쓰기 길이 뚫린다. unique 인덱스가 마지막 방어선이다(race 규칙 문안 3).
//   새로 "하나만" 행을 막으면(지도 7절 "없음" 줄을 고치면) 그 인덱스를 아래 표에 더한다.
// 보는 것: 표의 인덱스마다 로컬 DB 에 ①있고 ②unique 이고 ③그 테이블에 걸려 있다. 하나라도 빠지면 종료 1.
// ⚠️한계: 인덱스의 열·조건(where)이 맞는지는 보지 않는다. 이름과 unique 여부만 본다. 표에 없는 "하나만" 행은 모른다.
//
// 읽기 전용. docker exec psql 로 로컬 DB 를 읽는다(check:client-trust 와 같은 틀). CI 에는 얹지 않는다(로컬 DB 가 없다).
// 사용법: npm run check:once-rows
import { execFileSync } from 'node:child_process';

const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 16 << 20 }).trim();
try { psql('select 1;'); } catch { console.log('중단: 로컬 도커 DB 가 없다'); process.exit(2); }

// [테이블, 인덱스, 무엇을 하나로 막나]
const ONCE_ROWS = [
  ['work_rooms', 'work_rooms_one_default_per_unit', '매장 기본방 하나'],
  ['unit_members', 'unit_members_pkey', '한 사람 한 매장 멤버 행'],
  ['member_tenures', 'ux_member_tenures_open', '열린 재직 기록 하나'],
  ['work_done', 'work_done_pkey', '할 일 하루 완료 하나'],
  ['quiz_assignments', 'quiz_assignments_course_id_user_id_scheduled_on_key', '퀴즈 배정(코스·사람·날짜)'],
  ['shift_change_requests', 'shift_change_requests_one_pending', '근무 시간 변경 대기 하나'],
  ['units', 'units_invite_code_key', '초대 코드'],
  ['edu_link_handoffs', 'edu_link_handoffs_code_hash_key', '이어받기 코드'],
  ['payment_claims', 'payment_claims_one_pending_per_unit', '결제 청구 대기 하나'],
  ['card_subscriptions', 'card_subscriptions_pkey', '카드 구독 사장당 하나'],
  ['iap_subscriptions', 'iap_subscriptions_txn_uidx', 'IAP 거래'],
  ['promo_redemptions', 'promo_redemptions_code_unit_id_key', '프로모 코드 매장당 한 번'],
  ['space_join_requests', 'space_join_requests_one_pending', '공간 합류 신청 대기 하나'],
  ['playbook_suggestions', 'ux_ps_from_space_pending', '공간 → 매장 제안 대기 하나'],
  ['brand_units', 'brand_units_one_active_per_unit', '본사 연결 매장당 하나'],
  ['ai_usage_monthly', 'ai_usage_monthly_pkey', 'AI 한도 카운터(월)'],
  ['ai_quota_requests', 'ai_quota_requests_pkey', 'AI 한도 카운터(요청)'],
  ['owner_alerts', 'owner_alerts_unit_id_kind_period_step_key', '사장 알림 중복 키'],
  ['task_reminder_sent', 'task_reminder_sent_pkey', '할 일 리마인더 하루 한 번'],
  ['seat_lock_episodes', 'uq_seat_lock_open', '좌석 잠금 열린 회차 하나'],
  ['profiles', 'ux_profiles_phone_norm_role', '전화번호 + 가입 역할'],
  ['units', 'units_biz_no_key', '사업자번호'],
];

const idx = new Map(psql(`select c.relname, t.relname, i.indisunique from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
                          where c.relnamespace = 'public'::regnamespace`).split('\n').filter(Boolean)
  .map((l) => { const [n, t, u] = l.split('\t'); return [n, { t, u: u === 't' }]; }));

let pass = 0, fail = 0;
for (const [table, name, what] of ONCE_ROWS) {
  const got = idx.get(name);
  const why = !got ? '인덱스 없음' : !got.u ? 'unique 아님' : got.t !== table ? `다른 테이블(${got.t})` : '';
  if (why) { fail++; console.log(`  FAIL ${what} · ${table}.${name} · ${why}`); } else pass++;
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail} · 표 ${ONCE_ROWS.length}줄`);
process.exit(fail === 0 ? 0 : 1);
