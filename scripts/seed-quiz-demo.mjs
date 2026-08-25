// scripts/seed-quiz-demo.mjs — 파일럿 매장(store_001)의 **퀴즈 축만** 채우는 데모 시드.
//
// 왜 있나:
//   store_001 은 노하우 40건·업무 22건·채팅 76건까지 차 있는데, 08-11 퀴즈 재설계(0139·0140)
//   이후의 테이블(quiz_items · quiz_assignments · quiz_attempts · knowhow_understanding)만
//   전부 0건이라 퀴즈 화면이 사장·직원 양쪽에서 콜드스타트로 뜬다. 그 구멍만 메운다.
//
// ⛔ 노하우·업무·채팅·출퇴근은 손대지 않는다. 이 시드가 쓰는 테이블은 아래 5개뿐이다.
// ★ 문항은 course_id 가 아니라 **entry_ids(노하우)** 로 붙는다(0107) — 그래서 이 시드가 노하우에
//   문항을 달면 그 노하우를 담고 있는 **기존 코스 4개도 같이** 채워진다.
//
// 실행:  node scripts/seed-quiz-demo.mjs          (.env.seed + .env 자동 로드)
//        node scripts/seed-quiz-demo.mjs --purge  (이 시드가 만든 것만 지우고 끝)
//
// 멱등: 이 시드가 만든 행은 전부 고정 접두를 달고 있고(아래 P), 매 실행 처음에 그 접두 행만
//       지우고 다시 넣는다. 사람이 앱에서 만든 퀴즈·응시는 접두가 달라 건드리지 않는다.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const readEnv = (file) => {
  try {
    const o = {};
    for (const line of readFileSync(join(__dir, '..', file), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !m[1].startsWith('#')) o[m[1]] = m[2].trim();
    }
    return o;
  } catch { return {}; }
};
const envSeed = readEnv('.env.seed');
const envApp = readEnv('.env');
const URL_ = process.env.SUPABASE_URL || envSeed.SUPABASE_URL || envApp.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || envSeed.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) { console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.seed)'); process.exit(1); }

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const PURGE_ONLY = process.argv.includes('--purge');

// ── 대상(파일럿 가족) ─────────────────────────────────────────
const UNIT = 'store_001';
const P = 'qzd_';                                    // 이 시드가 만든 모든 행의 id 접두 = 멱등의 근거
const OWNER_EMAIL = 'owner@pilot.squaretable.app';   // 김영자
const JIWON_EMAIL = 'staff@pilot.squaretable.app';   // 박지원(매니저)
const SUMIN_EMAIL = 'staff2@pilot.squaretable.app';  // 이수민(직원)

// ── 날짜(KST 벽시계) ─────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayFrom = (n) => ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + n));
const TODAY = dayFrom(0);
const agoTs = (days) => new Date(Date.now() - days * 86400_000).toISOString();

const step = async (label, p) => {
  const { error } = await p;
  if (error) { console.error(`  ✗ ${label}: ${error.message}`); throw error; }
  console.log(`  · ${label}`);
};

