// scripts/seed-appreview.mjs — 앱스토어/플레이스토어 "심사용 데모 계정 + 데모 매장" 프로비저닝.
//
// 왜 있나:
//   · Apple Guideline 2.1(a) — 로그인이 있는 앱은 데모 계정을 제출해야 하고 백엔드가 살아 있어야 한다.
//     매장의 정석은 사장(owner)/직원(junior) 화면이 완전히 달라 계정 2개를 모두 줘야 한다(하나면 절반을 못 봄).
//   · Apple Guideline 4.2 — 빈 앱은 "not particularly useful"로 반려된다. 그래서 노하우/할일/채팅/
//     출퇴근/질문답변을 "쓸모 있어 보이는" 수준으로 채운다.
//
// 실행:
//   node --env-file=.env.seed scripts/seed-appreview.mjs
//   node --env-file=.env.seed scripts/seed-appreview.mjs --skip-embed   (임베딩 생략 = 빠름)
//   node --env-file=.env.seed scripts/seed-appreview.mjs --force-embed  (전체 재임베딩)
//   (.env.seed 의 service_role + .env 의 anon 을 자동으로 읽는다)
//
// 멱등: 여러 번 돌려도 안전.
//   · 계정은 있으면 재사용(비번만 명세값으로 재설정)
//   · 매장 id 는 고정(store_appreview) — 재생성해도 PROTECT_UNITS 보호가 유지된다
//   · 운영데이터(할일/피드/출퇴근/질문)는 이 매장 범위만 purge 후 재삽입
//   · 노하우는 upsert + 목록에 없는 stale 행만 삭제 → 임베딩 재사용
//
// ★ 삭제 방지: scripts/cleanup-orphan-stores.mjs 의 PROTECT_UNITS 에 'store_appreview' 가,
//   PROTECT_EMAIL 에 appreview.* 계정이 등록돼 있어야 한다(이미 등록됨 — 지우지 말 것).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(__dir, '..', 'src', 'data', p), 'utf8'));
const readEnv = (file) => {
  try {
    const o = {};
    for (const line of readFileSync(join(__dir, '..', file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !m[1].startsWith('#')) o[m[1]] = m[2].trim();
    }
    return o;
  } catch { return {}; }
};

const envSeed = readEnv('.env.seed');
const envApp = readEnv('.env');
const URL = process.env.SUPABASE_URL || envSeed.SUPABASE_URL || envApp.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || envSeed.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || envApp.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SERVICE) { console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.seed)'); process.exit(1); }
if (!ANON) { console.error('✗ EXPO_PUBLIC_SUPABASE_ANON_KEY 필요(.env) — 초대·승인 RPC 를 실경로로 태우려면 필수'); process.exit(1); }

const SKIP_EMBED = process.argv.includes('--skip-embed');
const FORCE_EMBED = process.argv.includes('--force-embed');

// ── 고정 상수(스토어 콘솔에 그대로 기재된다 — 바꾸면 심사 문안도 같이 바꿀 것) ──
const UNIT = 'store_appreview';                       // ★고정 id. PROTECT_UNITS 보호 대상
const ROOM = `room_main_${UNIT}`;
const OWNER_EMAIL = 'appreview.owner@pilot.squaretable.app';
const STAFF_EMAIL = 'appreview.staff@pilot.squaretable.app';
const PASSWORD = 'ChackChack!2026';
const INVITE_CODE = '770427';
const STORE_NAME = '우리 데모 카페 (App Review)';
const P = 'apr_';                                     // 노하우 id 접두(전역 PK 충돌 방지)

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 날짜 헬퍼(KST 벽시계 → UTC ISO. 앱 저장 표기와 통일) ──
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const addDays = (n) => { const x = new Date(now); x.setDate(x.getDate() + n); return x; };
const dateStr = (n) => iso(addDays(n));
const TODAY = dateStr(0);
const ts = (d, hh, mm) => new Date(`${d}T${pad(hh)}:${pad(mm)}:00+09:00`).toISOString();
const mins = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

async function step(label, p) {
  const { error } = await p;
  if (error) { console.error(`  ✗ ${label}: ${error.message}`); throw error; }
  console.log(`  ✓ ${label}`);
}

async function ensureUser(email, meta) {
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: meta,
  });
  if (!error) { console.log(`  · 계정 생성: ${email}`); return data.user.id; }
  if (!/already.*registered|exists|been registered/i.test(error.message)) throw error;
  let page = 1, found = null;
  for (;;) {
    const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
    found = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
    if (found || (list?.users ?? []).length < 200) break;
    page++;
  }
  if (!found) throw new Error(`계정을 찾을 수 없음: ${email}`);
  // 재실행 시 명세 비번 보장(심사 기간 중 로그인 실패 = 2.1 반려).
  await db.auth.admin.updateUserById(found.id, { password: PASSWORD, email_confirm: true });
  console.log(`  · 기존 계정 재사용(비번 재설정): ${email}`);
  return found.id;
}

// ════════════════════════════════════════════════════════════════════
//  노하우 콘텐츠 (Guideline 4.2 — "쓸모 있는 앱"으로 보이게)
// ════════════════════════════════════════════════════════════════════
const SQ = (situation, steps, dont, scripts = []) => ({
  situation,
  quagmire: '',
  uncover: '',
  action: { steps, scripts },
  result: { before: '', after: '', metric: '' },
  extract: { do: '', dont, template: '' },
});

