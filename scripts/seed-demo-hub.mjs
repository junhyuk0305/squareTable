// scripts/seed-demo-hub.mjs — 허브 대시보드(3탭) 신규 기능 QA용 데모 데이터 시드.
//
// 기존 파일럿 가족(store_001 스퀘어 카페 신촌점 · 김영자/박지원/이수민)을 "다매장" 상태로 확장하고,
// 07-30 라이브된 신규 기능이 전부 데이터 있는 상태로 보이게 채운다:
//   · 사장 현황 탭: 오늘 스냅샷(근무중/예정) · 확인 필요 4종(합류/받은질문/제안/검증) · 매장 비교 · AI 게이지
//   · 사장 노하우 탭: 노하우로 만들 것(pending_q) · 검증 필요(needs_review) · 방치(stale 90일+)
//   · 직원 오늘 탭: 전 매장 근무 카드 · 매장별 오늘 할일(@배정) · 이번달 근무·예상 급여(다매장 합산)
//   · 직원 성장 탭: 가르침 실적(제안 승격 resulting_entry_id) · 내가 남긴 것(query_hits) · 해본 업무
//   · 시작 체크리스트(콜드스타트): 매장 1곳 사장 전용 → 별도 신규 사장(한지현)으로 1/4 상태 재현
//
// 구성 매장/계정 (비번 공통: pilot1234)
//   store_001          스퀘어 카페 신촌점  김영자 owner@pilot.squaretable.app (multi 승격)
//   store_002_demo     스퀘어 카페 홍대점  김영자 2호점 · 박지원 겸직 · 최은우 전담(hubdemo.staff3@…)
//   store_starter_demo 스퀘어 카페 성수점  한지현 hubdemo.starter@…  (콜드스타트 · free 유지)
//   합류 신청 pending   김하늘 hubdemo.applicant@… → 홍대점 (사장 확인 필요 작업함용)
//
// 실행:  node scripts/seed-demo-hub.mjs           (.env.seed 자동 로드, 멱등 — 재실행 안전)
// ★ 임베딩은 생략한다(대시보드 QA 범위 밖). 신규 노하우로 AI 검색까지 볼 거면:
//    node --env-file=.env.seed scripts/backfill-embeddings.mjs
// ★ 삭제 방지: cleanup-orphan-stores.mjs 의 PROTECT_UNITS 에 store_002_demo·store_starter_demo,
//    PROTECT_EMAIL 에 /hubdemo\./ 가 등록돼 있어야 한다(이 시드와 같은 커밋에서 등록됨 — 지우지 말 것).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
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
const readJson = (p) => JSON.parse(readFileSync(join(__dir, '..', 'src', 'data', p), 'utf8'));

const envSeed = readEnv('.env.seed');
const envApp = readEnv('.env');
const URL = process.env.SUPABASE_URL || envSeed.SUPABASE_URL || envApp.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || envSeed.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || envApp.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SERVICE) { console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.seed)'); process.exit(1); }

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

// ── 상수 ─────────────────────────────────────────────────────
const PASSWORD = 'pilot1234';
const STORE1 = 'store_001';
const STORE2 = 'store_002_demo';
const STARTER = 'store_starter_demo';
const ROOM1 = `room_main_${STORE1}`;
const ROOM2 = `room_main_${STORE2}`;
const OWNER_EMAIL = 'owner@pilot.squaretable.app';
const JIWON_EMAIL = 'staff@pilot.squaretable.app';
const SUMIN_EMAIL = 'staff2@pilot.squaretable.app';
const STAFF3_EMAIL = 'hubdemo.staff3@pilot.squaretable.app';     // 최은우(홍대 전담)
const STARTER_EMAIL = 'hubdemo.starter@pilot.squaretable.app';   // 한지현(콜드스타트 사장)
const APPLICANT_EMAIL = 'hubdemo.applicant@pilot.squaretable.app'; // 김하늘(합류 신청 pending)

// ── 날짜 헬퍼(KST 벽시계 → UTC ISO, seed-demo 와 동일 표기) ──
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const addDays = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
const dateStr = (n) => iso(addDays(n));
const TODAY = dateStr(0);
const MONTH = TODAY.slice(0, 7);
const DOW = today.getDay();
const ts = (d, hh, mm) => new Date(`${d}T${pad(hh)}:${pad(mm)}:00+09:00`).toISOString();
const mins = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
const daysAgoTs = (n) => new Date(Date.now() - n * 86400_000).toISOString();

async function step(label, p) {
  const { error } = await p;
  if (error) { console.error(`  ✗ ${label}: ${error.message}`); throw error; }
  console.log(`  ✓ ${label}`);
}

async function findUser(email) {
  let page = 1;
  for (;;) {
    const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit.id;
    if ((list?.users ?? []).length < 200) return null;
    page++;
  }
}

async function ensureUser(email, meta) {
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: meta,
  });
  if (!error) { console.log(`  · 계정 생성: ${email}`); return data.user.id; }
  if (!/already.*registered|exists|been registered/i.test(error.message)) throw error;
  const id = await findUser(email);
  if (!id) throw new Error(`계정을 찾을 수 없음: ${email}`);
  await db.auth.admin.updateUserById(id, { password: PASSWORD, email_confirm: true });
  console.log(`  · 기존 계정 재사용(비번 재설정): ${email}`);
  return id;
}

async function uniqueInviteCode(unitId) {
  for (;;) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    const { data: t } = await db.from('units').select('id').eq('invite_code', c).maybeSingle();
    if (!t || t.id === unitId) return c;
  }
}

// units 는 기존 코드가 있으면 유지, 없으면 새로 발급
async function upsertStore(id, name, ownerId, ctxPatch = {}) {
  const { data: cur } = await db.from('units').select('invite_code').eq('id', id).maybeSingle();
  const code = cur?.invite_code ?? await uniqueInviteCode(id);
  const ctx = readJson('context-pack.json');
  await step(`units ${id} (${name})`, db.from('units').upsert({
    id, store_name: name, industry: ctx.industry, subcategory: ctx.subcategory,
    owner_id: ownerId, invite_code: code, invite_expires_at: null, deleted_at: null,
    context: { ...ctx, id: `ctx_${id}`, unit_id: id, store_name: name, owner_id: ownerId, ...ctxPatch },
  }));
  return code;
}

