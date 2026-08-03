// 훈련 코스 QA(0099 → 0107·0108) — 사장 코스 구성(코스 행·순서·빼기)과 직원 카드(순서·통과·
// 정기 재확인 verified_at 갱신), 그리고 문항 영속화·서버 채점(0107)을 실 백엔드로 재현하고 RLS 경계를 검증한다.
//
// ★0108 로 판정이 뒤집힌 것: 한 업무를 두 코스에 넣는 것이 **이제는 정상**이다(PK = course_id+template_id).
//   0099 는 PK(template_id 단독)로 이걸 막았고, course 값도 check 로 2종에 묶여 있었다 — 둘 다 사라졌다.
// 실 백엔드 대상·자가정리(@example.com → cleanup-orphan-stores.mjs 수거). 사용: node scripts/qa-training.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const PW = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: PW, options: { data: { birth_date: '1994-03-03', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

async function edgeAi(token, task, payload) {
  const res = await fetch(`${URL_}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, payload }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const qaPhones = [`0106${s.slice(0, 7)}`, `0108${s.slice(0, 7)}`];
const REGULAR_DUE_DAYS = 30; // 클라 상수 미러(useWorkStore.REGULAR_DUE_DAYS)

async function main() {
  // ── 셋업: 격리 매장 + 사장 + 직원1 ────────────────────────────────────────
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_tr_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0], store_name: 'TR', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'TR 훈련매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  const UNIT = c1?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  const CODE = c1?.[0]?.invite_code;
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  check('셋업: 매장 생성', !!UNIT && !!CODE, `unit=${UNIT}`);

  const jA = mk();
  const jAId = await signUpSession(jA, `qa_tr_j_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: qaPhones[1] });
  await jA.rpc('join_by_invite', { p_code: CODE });
  const { error: ape } = await owner.rpc('approve_member', { p_uid: jAId });
  check('셋업: 직원 합류 승인', !ape, ape?.message ?? '');
  await jA.rpc('switch_active_unit', { p_unit_id: UNIT });

  // ── ① 사장 코스 구성: 노하우+업무+링크 → 첫 훈련 3개 + 정기 훈련 1개 ──────
  console.log('\n━━ ① 코스 구성(첫 3 + 정기 1) ━━');
  const now = new Date().toISOString();
  const mkEntry = (id, title, situation) => ({
    id, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장',
    category: 'Know-how', subcategory: '일반', title, tags: [], search_keywords: [title],
    square: { situation, action: { steps: [], scripts: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.6,
    created_at: now, updated_at: now, is_template: false, pack_id: null,
    needs_review: false, correction_points: [], section: null, order_index: 0,
  });
  const E = [1, 2, 3, 4].map((i) => `pb_tr${i}_${s}`);
  const T = [1, 2, 3, 4].map((i) => `t_tr${i}_${s}`);
  const names = ['오픈 청소', '원두 채우기', '포스 마감', '가스 밸브 잠그기'];
  const HOW = [
    '문 열고 포스 켜기, 시재 5만원 확인, 머신 예열 순서로 진행해요. 시재가 안 맞으면 만지지 말고 바로 알려 주세요.',
    '그라인더 호퍼가 3분의 1 밑으로 내려가면 새 원두를 채워요. 봉투에 개봉일을 적고, 오래된 원두부터 써요.',
    '포스 정산 버튼을 누르고 카드·현금 합계를 장부와 맞춰요. 차액이 있으면 사진을 찍어 남겨 주세요.',
    '마감 때 주방 가스 밸브를 잠그고, 잠근 상태를 손으로 한 번 더 확인해요. 냄새가 나면 환기부터 하고 바로 전화 주세요.',
  ];
  { const { error } = await owner.from('playbook_entries').insert(E.map((id, i) => mkEntry(id, names[i], HOW[i])));
    check('①-1 노하우 4건 발행', !error, error?.message ?? ''); }
  { const { error } = await owner.from('work_templates').insert(T.map((id, i) => ({ id, unit_id: UNIT, section: 'etc', text: names[i], scope: 'shared', created_at: now })));
    check('①-2 업무 4건 생성', !error, error?.message ?? ''); }
  { const { error } = await owner.from('work_template_knowhow').upsert(
      T.map((tid, i) => ({ unit_id: UNIT, template_id: tid, entry_id: E[i] })), { onConflict: 'template_id,entry_id', ignoreDuplicates: true });
    check('①-3 업무↔노하우 링크', !error, error?.message ?? ''); }
  // 코스 행이 선행되어야 한다(0108: training_items.course_id not null + FK).
  const CF = `tc_fd_${s}`, CR = `tc_rg_${s}`, CS = `tc_st_${s}`;
  { const { error } = await owner.from('training_courses').insert([
      { id: CF, unit_id: UNIT, key: 'first_day', name: '첫 출근', description: '처음 온 날 이것만은', preset: 'first_day', min_items: 3, max_items: 5, due_days: null, position: 0 },
      { id: CR, unit_id: UNIT, key: 'regular', name: '정기 점검', description: '정해둔 주기마다 다시 확인', preset: 'regular', min_items: 3, max_items: 10, due_days: 30, position: 1 },
    ]);
    check('①-4 코스 2종 생성(0108)', !error, error?.message ?? ''); }
  // 0099 의 check(course in first_day/regular)가 0108 에서 제거됐다는 실증 — 신규 프리셋이 들어가야 한다.
  { const { error } = await owner.from('training_courses').insert(
      { id: CS, unit_id: UNIT, key: 'short_term', name: '단기·주말', preset: 'short_term', min_items: 2, max_items: 4, position: 2 });
    check('①-5 신규 프리셋 코스 생성(short_term)', !error, error?.message ?? ''); }
  { const { error } = await owner.from('training_items').upsert([
      { unit_id: UNIT, template_id: T[0], course_id: CF, course: 'first_day', position: 0 },
      { unit_id: UNIT, template_id: T[1], course_id: CF, course: 'first_day', position: 1 },
      { unit_id: UNIT, template_id: T[2], course_id: CF, course: 'first_day', position: 2 },
      { unit_id: UNIT, template_id: T[3], course_id: CR, course: 'regular', position: 0 },
    ], { onConflict: 'course_id,template_id', ignoreDuplicates: true });
    check('①-6 코스 등록(첫 3 + 정기 1)', !error, error?.message ?? ''); }
  // ★판정 뒤집힘(0108): 0099 는 PK 로 막았지만 이제는 성공해야 정상이다.
  { const { error } = await owner.from('training_items').insert({ unit_id: UNIT, template_id: T[0], course_id: CS, course: 'short_term', position: 0 });
    check('①-7 같은 업무를 두 코스에 동시 등록 성공(0108 PK 교체)', !error, error?.message ?? '(차단됨!)'); }
  // 같은 코스에 같은 업무 두 번은 여전히 차단(새 PK).
  { const { error } = await owner.from('training_items').insert({ unit_id: UNIT, template_id: T[0], course_id: CF, course: 'first_day', position: 7 });
    check('①-8 같은 코스 중복 등록 차단(새 PK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  // 코스명 check 는 사라졌고, 이제 방어선은 course_id FK 다.
  { const { error } = await owner.from('training_items').insert({ unit_id: UNIT, template_id: T[1], course_id: `no_such_${s}`, course: 'weekly', position: 9 });
    check('①-9 없는 코스에 등록 차단(FK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }

  // ── ② 순서 변경(ti_update) + 코스에서 빼기 ───────────────────────────────
  console.log('\n━━ ② 수정(순서·빼기) ━━');
  // 사장 스왑: 첫 출근 코스 안에서 T0(0) ↔ T1(1). ★course_id 로 좁히지 않으면 다른 코스 행까지 덮인다.
  await owner.from('training_items').update({ position: 1 }).eq('course_id', CF).eq('template_id', T[0]);
  await owner.from('training_items').update({ position: 0 }).eq('course_id', CF).eq('template_id', T[1]);
  const { data: afterSwap } = await owner.from('training_items').select('template_id, position').eq('course_id', CF).order('position');
  check('②-1 사장 순서 스왑(ti_update)', afterSwap?.[0]?.template_id === T[1] && afterSwap?.[1]?.template_id === T[0]);
  // 같은 업무의 다른 코스(단기) 순서는 안 흔들려야 한다 — 코스 스코프 실증.
  { const { data: st } = await owner.from('training_items').select('position').eq('course_id', CS).eq('template_id', T[0]).maybeSingle();
    check('②-2 다른 코스의 같은 업무는 순서 무영향', st?.position === 0, `pos=${st?.position}`); }
  // 되돌리기(이후 검증은 원래 순서 기준)
  await owner.from('training_items').update({ position: 0 }).eq('course_id', CF).eq('template_id', T[0]);
  await owner.from('training_items').update({ position: 1 }).eq('course_id', CF).eq('template_id', T[1]);
  // 빼기: 정기에서 T3 제거 → 업무·노하우는 남아야 함
  { const { error } = await owner.from('training_items').delete().eq('course_id', CR).eq('template_id', T[3]);
    check('②-3 코스에서 빼기', !error, error?.message ?? ''); }
  const { data: tmplLeft } = await owner.from('work_templates').select('id').eq('id', T[3]).maybeSingle();
  const { data: entryLeft } = await owner.from('playbook_entries').select('id').eq('id', E[3]).maybeSingle();
  check('②-4 빼도 업무·노하우는 남음', !!tmplLeft && !!entryLeft);
  // 한 코스에서 빼도 다른 코스 소속은 남는다(T0 은 첫 출근 + 단기 둘 다).
  { await owner.from('training_items').delete().eq('course_id', CS).eq('template_id', T[0]);
    const { data: stillFd } = await owner.from('training_items').select('template_id').eq('course_id', CF).eq('template_id', T[0]).maybeSingle();
    check('②-5 한 코스에서 빼도 다른 코스 소속 유지', !!stillFd);
    await owner.from('training_items').insert({ unit_id: UNIT, template_id: T[0], course_id: CS, course: 'short_term', position: 0 }); }
  // 정기 재등록(이후 정기 due 검증에 사용)
  await owner.from('training_items').upsert([{ unit_id: UNIT, template_id: T[3], course_id: CR, course: 'regular', position: 0 }], { onConflict: 'course_id,template_id', ignoreDuplicates: true });

  // ── ③ RLS 경계: 직원 조작 차단 ───────────────────────────────────────────
  console.log('\n━━ ③ RLS 경계 ━━');
  { const { error } = await jA.from('training_items').insert({ unit_id: UNIT, template_id: T[0], course_id: CF, course: 'first_day', position: 9 }).select('template_id');
    check('③-1 직원 코스 등록 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { data } = await jA.from('training_items').update({ position: 9 }).eq('course_id', CF).eq('template_id', T[0]).select('template_id');
    check('③-2 직원 순서 변경 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }
  { await jA.from('training_items').delete().eq('course_id', CF).eq('template_id', T[0]);
    const { data: still } = await owner.from('training_items').select('template_id').eq('course_id', CF).eq('template_id', T[0]).maybeSingle();
    check('③-3 직원 코스 삭제 차단', !!still); }
  const { data: jItems } = await jA.from('training_items').select('template_id, course_id, course, position').order('position');
  check('③-4 직원 코스 열람은 허용(첫3+정기1+단기1)', (jItems?.length ?? 0) === 5, `n=${jItems?.length}`);
  // 코스 행(0108) RLS — 읽기는 매장 전원, 쓰기는 관리 권한만.
  { const { data } = await jA.from('training_courses').select('id, key, name').order('position');
    check('③-5 직원 코스 목록 열람 허용', (data?.length ?? 0) === 3, `n=${data?.length}`); }
  { const { error } = await jA.from('training_courses').insert({ id: `tc_x_${s}`, unit_id: UNIT, key: 'hack', name: '몰래' });
    check('③-6 직원 코스 생성 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { data } = await jA.from('training_courses').update({ max_items: 99 }).eq('id', CF).select('id');
    check('③-7 직원 코스 수정 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }

  // ── ④ 직원 훈련: 퀴즈(실 AI) → 통과 → 재확인 verified_at 갱신 ────────────
  console.log('\n━━ ④ 퀴즈·통과·재확인 ━━');
  const token = (await jA.auth.getSession()).data.session?.access_token;
  const r = await edgeAi(token, 'quiz', {
    taskText: names[0],
    sops: [{ title: names[0], situation: HOW[0], steps: [], donts: [] }],
  });
  check('④-1 quiz 엣지 200 · 문항 ≥1', r.ok && (r.body?.questions?.length ?? 0) >= 1, `status=${r.status} n=${r.body?.questions?.length}`);
  // 첫 통과 기록(멱등 upsert — verified_at 명시)
  const firstPassAt = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(); // 40일 전으로 시드(정기 due 재현)
  { const { error } = await jA.from('task_understanding').upsert(
      { unit_id: UNIT, template_id: T[3], staff_name: 'QA직원', verified_at: firstPassAt }, { onConflict: 'template_id,staff_id' });
    check('④-2 통과 기록(40일 전 시드)', !error, error?.message ?? ''); }
  // 정기 due 판정(클라 로직 재현): 40일 전 통과 → due
  const { data: u1 } = await jA.from('task_understanding').select('template_id, verified_at').eq('template_id', T[3]).maybeSingle();
  const due1 = Date.now() - Date.parse(u1?.verified_at) > REGULAR_DUE_DAYS * 24 * 3600 * 1000;
  check('④-3 30일 경과 → 다시 확인(due)', due1, `verified_at=${u1?.verified_at}`);
  // 재확인 통과 → verified_at 갱신(0099 tu_update)
  { const { error } = await jA.from('task_understanding').upsert(
      { unit_id: UNIT, template_id: T[3], staff_name: 'QA직원', verified_at: new Date().toISOString() }, { onConflict: 'template_id,staff_id' });
    check('④-4 재확인 통과 upsert 성공', !error, error?.message ?? ''); }
  const { data: u2 } = await jA.from('task_understanding').select('verified_at').eq('template_id', T[3]).maybeSingle();
  const due2 = Date.now() - Date.parse(u2?.verified_at) > REGULAR_DUE_DAYS * 24 * 3600 * 1000;
  check('④-5 verified_at 갱신 → due 해제', !due2 && u2?.verified_at !== firstPassAt, `verified_at=${u2?.verified_at}`);
  // 위조 방어: 직원이 남(사장) 행의 verified_at 을 만질 수 없다(tu_update 본인 행만)
  await admin.from('task_understanding').upsert({ unit_id: UNIT, template_id: T[0], staff_id: ownerId, staff_name: '사장', verified_at: firstPassAt }, { onConflict: 'template_id,staff_id' });
  { const { data } = await jA.from('task_understanding').update({ verified_at: new Date().toISOString() }).eq('template_id', T[0]).eq('staff_id', ownerId).select('template_id');
    check('④-6 남의 통과 시각 갱신 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }

  // ── ⑥ 재확인 주기(0100) — 매장 설정·관리 권한·범위 제약·due 반영 ─────────
  console.log('\n━━ ⑥ 재확인 주기(0100) ━━');
  { const { error } = await owner.from('schedule_config').upsert({ unit_id: UNIT, regular_due_days: 7, updated_at: new Date().toISOString() });
    check('⑥-1 사장 주기 변경(7일)', !error, error?.message ?? ''); }
  const { data: sc1 } = await jA.from('schedule_config').select('regular_due_days').maybeSingle();
  check('⑥-2 직원도 주기 열람(카드 판정용)', sc1?.regular_due_days === 7, `v=${sc1?.regular_due_days}`);
  { const { data } = await jA.from('schedule_config').update({ regular_due_days: 365 }).eq('unit_id', UNIT).select('unit_id');
    const { data: sc2 } = await owner.from('schedule_config').select('regular_due_days').maybeSingle();
    check('⑥-3 직원 주기 변경 차단(관리 권한만)', (data?.length ?? 0) === 0 && sc2?.regular_due_days === 7, `n=${data?.length} v=${sc2?.regular_due_days}`); }
  { const { error } = await owner.from('schedule_config').upsert({ unit_id: UNIT, regular_due_days: 0 });
    check('⑥-4 범위 밖(0일) 거부(check)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  // due 판정에 주기 반영(클라 로직 미러): 방금 재통과(④-4, 지금)한 T3 는 7일 기준 미도래,
  // 10일 전으로 되돌리면 7일 기준 due.
  { const { data: u3 } = await jA.from('task_understanding').select('verified_at').eq('template_id', T[3]).maybeSingle();
    const dueNow = Date.now() - Date.parse(u3?.verified_at) > 7 * 24 * 3600 * 1000;
    check('⑥-5 방금 통과 → 7일 기준 미도래', !dueNow, `verified_at=${u3?.verified_at}`); }
  { const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    await jA.from('task_understanding').update({ verified_at: tenDaysAgo }).eq('template_id', T[3]).eq('staff_id', jAId);
    const { data: u4 } = await jA.from('task_understanding').select('verified_at').eq('template_id', T[3]).maybeSingle();
    const due7 = Date.now() - Date.parse(u4?.verified_at) > 7 * 24 * 3600 * 1000;
    const due30 = Date.now() - Date.parse(u4?.verified_at) > 30 * 24 * 3600 * 1000;
    check('⑥-6 10일 전 통과 → 7일 기준 due · 30일 기준 미도래(주기가 판정을 가름)', due7 && !due30); }

  // ── ⑦ 훈련 요청(0102) — 즉시/매주·본인만 열람·직원 조작 차단·완료 파생 ─────
  console.log('\n━━ ⑦ 훈련 요청(0102) ━━');
  const RQ1 = `trq1_${s}`, RQ2 = `trq2_${s}`;
  const todayDow = new Date().getDay();
  { const { error } = await owner.from('training_requests').insert([
      { id: RQ1, unit_id: UNIT, template_id: T[0], staff_id: jAId, recurrence: null },
      { id: RQ2, unit_id: UNIT, template_id: T[1], staff_id: jAId, recurrence: { weekly: [todayDow] } },
    ]);
    check('⑦-1 사장 요청 2건(즉시+매주 오늘요일)', !error, error?.message ?? ''); }
  { const { data } = await jA.from('training_requests').select('id, template_id, recurrence, created_at');
    check('⑦-2 직원이 본인 요청 열람', (data ?? []).length === 2, `n=${data?.length}`);
    // 즉시형 due 판정(클라 미러): 요청 이후 통과 없음(T0 의 내 통과기록은 ④ 이전 시각... T0 은 통과기록 없음) → due
    const rq1 = (data ?? []).find((r) => r.id === RQ1);
    const { data: myU } = await jA.from('task_understanding').select('template_id, verified_at').eq('staff_id', jAId);
    const vT0 = (myU ?? []).find((u) => u.template_id === T[0])?.verified_at;
    const due1 = !vT0 || Date.parse(vT0) < Date.parse(rq1.created_at);
    check('⑦-3 즉시 요청 → due(통과 전)', due1, `v=${vT0 ?? '없음'}`);
    // 매주형: 오늘 요일 포함 + 오늘 통과 없음 → due
    const vT1 = (myU ?? []).find((u) => u.template_id === T[1])?.verified_at;
    const dueW = !vT1 || new Date(vT1).toDateString() !== new Date().toDateString();
    check('⑦-4 매주(오늘) 요청 → due(오늘 통과 전)', dueW, `v=${vT1 ?? '없음'}`); }
  // 통과 → 즉시형 해소(파생)
  // ⚠️ verified_at 은 클라가 만든 시각이고 created_at 은 서버 now() 다 — 두 시계가 다르다.
  //    이 PC 시계가 서버보다 조금만 뒤여도 "나중에 쓴 통과"가 "먼저" 찍혀 이 판정이 뒤집힌다
  //    (실측: 91ms 차이로 실패). 검증 대상은 시계가 아니라 "통과 시각이 요청 시각 이후면 해소"라는
  //    파생 규칙이므로, 요청 시각(서버)을 먼저 읽어 그 기준으로 통과 시각을 만든다.
  //    ※ 앱은 이 여유가 없다 — 직원 기기 시계가 크게 어긋나면 요청 해소 판정도 같이 어긋난다(기존 설계, 별건).
  { const { data: rq } = await jA.from('training_requests').select('created_at').eq('id', RQ1).maybeSingle();
    const passAt = new Date(Date.parse(rq?.created_at) + 1000).toISOString();
    const { error: upErr } = await jA.from('task_understanding').upsert(
      { unit_id: UNIT, template_id: T[0], staff_name: 'QA직원', verified_at: passAt }, { onConflict: 'template_id,staff_id' });
    const { data: u } = await jA.from('task_understanding').select('verified_at').eq('template_id', T[0]).eq('staff_id', jAId).maybeSingle();
    // 통과 기록 자체가 실패하면 "요청 해소 안 됨"으로만 보여 원인을 못 찾는다 → 오류를 그대로 드러낸다.
    check('⑦-5 통과 후 즉시 요청 해소(verified_at ≥ 요청시각)',
      !upErr && Date.parse(u?.verified_at) >= Date.parse(rq?.created_at),
      upErr ? `통과 기록 실패: ${upErr.code ?? ''} ${upErr.message}` : `v=${u?.verified_at ?? '없음'} rq=${rq?.created_at ?? '없음'}`); }
  // RLS: 직원 요청 생성·삭제 차단, 사장 취소 가능
  { const { error } = await jA.from('training_requests').insert({ id: `trqX_${s}`, unit_id: UNIT, template_id: T[0], staff_id: jAId, recurrence: null });
    check('⑦-6 직원 요청 생성 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { await jA.from('training_requests').delete().eq('id', RQ2);
    const { data: still } = await owner.from('training_requests').select('id').eq('id', RQ2).maybeSingle();
    check('⑦-7 직원 요청 삭제 차단', !!still); }
  { const { error } = await owner.from('training_requests').delete().eq('id', RQ2);
    const { data: gone } = await owner.from('training_requests').select('id').eq('id', RQ2).maybeSingle();
    check('⑦-8 사장 요청 취소', !error && !gone, error?.message ?? ''); }

  // ── ⑧ 문항 영속화·서버 채점(0107) ────────────────────────────────────────
  // 핵심 불변식 하나: **정답은 클라에 내려가지 않는다.** 직원은 테이블을 못 읽고, RPC 는 정답 키를
  // 제거한 사본만 주며, 맞았는지는 서버가 판정한다. 아래는 그 세 겹을 전부 실증한다.
  console.log('\n━━ ⑧ 문항·서버 채점(0107) ━━');
  const QMC = `qi_mc_${s}`, QMN = `qi_mn_${s}`, QML = `qi_ml_${s}`, QBAD = `qi_bad_${s}`;
  { const { error } = await owner.from('quiz_items').insert([
      { id: QMC, unit_id: UNIT, entry_ids: [E[0]], kind: 't0', format: 'mc4',
        payload: { ask: '오픈 때 가장 먼저 할 일은?', choices: ['바닥 청소', '포스 켜기', '퇴근'], answer_index: 1, explain: '포스부터 켜요' } },
      { id: QMN, unit_id: UNIT, entry_ids: [E[0]], kind: 't3', format: 'mine_tap',
        payload: { ask: '하면 안 되는 것을 모두 누르세요', explain: '시재는 만지지 않아요',
          cards: [{ text: '시재 임의 사용', is_mine: true }, { text: '머신 예열', is_mine: false },
                  { text: '금고 열어두기', is_mine: true }, { text: '문 열기', is_mine: false }] } },
      { id: QML, unit_id: UNIT, entry_ids: [E[0]], kind: 't4', format: 'match_line',
        payload: { ask: '상황과 할 말을 이으세요', explain: '상황별 응대',
          pairs: [{ left: 'L0', right: 'R0' }, { left: 'L1', right: 'R1' }, { left: 'L2', right: 'R2' }] } },
    ]);
    check('⑧-1 사장 문항 3건 저장', !error, error?.message ?? ''); }
  { const { data, error } = await jA.from('quiz_items').select('id, payload');
    check('⑧-2 직원 직접 SELECT 차단(정답 노출 0행)', !error && (data?.length ?? 0) === 0, `n=${data?.length ?? 0} ${error?.message ?? ''}`); }
  { const { data } = await owner.from('quiz_items').select('id');
    check('⑧-3 사장은 문항 열람(편집용)', (data?.length ?? 0) === 3, `n=${data?.length}`); }

  const { data: forAttempt, error: fae } = await jA.rpc('quiz_items_for', { p_entry_ids: [E[0]], p_limit: 10 });
  check('⑧-4 직원 응시 조회(quiz_items_for) 3문항', !fae && (forAttempt?.length ?? 0) === 3, `n=${forAttempt?.length} ${fae?.message ?? ''}`);
  const qById = Object.fromEntries((forAttempt ?? []).map((r) => [r.id, r]));
  { const leaked = (forAttempt ?? []).filter((r) => {
      const p = r.payload ?? {};
      if ('answer_index' in p || 'wrong_index' in p || 'target' in p || 'explain' in p || 'pairs' in p) return true;
      return Array.isArray(p.cards) && p.cards.some((c) => 'is_mine' in c || 'answer' in c);
    });
    check('⑧-5 응시 payload 에 정답 키 0개', leaked.length === 0, leaked.map((r) => `${r.id}:${JSON.stringify(r.payload)}`).join(' | ')); }
  { const ml = qById[QML]?.payload ?? {};
    check('⑧-6 match_line 은 lefts/rights 로 분해', Array.isArray(ml.lefts) && ml.lefts.length === 3 && Array.isArray(ml.rights) && ml.rights.length === 3,
      `lefts=${JSON.stringify(ml.lefts)} rights=${JSON.stringify(ml.rights)}`); }
  { const { data: again } = await jA.rpc('quiz_items_for', { p_entry_ids: [E[0]], p_limit: 10 });
    const r2 = (again ?? []).find((r) => r.id === QML);
    check('⑧-7 rights 순서 재조회 안정(결정적 셔플 — 채점 가능성의 전제)',
      JSON.stringify(r2?.payload?.rights) === JSON.stringify(qById[QML]?.payload?.rights),
      `${JSON.stringify(qById[QML]?.payload?.rights)} vs ${JSON.stringify(r2?.payload?.rights)}`); }

  const grade = async (id, res) => {
    const { data, error } = await jA.rpc('grade_quiz', { p_item_id: id, p_response: res });
    return { row: Array.isArray(data) ? data[0] : data, error };
  };
  { const { row } = await grade(QMC, 1);
    check('⑧-8 mc4 정답 → correct · answer 는 안 알려줌', row?.correct === true && (row?.answer ?? null) === null, JSON.stringify(row)); }
  { const { row } = await grade(QMC, 0);
    check('⑧-9 mc4 오답 → 정답 공개 + explain', row?.correct === false && Number(row?.answer) === 1 && !!row?.explain, JSON.stringify(row)); }
  { const { row } = await grade(QMN, [2, 0]);
    check('⑧-10 mine_tap 집합 일치(순서 무관) → 정답', row?.correct === true, JSON.stringify(row)); }
  { const { row } = await grade(QMN, [0]);
    check('⑧-11 mine_tap 부분 선택은 오답(부분점수 없음)', row?.correct === false, JSON.stringify(row)); }
  { const { row } = await grade(QMN, [0, 1, 2, 3]);
    check('⑧-12 mine_tap 전부 찍기도 오답', row?.correct === false, JSON.stringify(row)); }
  {
    // ★좌표계 실증: 클라는 원본 pairs index 를 모른다. 화면에 보이는 rights 배열의 **위치**를 돌려준다.
    //   QA 는 값(R0/R1/R2)으로 짝을 찾아 그 위치를 계산한다 — 실제 응시자가 화면에서 하는 것과 같다.
    const rights = qById[QML]?.payload?.rights ?? [];
    const good = {};
    for (let i = 0; i < 3; i++) good[String(i)] = rights.findIndex((v) => v === `R${i}`);
    const { row } = await grade(QML, good);
    check('⑧-13 match_line 표시 위치 index 로 정답 판정', row?.correct === true, `res=${JSON.stringify(good)} rights=${JSON.stringify(rights)}`);
    const bad = { 0: good['1'], 1: good['0'], 2: good['2'] };
    const { row: r2 } = await grade(QML, bad);
    check('⑧-14 match_line 잘못 이으면 오답 + 정답 매핑 공개', r2?.correct === false && !!r2?.answer, `res=${JSON.stringify(bad)} ans=${JSON.stringify(r2?.answer)}`);
  }
  { await owner.from('quiz_items').insert({ id: QBAD, unit_id: UNIT, entry_ids: [E[0]], kind: 't0', format: 'bogus_format', payload: { ask: 'x' } });
    const { error } = await jA.rpc('grade_quiz', { p_item_id: QBAD, p_response: 0 });
    check('⑧-15 모르는 형태는 조용한 오답이 아니라 예외', !!error && /unknown_quiz_format/.test(error?.message ?? ''), error?.message ?? '(예외 없음!)'); }
  { const { error } = await jA.from('quiz_items').update({ payload: { ask: 'hacked' } }).eq('id', QMC);
    const { data: still } = await owner.from('quiz_items').select('payload').eq('id', QMC).maybeSingle();
    check('⑧-16 직원 문항 수정 차단', still?.payload?.ask === '오픈 때 가장 먼저 할 일은?', error?.code ?? ''); }

  // ── ⑤ cascade: 업무 삭제 → 코스 항목 소멸 / 코스 삭제 → 그 코스 항목만 소멸 ──
  console.log('\n━━ ⑤ cascade ━━');
  await owner.from('work_templates').delete().eq('id', T[2]);
  const { data: afterDel } = await owner.from('training_items').select('template_id');
  check('⑤-1 업무 삭제 시 코스 항목 cascade', !(afterDel ?? []).some((i) => i.template_id === T[2]), `n=${afterDel?.length}`);
  // 코스 삭제(0108 FK cascade) — 그 코스의 항목만 사라지고 업무·다른 코스 소속은 남는다.
  await owner.from('training_courses').delete().eq('id', CS);
  { const { data: rows } = await owner.from('training_items').select('template_id, course_id');
    const { data: tmpl } = await owner.from('work_templates').select('id').eq('id', T[0]).maybeSingle();
    check('⑤-2 코스 삭제 → 그 코스 항목만 소멸(업무·타 코스 소속은 유지)',
      !(rows ?? []).some((r) => r.course_id === CS) && (rows ?? []).some((r) => r.course_id === CF && r.template_id === T[0]) && !!tmpl,
      `n=${rows?.length}`); }

  await cleanupSeededPhones(URL_, SRV, qaPhones);
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 훈련 코스·문항(0099·0107·0108) QA · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