// 카페 업종 표준(노하우팩 카페/공통 기반 재작성) — 6건
const CAFE = [
  {
    id: `${P}cafe_01`, category: 'Context', subcategory: '레시피', section: '음료 제조', order_index: 1,
    title: '아메리카노 농도 기준 (HOT/ICE)',
    tags: ['#레시피', '#에스프레소'], keywords: ['아메리카노', '농도', '샷', '연하게', '진하게', '물양'],
    square: SQ('아메리카노를 만들 때 샷 수·물 양이 사람마다 달라 손님이 "저번이랑 맛이 다르다"고 한다.', [
      '1) HOT 은 2샷(약 50ml) + 뜨거운 물 220ml, 12oz 잔 기준 8부 능선까지.',
      '2) ICE 는 2샷 + 얼음 가득 + 물 180ml. 물을 먼저 붓고 샷을 마지막에 얹는다.',
      '3) "연하게" 요청은 물만 30ml 추가(샷은 그대로). "진하게"는 샷 1개 추가(+500원 안내).',
    ], '샷을 뺀 채 물만 늘려 "연하게" 만들지 않는다 — 맛이 완전히 무너진다.'),
    timing: '주문 접수 즉시', tone: '정확하게',
  },
  {
    id: `${P}cafe_02`, category: 'Context', subcategory: '레시피', section: '음료 제조', order_index: 2,
    title: '우유 스팀 온도·라떼 기준',
    tags: ['#레시피', '#라떼'], keywords: ['스팀', '우유', '온도', '라떼', '거품', '데우기'],
    square: SQ('우유 스팀 온도가 들쭉날쭉해 라떼가 미지근하거나 탄 맛이 난다.', [
      '1) 스팀피처에 우유는 절반보다 살짝 적게(피처 스파우트 아래).',
      '2) 목표 온도 60~65℃. 피처 바닥이 손으로 3초 못 버틸 때가 신호.',
      '3) 공기 주입은 처음 3초만. 이후는 롤링만 해서 거품을 곱게 정리.',
      '4) 스팀 후 노즐은 매번 젖은 행주로 닦고 공회전 1초.',
    ], '70℃ 넘기지 않는다 — 단백질이 타서 비린 맛이 난다. 남은 우유 재스팀 금지.'),
    timing: '음료 제조 중', tone: '정확하게',
  },
  {
    id: `${P}cafe_03`, category: 'Routine', subcategory: '장비', section: '오픈·마감', order_index: 3,
    title: '머신·그라인더 오픈/마감 관리',
    tags: ['#오픈', '#마감', '#장비'], keywords: ['머신', '그라인더', '예열', '백플러싱', '청소', '오픈', '마감'],
    square: SQ('오픈 직후 첫 잔이 맛없고, 마감 청소를 건너뛰면 다음 날 그라인더가 막힌다.', [
      '1) 오픈: 머신 전원 ON 후 15분 예열. 예열 중 그라인더 호퍼 원두 보충.',
      '2) 오픈 첫 샷은 반드시 버린다(에스프레소 1잔 테스트 추출 후 폐기).',
      '3) 마감: 포터필터 블라인드 바스켓 + 세정제로 백플러싱 3회, 물로 3회.',
      '4) 마감: 그라인더 호퍼 비우고 도징 챔버 브러시 청소. 원두는 밀폐용기로.',
    ], '세정제 백플러싱 후 물 헹굼을 빼먹지 않는다 — 다음 날 첫 손님이 세제 맛을 본다.'),
    timing: '오픈 07:30 / 마감 21:40', tone: '차분하게',
  },
  {
    id: `${P}cafe_04`, category: 'Routine', subcategory: '재고', section: '위생·재고', order_index: 4,
    title: '원두·우유 선입선출과 유통기한',
    tags: ['#재고', '#위생'], keywords: ['유통기한', '선입선출', '원두', '우유', '발주', '폐기'],
    square: SQ('냉장고 안쪽에 오래된 우유가 남아 있다가 뒤늦게 발견된다.', [
      '1) 입고분은 항상 안쪽에, 기존 재고는 앞으로 당긴다(선입선출).',
      '2) 우유는 개봉일을 뚜껑에 유성펜으로 적는다. 개봉 후 3일 초과분은 폐기.',
      '3) 원두는 로스팅일 기준 14일 이내만 사용. 봉투에 로스팅일 스티커 부착.',
      '4) 오픈조가 매일 아침 유통기한 임박(2일 이내) 품목을 업무 채팅에 올린다.',
    ], '"냄새 괜찮으니 쓰자" 판단 금지 — 날짜가 기준이다.'),
    timing: '매일 오픈 시', tone: '단호하게',
  },
  {
    id: `${P}cafe_05`, category: 'Event', subcategory: '품절', section: '손님 응대', order_index: 5,
    title: '인기 메뉴 품절 시 응대',
    tags: ['#품절', '#응대'], keywords: ['품절', '없어요', '재료소진', '대체', '추천'],
    square: SQ('피크타임에 딸기스무디·크로플 같은 인기 메뉴가 떨어졌다.', [
      '1) 품절이 확정되면 즉시 POS 옆 품절 보드와 업무 채팅에 올린다.',
      '2) 주문받기 전에 먼저 안내한다 — 결제 후 통보가 가장 큰 컴플레인 원인.',
      '3) 대체 메뉴를 반드시 하나 제안한다(딸기스무디 → 딸기라떼, 크로플 → 치즈케이크).',
      '4) 재입고 예정일을 알면 같이 말한다. 모르면 "확인해서 알려드리겠다"까지만.',
    ], '"몰라요" 로 끝내지 않는다. 대체안 없이 품절만 통보하지 않는다.',
    ['죄송합니다, 딸기스무디는 오늘 재료가 소진됐어요. 딸기라떼도 인기가 많은데 괜찮으실까요?']),
    timing: '주문 접수 전', tone: '공감하며',
  },
  {
    id: `${P}cafe_06`, category: 'Event', subcategory: '좌석', section: '손님 응대', order_index: 6,
    title: '노트북 장시간 이용·콘센트 분쟁',
    tags: ['#좌석', '#분쟁'], keywords: ['노트북', '콘센트', '자리', '장시간', '카공', '회전율'],
    square: SQ('주말 피크타임에 노트북 손님이 4인석을 오래 점유해 대기 손님과 마찰이 생긴다.', [
      '1) 먼저 안내문 기준을 말한다 — "주말 12~17시는 2시간 이용을 부탁드리고 있어요".',
      '2) 개인이 판단하지 않는다. 매장 기준을 그대로 전달하는 방식이 안전하다.',
      '3) 4인석 점유는 2인석으로 자리 이동을 정중히 제안하고, 직접 짐을 옮겨드린다.',
      '4) 손님이 언짢아하면 더 밀지 말고 사장에게 바로 알린다.',
    ], '"오래 계셨네요" 같은 지적성 표현 금지. 다른 손님 앞에서 목소리를 키우지 않는다.',
    ['이용에 불편 드려 죄송해요. 주말 낮에는 2시간 이용을 부탁드리고 있어서요, 창가 2인석으로 옮겨드려도 될까요?']),
    timing: '대기 발생 시', tone: '정중하게',
  },
].map((e) => ({
  id: e.id, category: e.category, subcategory: e.subcategory, title: e.title,
  tags: e.tags, search_keywords: e.keywords, square: e.square,
  execution: { timing: e.timing, channel: '대면', tone: e.tone, stakeholders: ['손님', '사장'] },
  section: e.section, order_index: e.order_index, pack_id: 'cafe',
  verification: { state: 'owner_verified' },
}));

