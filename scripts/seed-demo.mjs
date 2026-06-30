// scripts/seed-demo.mjs — 테스트용 "현실적인 매장 운영 데이터" 전면 시드.
//   직원(박지원·이수민) → 사장(김영자) 흐름을 모든 탭/기능에서 검증할 수 있게
//   쓰레기 데이터를 비우고 일관된 더미를 채운다. service_role 로 RLS 우회.
//   멱등: 다시 돌려도 안전(계정 재사용, 결정적 ID upsert, 운영데이터 purge 후 재삽입).
//
// 실행:  node scripts/seed-demo.mjs            (.env.seed 자동 로드)
//        node scripts/seed-demo.mjs .env.seed
//
// ⚠️ 보존: playbook_entries(노하우)·unknown_queries·chat_queries 의 "내용"은 양질이라 유지.
//          junior_id 만 실제 로그인 UID 로 재귀속한다.
// ⚠️ 삭제: work_templates·work_done·work_feed·attendance (전부 테스트 난타/스팸) → purge 후 재시드.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── env 로드(.env.seed) ─────────────────────────────────────
const envPath = process.argv[2] || join(__dir, '..', '.env.seed');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2].trim();
}
const URL = env.SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const UNIT = 'store_001';
const ROOM = 'room_main_store_001';
const PASSWORD = 'pilot1234';            // 테스트 계정 공통 비번(사장/박지원/이수민)

// 기존 실계정 UID(점검으로 확인됨)
const OWNER = '44eb0c73-f736-4015-a3f0-1daf2fab4d41';  // 김영자
const JIWON = 'fb3e772d-848d-49f8-930e-ad59e57245f5';  // 박지원
let SUMIN = null;                                       // 이수민(아래서 생성/조회)

// ── 날짜 헬퍼 (KST 기준, 실행 시점 상대) ───────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const addDays = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
const dateStr = (n) => iso(addDays(n));
const TODAY = dateStr(0);
// KST 벽시계 → 표준 UTC ISO("…Z"). 앱이 저장하는 타임스탬프(new Date().toISOString())와
// 같은 표기로 통일한다 — 표기가 섞이면(KST 오프셋 vs UTC) 문자열 정렬이 어긋난다.
const ts = (dStr, hh, mm) => new Date(`${dStr}T${pad(hh)}:${pad(mm)}:00+09:00`).toISOString();
const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

async function step(label, p) {
  const { error } = await p;
  if (error) { console.error(`  ✗ ${label}: ${error.message}`); throw error; }
  console.log(`  ✓ ${label}`);
}