// ── 노하우 골격(SQUARE 스키마 최소 충족) ─────────────────────
const SQ = (situation, steps, dont, scripts = []) => ({
  situation, quagmire: '', uncover: '',
  action: { steps, scripts },
  result: { before: '', after: '', metric: '' },
  extract: { do: '', dont, template: '' },
});
const entryRow = (unit, creatorId, creatorName, e) => ({
  id: e.id, unit_id: unit, creator_id: creatorId, creator_name: creatorName,
  category: e.category, subcategory: e.subcategory, title: e.title,
  tags: e.tags ?? [], search_keywords: e.keywords ?? [], square: e.square,
  execution: { timing: e.timing ?? '상황 발생 시', channel: '대면', tone: '차분하게', stakeholders: ['손님', '사장'] },
  photos: [], version: 1, quality_score: 0.82,
  stats: { query_hits_30d: e.hits ?? 0, resolution_rate: 0, thumbs_up: 0, thumbs_down: 0, last_used_at: '' },
  is_template: false, pack_id: null, needs_review: e.needs_review ?? false, correction_points: [],
  section: e.section, order_index: e.order_index, status: 'published', source_id: null,
  verification: e.verification ?? { state: 'owner_verified', verified_by: creatorId, verified_at: daysAgoTs(5) },
  created_at: e.created_at ?? daysAgoTs(30), updated_at: e.updated_at ?? daysAgoTs(3),
});