// 사장이 직원 질문에 직접 답해서 생긴 노하우 3건 (받은질문 → 노하우 루프의 결과물)
const INBOX_ANSWERS = [
  {
    id: `${P}inbox_01`, category: 'Event', subcategory: '결제', section: '주문·결제', order_index: 11,
    title: '카드 단말기 통신 오류가 났을 때',
    tags: ['#결제', '#장애'], keywords: ['카드', '단말기', '결제오류', '통신오류', '먹통', 'POS'],
    q: '카드 단말기에 통신오류 뜨는데 어떻게 해요?',
    square: SQ('결제 중 카드 단말기에 "통신오류"가 떠서 승인이 안 된다.', [
      '1) 같은 카드로 한 번 더 시도하지 말고 먼저 승인 내역부터 확인(중복 승인 위험).',
      '2) 단말기 뒤 랜선을 뽑았다 5초 후 다시 꽂고 전원 재시작(약 40초).',
      '3) 그동안 손님께는 계좌이체 또는 카카오페이 QR 안내(카운터 옆 QR판).',
      '4) 재시작 후에도 안 되면 사장에게 전화. 단말기사 고객센터는 사장이 건다.',
    ], '오류 화면에서 같은 카드를 연속으로 긁지 않는다 — 이중 승인이 실제로 났었다.'),
  },
  {
    id: `${P}inbox_02`, category: 'Event', subcategory: '긴급', section: '위생·재고', order_index: 12,
    title: '제빙기에서 물이 새면',
    tags: ['#긴급', '#장비'], keywords: ['제빙기', '물샘', '누수', '얼음', '바닥', '고장'],
    q: '제빙기 밑으로 물이 계속 새요. 어떻게 하죠?',
    square: SQ('제빙기 아래로 물이 흘러 바닥이 젖고 있다.', [
      '1) 안전 먼저 — 젖은 바닥에 "미끄럼 주의" 표지판을 놓고 마른 걸레로 즉시 닦는다.',
      '2) 제빙기 전원 코드를 뽑는다(젖은 손 금지, 마른 수건으로 잡고).',
      '3) 배수 호스가 싱크 배수구에서 빠졌는지 먼저 확인 — 열에 아홉은 이 경우다.',
      '4) 호스 문제가 아니면 사진을 찍어 업무 채팅에 올리고 사장에게 바로 알린다.',
      '5) 그날 얼음은 편의점 봉지얼음으로 대체(주변 CU에서 3봉 이내 구매, 영수증 보관).',
    ], '전원이 꽂힌 상태로 내부를 만지지 않는다. 혼자 분해하지 않는다.'),
  },
  {
    id: `${P}inbox_03`, category: 'Context', subcategory: '위생', section: '위생·재고', order_index: 13,
    title: '개인 텀블러 받아도 되는 기준',
    tags: ['#위생', '#텀블러'], keywords: ['텀블러', '개인컵', '할인', '위생', '세척'],
    q: '손님이 개인 텀블러 주시는데 그냥 받아도 되나요?',
    square: SQ('손님이 개인 텀블러를 건네며 음료를 담아달라고 한다.', [
      '1) 받는다. 개인컵 할인 300원 적용(POS 개인컵 버튼).',
      '2) 단, 텀블러 안쪽에 이물질·기존 음료가 남아 있으면 "헹궈드릴까요?" 하고 온수로 헹군다.',
      '3) 제조는 반드시 매장 잔에 만든 뒤 텀블러로 옮겨 담는다 — 용량 초과 사고 방지.',
      '4) 용량이 애매하면 먼저 물어본다. "톨 사이즈로 담아드리면 될까요?"',
    ], '텀블러를 스팀 피처나 그룹헤드에 직접 대지 않는다(위생·화상 위험).'),
  },
].map((e) => ({
  id: e.id, category: e.category, subcategory: e.subcategory, title: e.title,
  tags: e.tags, search_keywords: e.keywords, square: e.square, q: e.q,
  execution: { timing: '상황 발생 즉시', channel: '대면', tone: '차분하게', stakeholders: ['손님', '사장'] },
  section: e.section, order_index: e.order_index, pack_id: null,
  verification: { state: 'owner_verified' },
}));