// ════════════════════════════════════════════════════════════
// 문항 — 노하우 id 별로. ask/choices/answer_index/explain 은 choicePickSpec(클라 SSOT) 모양,
// wrong_spot 만 sequence/wrong_index 다. 정답 키는 서버 quiz_strip_payload 가 응시 때 지운다.
// ★내용은 store_001 에 실제로 들어 있는 노하우 본문에서만 뽑았다 — 없는 규칙을 지어내면
//   직원 화면에서 "매장에 없는 답"이 정답으로 뜬다.
// ════════════════════════════════════════════════════════════
const ITEMS = [
  ['pb_routine_001', 't1', 'order_pick', {
    ask: '오픈 루틴 7시 30분, 매장에 들어와서 하는 순서는?',
    choices: [
      '머신 전원 ON → 음악·조명·간판 → 냉장고 검수 → 원두 그라인더 세팅',
      '냉장고 검수 → 머신 전원 ON → 음악·조명·간판 → 원두 그라인더 세팅',
      '음악·조명·간판 → 냉장고 검수 → 머신 전원 ON → 원두 그라인더 세팅',
    ],
    answer_index: 0,
    explain: '머신 예열이 가장 오래 걸려서 들어오자마자 전원부터 켜요.',
  }],
  ['pb_routine_001', 't2', 'value_pick', {
    ask: '오픈 루틴을 시작하는 시각은 몇 시인가요?',
    choices: ['7시', '7시 30분', '8시', '8시 30분'],
    answer_index: 1, unit: '시',
    explain: '오픈 루틴은 7시 30분 매장 도착 기준이에요.',
  }],
  ['pb_routine_003', 't3', 'trap_pick', {
    ask: '마감 청소에서 하면 안 되는 것은?',
    choices: [
      '매트는 위쪽만 닦고 뒷면은 다음날 오픈조에 넘긴다',
      '마지막 손님이 나가면 출입문을 잠그고 OPEN 사인을 끈다',
      '매트 4장을 전부 들춰서 뒷면까지 락스로 닦는다',
      '제빙기 안쪽을 손 닿는 데까지 닦는다',
    ],
    answer_index: 0,
    explain: '매트 뒷면은 마감에서 반드시 닦아요. 넘기면 그 자리에서 냄새가 나요.',
  }],
  ['pb_event_001', 't5', 'case_pick', {
    ask: '가장 먼저 할 행동은?',
    situation: '손님이 음료에서 머리카락이 나왔다고 말합니다.',
    choices: [
      '두 손으로 음료를 받아 트레이에 옮기고 "정말 죄송합니다"부터 말한다',
      '어디에서 들어갔는지 먼저 확인한다',
      '환불 가능한지 사장님께 전화한다',
      '새 음료를 만들면서 손님을 세워 둔다',
    ],
    answer_index: 0,
    explain: '사과가 먼저예요. 원인 확인은 그다음이에요.',
  }],
  ['pb_event_004', 't5', 'case_pick', {
    ask: '이때 먼저 하는 것은?',
    situation: '손님이 홀 한가운데에서 큰 소리로 항의하고 있습니다.',
    choices: [
      '카운터 안쪽이나 입구 쪽으로 자연스럽게 자리를 옮기도록 유도한다',
      '그 자리에서 바로 사과하고 환불한다',
      '다른 손님들에게 먼저 양해를 구한다',
      '경찰에 신고한다',
    ],
    answer_index: 0,
    explain: '보는 사람에게서 분리하면 목소리가 먼저 내려가요. 듣는 건 그다음이에요.',
  }],
  ['pb_event_005', 't1', 'order_pick', {
    ask: 'POS 카드 단말기 오류가 났을 때 순서는?',
    choices: [
      '케이블 2개 빼고 다시 꽂기 → 10초 대기 → 그래도 안 되면 사장님께 연락',
      '사장님께 연락 → 케이블 2개 빼고 다시 꽂기 → 10초 대기',
      '10초 대기 → 사장님께 연락 → 케이블 2개 빼고 다시 꽂기',
    ],
    answer_index: 0,
    explain: '케이블 재연결에서 대부분 해결돼요.',
  }],
  ['pb_event_003', 't5', 'case_pick', {
    ask: '어떻게 하나요?',
    situation: '냉장고와 보조 냉장고를 다 확인했는데 우유가 1L도 안 남았습니다.',
    choices: [
      '사장님께 바로 카톡하고, 동시에 라떼류를 품절 처리한다',
      '남은 우유로 최대한 만들고 떨어지면 그때 알린다',
      '근처 편의점에서 사 온다',
      '다음 발주일까지 기다린다',
    ],
    answer_index: 0,
    explain: '알리는 것과 품절 처리를 같이 해요. 하나만 하면 주문이 계속 들어와요.',
  }],
  ['pb_context_001', 't3', 'trap_pick', {
    ask: '첫날 규칙에서 하면 안 되는 것은?',
    choices: [
      '손님이 현금을 내밀면 받아서 서랍에 넣는다',
      '호칭은 "~님"으로 통일한다',
      '현금은 정중히 사양하고 카드만 가능하다고 안내한다',
      '컵·뚜껑·시럽·빨대 위치를 외워 둔다',
    ],
    answer_index: 0,
    explain: '이 매장은 현금을 안 받아요.',
  }],
  ['pb_context_002', 't5', 'case_pick', {
    ask: '직원이 혼자 결정해도 되는 것은?',
    situation: '사장님이 매장에 없습니다.',
    choices: [
      '음료 재제조와 5천원 이하 사과 쿠폰 제공',
      '5만원 이상 환불',
      '영업시간 변경',
      '신규 메뉴 가격 조정',
    ],
    answer_index: 0,
    explain: '작은 응대는 직원 재량이고, 금액이 커지면 전화예요.',
  }],
  ['pb_knowhow_001', 't3', 'trap_pick', {
    ask: '에스프레소를 뽑을 때 하면 안 되는 것은?',
    choices: [
      '추출이 끝난 잔을 흔들어 섞는다',
      '추출 2~3초 전에 데미타스 잔을 시계 방향으로 한 바퀴 돌린다',
      '돌린 잔을 그대로 머신 아래에 놓는다',
      '추출이 끝나면 잔을 그대로 둔다',
    ],
    answer_index: 0,
    explain: '흔들면 크레마가 깨져요.',
  }],
  ['pb_knowhow_002', 't6', 'name_pick', {
    ask: '메뉴판을 계속 보고 있는 손님에게 하는 응대는?',
    choices: [
      '"저는 바닐라라떼 자주 추천드려요" 하고 한 잔만 콕 집어 준다',
      '"아메리카노 1분이면 나와요" 하고 속도를 강조한다',
      '자리를 먼저 안내한다',
      '기다렸다가 손님이 말할 때까지 둔다',
    ],
    answer_index: 0,
    explain: '결정을 못 한 사람에겐 선택지를 줄여 줘요.',
  }],
  ['pb_routine_002', 't1', 'order_pick', {
    ask: '피크타임 1인 운영에서 주문이 들어왔을 때 순서는?',
    choices: [
      'POS 결제부터 끝낸다 → 같은 음료를 묶어서 제조 → 픽업존에 진동벨',
      '음료부터 만든다 → POS 결제 → 픽업존에 진동벨',
      '진동벨을 먼저 준다 → 음료 제조 → POS 결제',
    ],
    answer_index: 0,
    explain: '결제를 먼저 끝내야 줄이 안 밀려요.',
  }],
  ['pb_routine_1782886957696_0', 't1', 'wrong_spot', {
    ask: '마감 그라인더 관리 순서 중 잘못 놓인 자리는?',
    sequence: ['호퍼를 비운다', '뚜껑을 열어둔다', '호퍼를 물기 없이 닦는다'],
    wrong_index: 1,
    explain: '닦은 다음에 뚜껑을 열어 둬요. 순서가 바뀌면 물기가 남아요.',
  }],
  ['pb_routine_1783153328086_0', 't2', 'value_pick', {
    ask: '초코프라페는 블렌더에서 몇 초를 가나요?',
    choices: ['10초', '30초', '1분', '2분'],
    answer_index: 1, unit: '초',
    explain: '30초예요. 더 갈면 얼음이 물이 돼요.',
  }],
  ['pb_routine_1782886993596_1', 't2', 'value_pick', {
    ask: '아이스 아메리카노는 얼음을 컵의 몇 %까지 채우나요?',
    choices: ['50%', '80%', '100%', '30%'],
    answer_index: 1, unit: '%',
    explain: '80%예요. 가득 채우면 음료가 넘쳐요.',
  }],
  ['hub_pb_staff_jiwon', 't1', 'order_pick', {
    ask: '자몽에이드를 만드는 순서는?',
    choices: [
      '자몽청 60g → 얼음 가득 → 탄산수 180ml',
      '탄산수 180ml → 자몽청 60g → 얼음 가득',
      '얼음 가득 → 탄산수 180ml → 자몽청 60g',
    ],
    answer_index: 0,
    explain: '청이 바닥에 깔려야 층이 살아요.',
  }],
  ['hub_pb_staff_sumin', 't1', 'order_pick', {
    ask: '20잔 이상 단체 주문이 들어왔을 때 순서는?',
    choices: [
      '예상 시간 안내 → 아이스부터 제조 → HOT 은 마지막에 몰아서',
      '아이스부터 제조 → 예상 시간 안내 → HOT 은 마지막에 몰아서',
      'HOT 부터 제조 → 예상 시간 안내 → 아이스는 마지막에',
    ],
    answer_index: 0,
    explain: '시간을 먼저 알려야 손님이 기다려 줘요.',
  }],
  ['hub_pb_stale_1', 't2', 'value_pick', {
    ask: '포인트는 몇 원당 1점 적립인가요?',
    choices: ['500원', '1,000원', '3,000원', '5,000원'],
    answer_index: 1, unit: '원',
    explain: '1,000원당 1점, 10점이면 아메리카노 1잔이에요.',
  }],
  ['pb_context_1782785080768_0', 't6', 'name_pick', {
    ask: '손님이 와이파이 비밀번호를 물으면?',
    choices: ['squaretable7788', '12345678', '매장 전화번호 뒷자리', '사장님께 여쭤본다'],
    answer_index: 0,
    explain: '비밀번호는 squaretable7788 이에요.',
  }],
  ['pb_1783382035168_0', 't3', 'trap_pick', {
    ask: '취객이 난동을 부릴 때 하면 안 되는 것은?',
    choices: [
      '직접 붙잡아 밖으로 내보낸다',
      '낮은 목소리로 1회 정중히 안내한다',
      '다른 손님 동선을 먼저 분리한다',
      '위협이 이어지면 112 에 신고한다',
    ],
    answer_index: 0,
    explain: '몸으로 막지 않아요. 직원 안전이 1순위예요.',
  }],
];