async function main() {
  // ════════════════════════════════════════════════════════
  console.log('1) 이수민(2번째 직원) 계정 프로비저닝');
  {
    const email = 'staff2@pilot.squaretable.app';
    const { data, error } = await db.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { name: '이수민', role: 'junior', unit_id: UNIT },
    });
    if (error) {
      if (/already.*registered|exists/i.test(error.message)) {
        const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
        SUMIN = list.users.find((u) => u.email === email)?.id;
        console.log(`  · 기존 계정 사용: ${email}`);
      } else throw error;
    } else {
      SUMIN = data.user.id;
      console.log(`  · 계정 생성: ${email} / ${PASSWORD}`);
    }
    // 비번 보정(재실행 시 알려진 비번 보장)
    await db.auth.admin.updateUserById(SUMIN, { password: PASSWORD });
  }

  // ════════════════════════════════════════════════════════
  console.log('2) 프로필 보강(시프트·경력·아바타·연락처)');
  await step('profile 김영자', db.from('profiles').update({
    name: '김영자', role: 'owner', unit_id: UNIT, phone_last4: '8821', avatar: 'owner',
    bio: '12년차 신촌 카페 사장. 손님 응대 베테랑.', meta: { career_years: 12 },
  }).eq('id', OWNER));
  await step('profile 박지원', db.from('profiles').update({
    name: '박지원', role: 'junior', unit_id: UNIT, phone_last4: '4412', avatar: 'junior_female',
    bio: '대학생 1학년. 카페 첫 알바. 오후 시프트.', meta: { career_days: 36, shift: '오후 (13~19시)' },
  }).eq('id', JIWON));
  await step('profile 이수민', db.from('profiles').update({
    name: '이수민', role: 'junior', unit_id: UNIT, phone_last4: '7790', avatar: 'junior_male',
    bio: '취준생. 입사 3개월차. 오픈 시프트 담당.', meta: { career_days: 92, shift: '오전 (7:30~14시)' },
  }).eq('id', SUMIN));

  // ════════════════════════════════════════════════════════
  console.log('3) 시급(wages)');
  await step('wages', db.from('wages').upsert([
    { unit_id: UNIT, staff_id: JIWON, hourly_wage: 10500 },
    { unit_id: UNIT, staff_id: SUMIN, hourly_wage: 11500 },
  ]));

  // ════════════════════════════════════════════════════════
  console.log('4) ID 재귀속(채팅기록/받은질문 junior_id → 실제 UID)');
  await step('chat_queries u_staff_001→박지원',
    db.from('chat_queries').update({ junior_id: JIWON }).eq('unit_id', UNIT).eq('junior_id', 'u_staff_001'));
  await step('chat_queries u_staff_002→이수민',
    db.from('chat_queries').update({ junior_id: SUMIN }).eq('unit_id', UNIT).eq('junior_id', 'u_staff_002'));
  await step('unknown_queries u_staff_001→박지원',
    db.from('unknown_queries').update({ junior_id: JIWON }).eq('unit_id', UNIT).eq('junior_id', 'u_staff_001'));
  await step('unknown_queries u_staff_002→이수민',
    db.from('unknown_queries').update({ junior_id: SUMIN }).eq('unit_id', UNIT).eq('junior_id', 'u_staff_002'));

  // ════════════════════════════════════════════════════════
  console.log('5) 노하우 정리: 난타 entry "마감 시 소등"(q=0.25) 제거');
  await step('embedding 삭제', db.from('playbook_embeddings').delete().eq('entry_id', 'pb_routine_1782726108828'));
  await step('entry 삭제', db.from('playbook_entries').delete().eq('id', 'pb_routine_1782726108828'));

  // ════════════════════════════════════════════════════════
  console.log('6) 운영 데이터 PURGE(쓰레기 전면 삭제)');
  await step('work_done purge', db.from('work_done').delete().eq('unit_id', UNIT));
  await step('work_feed purge', db.from('work_feed').delete().eq('unit_id', UNIT));
  await step('work_templates purge', db.from('work_templates').delete().eq('unit_id', UNIT));
  await step('attendance purge', db.from('attendance').delete().eq('unit_id', UNIT));
  await step('shift_templates purge', db.from('shift_templates').delete().eq('unit_id', UNIT));
  await step('swap_requests purge', db.from('swap_requests').delete().eq('unit_id', UNIT));
  await step('suggestions purge', db.from('playbook_suggestions').delete().eq('unit_id', UNIT));
  // 비기본방 + 멤버 정리(기본방 'room_main_store_001'은 유지)
  await step('room_members purge', db.from('work_room_members').delete().neq('room_id', ROOM));
  await step('extra rooms purge', db.from('work_rooms').delete().eq('unit_id', UNIT).eq('is_default', false));

  // ════════════════════════════════════════════════════════
  console.log('7) 운영 설정(schedule_config)');
  await step('schedule_config', db.from('schedule_config').upsert({
    unit_id: UNIT, open: '07:30', close: '22:00', closed_days: [], note: '연중무휴. 주말 14~16시 피크.',
    updated_at: new Date().toISOString(),
  }));

  // ════════════════════════════════════════════════════════
  console.log('8) 주간 근무표(shift_templates)');
  // 이수민=오픈(월~금 07:30~14:00) / 박지원=오후(수·목·금·토·일 13:00~19:00)
  const shifts = [];
  for (const wd of [1, 2, 3, 4, 5]) shifts.push({ id: `shift_sumin_${wd}`, unit_id: UNIT, staff_id: SUMIN, weekday: wd, start_time: '07:30', end_time: '14:00' });
  for (const wd of [3, 4, 5, 6, 0]) shifts.push({ id: `shift_jiwon_${wd}`, unit_id: UNIT, staff_id: JIWON, weekday: wd, start_time: '13:00', end_time: '19:00' });
  await step('shift_templates', db.from('shift_templates').upsert(shifts));

  // ════════════════════════════════════════════════════════
  console.log('9) 교대 요청(swap_requests): 대타 1건 open + 과거 승인 1건');
  const nextSat = (() => { const x = new Date(today); x.setDate(x.getDate() + ((6 - x.getDay() + 7) % 7 || 7)); return iso(x); })();
  await step('swap open(박지원 토요일 대타구함)', db.from('swap_requests').upsert({
    id: 'swap_demo_open', unit_id: UNIT, kind: 'cover', requester_id: JIWON,
    date: nextSat, template_id: 'shift_jiwon_6', target_staff_id: null, target_date: null, target_template_id: null,
    note: '토요일 오후 집안일이 생겨서 대타 부탁드려요 🙏', status: 'open', accepted_by: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));
  await step('swap approved(과거 이력)', db.from('swap_requests').upsert({
    id: 'swap_demo_done', unit_id: UNIT, kind: 'cover', requester_id: SUMIN,
    date: dateStr(-5), template_id: 'shift_sumin_3', target_staff_id: null, target_date: null, target_template_id: null,
    note: '병원 예약으로 오전 대타 요청', status: 'approved', accepted_by: JIWON,
    created_at: ts(dateStr(-7), 10, 0), updated_at: ts(dateStr(-6), 9, 0),
  }));

  // ════════════════════════════════════════════════════════
  console.log('10) 할일 템플릿(work_templates) — 오픈/마감/기타 + private 1건');
  const tmpl = (id, section, text, extra = {}) => ({ id, unit_id: UNIT, room_id: ROOM, section, text, scope: 'shared', ...extra });
  const templates = [
    tmpl('demo_t_open_1', 'open', '에스프레소 머신 전원 ON → 15분 예열'),
    tmpl('demo_t_open_2', 'open', '냉장고 우유 잔량 확인(안쪽 보조냉장고까지)'),
    tmpl('demo_t_open_3', 'open', 'POS 시재 5만원 확인'),
    tmpl('demo_t_mid_1', 'mid', '디저트 쇼케이스 재정렬·유통기한 체크'),
    tmpl('demo_t_mid_2', 'mid', '원두 호퍼 보충'),
    tmpl('demo_t_close_1', 'close', '매트 4장 뒷면 청소(락스)'),
    tmpl('demo_t_close_2', 'close', '제빙기 안쪽·싱크대 배수구 거름망 청소'),
    tmpl('demo_t_close_3', 'close', '마감 정산 후 시재 5만원만 남기고 금고에'),
    tmpl('demo_t_etc_1', 'etc', '신메뉴 흑임자 시럽 발주', { recurrence: 'once', date: dateStr(1), section_note: '발주' }),
    // 박지원 전용 private 할일(사장+본인만 보임)
    tmpl('demo_t_priv_1', 'close', '내 앞치마 세탁해오기', { scope: 'private', owner_id: JIWON, created_by: JIWON }),
  ];
  await step('work_templates', db.from('work_templates').upsert(templates));

  // ════════════════════════════════════════════════════════
  console.log('11) 오늘 완료 체크(work_done) — 오픈 항목은 이수민이 완료, 마감은 미완료');
  const doneMark = (by, byName) => ({ by, byName, at: new Date().toISOString() });
  const doneRows = [
    { unit_id: UNIT, work_date: TODAY, template_id: 'demo_t_open_1', room_id: ROOM, data: doneMark(SUMIN, '이수민') },
    { unit_id: UNIT, work_date: TODAY, template_id: 'demo_t_open_2', room_id: ROOM, data: doneMark(SUMIN, '이수민') },
    { unit_id: UNIT, work_date: TODAY, template_id: 'demo_t_open_3', room_id: ROOM, data: doneMark(SUMIN, '이수민') },
  ];
  await step('work_done', db.from('work_done').upsert(doneRows));

  // ════════════════════════════════════════════════════════
  console.log('12) 피드(work_feed): 공지 2(안읽음) + 메시지 2 + 완료알림 1');
  const feed = (id, date, data) => ({ id, unit_id: UNIT, feed_date: date, room_id: ROOM, data: { id, date, ...data } });
  const feedRows = [
    feed('demo_f_notice_1', TODAY, {
      kind: 'notice', text: '이번 주 토요일 14시 단체예약 20명! 오후타임 인원 미리 준비 부탁해요.',
      authorId: OWNER, authorName: '김영자', authorRole: 'owner', createdAt: ts(TODAY, 9, 10),
      pinned: false, important: true, read_by: [], reactions: {},
    }),
    feed('demo_f_notice_2', dateStr(-1), {
      kind: 'notice', text: '신메뉴 “흑임자 라떼” 7/1 출시. 레시피 공유함에 올려뒀으니 오픈조 확인해주세요.',
      authorId: OWNER, authorName: '김영자', authorRole: 'owner', createdAt: ts(dateStr(-1), 18, 30),
      pinned: false, important: false, read_by: [SUMIN], reactions: { '👍': [SUMIN] },
    }),
    feed('demo_f_msg_1', TODAY, {
      kind: 'message', text: '사장님 우유 거의 떨어져서 발주 넣었습니다!',
      authorId: SUMIN, authorName: '이수민', authorRole: 'junior', createdAt: ts(TODAY, 10, 5),
    }),
    feed('demo_f_msg_2', TODAY, {
      kind: 'message', text: '고마워요 수민님 👍 박지원님 오후에 디저트 입고분 정리 부탁해요.',
      authorId: OWNER, authorName: '김영자', authorRole: 'owner', createdAt: ts(TODAY, 10, 12),
      mentions: [JIWON],
    }),
    feed('demo_f_done_1', TODAY, {
      kind: 'task_done', text: '이수민 · POS 시재 5만원 확인 완료', refId: 'demo_t_open_3',
      authorId: SUMIN, authorName: '이수민', authorRole: 'junior', createdAt: ts(TODAY, 7, 45),
    }),
  ];
  await step('work_feed', db.from('work_feed').upsert(feedRows));

  // ════════════════════════════════════════════════════════
  console.log('13) 추가 채팅방(work_rooms "주말팀") + 멤버');
  await step('room 주말팀', db.from('work_rooms').upsert({
    id: 'room_weekend_store_001', unit_id: UNIT, name: '주말팀', is_default: false, created_by: OWNER,
    created_at: new Date().toISOString(),
  }));
  await step('room members', db.from('work_room_members').upsert([
    { room_id: 'room_weekend_store_001', user_id: JIWON },
    { room_id: 'room_weekend_store_001', user_id: SUMIN },
  ]));

  // ════════════════════════════════════════════════════════
  console.log('14) 노하우 제안(playbook_suggestions): 개선1 + 신규1 (pending) + 과거 승인1');
  await step('suggestion improve(pending)', db.from('playbook_suggestions').upsert({
    id: 'demo_sug_1', unit_id: UNIT, kind: 'improve',
    target_entry_id: 'pb_event_003', target_title: '우유 떨어졌을 때 (1L 미만)',
    proposer_id: JIWON, proposer_name: '박지원',
    text: '보조냉장고 위치를 모르는 알바가 많아요. 주방 안쪽 위치 사진 한 장 추가하면 좋겠습니다.',
    status: 'pending', created_at: ts(dateStr(-1), 16, 0),
  }));
  await step('suggestion new(pending)', db.from('playbook_suggestions').upsert({
    id: 'demo_sug_2', unit_id: UNIT, kind: 'new', target_entry_id: null, target_title: null,
    proposer_id: SUMIN, proposer_name: '이수민',
    text: '여름 한정 음료(자몽에이드 등) 제조 순서가 사람마다 달라요. 표준 레시피 노하우로 등록해주세요.',
    status: 'pending', created_at: ts(TODAY, 8, 20),
  }));
  await step('suggestion approved(과거)', db.from('playbook_suggestions').upsert({
    id: 'demo_sug_3', unit_id: UNIT, kind: 'improve',
    target_entry_id: 'pb_routine_003', target_title: '마감 청소 — 매트 뒷면 포함',
    proposer_id: SUMIN, proposer_name: '이수민',
    text: '배수구 거름망 칫솔을 따로 두면 편해요.', status: 'approved',
    owner_note: '반영했습니다. 고마워요!', reviewed_by: OWNER, reviewed_at: ts(dateStr(-3), 22, 0),
    created_at: ts(dateStr(-4), 21, 0),
  }));

  // ════════════════════════════════════════════════════════
  console.log('15) 출퇴근(attendance): 최근 14일 현실적 기록 (오늘=박지원 미출근/이수민 완료)');
  const att = [];
  const mkAtt = (staff, dStr, sh, sm, eh, em) => {
    const ci = ts(dStr, sh, sm), co = ts(dStr, eh, em);
    att.push({ id: `att_${staff}_${dStr}_seed`, unit_id: UNIT, staff_id: staff, date: dStr,
      check_in: ci, check_out: co, work_minutes: minutesBetween(ci, co), edited_by: null });
  };
  for (let n = -14; n <= 0; n++) {
    const dStr = dateStr(n);
    const wd = addDays(n).getDay();
    // 이수민: 월~금 오픈 (07:31~14:0x). 오늘도 출근 완료.
    if ([1, 2, 3, 4, 5].includes(wd)) mkAtt(SUMIN, dStr, 7, 31, 14, 3 + (n % 5 === 0 ? 7 : 0));
    // 박지원: 수·목·금·토·일 오후 — 단, 오늘(n=0)은 아직 미출근(라이브 출근 테스트용)
    if ([3, 4, 5, 6, 0].includes(wd) && n < 0) mkAtt(JIWON, dStr, 13, 2, 19, 5);
  }
  await step('attendance', db.from('attendance').upsert(att));

  console.log('\n✅ 데모 시드 완료\n');
  console.log('로그인 계정 (비번 공통: ' + PASSWORD + ')');
  console.log('  사장   김영자  owner@pilot.squaretable.app');
  console.log('  직원1  박지원  staff@pilot.squaretable.app');
  console.log('  직원2  이수민  staff2@pilot.squaretable.app');
  console.log('  (cristianojun@naver.com=매장 미연결 사장, 신규 온보딩 테스트용 — 미변경)');
}

main().catch((e) => { console.error('\n✗ 시드 실패:', e.message ?? e); process.exit(1); });