const SECTION_FOR_BASE = {
  Event: '손님 응대', Routine: '오픈·마감', Context: '매장 원칙', 'Know-how': '현장 꿀팁',
};

async function main() {
  console.log(`\n■ 심사용 데모 환경 시드 — ${UNIT}\n`);

  // ════════════════════════════════════════════════════════════════
  console.log('1) 데모 계정 2개 프로비저닝');
  const ownerId = await ensureUser(OWNER_EMAIL, {
    name: '김민서', role: 'owner', phone: '01099880001', birth_date: '1984-03-11',
  });
  const staffId = await ensureUser(STAFF_EMAIL, {
    name: '이도현', role: 'junior', phone: '01099880002', birth_date: '2003-09-22',
  });
  if (ownerId === staffId) throw new Error('owner/staff 계정이 동일합니다');

  // ════════════════════════════════════════════════════════════════
  console.log('2) 데모 매장 upsert (고정 id — PROTECT_UNITS 보호 대상)');
  {
    // 초대코드 유일성 — 다른 매장이 이미 쓰면 빈 코드로 교체.
    let code = INVITE_CODE;
    const { data: taken } = await db.from('units').select('id').eq('invite_code', code).maybeSingle();
    if (taken && taken.id !== UNIT) {
      for (;;) {
        const c = String(Math.floor(100000 + Math.random() * 900000));
        const { data: t2 } = await db.from('units').select('id').eq('invite_code', c).maybeSingle();
        if (!t2) { code = c; break; }
      }
      console.log(`  ! 초대코드 ${INVITE_CODE} 는 이미 사용중 → ${code} 로 대체`);
    }
    const ctx = readJson('context-pack.json');
    await step('units', db.from('units').upsert({
      id: UNIT, store_name: STORE_NAME, industry: ctx.industry, subcategory: ctx.subcategory,
      owner_id: ownerId, invite_code: code, invite_expires_at: null, deleted_at: null,
      context: { ...ctx, id: 'ctx_appreview', unit_id: UNIT, store_name: STORE_NAME, owner_id: ownerId },
    }));
    console.log(`  · 초대코드: ${code}`);
  }

  // 사장 프로필/멤버십 — approve_member 가 auth_unit_id()(활성매장)를 보므로 반드시 먼저.
  await step('profiles(사장)', db.from('profiles').update({
    name: '김민서', role: 'owner', unit_id: UNIT, active_unit_id: UNIT, pending_unit_id: null,
    deleted_at: null, avatar: 'owner', phone_last4: '0001', birth_date: '1984-03-11',
    bio: '우리 데모 카페 사장. 9년째 카페 운영 중.', meta: { career_years: 9 },
  }).eq('id', ownerId));
  await step('unit_members(사장)', db.from('unit_members')
    .upsert({ user_id: ownerId, unit_id: UNIT, role: 'owner' }, { onConflict: 'user_id,unit_id' }));

  // ════════════════════════════════════════════════════════════════
  console.log('3) 구독 활성화 (multi — 페이월 우회 + 다점포 화면 심사 가능)');
  {
    const { data: sub } = await db.from('unit_subscriptions')
      .select('plan,status,paid_until').eq('unit_id', UNIT).maybeSingle();
    const farEnough = sub?.plan === 'multi' && sub?.status === 'active'
      && sub?.paid_until && new Date(sub.paid_until) > addDays(180);
    if (farEnough) {
      console.log(`  · 이미 multi/active (paid_until=${String(sub.paid_until).slice(0, 10)}) → 건너뜀`);
    } else {
      const { data, error } = await db.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 365, p_plan: 'multi' });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      console.log(`  ✓ admin_activate_store → plan=${row?.plan} status=${row?.status} paid_until=${String(row?.paid_until).slice(0, 10)}`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  console.log('4) 직원 합류 — 초대코드 join_by_invite → 사장 approve_member (실 RPC 경로)');
  {
    const { data: mem } = await db.from('unit_members')
      .select('user_id').eq('unit_id', UNIT).eq('user_id', staffId).maybeSingle();
    if (mem) {
      console.log('  · 이미 승인된 멤버 → 합류 절차 건너뜀');
      await step('profiles(직원) 보정', db.from('profiles').update({
        name: '이도현', role: 'junior', unit_id: UNIT, active_unit_id: UNIT, pending_unit_id: null,
        deleted_at: null, avatar: 'junior_male', phone_last4: '0002', birth_date: '2003-09-22',
        bio: '대학생. 카페 알바 3개월차. 오후 시프트.', meta: { career_days: 96, shift: '오후 (13~19시)' },
      }).eq('id', staffId));
    } else {
      const { data: u } = await db.from('units').select('invite_code').eq('id', UNIT).single();
      // 재실행 안전: 잔여 pending 정리 후 실경로 진행
      await db.from('profiles').update({ pending_unit_id: null, role: 'junior' }).eq('id', staffId);

      const sc = anon();
      const { data: sSess, error: sErr } = await sc.auth.signInWithPassword({ email: STAFF_EMAIL, password: PASSWORD });
      if (sErr || !sSess?.session) throw new Error(`직원 로그인 실패: ${sErr?.message}`);
      const { error: jErr } = await sc.rpc('join_by_invite', { p_code: u.invite_code, p_birth_date: '2003-09-22' });
      if (jErr) throw new Error(`join_by_invite 실패: ${jErr.message}`);
      console.log('  ✓ join_by_invite (승인 대기 상태)');

      const oc = anon();
      const { data: oSess, error: oErr } = await oc.auth.signInWithPassword({ email: OWNER_EMAIL, password: PASSWORD });
      if (oErr || !oSess?.session) throw new Error(`사장 로그인 실패: ${oErr?.message}`);
      const { error: aErr } = await oc.rpc('approve_member', { p_uid: staffId });
      if (aErr) throw new Error(`approve_member 실패: ${aErr.message}`);
      console.log('  ✓ approve_member (소속 확정)');

      await step('profiles(직원) 보강', db.from('profiles').update({
        name: '이도현', avatar: 'junior_male', phone_last4: '0002', birth_date: '2003-09-22',
        bio: '대학생. 카페 알바 3개월차. 오후 시프트.', meta: { career_days: 96, shift: '오후 (13~19시)' },
      }).eq('id', staffId));
    }
  }

  await step('wages', db.from('wages').upsert({ unit_id: UNIT, staff_id: staffId, hourly_wage: 11000 }));
  await step('schedule_config', db.from('schedule_config').upsert({
    unit_id: UNIT, open: '07:30', close: '22:00', closed_days: [],
    note: '연중무휴. 주말 13~17시 피크.', updated_at: new Date().toISOString(),
  }));
  await step('work_rooms(기본방)', db.from('work_rooms').upsert({
    id: ROOM, unit_id: UNIT, name: '전체', is_default: true, created_by: ownerId,
  }));

  // ════════════════════════════════════════════════════════════════
  console.log('5) 운영데이터 purge (이 매장 범위만 — 재실행 멱등)');
  for (const t of ['work_done', 'work_feed', 'work_templates', 'attendance', 'shift_templates',
    'playbook_suggestions', 'chat_queries', 'unknown_queries']) {
    await step(`${t} purge`, db.from(t).delete().eq('unit_id', UNIT));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('6) 노하우 upsert');
  const base = readJson('playbook-entries.json').map((e, i) => ({
    ...e,
    id: P + e.id,
    section: SECTION_FOR_BASE[e.category] ?? '기타',
    order_index: 20 + i,
    verification: { state: 'owner_verified', verified_by: ownerId, verified_at: ts(dateStr(-6), 21, 0) },
  }));
  const extra = [...CAFE, ...INBOX_ANSWERS].map((e) => ({
    id: e.id, category: e.category, subcategory: e.subcategory, title: e.title,
    tags: e.tags, search_keywords: e.search_keywords, square: e.square, execution: e.execution,
    photos: [], version: 1, quality_score: 0.82,
    stats: { query_hits_30d: 0, resolution_rate: 0, thumbs_up: 0, thumbs_down: 0, last_used_at: '' },
    is_template: false, pack_id: e.pack_id, needs_review: false, correction_points: [],
    section: e.section, order_index: e.order_index,
    verification: { ...e.verification, verified_by: ownerId, verified_at: ts(dateStr(-3), 20, 0) },
  }));
  const entries = [...base, ...extra].map((e) => {
    const { q: _q, ...rest } = e;
    return {
      ...rest, unit_id: UNIT, creator_id: ownerId, creator_name: '김민서',
      status: 'published', is_template: false, source_id: null,
      photos: rest.photos ?? [],
      needs_review: rest.needs_review ?? false,
      correction_points: rest.correction_points ?? [],
      tags: rest.tags ?? [],
      search_keywords: rest.search_keywords ?? [],
      version: rest.version ?? 1,
      quality_score: rest.quality_score ?? 0.8,
      created_at: rest.created_at ?? dateStr(-30),
      updated_at: rest.updated_at ?? dateStr(-3),
    };
  });
  await step(`playbook_entries ${entries.length}건`, db.from('playbook_entries').upsert(entries));
  // 이전 실행이 남긴 stale 노하우만 제거(임베딩 재사용을 위해 전량 삭제는 하지 않는다).
  {
    const keep = new Set(entries.map((e) => e.id));
    const { data: cur } = await db.from('playbook_entries').select('id').eq('unit_id', UNIT);
    const stale = (cur ?? []).map((r) => r.id).filter((id) => !keep.has(id));
    if (stale.length) {
      await db.from('playbook_embeddings').delete().in('entry_id', stale);
      await step(`stale 노하우 ${stale.length}건 삭제`, db.from('playbook_entries').delete().in('id', stale));
    }
  }

  // ════════════════════════════════════════════════════════════════
  console.log('7) 오늘 할 일 (work_templates 8건 · 오늘 완료 3건)');
  const tmpl = (id, section, text, extra2 = {}) => ({
    id: `${P}t_${id}`, unit_id: UNIT, room_id: ROOM, section, text,
    scope: 'shared', created_by: ownerId, ...extra2,
  });
  const templates = [
    tmpl('open1', 'open', '에스프레소 머신 전원 ON → 15분 예열, 첫 샷 버리기'),
    tmpl('open2', 'open', '냉장고 우유 잔량 확인 + 개봉일 라벨 체크'),
    tmpl('open3', 'open', 'POS 시재 5만원 확인 후 오픈 사인 켜기'),
    tmpl('mid1', 'mid', '디저트 쇼케이스 재정렬 · 유통기한 임박분 채팅 공유'),
    tmpl('mid2', 'mid', '원두 호퍼 보충 · 그라인더 분쇄도 점검'),
    tmpl('close1', 'close', '머신 백플러싱(세정제 3회 → 물 3회)'),
    tmpl('close2', 'close', '제빙기 배수 호스 위치 확인 · 싱크 거름망 청소'),
    tmpl('close3', 'close', '마감 정산 후 시재 5만원만 남기고 금고 보관'),
  ];
  await step('work_templates', db.from('work_templates').upsert(templates));
  const doneAt = (h, m) => ({ by: staffId, byName: '이도현', at: ts(TODAY, h, m) });
  await step('work_done(오늘 3건 완료)', db.from('work_done').upsert([
    { unit_id: UNIT, work_date: TODAY, room_id: ROOM, template_id: `${P}t_open1`, data: doneAt(7, 42) },
    { unit_id: UNIT, work_date: TODAY, room_id: ROOM, template_id: `${P}t_open2`, data: doneAt(7, 55) },
    { unit_id: UNIT, work_date: TODAY, room_id: ROOM, template_id: `${P}t_open3`, data: doneAt(8, 3) },
  ]));

  // ════════════════════════════════════════════════════════════════
  console.log('8) 업무 채팅 (공지 1건 + 메시지 11건 + 완료알림 1건)');
  const feed = (id, date, data) => ({
    id: `${P}f_${id}`, unit_id: UNIT, feed_date: date, room_id: ROOM,
    data: { id: `${P}f_${id}`, date, ...data },
  });
  const O = { authorId: ownerId, authorName: '김민서', authorRole: 'owner' };
  const S = { authorId: staffId, authorName: '이도현', authorRole: 'junior' };
  const feedRows = [
    feed('notice1', TODAY, {
      kind: 'notice', ...O, createdAt: ts(TODAY, 8, 40), pinned: true, important: true,
      read_by: [staffId], reactions: { '👍': [staffId] },
      text: '이번 주 토요일 14시 단체예약 20명 있습니다. 오후 타임 얼음·컵 재고 미리 넉넉히 채워주세요.',
    }),
    feed('m1', dateStr(-2), { kind: 'message', ...S, createdAt: ts(dateStr(-2), 13, 20), text: '오후 출근했습니다! 디저트 입고분 정리부터 할게요.' }),
    feed('m2', dateStr(-2), { kind: 'message', ...O, createdAt: ts(dateStr(-2), 13, 31), text: '네 고마워요. 크로플은 냉동실 두 번째 칸에 넣어주세요.' }),
    feed('m3', dateStr(-1), { kind: 'message', ...S, createdAt: ts(dateStr(-1), 14, 5), text: '사장님, 우유 두 팩 남았어요. 발주 넣을까요?' }),
    feed('m4', dateStr(-1), { kind: 'message', ...O, createdAt: ts(dateStr(-1), 14, 12), text: '네 6팩으로 넣어주세요. 주말 단체예약 있어서 넉넉히요.' }),
    feed('m5', dateStr(-1), { kind: 'message', ...S, createdAt: ts(dateStr(-1), 14, 15), text: '넣었습니다. 내일 오전 도착이래요.' }),
    feed('m6', dateStr(-1), { kind: 'message', ...O, createdAt: ts(dateStr(-1), 19, 2), text: '오늘 마감 수고 많았어요. 제빙기 배수 호스 위치만 한 번 더 봐주세요.' }),
    feed('m7', TODAY, { kind: 'message', ...S, createdAt: ts(TODAY, 7, 35), text: '오픈했습니다. 머신 예열 중이에요.' }),
    feed('m8', TODAY, { kind: 'message', ...S, createdAt: ts(TODAY, 9, 12), text: '우유 6팩 입고 확인했습니다. 개봉일 라벨 붙여뒀어요.' }),
    feed('m9', TODAY, { kind: 'message', ...O, createdAt: ts(TODAY, 9, 20), mentions: [staffId], text: '이도현님 👍 오후에 딸기 재고도 한 번 확인해주세요.' }),
    feed('m10', TODAY, { kind: 'message', ...S, createdAt: ts(TODAY, 9, 24), text: '네 확인하고 다시 올리겠습니다.' }),
    feed('m11', TODAY, { kind: 'message', ...O, createdAt: ts(TODAY, 10, 5), text: '오늘 낮에 원두 로스팅일 스티커도 같이 갈아주면 좋겠어요.' }),
    feed('done1', TODAY, {
      kind: 'task_done', ...S, createdAt: ts(TODAY, 8, 3),
      text: '이도현 · POS 시재 5만원 확인 후 오픈 사인 켜기 완료', refId: `${P}t_open3`,
    }),
  ];
  await step('work_feed', db.from('work_feed').upsert(feedRows));

  // ════════════════════════════════════════════════════════════════
  console.log('9) 근무표 + 출퇴근 3일치');
  // 근무표가 비면 직원 '출퇴근 > 근무표' 화면이 빈 화면으로 보인다(4.2 리스크).
  await step('shift_templates', db.from('shift_templates').upsert(
    [1, 2, 3, 4, 5].map((wd) => ({
      id: `${P}shift_${wd}`, unit_id: UNIT, staff_id: staffId, weekday: wd,
      start_time: '13:00', end_time: '19:00',
    })),
  ));
  const att = [];
  for (const [n, sh, sm, eh, em] of [[-2, 13, 2, 19, 4], [-1, 13, 0, 19, 11], [0, 13, 1, 19, 0]]) {
    const d = dateStr(n);
    // 오늘은 "근무중"(퇴근 전) — 심사원이 라이브 퇴근을 눌러볼 수 있다. 미래 시각이 되지 않게 1시간 전으로.
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const ci = n === 0 ? (hourAgo > ts(d, sh, sm) ? ts(d, sh, sm) : hourAgo) : ts(d, sh, sm);
    const co = n === 0 ? null : ts(d, eh, em);
    att.push({
      id: `${P}att_${d}`, unit_id: UNIT, staff_id: staffId, date: d,
      check_in: ci, check_out: co, work_minutes: co ? mins(ci, co) : 0, edited_by: null,
    });
  }
  await step('attendance', db.from('attendance').upsert(att));

  // ════════════════════════════════════════════════════════════════
  console.log('10) AI가 답한 질문 3건 (chat_queries)');
  const srcRef = (id) => {
    const e = entries.find((x) => x.id === id);
    return { entry_id: e.id, creator_name: e.creator_name, title: e.title, version: e.version ?? 1, updated_at: e.updated_at ?? dateStr(-3) };
  };
  const cq = (n, hoursAgoDay, hh, mm, text, entryId, block) => ({
    id: `${P}cq_${n}`, unit_id: UNIT, junior_id: staffId, junior_name: '이도현',
    query_text: text, asked_at: ts(dateStr(hoursAgoDay), hh, mm),
    matched_entry_ids: [entryId], match_confidence: block.conf, was_deflected: true,
    response_block: { summary: block.summary, actions: block.actions, donts: block.donts, mode: 'served', source: srcRef(entryId) },
    satisfaction: 'up', resolved_at: ts(dateStr(hoursAgoDay), hh, mm + 2),
  });
  await step('chat_queries 3건', db.from('chat_queries').upsert([
    cq('01', -1, 15, 8, '아메리카노 연하게 해달라는데 물만 더 넣으면 되나요?', `${P}cafe_01`, {
      conf: 0.93,
      summary: '매장 기준은 "샷은 그대로, 물만 30ml 추가"예요. 샷을 빼면 맛이 무너집니다.',
      actions: ['HOT 기준 2샷 + 뜨거운 물 220ml 가 기본이에요.', '"연하게" 요청은 물만 30ml 더 넣습니다.', '"진하게"는 샷 1개 추가 + 500원 안내.'],
      donts: ['샷을 빼고 물만 늘려 연하게 만들지 않습니다.'],
    }),
    cq('02', -1, 18, 41, '딸기스무디 재료 떨어졌는데 손님한테 뭐라고 하죠?', `${P}cafe_05`, {
      conf: 0.9,
      summary: '주문받기 전에 먼저 알리고, 대체 메뉴를 반드시 하나 제안하는 게 매장 기준이에요.',
      actions: ['품절 보드와 업무 채팅에 즉시 공유합니다.', '주문 접수 전에 먼저 안내합니다(결제 후 통보 금지).', '딸기스무디 → 딸기라떼로 대체 제안.'],
      donts: ['"몰라요"로 끝내거나 대체안 없이 품절만 통보하지 않습니다.'],
    }),
    cq('03', 0, 9, 40, '우유 개봉한 지 며칠까지 써도 돼요?', `${P}cafe_04`, {
      conf: 0.95,
      summary: '개봉 후 3일까지만 사용하고 초과분은 폐기합니다. 냄새로 판단하지 않아요.',
      actions: ['개봉일을 뚜껑에 유성펜으로 적어둡니다.', '개봉 후 3일 초과분은 폐기합니다.', '입고분은 안쪽, 기존 재고는 앞으로(선입선출).'],
      donts: ['"냄새 괜찮으니 쓰자" 판단 금지 — 날짜가 기준입니다.'],
    }),
  ]));

  // ════════════════════════════════════════════════════════════════
  console.log('11) 사장이 답한 질문 3건 + 미답변 1건 (unknown_queries)');
  const uq = (n, dayN, hh, mm, e, conf) => ({
    id: `${P}uq_${n}`, unit_id: UNIT, junior_id: staffId, junior_name: '이도현',
    query_text: e.q, asked_at: ts(dateStr(dayN), hh, mm),
    presumed_category: e.category, presumed_subcategory: e.subcategory,
    match_attempted: true, best_match_confidence: conf, best_match_entry_id: null,
    status: 'resolved_with_entry', resolved_with_entry_id: e.id,
    fallback_action: '사장님께 알림 전송됨.', owner_notified_at: ts(dateStr(dayN), hh, mm + 1),
    owner_will_answer: true, similar_queries_count: 1, anonymous: false, answered_by: null,
    ai_general_answer: '',
  });
  await step('unknown_queries(사장 답변 3건)', db.from('unknown_queries').upsert([
    uq('01', -6, 16, 12, INBOX_ANSWERS[0], 0.24),
    uq('02', -4, 11, 30, INBOX_ANSWERS[1], 0.19),
    uq('03', -2, 15, 5, INBOX_ANSWERS[2], 0.31),
  ]));
  // 사장 인박스가 빈 화면으로 보이지 않게 대기 1건(핵심 루프를 심사원이 직접 답해볼 수 있다).
  await step('unknown_queries(대기 1건)', db.from('unknown_queries').upsert({
    id: `${P}uq_04`, unit_id: UNIT, junior_id: staffId, junior_name: '이도현',
    query_text: '단체손님이 세금계산서 달라고 하는데 어떻게 하나요?',
    asked_at: ts(TODAY, 11, 2), presumed_category: 'Event', presumed_subcategory: '결제',
    match_attempted: true, best_match_confidence: 0.21, best_match_entry_id: null,
    status: 'pending_owner_answer', fallback_action: '사장님께 알림 전송됨.',
    owner_notified_at: ts(TODAY, 11, 3), owner_will_answer: true, similar_queries_count: 1,
    anonymous: false, ai_general_answer: '',
  }));

  // ════════════════════════════════════════════════════════════════
  if (SKIP_EMBED) {
    console.log('\n12) 임베딩 — --skip-embed 로 생략');
  } else {
    console.log('12) 노하우 임베딩 (Edge ai/embed · 사용자 분당캡 10 → 8초 페이싱)');
    const { data: has } = await db.from('playbook_embeddings').select('entry_id').eq('unit_id', UNIT);
    const done = new Set(FORCE_EMBED ? [] : (has ?? []).map((r) => r.entry_id));
    const todo = entries.filter((e) => !done.has(e.id));
    if (!todo.length) console.log('  · 이미 전부 임베딩됨 → 건너뜀');
    else {
      const H = { apikey: ANON, 'Content-Type': 'application/json' };
      const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: H, body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
      })).json();
      if (!auth.access_token) throw new Error(`사장 로그인 실패(임베딩): ${auth.error_description ?? ''}`);
      const AH = { ...H, Authorization: `Bearer ${auth.access_token}` };
      const CAT = { Routine: '루틴', Event: '돌발', Context: '원칙', 'Know-how': '꿀팁' };
      const embedText = (e) => [e.title, CAT[e.category] ?? e.category, e.square?.situation,
        (e.square?.action?.steps ?? []).join(' '), e.square?.extract?.dont,
        (e.search_keywords ?? []).join(' ')].filter(Boolean).join('\n').slice(0, 4000);
      let ok = 0, ng = 0;
      for (const e of todo) {
        for (let a = 1; a <= 4; a++) {
          const res = await fetch(`${URL}/functions/v1/ai`, {
            method: 'POST', headers: AH,
            body: JSON.stringify({ task: 'embed', payload: { entryId: e.id, text: embedText(e) } }),
          });
          if (res.status === 429) { await sleep(9000 * a); continue; }
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.ok !== false) { ok++; process.stdout.write('.'); }
          else { ng++; console.warn(`\n   ✗ ${e.id}: ${res.status} ${JSON.stringify(j).slice(0, 140)}`); }
          break;
        }
        await sleep(8000);
      }
      console.log(`\n  · 임베딩 성공 ${ok} / 실패 ${ng} (대상 ${todo.length})`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  const { data: unit } = await db.from('units').select('invite_code').eq('id', UNIT).single();
  console.log('\n' + '═'.repeat(70));
  console.log('✅ 심사용 데모 환경 준비 완료');
  console.log('═'.repeat(70));
  console.log(`  unit_id     : ${UNIT}`);
  console.log(`  매장명       : ${STORE_NAME}`);
  console.log(`  초대코드     : ${unit?.invite_code}`);
  console.log(`  사장 계정    : ${OWNER_EMAIL} / ${PASSWORD}   (uid ${ownerId})`);
  console.log(`  직원 계정    : ${STAFF_EMAIL} / ${PASSWORD}   (uid ${staffId})`);
  console.log('');
  console.log('★ 삭제 방지 확인 — scripts/cleanup-orphan-stores.mjs 에 아래 두 줄이 살아 있어야 합니다.');
  console.log(`    PROTECT_UNITS 에 '${UNIT}'`);
  console.log(`    PROTECT_EMAIL 에 /appreview\\.(owner|staff)@/i`);
  console.log('  (누락 시 정리 스크립트가 심사 도중 데모 매장을 삭제합니다.)');
  console.log('');
  console.log('  검증: node --env-file=.env.seed scripts/seed-appreview.mjs --skip-embed  (재실행 = 멱등)');
  console.log('');
}

main().catch((e) => { console.error('\n✗ 시드 실패:', e.message ?? e); process.exit(1); });