// 퀴즈(코스) 3개 — 화면 어휘로는 "퀴즈 1건". 예약·마감이 서로 다른 상태로 보이게 셋을 둔다.
const COURSES = [
  {
    id: `tc_${P}open_close`, key: `${P}open_close`, name: '오픈·마감 기본',
    description: '문 열고 닫을 때 빠지면 안 되는 것',
    start_at: dayFrom(-7), answer_days: 3, position: 10,
    entries: ['pb_routine_001', 'pb_routine_003', 'pb_routine_1782886957696_0', 'pb_context_001'],
  },
  {
    id: `tc_${P}trouble`, key: `${P}trouble`, name: '손님 응대 사고',
    description: '클레임·항의·기기 오류가 났을 때',
    start_at: dayFrom(-2), answer_days: 7, position: 11,
    entries: ['pb_event_001', 'pb_event_004', 'pb_event_005', 'pb_1783382035168_0', 'pb_context_002'],
  },
  {
    id: `tc_${P}recipe`, key: `${P}recipe`, name: '음료 제조 기준',
    description: '레시피와 수치는 외워야 하는 것',
    start_at: dayFrom(3), answer_days: 5, position: 12,   // ★미래 = 예약 상태로 보인다
    entries: ['pb_knowhow_001', 'pb_knowhow_002', 'pb_routine_1783153328086_0', 'pb_routine_1782886993596_1', 'hub_pb_staff_jiwon'],
  },
];