async function main() {
  console.log('\n■ 허브 대시보드 QA 데모 시드 — 다매장(신촌+홍대) + 콜드스타트(성수)\n');

  // ══════════════════════════════════════════════════════════
  console.log('1) 계정 확인/프로비저닝');
  const OWNER = await findUser(OWNER_EMAIL);
  const JIWON = await findUser(JIWON_EMAIL);
  const SUMIN = await findUser(SUMIN_EMAIL);
  if (!OWNER || !JIWON || !SUMIN) {
    throw new Error('파일럿 기본 계정이 없습니다. 먼저 node scripts/seed-demo.mjs 를 실행하세요.');
  }
  console.log(`  · 김영자 ${OWNER.slice(0, 8)} / 박지원 ${JIWON.slice(0, 8)} / 이수민 ${SUMIN.slice(0, 8)}`);
  const STAFF3 = await ensureUser(STAFF3_EMAIL, {
    name: '최은우', role: 'junior', phone: '01077120031', birth_date: '2001-05-14',
  });
  const HANJH = await ensureUser(STARTER_EMAIL, {
    name: '한지현', role: 'owner', phone: '01077120032', birth_date: '1991-08-02',
  });
  const APPLICANT = await ensureUser(APPLICANT_EMAIL, {
    name: '김하늘', role: 'junior', phone: '01077120033', birth_date: '2004-11-30',
  });
  // 0088 전화인증 게이트(라이브): 신규 계정은 phone_otps 에 인증 완료 행이 있어야
  // 매장 생성(units INSERT)·합류 신청(pending_unit_id)이 통과한다. QA 시드 방식(qa-otp-seed)과 동일.
  {
    const now = new Date().toISOString();
    await step('phone_otps 인증 시드(신규 3계정)', db.from('phone_otps').upsert(
      ['01077120031', '01077120032', '01077120033'].map((phone) => ({
        phone, code_hash: 'qa-seed', expires_at: now, verified_at: now,
      })),
    ));
  }

  // ══════════════════════════════════════════════════════════
  console.log('2) 홍대점(store_002_demo) 신설 — 김영자 2호점');
  const code2 = await upsertStore(STORE2, '스퀘어 카페 홍대점', OWNER);
  console.log(`  · 초대코드: ${code2}`);
  await step('unit_members(사장)', db.from('unit_members')
    .upsert({ user_id: OWNER, unit_id: STORE2, role: 'owner' }, { onConflict: 'user_id,unit_id' }));
  await step('unit_members(박지원 겸직)', db.from('unit_members')
    .upsert({ user_id: JIWON, unit_id: STORE2, role: 'junior' }, { onConflict: 'user_id,unit_id' }));
  await step('unit_members(최은우)', db.from('unit_members')
    .upsert({ user_id: STAFF3, unit_id: STORE2, role: 'junior' }, { onConflict: 'user_id,unit_id' }));
  await step('profiles(최은우 홍대 전담)', db.from('profiles').update({
    name: '최은우', role: 'junior', unit_id: STORE2, active_unit_id: STORE2, pending_unit_id: null,
    deleted_at: null, avatar: 'junior_female', phone_last4: '0031', birth_date: '2001-05-14',
    bio: '홍대점 오픈 담당. 바리스타 자격증 준비 중.', meta: { career_days: 148, shift: '오전 (7:30~14시)' },
  }).eq('id', STAFF3));
  await step('work_rooms(홍대 기본방)', db.from('work_rooms').upsert({
    id: ROOM2, unit_id: STORE2, name: '전체', is_default: true, created_by: OWNER,
  }));
  await step('schedule_config(홍대)', db.from('schedule_config').upsert({
    unit_id: STORE2, open: '08:00', close: '23:00', closed_days: [],
    note: '홍대는 저녁 피크. 금·토 21시 이후 마감 인원 2명 필수.', updated_at: new Date().toISOString(),
  }));

  // ══════════════════════════════════════════════════════════
  console.log('3) 구독 — 신촌·홍대 multi 승격(다점포 실플랜 경로), 성수는 free 유지');
  for (const u of [STORE1, STORE2]) {
    const { data: sub } = await db.from('unit_subscriptions')
      .select('plan,status,paid_until').eq('unit_id', u).maybeSingle();
    const ok = sub?.plan === 'multi' && sub?.status === 'active'
      && sub?.paid_until && new Date(sub.paid_until) > addDays(180);
    if (ok) { console.log(`  · ${u} 이미 multi/active → 건너뜀`); continue; }
    const { error } = await db.rpc('admin_activate_store', { p_unit_id: u, p_days: 365, p_plan: 'multi' });
    if (error) throw new Error(`admin_activate_store(${u}): ${error.message}`);
    console.log(`  ✓ ${u} → multi/active (365일)`);
  }

  // ══════════════════════════════════════════════════════════
  console.log('4) 신촌 기준 데이터 보강(시급·근무표 — seed-demo 미실행이어도 동작하게 동일 id 업서트)');
  await step('wages', db.from('wages').upsert([
    { unit_id: STORE1, staff_id: JIWON, hourly_wage: 10500 },
    { unit_id: STORE1, staff_id: SUMIN, hourly_wage: 11500 },
    { unit_id: STORE2, staff_id: JIWON, hourly_wage: 11000 },
    { unit_id: STORE2, staff_id: STAFF3, hourly_wage: 10800 },
  ]));
  const shifts = [];
  for (const wd of [1, 2, 3, 4, 5]) shifts.push({ id: `shift_sumin_${wd}`, unit_id: STORE1, staff_id: SUMIN, weekday: wd, start_time: '07:30', end_time: '14:00' });
  for (const wd of [3, 4, 5, 6, 0]) shifts.push({ id: `shift_jiwon_${wd}`, unit_id: STORE1, staff_id: JIWON, weekday: wd, start_time: '13:00', end_time: '19:00' });
  for (const wd of [1, 2, 3, 4, 5]) shifts.push({ id: `hub2_shift_s3_${wd}`, unit_id: STORE2, staff_id: STAFF3, weekday: wd, start_time: '07:30', end_time: '14:00' });
  for (const wd of [6, 0]) shifts.push({ id: `hub2_shift_jw_${wd}`, unit_id: STORE2, staff_id: JIWON, weekday: wd, start_time: '13:00', end_time: '19:00' });
  await step('shift_templates(신촌+홍대)', db.from('shift_templates').upsert(shifts));

  // ══════════════════════════════════════════════════════════
  console.log('5) 출퇴근 — 오늘 "근무중"(사장 현황 스냅샷) + 이번달 이력(인건비·예상급여)');
  const att = [];
  const mkAtt = (idPrefix, unit, staff, dStr, sh, sm, eh, em) => {
    const ci = ts(dStr, sh, sm);
    const co = eh == null ? null : ts(dStr, eh, em);
    att.push({ id: `${idPrefix}_${staff}_${dStr}_seed`, unit_id: unit, staff_id: staff, date: dStr,
      check_in: ci, check_out: co, work_minutes: co ? mins(ci, co) : 0, edited_by: null });
  };
  for (let n = -14; n < 0; n++) {
    const dStr = dateStr(n); const wd = addDays(n).getDay();
    // 신촌 — seed-demo 와 같은 id 규칙(att_<uid>_<date>_seed)이라 중복 없이 수렴한다
    if ([1, 2, 3, 4, 5].includes(wd)) mkAtt('att', STORE1, SUMIN, dStr, 7, 31, 14, 3);
    if ([3, 4, 5, 6, 0].includes(wd)) mkAtt('att', STORE1, JIWON, dStr, 13, 2, 19, 5);
    // 홍대 — 최은우 평일 오픈, 박지원 주말 오후
    if ([1, 2, 3, 4, 5].includes(wd)) mkAtt('hub2_att', STORE2, STAFF3, dStr, 7, 33, 14, 6);
    if ([6, 0].includes(wd)) mkAtt('hub2_att', STORE2, JIWON, dStr, 13, 4, 19, 2);
  }
  // 오늘: 이수민(신촌)·최은우(홍대) = 출근만(근무중). 박지원 = 미출근(예정) — 라이브 출근 QA용.
  //   미래 check_in 이 되지 않게 "지금-2h vs 시프트 시작" 중 이른 쪽.
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const ciFor = (d, hh, mm) => (twoHoursAgo > ts(d, hh, mm) ? ts(d, hh, mm) : twoHoursAgo);
  if ([1, 2, 3, 4, 5].includes(DOW)) {
    att.push({ id: `att_${SUMIN}_${TODAY}_seed`, unit_id: STORE1, staff_id: SUMIN, date: TODAY,
      check_in: ciFor(TODAY, 7, 31), check_out: null, work_minutes: 0, edited_by: null });
    att.push({ id: `hub2_att_${STAFF3}_${TODAY}_seed`, unit_id: STORE2, staff_id: STAFF3, date: TODAY,
      check_in: ciFor(TODAY, 7, 33), check_out: null, work_minutes: 0, edited_by: null });
  }
  await step(`attendance ${att.length}건`, db.from('attendance').upsert(att));

  // ══════════════════════════════════════════════════════════
  console.log('6) 노하우 — 승격 결과물(성장 탭)·검증 필요·방치(stale 90일+)');
  const entries1 = [
    entryRow(STORE1, OWNER, '김영자', {
      id: 'hub_pb_staff_jiwon', category: 'Context', subcategory: '레시피', section: '음료 제조', order_index: 41,
      title: '자몽에이드 표준 레시피', hits: 7,
      tags: ['#레시피', '#여름한정'], keywords: ['자몽에이드', '에이드', '탄산', '시럽', '비율'],
      square: SQ('여름 한정 에이드 제조 순서가 사람마다 달라 맛이 들쭉날쭉하다.', [
        '1) 자몽청 60g → 얼음 가득 → 탄산수 180ml 순서로 붓는다.',
        '2) 탄산수는 젓지 말고 바 스푼으로 두 번만 살짝 들어올린다.',
        '3) 마지막에 자몽 슬라이스 1장. 빨대는 종이 말고 굵은 것.',
      ], '탄산수를 먼저 붓지 않는다 — 청이 바닥에 뭉쳐 첫 모금이 밍밍해진다.'),
      updated_at: daysAgoTs(2),
    }),
    entryRow(STORE1, OWNER, '김영자', {
      id: 'hub_pb_staff_sumin', category: 'Event', subcategory: '주문', section: '손님 응대', order_index: 42,
      title: '단체 주문 20잔 이상 들어왔을 때 처리 순서', hits: 4,
      tags: ['#단체주문'], keywords: ['단체', '단체주문', '20잔', '순서', '대기'],
      square: SQ('단체 주문이 들어오면 일반 손님 대기가 밀려 컴플레인이 생긴다.', [
        '1) 단체 주문은 접수 즉시 예상 시간을 먼저 안내한다("20잔이라 15분 정도 걸려요").',
        '2) 아이스 음료부터 만들고, HOT 은 마지막 5잔으로 몰아서 만든다.',
        '3) 일반 손님 주문이 들어오면 3잔 단위로 끼워서 처리한다.',
      ], '단체 주문을 다 끝내고 일반 손님을 받지 않는다 — 사이사이 끼워 처리한다.'),
      updated_at: daysAgoTs(4),
    }),
    entryRow(STORE1, OWNER, '김영자', {
      id: 'hub_pb_stale_1', category: 'Context', subcategory: '멤버십', section: '매장 원칙', order_index: 43,
      title: '포인트 적립 안내 기준',
      tags: ['#포인트'], keywords: ['포인트', '적립', '멤버십', '쿠폰'],
      square: SQ('포인트 적립을 물어보는 손님에게 안내가 제각각이다.', [
        '1) 전화번호 뒤 4자리로 적립. 1,000원당 1점.',
        '2) 10점 = 아메리카노 1잔 무료.',
      ], '타 브랜드 쿠폰과 중복 적용하지 않는다.'),
      created_at: daysAgoTs(180), updated_at: daysAgoTs(120),
      verification: { state: 'owner_verified', verified_by: OWNER, verified_at: daysAgoTs(120) },
    }),
    entryRow(STORE1, OWNER, '김영자', {
      id: 'hub_pb_stale_2', category: 'Routine', subcategory: '재고', section: '위생·재고', order_index: 44,
      title: '시럽 재고 정리 기준',
      tags: ['#재고'], keywords: ['시럽', '재고', '유통기한', '정리'],
      square: SQ('시럽 종류가 늘면서 유통기한 관리가 안 된다.', [
        '1) 매주 월요일 오픈조가 시럽 유통기한을 확인한다.',
        '2) 2주 이내 임박분은 펌프에 초록 테이프를 붙인다.',
      ], '개봉일 미표기 시럽은 사용하지 않는다.'),
      created_at: daysAgoTs(150), updated_at: daysAgoTs(95),
      verification: { state: 'owner_verified', verified_by: OWNER, verified_at: daysAgoTs(95) },
    }),
    entryRow(STORE1, OWNER, '김영자', {
      id: 'hub_pb_review_1', category: 'Context', subcategory: '레시피', section: '음료 제조', order_index: 45,
      title: '신메뉴 흑임자 라떼 레시피 (확인 필요)', needs_review: true,
      tags: ['#신메뉴'], keywords: ['흑임자', '라떼', '신메뉴', '레시피'],
      square: SQ('신메뉴 흑임자 라떼 배합이 아직 확정 전이다.', [
        '1) 흑임자 페이스트 30g + 스팀우유 250ml (임시 배합).',
        '2) 토핑은 흑임자 가루 한 꼬집.',
      ], '확정 전이므로 손님 문의 시 "출시 준비 중" 으로 안내한다.'),
      updated_at: daysAgoTs(1),
      verification: { state: 'unverified' },
    }),
  ];
  const entries2 = [
    entryRow(STORE2, OWNER, '김영자', {
      id: 'hub2_pb_open', category: 'Routine', subcategory: '오픈', section: '오픈·마감', order_index: 1,
      title: '홍대점 오픈 절차 (08:00)', hits: 3,
      tags: ['#오픈'], keywords: ['오픈', '홍대', '머신', '예열', '시재'],
      square: SQ('홍대점은 오픈 준비 순서가 정해져 있지 않아 첫 손님 응대가 늦어진다.', [
        '1) 머신 전원 ON → 15분 예열, 예열 중 테라스 의자 정리.',
        '2) POS 시재 5만원 확인 → 오픈 사인 ON.',
        '3) 첫 샷은 버리고 시음 후 오픈.',
      ], '예열 전에 첫 주문을 받지 않는다.'),
      updated_at: daysAgoTs(6),
    }),
    entryRow(STORE2, OWNER, '김영자', {
      id: 'hub2_pb_terrace', category: 'Event', subcategory: '좌석', section: '손님 응대', order_index: 2,
      title: '테라스 흡연 손님 응대',
      tags: ['#테라스'], keywords: ['테라스', '흡연', '금연', '안내'],
      square: SQ('테라스에서 흡연하는 손님 때문에 옆 테이블 컴플레인이 잦다.', [
        '1) "테라스 포함 전 좌석 금연이에요. 골목 끝 흡연 부스를 안내드릴게요" 로 정중히 안내.',
        '2) 두 번째 안내에도 계속이면 사장에게 알린다. 직접 언성 높이지 않는다.',
      ], '다른 손님 앞에서 지적하듯 말하지 않는다.'),
      updated_at: daysAgoTs(9),
    }),
    entryRow(STORE2, OWNER, '김영자', {
      id: 'hub2_pb_stale', category: 'Context', subcategory: '메뉴', section: '매장 원칙', order_index: 3,
      title: '홍대점 시즌 메뉴 구성',
      tags: ['#메뉴'], keywords: ['시즌', '메뉴', '한정'],
      square: SQ('시즌 메뉴 구성이 문서로 없어서 새 알바가 묻는다.', [
        '1) 봄=벚꽃라떼, 여름=자몽에이드, 가을=밤라떼, 겨울=진저브레드.',
      ], '시즌 지난 메뉴를 임의로 만들어주지 않는다.'),
      created_at: daysAgoTs(200), updated_at: daysAgoTs(100),
      verification: { state: 'owner_verified', verified_by: OWNER, verified_at: daysAgoTs(100) },
    }),
    entryRow(STORE2, OWNER, '김영자', {
      id: 'hub2_pb_review', category: 'Event', subcategory: '배달', section: '주문·결제', order_index: 4,
      title: '배달앱 주문 누락 대응 (확인 필요)', needs_review: true,
      tags: ['#배달'], keywords: ['배달', '누락', '배민', '주문'],
      square: SQ('배달앱 주문이 프린터에 안 뜨는 일이 가끔 있다.', [
        '1) 라이더 도착 시 주문 내역이 없으면 앱 주문 접수함부터 확인.',
        '2) 접수함에도 없으면 고객센터 대신 사장에게 먼저 전화.',
      ], '라이더를 그냥 돌려보내지 않는다.'),
      updated_at: daysAgoTs(2),
      verification: { state: 'unverified' },
    }),
  ];
  await step(`playbook_entries 신촌 ${entries1.length}건`, db.from('playbook_entries').upsert(entries1));
  await step(`playbook_entries 홍대 ${entries2.length}건`, db.from('playbook_entries').upsert(entries2));

  // ══════════════════════════════════════════════════════════
  console.log('7) 제안 — 승격 이력(성장 탭 "가르침 실적") + 대기(확인 필요 작업함)');
  await step('제안 승격(박지원→자몽에이드)', db.from('playbook_suggestions').upsert({
    id: 'hub_sug_ap_jiwon', unit_id: STORE1, kind: 'new', target_entry_id: null, target_title: null,
    proposer_id: JIWON, proposer_name: '박지원',
    text: '여름 에이드 만드는 순서가 사람마다 달라요. 자몽청 → 얼음 → 탄산수 순서로 표준을 정하면 좋겠어요.',
    status: 'approved', resulting_entry_id: 'hub_pb_staff_jiwon',
    owner_note: '좋은 제안이라 그대로 노하우로 등록했어요.', reviewed_by: OWNER, reviewed_at: daysAgoTs(2),
    created_at: daysAgoTs(3),
  }));
  await step('제안 승격(이수민→단체주문)', db.from('playbook_suggestions').upsert({
    id: 'hub_sug_ap_sumin', unit_id: STORE1, kind: 'new', target_entry_id: null, target_title: null,
    proposer_id: SUMIN, proposer_name: '이수민',
    text: '단체 주문 들어오면 다들 우왕좌왕해요. 아이스 먼저·HOT 마지막·일반 손님 끼워받기로 정하면 어떨까요.',
    status: 'approved', resulting_entry_id: 'hub_pb_staff_sumin',
    owner_note: '반영했습니다!', reviewed_by: OWNER, reviewed_at: daysAgoTs(4),
    created_at: daysAgoTs(5),
  }));
  await step('제안 대기(신촌 박지원)', db.from('playbook_suggestions').upsert({
    id: 'hub_sug_pend_1', unit_id: STORE1, kind: 'improve',
    target_entry_id: 'hub_pb_staff_jiwon', target_title: '자몽에이드 표준 레시피',
    proposer_id: JIWON, proposer_name: '박지원',
    text: '자몽 슬라이스가 떨어졌을 때 레몬으로 대체 가능한지도 적어두면 좋겠어요.',
    status: 'pending', created_at: ts(TODAY, 9, 40),
  }));
  await step('제안 대기(홍대 최은우)', db.from('playbook_suggestions').upsert({
    id: 'hub2_sug_pend_1', unit_id: STORE2, kind: 'new', target_entry_id: null, target_title: null,
    proposer_id: STAFF3, proposer_name: '최은우',
    text: '금·토 밤 마감 때 취객 응대 기준이 없어요. 매뉴얼로 만들어주세요.',
    status: 'pending', created_at: ts(TODAY, 10, 15),
  }));

  // ══════════════════════════════════════════════════════════
  console.log('8) 받은질문 대기(pending_owner_answer) — 노하우 탭 "노하우로 만들 것"');
  const uqPend = (id, unit, jid, jname, dayN, hh, mm, text, cat, sub) => ({
    id, unit_id: unit, junior_id: jid, junior_name: jname,
    query_text: text, asked_at: ts(dateStr(dayN), hh, mm),
    presumed_category: cat, presumed_subcategory: sub,
    match_attempted: true, best_match_confidence: 0.2, best_match_entry_id: null,
    status: 'pending_owner_answer', fallback_action: '사장님께 알림 전송됨.',
    owner_notified_at: ts(dateStr(dayN), hh, mm + 1), owner_will_answer: true,
    similar_queries_count: 1, anonymous: false, ai_general_answer: '',
  });
  await step('신촌 대기 1건', db.from('unknown_queries').upsert([
    uqPend('hub_uq_p1', STORE1, JIWON, '박지원', 0, 11, 20, '기프티콘 유효기간 지난 거 가져오시면 어떻게 해요?', 'Event', '결제'),
  ]));
  await step('홍대 대기 3건', db.from('unknown_queries').upsert([
    uqPend('hub2_uq_p1', STORE2, STAFF3, '최은우', 0, 9, 5, '옆 가게 소음 항의하러 오신 분한테 뭐라고 해야 해요?', 'Event', '민원'),
    uqPend('hub2_uq_p2', STORE2, STAFF3, '최은우', 0, 10, 42, '테라스 파라솔 바람 불면 접어야 하나요?', 'Routine', '안전'),
    uqPend('hub2_uq_p3', STORE2, JIWON, '박지원', -1, 18, 30, '주말에 유모차 손님 오시면 어디로 안내해요?', 'Event', '좌석'),
  ]));

  // ══════════════════════════════════════════════════════════
  console.log('9) AI 질문 이력(chat_queries) — asked_ever·query_hits 근거');
  const cq = (id, unit, jid, jname, dayN, hh, mm, text, entryId, summary) => ({
    id, unit_id: unit, junior_id: jid, junior_name: jname,
    query_text: text, asked_at: ts(dateStr(dayN), hh, mm),
    matched_entry_ids: [entryId], match_confidence: 0.91, was_deflected: true,
    response_block: { summary, actions: [], donts: [], mode: 'served',
      source: { entry_id: entryId, creator_name: '김영자', title: '', version: 1, updated_at: daysAgoTs(3) } },
    satisfaction: 'up', resolved_at: ts(dateStr(dayN), hh, mm + 2),
  });
  await step('chat_queries 3건', db.from('chat_queries').upsert([
    cq('hub_cq_1', STORE1, SUMIN, '이수민', -1, 15, 10, '자몽에이드 탄산수 얼마나 넣어요?', 'hub_pb_staff_jiwon',
      '자몽청 60g → 얼음 → 탄산수 180ml 순서예요. 탄산수를 먼저 붓지 않아요.'),
    cq('hub_cq_2', STORE1, JIWON, '박지원', 0, 8, 50, '단체 주문 들어오면 뭐부터 만들어요?', 'hub_pb_staff_sumin',
      '아이스부터 만들고 HOT 은 마지막 5잔으로 몰아요. 일반 손님은 3잔 단위로 끼워 받아요.'),
    cq('hub2_cq_1', STORE2, STAFF3, '최은우', 0, 8, 20, '오픈할 때 머신 예열 몇 분이에요?', 'hub2_pb_open',
      '15분 예열 후 첫 샷은 버려요. 예열 중에 테라스 정리를 해두면 좋아요.'),
  ]));

  // ══════════════════════════════════════════════════════════
  console.log('10) 업무 — 홍대 할일(박지원 배정 포함)·노하우 첨부(커버 판정)·오늘 완료');
  const tmpl = (id, unit, room, section, text, extra = {}) => ({
    id, unit_id: unit, room_id: room, section, text, scope: 'shared', created_by: OWNER, ...extra,
  });
  await step('work_templates', db.from('work_templates').upsert([
    // 신촌: 노하우 첨부된 업무 1건(커버) — 나머지 기존 업무는 미첨부(uncovered)로 남는다
    tmpl('hub_t_covered', STORE1, ROOM1, 'mid', '원두 호퍼 리필 · 분쇄도 점검'),
    // 홍대: 오픈/마감 + 배정 2건
    tmpl('hub2_t_open1', STORE2, ROOM2, 'open', '머신 예열 15분 · 첫 샷 버리기'),
    tmpl('hub2_t_open2', STORE2, ROOM2, 'open', '테라스 의자·파라솔 정리'),
    tmpl('hub2_t_close1', STORE2, ROOM2, 'close', '마감 정산 · 시재 5만원 남기고 금고 보관'),
    tmpl('hub2_t_assign_jw', STORE2, ROOM2, 'etc', '주말 원두 재고 실사 후 채팅으로 공유', { owner_id: JIWON }),
    tmpl('hub2_t_assign_s3', STORE2, ROOM2, 'mid', '디저트 쇼케이스 유통기한 체크', { owner_id: STAFF3 }),
  ]));
  await step('work_template_knowhow(첨부 2건)', db.from('work_template_knowhow').upsert([
    { unit_id: STORE1, template_id: 'hub_t_covered', entry_id: 'hub_pb_staff_jiwon', added_by: OWNER },
    { unit_id: STORE2, template_id: 'hub2_t_open1', entry_id: 'hub2_pb_open', added_by: OWNER },
  ]));
  await step('work_done(홍대 오늘 1건)', db.from('work_done').upsert([
    { unit_id: STORE2, work_date: TODAY, room_id: ROOM2, template_id: 'hub2_t_open1',
      data: { by: STAFF3, byName: '최은우', at: ts(TODAY, 8, 10) } },
  ]));

  // ══════════════════════════════════════════════════════════
  console.log('11) 피드 — 홍대 공지·@멘션(크로스 알림) + task_done(done_ever·성장 탭 "해본 업무")');
  const feed = (id, unit, room, date, data) => ({
    id, unit_id: unit, feed_date: date, room_id: room, data: { id, date, ...data },
  });
  const O = { authorId: OWNER, authorName: '김영자', authorRole: 'owner' };
  const JW = { authorId: JIWON, authorName: '박지원', authorRole: 'junior' };
  const S3 = { authorId: STAFF3, authorName: '최은우', authorRole: 'junior' };
  await step('work_feed', db.from('work_feed').upsert([
    // 홍대 공지(안읽음) + 박지원 멘션 → 허브 매장 카드 "알림 N"·통합 알림 QA
    feed('hub2_f_notice1', STORE2, ROOM2, TODAY, {
      kind: 'notice', ...O, createdAt: ts(TODAY, 9, 0), pinned: true, important: true, read_by: [], reactions: {},
      text: '이번 주 금·토 밤 홍대 거리공연 행사로 손님 몰릴 예정. 마감조 2명 유지해주세요.',
    }),
    feed('hub2_f_m1', STORE2, ROOM2, TODAY, {
      kind: 'message', ...O, createdAt: ts(TODAY, 9, 5), mentions: [JIWON],
      text: '박지원님 이번 주말 원두 재고 실사 부탁해요. 실사표는 노하우에 있어요.',
    }),
    feed('hub2_f_done1', STORE2, ROOM2, TODAY, {
      kind: 'task_done', ...S3, createdAt: ts(TODAY, 8, 10),
      text: '최은우 · 머신 예열 15분 · 첫 샷 버리기 완료', refId: 'hub2_t_open1',
    }),
    // 신촌 — 박지원 task_done 3종(성장 탭 "해본 업무" 3)
    feed('hub_f_done_jw1', STORE1, ROOM1, dateStr(-1), {
      kind: 'task_done', ...JW, createdAt: ts(dateStr(-1), 18, 40),
      text: '박지원 · 매트 4장 뒷면 청소(락스) 완료', refId: 'demo_t_close_1',
    }),
    feed('hub_f_done_jw2', STORE1, ROOM1, dateStr(-2), {
      kind: 'task_done', ...JW, createdAt: ts(dateStr(-2), 18, 55),
      text: '박지원 · 제빙기 안쪽·싱크대 배수구 거름망 청소 완료', refId: 'demo_t_close_2',
    }),
    feed('hub_f_done_jw3', STORE1, ROOM1, dateStr(-3), {
      kind: 'task_done', ...JW, createdAt: ts(dateStr(-3), 14, 30),
      text: '박지원 · 원두 호퍼 리필 · 분쇄도 점검 완료', refId: 'hub_t_covered',
    }),
  ]));

  // ══════════════════════════════════════════════════════════
  console.log('12) AI 사용량(ai_usage_monthly) — 현황 탭 게이지');
  await step('ai_usage', db.from('ai_usage_monthly').upsert([
    { unit_id: STORE1, month: MONTH, used: 412, updated_at: new Date().toISOString() },
    { unit_id: STORE2, month: MONTH, used: 37, updated_at: new Date().toISOString() },
  ]));

  // ══════════════════════════════════════════════════════════
  console.log('13) 콜드스타트 사장(한지현·성수점) — 시작 체크리스트 1/4 상태');
  await upsertStore(STARTER, '스퀘어 카페 성수점', HANJH);
  await step('unit_members(한지현)', db.from('unit_members')
    .upsert({ user_id: HANJH, unit_id: STARTER, role: 'owner' }, { onConflict: 'user_id,unit_id' }));
  await step('profiles(한지현)', db.from('profiles').update({
    name: '한지현', role: 'owner', unit_id: STARTER, active_unit_id: STARTER, pending_unit_id: null,
    deleted_at: null, avatar: 'owner', phone_last4: '0032', birth_date: '1991-08-02',
    bio: '성수동에 첫 카페를 연 초보 사장.', meta: { career_years: 1 },
  }).eq('id', HANJH));
  await step('work_rooms(성수 기본방)', db.from('work_rooms').upsert({
    id: `room_main_${STARTER}`, unit_id: STARTER, name: '전체', is_default: true, created_by: HANJH,
  }));
  {
    // 구독 행이 없으면 free/trialing 생성(create_store 경로 모사). 있으면 손대지 않는다.
    const { data: sub } = await db.from('unit_subscriptions').select('unit_id').eq('unit_id', STARTER).maybeSingle();
    if (!sub) {
      await step('unit_subscriptions(free/trialing)', db.from('unit_subscriptions').insert({
        unit_id: STARTER, plan: 'free', status: 'trialing', trial_ends_at: addDays(30).toISOString(),
      }));
    } else console.log('  · 구독 행 이미 있음 → 유지');
  }
  // 체크리스트 4단계 중 "노하우 담기"만 완료(1/4): 질문·직원·첫할일완료는 비워둔다.
  await step('노하우 1건(체크리스트 1단계)', db.from('playbook_entries').upsert([
    entryRow(STARTER, HANJH, '한지현', {
      id: 'hubs_pb_1', category: 'Routine', subcategory: '마감', section: '오픈·마감', order_index: 1,
      title: '마감 때 테이블 닦는 순서',
      tags: ['#마감'], keywords: ['마감', '테이블', '청소'],
      square: SQ('마감 청소 순서가 정해져 있지 않다.', [
        '1) 창가 → 중앙 → 카운터 순서로 닦는다.',
        '2) 행주는 테이블용/바닥용을 색으로 구분한다.',
      ], '바닥용 행주로 테이블을 닦지 않는다.'),
      updated_at: daysAgoTs(1),
    }),
  ]));
  // 멱등 보정: 체크리스트 미완료 단계가 이전 실행/QA 로 채워졌으면 비운다(asked_ever·done_ever 는 단조라 행 삭제로만 되돌릴 수 있다)
  await db.from('chat_queries').delete().eq('unit_id', STARTER);
  await db.from('work_feed').delete().eq('unit_id', STARTER);
  console.log('  ✓ 체크리스트 잔여 단계 초기화(질문·완료 이력 제거)');

  // ══════════════════════════════════════════════════════════
  console.log('14) 합류 신청 pending(김하늘 → 홍대점) — 사장 확인 필요 작업함');
  {
    const { data: mem } = await db.from('unit_members')
      .select('user_id').eq('unit_id', STORE2).eq('user_id', APPLICANT).maybeSingle();
    const { data: prof } = await db.from('profiles')
      .select('pending_unit_id').eq('id', APPLICANT).maybeSingle();
    if (mem) console.log('  · 이미 멤버(이전 QA 에서 승인됨) → 건너뜀. 다시 pending 으로 만들려면 앱에서 내보내기 후 재실행.');
    else if (prof?.pending_unit_id === STORE2) console.log('  · 이미 홍대점 합류 신청 대기 중 → 건너뜀');
    else if (!ANON) console.log('  ! EXPO_PUBLIC_SUPABASE_ANON_KEY 없음(.env) → 합류 신청 생략');
    else {
      await db.from('profiles').update({ pending_unit_id: null }).eq('id', APPLICANT);
      const c = anon();
      const { error: sErr } = await c.auth.signInWithPassword({ email: APPLICANT_EMAIL, password: PASSWORD });
      if (sErr) throw new Error(`김하늘 로그인 실패: ${sErr.message}`);
      const { error: jErr } = await c.rpc('join_by_invite', { p_code: code2, p_birth_date: '2004-11-30' });
      if (jErr) throw new Error(`join_by_invite 실패: ${jErr.message}`);
      console.log('  ✓ join_by_invite → 승인 대기 상태(사장이 허브에서 확인)');
    }
  }

  // ══════════════════════════════════════════════════════════
  console.log('\n15) 검증 — 실계정 로그인으로 신규 RPC 4종 판정');
  if (!ANON) console.log('  ! ANON 키 없음 → 검증 생략');
  else {
    let pass = 0, fail = 0;
    const check = (label, ok, detail = '') => {
      console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
      ok ? pass++ : fail++;
    };
    const login = async (email) => {
      const c = anon();
      const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
      return c;
    };
    // 사장 김영자
    {
      const c = await login(OWNER_EMAIL);
      const { data: ov, error } = await c.rpc('owner_overview');
      check('owner_overview 매장 2곳', !error && (ov?.length ?? 0) === 2, error?.message ?? `n=${ov?.length}`);
      const s2 = (ov ?? []).find((r) => r.unit_id === STORE2);
      check('홍대 pending_q ≥ 3', (s2?.pending_q ?? 0) >= 3, `pending_q=${s2?.pending_q}`);
      check('홍대 sugg_pending ≥ 1', (s2?.sugg_pending ?? 0) >= 1);
      check('홍대 needs_review ≥ 1', (s2?.needs_review ?? 0) >= 1);
      check('홍대 stale ≥ 1', (s2?.stale ?? 0) >= 1, `stale=${s2?.stale}`);
      check('홍대 staff ≥ 1', (s2?.staff ?? 0) >= 1);
      const s1 = (ov ?? []).find((r) => r.unit_id === STORE1);
      check('신촌 ai_used > 0', (s1?.ai_used ?? 0) > 0, `ai_used=${s1?.ai_used}`);
      check('신촌 stale ≥ 2', (s1?.stale ?? 0) >= 2, `stale=${s1?.stale}`);
      check('신촌 asked_ever·done_ever', !!s1?.asked_ever && !!s1?.done_ever);
      const { data: td } = await c.rpc('owner_today');
      const t2 = (td ?? []).find((r) => r.unit_id === STORE2);
      const weekday = [1, 2, 3, 4, 5].includes(DOW);
      if (weekday) check('홍대 오늘 근무중 ≥ 1', (t2?.working_now ?? 0) >= 1, `working_now=${t2?.working_now}`);
      else console.log('  · 주말이라 근무중 판정 생략(오픈조 시드는 평일 전용)');
      await c.auth.signOut();
    }
    // 직원 박지원(다매장)
    {
      const c = await login(JIWON_EMAIL);
      const { data: cs, error } = await c.rpc('my_cross_summary');
      check('my_cross_summary 매장 2곳', !error && (cs?.length ?? 0) === 2, error?.message ?? `n=${cs?.length}`);
      const g = await c.rpc('my_growth');
      const gr = Array.isArray(g.data) ? g.data : (g.data ? [g.data] : []);
      const taught = gr.reduce((a, r) => a + (r.taught ?? 0), 0);
      const myKh = gr.reduce((a, r) => a + (r.my_knowhow ?? 0), 0);
      const kinds = gr.reduce((a, r) => a + (r.done_kinds ?? 0), 0);
      check('my_growth 가르침(taught) ≥ 1', !g.error && taught >= 1, g.error?.message ?? `taught=${taught}`);
      check('my_growth 내 노하우 ≥ 1', myKh >= 1, `my_knowhow=${myKh}`);
      check('my_growth 해본 업무 ≥ 3', kinds >= 3, `done_kinds=${kinds}`);
      await c.auth.signOut();
    }
    // 콜드스타트 사장 한지현
    {
      const c = await login(STARTER_EMAIL);
      const { data: ov, error } = await c.rpc('owner_overview');
      const s = ov?.[0];
      check('성수 owner_overview 매장 1곳', !error && (ov?.length ?? 0) === 1, error?.message ?? `n=${ov?.length}`);
      check('성수 체크리스트 1/4 상태', (s?.knowhow ?? 0) >= 1 && !s?.asked_ever && !s?.done_ever && (s?.staff ?? 0) === 0,
        `knowhow=${s?.knowhow} asked=${s?.asked_ever} done=${s?.done_ever} staff=${s?.staff}`);
      await c.auth.signOut();
    }
    console.log(`\n  결과: ${pass} PASS / ${fail} FAIL`);
    if (fail > 0) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('✅ 허브 QA 데모 시드 완료 (비번 공통: pilot1234)');
  console.log('═'.repeat(70));
  console.log(`
  ① 김영자(다매장 사장)  ${OWNER_EMAIL}
     현황 탭: 매장 비교(신촌 vs 홍대) · 오늘 근무중/예정 · 확인 필요(합류1·질문4·제안2·검증2) · AI 게이지(412/37)
     노하우 탭: 노하우로 만들 것(홍대3+신촌1) · 검증 필요 2 · 방치(stale) 3
  ② 박지원(다매장 직원)  ${JIWON_EMAIL}
     오늘 탭: 신촌+홍대 근무·할일(@홍대 재고 실사 배정) · 이번달 예상 급여(두 매장 합산)
     성장 탭: 가르침 실적 1(자몽에이드 승격) · 내가 남긴 것(참조 7회) · 해본 업무 3
  ③ 이수민(단일 직원)    ${SUMIN_EMAIL} — 성장 탭 가르침 1(단체주문) · 오늘 근무중
  ④ 최은우(홍대 전담)    ${STAFF3_EMAIL} — 홍대 오늘 근무중 · 제안 대기 1
  ⑤ 한지현(콜드스타트)   ${STARTER_EMAIL} — 시작 체크리스트 1/4 · 빈 화면 골격 QA
  ⑥ 김하늘(합류 대기)    ${APPLICANT_EMAIL} — 홍대점 승인 대기(사장 작업함에 표시)
`);
}

main().catch((e) => { console.error('\n✗ 시드 실패:', e.message ?? e); process.exit(1); });