async function main() {
  console.log(`퀴즈 데모 시드 — ${UNIT} (KST ${TODAY})`);

  // ── 0) 사람 찾기 ────────────────────────────────────────────
  const { data: list, error: le } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (le) throw le;
  const byEmail = Object.fromEntries(list.users.map((u) => [u.email, u.id]));
  const OWNER = byEmail[OWNER_EMAIL], JIWON = byEmail[JIWON_EMAIL], SUMIN = byEmail[SUMIN_EMAIL];
  if (!OWNER || !JIWON || !SUMIN) {
    console.error('✗ 파일럿 계정을 못 찾았다. seed-demo.mjs 를 먼저 돌릴 것.');
    process.exit(1);
  }

  // ── 1) 지난 실행분 정리(이 시드 접두만) ──────────────────────
  const courseIds = COURSES.map((c) => c.id);
  const entryIds = [...new Set(ITEMS.map(([e]) => e))];
  await step('이전 시드 정리: 발송 원장', db.from('quiz_assignments').delete().like('id', `${P}%`));
  await step('이전 시드 정리: 응시 기록', db.from('quiz_attempts').delete().like('id', `${P}%`));
  await step('이전 시드 정리: 문항', db.from('quiz_items').delete().like('id', `${P}%`));
  await step('이전 시드 정리: 코스 항목', db.from('course_entries').delete().in('course_id', courseIds));
  await step('이전 시드 정리: 퀴즈', db.from('training_courses').delete().in('id', courseIds));
  // 통과 기록은 (entry_id, staff_id) PK 라 접두를 못 단다 — 이 시드가 쓰는 노하우 × 두 직원만 지운다.
  await step(
    '이전 시드 정리: 통과 기록',
    db.from('knowhow_understanding').delete().eq('unit_id', UNIT).in('entry_id', entryIds).in('staff_id', [JIWON, SUMIN]),
  );
  await step('이전 시드 정리: 훈련 요청', db.from('training_requests').delete().like('id', `${P}%`));
  // 오답 집계는 entry_id 가 PK 라 접두를 못 단다 — 이 시드가 쓰는 노하우만 지운다.
  await step('이전 시드 정리: 오답 집계', db.from('knowhow_quiz_stats').delete().eq('unit_id', UNIT).in('entry_id', entryIds));
  if (PURGE_ONLY) { console.log('✓ --purge 완료 (되돌림만 하고 끝)'); return; }

  // ── 2) 노하우 존재 확인 ─────────────────────────────────────
  const { data: have, error: he } = await db.from('playbook_entries').select('id').eq('unit_id', UNIT).in('id', entryIds);
  if (he) throw he;
  const alive = new Set((have ?? []).map((r) => r.id));
  const missing = entryIds.filter((e) => !alive.has(e));
  if (missing.length) console.log(`  ⚠️ 매장에 없는 노하우 ${missing.length}건은 건너뛴다: ${missing.join(', ')}`);

  // ── 3) 문항 ────────────────────────────────────────────────
  const items = ITEMS.filter(([e]) => alive.has(e)).map(([entryId, kind, format, payload], i) => ({
    id: `${P}i${pad(i + 1)}`, unit_id: UNIT, entry_ids: [entryId], kind, format, payload,
    source: 'owner', status: 'active', created_by: OWNER,
  }));
  await step(`문항 ${items.length}건`, db.from('quiz_items').insert(items));

  // ── 4) 퀴즈(코스) + 담긴 노하우 ─────────────────────────────
  await step(`퀴즈 ${COURSES.length}건`, db.from('training_courses').insert(COURSES.map((c) => ({
    id: c.id, unit_id: UNIT, key: c.key, name: c.name, description: c.description,
    min_items: 3, max_items: 10, due_days: null, start_at: c.start_at, answer_days: c.answer_days,
    position: c.position, active: true,
  }))));
  const ce = COURSES.flatMap((c) => c.entries.filter((e) => alive.has(e)).map((entryId, i) => ({
    course_id: c.id, entry_id: entryId, unit_id: UNIT, position: i,
  })));
  await step(`퀴즈에 담긴 노하우 ${ce.length}건`, db.from('course_entries').insert(ce));

  // ── 5) 발송 원장 ───────────────────────────────────────────
  // ★sent_at·due_on 은 평소엔 크론(claim_quiz_send)만 채운다. 시드는 "이미 나간 뒤"를 재현하려고
  //   service_role 로 직접 넣는다 — 앱 코드에는 이 경로가 없다(있으면 그게 버그다).
  const [C1, C2, C3] = COURSES;
  const assignments = [
    // 오픈·마감: 둘 다 받고 둘 다 풀었다(= 결과 화면에 진행이 찬다)
    { id: `${P}a01`, course_id: C1.id, user_id: SUMIN, scheduled_on: C1.start_at, sent_at: agoTs(7), due_on: dayFrom(-4), opened_at: agoTs(7), completed_at: agoTs(7) },
    { id: `${P}a02`, course_id: C1.id, user_id: JIWON, scheduled_on: C1.start_at, sent_at: agoTs(7), due_on: dayFrom(-4), opened_at: agoTs(6), completed_at: agoTs(6) },
    // 손님 응대: 이수민은 열었지만 안 끝냈고, 박지원은 아직 안 열었다(마감 남은 상태)
    { id: `${P}a03`, course_id: C2.id, user_id: SUMIN, scheduled_on: C2.start_at, sent_at: agoTs(2), due_on: dayFrom(5), opened_at: agoTs(1), completed_at: null },
    { id: `${P}a04`, course_id: C2.id, user_id: JIWON, scheduled_on: C2.start_at, sent_at: agoTs(2), due_on: dayFrom(5), opened_at: null, completed_at: null },
    // 음료 제조: 예약만 걸린 상태 — sent_at 이 null 이라 직원 카드에는 아직 안 뜬다
    { id: `${P}a05`, course_id: C3.id, user_id: SUMIN, scheduled_on: C3.start_at, sent_at: null, due_on: null, opened_at: null, completed_at: null },
    { id: `${P}a06`, course_id: C3.id, user_id: JIWON, scheduled_on: C3.start_at, sent_at: null, due_on: null, opened_at: null, completed_at: null },
  ].map((a) => ({ ...a, unit_id: UNIT, created_by: OWNER }));
  await step(`발송 원장 ${assignments.length}건`, db.from('quiz_assignments').insert(assignments));

  // ── 6) 응시 기록 + 통과 기록 ────────────────────────────────
  // 통과(knowhow_understanding)는 만점일 때만 남긴다 — 화면의 "안다" 배지 근거다.
  const results = [
    // [노하우, 사람, 이름, total, correct, 며칠 전, 간격단계]
    ['pb_routine_001', SUMIN, '이수민', 2, 2, 7, 1],
    ['pb_routine_003', SUMIN, '이수민', 1, 1, 7, 1],
    ['pb_routine_1782886957696_0', SUMIN, '이수민', 1, 0, 7, null],
    ['pb_context_001', SUMIN, '이수민', 1, 1, 7, 1],
    ['pb_routine_001', JIWON, '박지원', 2, 2, 6, 2],
    ['pb_routine_003', JIWON, '박지원', 1, 1, 6, 2],
    ['pb_routine_1782886957696_0', JIWON, '박지원', 1, 1, 6, 0],
    ['pb_context_001', JIWON, '박지원', 1, 1, 6, 1],
    ['pb_event_001', SUMIN, '이수민', 1, 1, 1, 0],
    ['pb_event_004', SUMIN, '이수민', 1, 0, 1, null],
  ].filter(([e]) => alive.has(e));

  await step(`응시 기록 ${results.length}건`, db.from('quiz_attempts').insert(
    results.map(([entryId, staffId, , total, correct, ago], i) => ({
      id: `${P}t${pad(i + 1)}`, unit_id: UNIT, entry_id: entryId, staff_id: staffId,
      total, correct, taken_at: agoTs(ago),
    })),
  ));

  const passed = results.filter(([, , , total, correct]) => correct === total);
  await step(`통과 기록 ${passed.length}건`, db.from('knowhow_understanding').insert(
    passed.map(([entryId, staffId, staffName, , , ago, stepN]) => ({
      unit_id: UNIT, entry_id: entryId, staff_id: staffId, staff_name: staffName,
      verified_at: agoTs(ago), interval_step: stepN ?? 0,
    })),
  ));

  // ── 오답 집계(0103) — 사장·매니저 화면의 "오답률 높은 노하우" 근거. 응시 기록과 같은 수치에서 뽑는다.
  //    개인 귀속이 아니라 노하우 귀속이라 staff_id 컬럼 자체가 없다(0072 "실패는 저장하지 않는다").
  const agg = new Map();
  for (const [entryId, , , total, correct, ago] of results) {
    const a = agg.get(entryId) ?? { attempt_count: 0, miss_count: 0, last_missed_at: null };
    a.attempt_count += total;
    a.miss_count += total - correct;
    if (total > correct) a.last_missed_at = a.last_missed_at ?? agoTs(ago);
    agg.set(entryId, a);
  }
  await step(`오답 집계 ${agg.size}건`, db.from('knowhow_quiz_stats').insert(
    [...agg].map(([entry_id, a]) => ({ entry_id, unit_id: UNIT, ...a })),
  ));

  // ── 훈련 요청(0102/0111) — 사장이 "이 노하우 이해했는지 확인해줘"를 직원에게 건다.
  //    즉시형(recurrence=null) 1건 + 매주형 1건. 완료는 knowhow_understanding.verified_at 으로 파생된다.
  const reqs = [
    { id: `${P}r01`, unit_id: UNIT, entry_id: 'pb_routine_1782886957696_0', staff_id: SUMIN, recurrence: null, created_by: OWNER },
    { id: `${P}r02`, unit_id: UNIT, entry_id: 'pb_event_004', staff_id: SUMIN, recurrence: { weekly: [1] }, created_by: OWNER },
    { id: `${P}r03`, unit_id: UNIT, entry_id: 'pb_context_002', staff_id: JIWON, recurrence: null, created_by: OWNER },
  ].filter((r) => alive.has(r.entry_id));
  await step(`훈련 요청 ${reqs.length}건`, db.from('training_requests').insert(reqs));

  console.log('\n✓ 완료');
  console.log(`  사장   ${OWNER_EMAIL} / pilot1234`);
  console.log(`  직원   ${SUMIN_EMAIL} / pilot1234  (이수민 — 완료 1건·진행 중 1건)`);
  console.log(`  매니저 ${JIWON_EMAIL} / pilot1234`);
  console.log('  되돌리기: node scripts/seed-quiz-demo.mjs --purge');
}

main().catch((e) => { console.error('✗ 실패:', e.message); process.exitCode = 1; });
