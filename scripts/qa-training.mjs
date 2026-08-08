// 퀴즈 QA(0107·0108 → 0110~0114) — 사장 코스 구성·직원 응시·RLS 경계를 실 백엔드로 재현한다.
//
// ★0111 로 판정이 뒤집힌 것: 코스에 담기는 것이 **업무가 아니라 노하우**다(course_entries).
//   통과 기록도 노하우 단위(knowhow_understanding)이고, "이 업무를 할 줄 아는가"는 저장하지 않는다
//   — 그 업무가 참조하는 노하우를 전부 아는가의 **파생**이고, 판정 SSOT 는 클라(useWorkStore)다.
//   여기서는 파생의 재료(원시 행)가 맞는지와 RLS 경계만 실증한다.
//
// 커버: 0107 문항·서버 채점 / 0108 코스 / 0110 껍데기 업무 숨김 / 0111 축 이동·요청 /
//       0112 응시 점수 / 0113 외부 링크(토큰 4종 RPC) / 0114 문항 낡음 스냅샷
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
/** 로그인하지 않은 손님(anon) — 외부 링크 경로 전용. 세션을 절대 만들지 않는다. */
const guest = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
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
const REGULAR_DUE_DAYS = 30; // 클라 상수 미러(useWorkStore.REGULAR_DUE_DAYS_DEFAULT)

async function main() {
  // ── 셋업: 격리 매장 + 사장 + 직원1 ────────────────────────────────────────
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_tr_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0], store_name: 'TR', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'TR 퀴즈매장', p_industry: '카페·디저트', p_biz_no: null });
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

  // ── ① 사장 코스 구성: 노하우를 코스에 직접 담는다(0111) ───────────────────
  console.log('\n━━ ① 코스 구성(노하우 축) ━━');
  const now = new Date().toISOString();
  const mkEntry = (id, title, situation) => ({
    id, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장',
    category: 'Know-how', subcategory: '일반', title, tags: [], search_keywords: [title],
    square: { situation, action: { steps: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.6,
    created_at: now, updated_at: now, is_template: false, pack_id: null,
    needs_review: false, correction_points: [], section: null, order_index: 0,
  });
  const E = [1, 2, 3, 4].map((i) => `pb_tr${i}_${s}`);
  const names = ['오픈 청소', '원두 채우기', '포스 마감', '가스 밸브 잠그기'];
  const HOW = [
    '문 열고 포스 켜기, 시재 5만원 확인, 머신 예열 순서로 진행해요. 시재가 안 맞으면 만지지 말고 바로 알려 주세요.',
    '그라인더 호퍼가 3분의 1 밑으로 내려가면 새 원두를 채워요. 봉투에 개봉일을 적고, 오래된 원두부터 써요.',
    '포스 정산 버튼을 누르고 카드·현금 합계를 장부와 맞춰요. 차액이 있으면 사진을 찍어 남겨 주세요.',
    '마감 때 주방 가스 밸브를 잠그고, 잠근 상태를 손으로 한 번 더 확인해요. 냄새가 나면 환기부터 하고 바로 전화 주세요.',
  ];
  { const { error } = await owner.from('playbook_entries').insert(E.map((id, i) => mkEntry(id, names[i], HOW[i])));
    check('①-1 노하우 4건 발행', !error, error?.message ?? ''); }
  // 코스 행이 선행되어야 한다(0111: course_entries.course_id FK).
  const CF = `tc_fd_${s}`, CR = `tc_rg_${s}`, CS = `tc_st_${s}`;
  { const { error } = await owner.from('training_courses').insert([
      { id: CF, unit_id: UNIT, key: 'first_day', name: '첫 출근', description: '처음 온 날 이것만은', preset: 'first_day', min_items: 3, max_items: 5, due_days: null, position: 0 },
      { id: CR, unit_id: UNIT, key: 'regular', name: '정기 점검', description: '정해둔 주기마다 다시 확인', preset: 'regular', min_items: 3, max_items: 10, due_days: 30, position: 1 },
      { id: CS, unit_id: UNIT, key: 'short_term', name: '단기·주말', preset: 'short_term', min_items: 2, max_items: 4, position: 2 },
    ]);
    check('①-2 코스 3종 생성', !error, error?.message ?? ''); }
  { const { error } = await owner.from('course_entries').upsert([
      { unit_id: UNIT, course_id: CF, entry_id: E[0], position: 0 },
      { unit_id: UNIT, course_id: CF, entry_id: E[1], position: 1 },
      { unit_id: UNIT, course_id: CF, entry_id: E[2], position: 2 },
      { unit_id: UNIT, course_id: CR, entry_id: E[3], position: 0 },
    ], { onConflict: 'course_id,entry_id', ignoreDuplicates: true });
    check('①-3 코스에 노하우 담기(첫 3 + 정기 1)', !error, error?.message ?? ''); }
  // ★껍데기 업무가 생기지 않는다 — 0111 의 존재 이유. 코스를 채워도 work_templates 는 그대로 0행이다.
  { const { data } = await owner.from('work_templates').select('id');
    check('①-4 ★코스를 채워도 껍데기 업무 0건(0111 핵심)', (data ?? []).length === 0, `n=${data?.length}`); }
  // 같은 노하우를 두 코스에 넣는 것은 정상(PK = course_id + entry_id).
  { const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CS, entry_id: E[0], position: 0 });
    check('①-5 같은 노하우를 두 코스에 동시 등록 성공', !error, error?.message ?? '(차단됨!)'); }
  { const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CF, entry_id: E[0], position: 7 });
    check('①-6 같은 코스 중복 등록 차단(PK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: `no_such_${s}`, entry_id: E[1], position: 9 });
    check('①-7 없는 코스에 등록 차단(FK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CF, entry_id: `pb_nope_${s}`, position: 9 });
    check('①-8 없는 노하우 등록 차단(FK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }

  // ── ② 순서 변경 + 코스에서 빼기 ──────────────────────────────────────────
  console.log('\n━━ ② 수정(순서·빼기) ━━');
  await owner.from('course_entries').update({ position: 1 }).eq('course_id', CF).eq('entry_id', E[0]);
  await owner.from('course_entries').update({ position: 0 }).eq('course_id', CF).eq('entry_id', E[1]);
  const { data: afterSwap } = await owner.from('course_entries').select('entry_id, position').eq('course_id', CF).order('position');
  check('②-1 사장 순서 스왑(ce_update)', afterSwap?.[0]?.entry_id === E[1] && afterSwap?.[1]?.entry_id === E[0]);
  { const { data: st } = await owner.from('course_entries').select('position').eq('course_id', CS).eq('entry_id', E[0]).maybeSingle();
    check('②-2 다른 코스의 같은 노하우는 순서 무영향', st?.position === 0, `pos=${st?.position}`); }
  await owner.from('course_entries').update({ position: 0 }).eq('course_id', CF).eq('entry_id', E[0]);
  await owner.from('course_entries').update({ position: 1 }).eq('course_id', CF).eq('entry_id', E[1]);
  { const { error } = await owner.from('course_entries').delete().eq('course_id', CR).eq('entry_id', E[3]);
    check('②-3 코스에서 빼기', !error, error?.message ?? ''); }
  const { data: entryLeft } = await owner.from('playbook_entries').select('id').eq('id', E[3]).maybeSingle();
  check('②-4 빼도 노하우는 남음', !!entryLeft);
  { await owner.from('course_entries').delete().eq('course_id', CS).eq('entry_id', E[0]);
    const { data: stillFd } = await owner.from('course_entries').select('entry_id').eq('course_id', CF).eq('entry_id', E[0]).maybeSingle();
    check('②-5 한 코스에서 빼도 다른 코스 소속 유지', !!stillFd);
    await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CS, entry_id: E[0], position: 0 }); }
  await owner.from('course_entries').upsert([{ unit_id: UNIT, course_id: CR, entry_id: E[3], position: 0 }], { onConflict: 'course_id,entry_id', ignoreDuplicates: true });

  // ── ③ RLS 경계: 직원 조작 차단 ───────────────────────────────────────────
  console.log('\n━━ ③ RLS 경계 ━━');
  { const { error } = await jA.from('course_entries').insert({ unit_id: UNIT, course_id: CF, entry_id: E[3], position: 9 }).select('entry_id');
    check('③-1 직원 코스 등록 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { data } = await jA.from('course_entries').update({ position: 9 }).eq('course_id', CF).eq('entry_id', E[0]).select('entry_id');
    check('③-2 직원 순서 변경 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }
  { await jA.from('course_entries').delete().eq('course_id', CF).eq('entry_id', E[0]);
    const { data: still } = await owner.from('course_entries').select('entry_id').eq('course_id', CF).eq('entry_id', E[0]).maybeSingle();
    check('③-3 직원 코스 삭제 차단', !!still); }
  const { data: jItems } = await jA.from('course_entries').select('entry_id, course_id, position').order('position');
  check('③-4 직원 코스 열람은 허용(첫3+정기1+단기1)', (jItems?.length ?? 0) === 5, `n=${jItems?.length}`);
  { const { data } = await jA.from('training_courses').select('id, key, name').order('position');
    check('③-5 직원 코스 목록 열람 허용', (data?.length ?? 0) === 3, `n=${data?.length}`); }
  { const { error } = await jA.from('training_courses').insert({ id: `tc_x_${s}`, unit_id: UNIT, key: 'hack', name: '몰래' });
    check('③-6 직원 코스 생성 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { data } = await jA.from('training_courses').update({ max_items: 99 }).eq('id', CF).select('id');
    check('③-7 직원 코스 수정 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }

  // ── ④ 직원 통과·재확인(0111 knowhow_understanding) ───────────────────────
  console.log('\n━━ ④ 통과·재확인(노하우 단위) ━━');
  const token = (await jA.auth.getSession()).data.session?.access_token;
  const r = await edgeAi(token, 'quiz', { taskText: names[0], sops: [{ title: names[0], situation: HOW[0], steps: [], donts: [] }] });
  check('④-1 quiz 엣지 200 · 문항 ≥1', r.ok && (r.body?.questions?.length ?? 0) >= 1, `status=${r.status} n=${r.body?.questions?.length}`);
  const firstPassAt = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(); // 40일 전 시드(정기 due 재현)
  { const { error } = await jA.from('knowhow_understanding').upsert(
      { unit_id: UNIT, entry_id: E[3], staff_name: 'QA직원', verified_at: firstPassAt }, { onConflict: 'entry_id,staff_id' });
    check('④-2 통과 기록(40일 전 시드)', !error, error?.message ?? ''); }
  const { data: u1 } = await jA.from('knowhow_understanding').select('entry_id, verified_at').eq('entry_id', E[3]).maybeSingle();
  const due1 = Date.now() - Date.parse(u1?.verified_at) > REGULAR_DUE_DAYS * 24 * 3600 * 1000;
  check('④-3 30일 경과 → 다시 확인(due)', due1, `verified_at=${u1?.verified_at}`);
  { const { error } = await jA.from('knowhow_understanding').upsert(
      { unit_id: UNIT, entry_id: E[3], staff_name: 'QA직원', verified_at: new Date().toISOString() }, { onConflict: 'entry_id,staff_id' });
    check('④-4 재확인 통과 upsert 성공', !error, error?.message ?? ''); }
  const { data: u2 } = await jA.from('knowhow_understanding').select('verified_at').eq('entry_id', E[3]).maybeSingle();
  const due2 = Date.now() - Date.parse(u2?.verified_at) > REGULAR_DUE_DAYS * 24 * 3600 * 1000;
  check('④-5 verified_at 갱신 → due 해제', !due2 && u2?.verified_at !== firstPassAt, `verified_at=${u2?.verified_at}`);
  // 위조 방어: 남(사장) 행의 verified_at 을 만질 수 없다(ku_update 본인 행만)
  await admin.from('knowhow_understanding').upsert({ unit_id: UNIT, entry_id: E[0], staff_id: ownerId, staff_name: '사장', verified_at: firstPassAt }, { onConflict: 'entry_id,staff_id' });
  { const { data } = await jA.from('knowhow_understanding').update({ verified_at: new Date().toISOString() }).eq('entry_id', E[0]).eq('staff_id', ownerId).select('entry_id');
    check('④-6 남의 통과 시각 갱신 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }
  { const { error } = await jA.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: E[1], staff_id: ownerId, staff_name: '위조' }).select('entry_id');
    check('④-7 남의 명의 통과 삽입 차단(WITH CHECK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  // ★파생 실증: 노하우 2건짜리 업무는 **둘 다** 통과해야 "할 줄 안다"가 된다(부분 통과는 아니다).
  {
    const TWO = `t_two_${s}`;
    await owner.from('work_templates').insert({ id: TWO, unit_id: UNIT, section: 'etc', text: '마감 전체', scope: 'shared', created_at: now });
    await owner.from('work_template_knowhow').upsert(
      [{ unit_id: UNIT, template_id: TWO, entry_id: E[2] }, { unit_id: UNIT, template_id: TWO, entry_id: E[3] }],
      { onConflict: 'template_id,entry_id', ignoreDuplicates: true });
    const knowsOf = async () => {
      const { data } = await owner.from('knowhow_understanding').select('entry_id').eq('staff_id', jAId);
      return new Set((data ?? []).map((x) => x.entry_id));
    };
    const need = [E[2], E[3]];
    const before = await knowsOf();
    check('④-8 노하우 2건 중 1건만 통과 → 업무는 아직 아님(파생)', !need.every((id) => before.has(id)), `knows=${[...before].length}`);
    await jA.from('knowhow_understanding').upsert({ unit_id: UNIT, entry_id: E[2], staff_name: 'QA직원' }, { onConflict: 'entry_id,staff_id' });
    const after = await knowsOf();
    check('④-9 나머지 1건까지 통과 → 업무 통과(파생)', need.every((id) => after.has(id)), `knows=${[...after].length}`);
  }

  // ── ⑤ 재확인 주기(0100) ──────────────────────────────────────────────────
  console.log('\n━━ ⑤ 재확인 주기(0100) ━━');
  { const { error } = await owner.from('schedule_config').upsert({ unit_id: UNIT, regular_due_days: 7, updated_at: new Date().toISOString() });
    check('⑤-1 사장 주기 변경(7일)', !error, error?.message ?? ''); }
  const { data: sc1 } = await jA.from('schedule_config').select('regular_due_days').maybeSingle();
  check('⑤-2 직원도 주기 열람(카드 판정용)', sc1?.regular_due_days === 7, `v=${sc1?.regular_due_days}`);
  { const { data } = await jA.from('schedule_config').update({ regular_due_days: 365 }).eq('unit_id', UNIT).select('unit_id');
    const { data: sc2 } = await owner.from('schedule_config').select('regular_due_days').maybeSingle();
    check('⑤-3 직원 주기 변경 차단(관리 권한만)', (data?.length ?? 0) === 0 && sc2?.regular_due_days === 7, `n=${data?.length} v=${sc2?.regular_due_days}`); }
  { const { error } = await owner.from('schedule_config').upsert({ unit_id: UNIT, regular_due_days: 0 });
    check('⑤-4 범위 밖(0일) 거부(check)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    await jA.from('knowhow_understanding').update({ verified_at: tenDaysAgo }).eq('entry_id', E[3]).eq('staff_id', jAId);
    const { data: u4 } = await jA.from('knowhow_understanding').select('verified_at').eq('entry_id', E[3]).eq('staff_id', jAId).maybeSingle();
    const due7 = Date.now() - Date.parse(u4?.verified_at) > 7 * 24 * 3600 * 1000;
    const due30 = Date.now() - Date.parse(u4?.verified_at) > 30 * 24 * 3600 * 1000;
    check('⑤-5 10일 전 통과 → 7일 기준 due · 30일 기준 미도래(주기가 판정을 가름)', due7 && !due30); }

  // ── ⑥ 퀴즈 요청(0102 → 0111 노하우 축) ───────────────────────────────────
  console.log('\n━━ ⑥ 퀴즈 요청(노하우 축) ━━');
  const RQ1 = `trq1_${s}`, RQ2 = `trq2_${s}`;
  const todayDow = new Date().getDay();
  { const { error } = await owner.from('training_requests').insert([
      { id: RQ1, unit_id: UNIT, entry_id: E[0], staff_id: jAId, recurrence: null },
      { id: RQ2, unit_id: UNIT, entry_id: E[1], staff_id: jAId, recurrence: { weekly: [todayDow] } },
    ]);
    check('⑥-1 사장 요청 2건(즉시+매주 오늘요일)', !error, error?.message ?? ''); }
  { const { data } = await jA.from('training_requests').select('id, entry_id, recurrence, created_at').not('entry_id', 'is', null);
    check('⑥-2 직원이 본인 요청 열람', (data ?? []).length === 2, `n=${data?.length}`);
    const rq1 = (data ?? []).find((x) => x.id === RQ1);
    const { data: myU } = await jA.from('knowhow_understanding').select('entry_id, verified_at').eq('staff_id', jAId);
    const vE0 = (myU ?? []).find((u) => u.entry_id === E[0])?.verified_at;
    check('⑥-3 즉시 요청 → due(통과 전)', !vE0 || Date.parse(vE0) < Date.parse(rq1.created_at), `v=${vE0 ?? '없음'}`);
    const vE1 = (myU ?? []).find((u) => u.entry_id === E[1])?.verified_at;
    check('⑥-4 매주(오늘) 요청 → due(오늘 통과 전)', !vE1 || new Date(vE1).toDateString() !== new Date().toDateString(), `v=${vE1 ?? '없음'}`); }
  // 통과 → 즉시형 해소(파생). ⚠️ verified_at 은 클라 시계, created_at 은 서버 now() — 시계가 다르다.
  //    검증 대상은 시계가 아니라 "통과 시각이 요청 시각 이후면 해소"라는 규칙이므로 서버 시각을 먼저 읽는다.
  { const { data: rq } = await jA.from('training_requests').select('created_at').eq('id', RQ1).maybeSingle();
    const passAt = new Date(Date.parse(rq?.created_at) + 1000).toISOString();
    const { error: upErr } = await jA.from('knowhow_understanding').upsert(
      { unit_id: UNIT, entry_id: E[0], staff_name: 'QA직원', verified_at: passAt }, { onConflict: 'entry_id,staff_id' });
    const { data: u } = await jA.from('knowhow_understanding').select('verified_at').eq('entry_id', E[0]).eq('staff_id', jAId).maybeSingle();
    check('⑥-5 통과 후 즉시 요청 해소(verified_at ≥ 요청시각)',
      !upErr && Date.parse(u?.verified_at) >= Date.parse(rq?.created_at),
      upErr ? `통과 기록 실패: ${upErr.code ?? ''} ${upErr.message}` : `v=${u?.verified_at ?? '없음'} rq=${rq?.created_at ?? '없음'}`); }
  { const { error } = await jA.from('training_requests').insert({ id: `trqX_${s}`, unit_id: UNIT, entry_id: E[0], staff_id: jAId, recurrence: null });
    check('⑥-6 직원 요청 생성 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { await jA.from('training_requests').delete().eq('id', RQ2);
    const { data: still } = await owner.from('training_requests').select('id').eq('id', RQ2).maybeSingle();
    check('⑥-7 직원 요청 삭제 차단', !!still); }
  { const { error } = await owner.from('training_requests').delete().eq('id', RQ2);
    const { data: gone } = await owner.from('training_requests').select('id').eq('id', RQ2).maybeSingle();
    check('⑥-8 사장 요청 취소', !error && !gone, error?.message ?? ''); }

  // ── ⑦ 문항 영속화·서버 채점(0107) ────────────────────────────────────────
  // 핵심 불변식 하나: **정답은 클라에 내려가지 않는다.** 직원은 테이블을 못 읽고, RPC 는 정답 키를
  // 제거한 사본만 주며, 맞았는지는 서버가 판정한다. 아래는 그 세 겹을 전부 실증한다.
  console.log('\n━━ ⑦ 문항·서버 채점(0107) ━━');
  // match_line(t4)은 2026-08-08 멘트 폐기와 함께 삭제 — 형태·렌더러·판정이 전부 없어졌다.
  // 서버(0107 quiz_items_for · grade_quiz)의 match_line 분기는 남아 있지만 만들 경로가 없어 도달 불가다.
  const QMC = `qi_mc_${s}`, QMN = `qi_mn_${s}`, QBAD = `qi_bad_${s}`;
  { const { error } = await owner.from('quiz_items').insert([
      { id: QMC, unit_id: UNIT, entry_ids: [E[0]], kind: 't0', format: 'mc4',
        payload: { ask: '오픈 때 가장 먼저 할 일은?', choices: ['바닥 청소', '포스 켜기', '퇴근'], answer_index: 1, explain: '포스부터 켜요' } },
      { id: QMN, unit_id: UNIT, entry_ids: [E[0]], kind: 't3', format: 'mine_tap',
        payload: { ask: '하면 안 되는 것을 모두 누르세요', explain: '시재는 만지지 않아요',
          cards: [{ text: '시재 임의 사용', is_mine: true }, { text: '머신 예열', is_mine: false },
                  { text: '금고 열어두기', is_mine: true }, { text: '문 열기', is_mine: false }] } },
    ]);
    check('⑦-1 사장 문항 2건 저장', !error, error?.message ?? ''); }
  { const { data, error } = await jA.from('quiz_items').select('id, payload');
    check('⑦-2 직원 직접 SELECT 차단(정답 노출 0행)', !error && (data?.length ?? 0) === 0, `n=${data?.length ?? 0} ${error?.message ?? ''}`); }
  { const { data } = await owner.from('quiz_items').select('id');
    check('⑦-3 사장은 문항 열람(편집용)', (data?.length ?? 0) === 2, `n=${data?.length}`); }

  const { data: forAttempt, error: fae } = await jA.rpc('quiz_items_for', { p_entry_ids: [E[0]], p_limit: 10 });
  check('⑦-4 직원 응시 조회(quiz_items_for) 2문항', !fae && (forAttempt?.length ?? 0) === 2, `n=${forAttempt?.length} ${fae?.message ?? ''}`);
  const qById = Object.fromEntries((forAttempt ?? []).map((x) => [x.id, x]));
  const leakedIn = (rows) => (rows ?? []).filter((x) => {
    const p = x.payload ?? {};
    if ('answer_index' in p || 'wrong_index' in p || 'target' in p || 'explain' in p || 'pairs' in p) return true;
    return Array.isArray(p.cards) && p.cards.some((c) => 'is_mine' in c || 'answer' in c);
  });
  { const leaked = leakedIn(forAttempt);
    check('⑦-5 응시 payload 에 정답 키 0개', leaked.length === 0, leaked.map((x) => `${x.id}:${JSON.stringify(x.payload)}`).join(' | ')); }
  // ⑦-6·⑦-7(match_line 분해·셔플 안정)은 t4 폐기와 함께 삭제.

  const grade = async (id, res) => {
    const { data, error } = await jA.rpc('grade_quiz', { p_item_id: id, p_response: res });
    return { row: Array.isArray(data) ? data[0] : data, error };
  };
  { const { row } = await grade(QMC, 1);
    check('⑦-8 mc4 정답 → correct · answer 는 안 알려줌', row?.correct === true && (row?.answer ?? null) === null, JSON.stringify(row)); }
  { const { row } = await grade(QMC, 0);
    check('⑦-9 mc4 오답 → 정답 공개 + explain', row?.correct === false && Number(row?.answer) === 1 && !!row?.explain, JSON.stringify(row)); }
  { const { row } = await grade(QMN, [2, 0]);
    check('⑦-10 mine_tap 집합 일치(순서 무관) → 정답', row?.correct === true, JSON.stringify(row)); }
  { const { row } = await grade(QMN, [0]);
    check('⑦-11 mine_tap 부분 선택은 오답(부분점수 없음)', row?.correct === false, JSON.stringify(row)); }
  { const { row } = await grade(QMN, [0, 1, 2, 3]);
    check('⑦-12 mine_tap 전부 찍기도 오답', row?.correct === false, JSON.stringify(row)); }
  // ⑦-13·⑦-14(match_line 좌표계 채점)는 t4 폐기와 함께 삭제.
  { await owner.from('quiz_items').insert({ id: QBAD, unit_id: UNIT, entry_ids: [E[0]], kind: 't0', format: 'bogus_format', payload: { ask: 'x' } });
    const { error } = await jA.rpc('grade_quiz', { p_item_id: QBAD, p_response: 0 });
    check('⑦-15 모르는 형태는 조용한 오답이 아니라 예외', !!error && /unknown_quiz_format/.test(error?.message ?? ''), error?.message ?? '(예외 없음!)'); }
  { const { error } = await jA.from('quiz_items').update({ payload: { ask: 'hacked' } }).eq('id', QMC);
    const { data: still } = await owner.from('quiz_items').select('payload').eq('id', QMC).maybeSingle();
    check('⑦-16 직원 문항 수정 차단', still?.payload?.ask === '오픈 때 가장 먼저 할 일은?', error?.code ?? ''); }
  { const { data } = await jA.rpc('quiz_item_counts');
    const row = (data ?? []).find((x) => x.entry_id === E[0]);
    // bogus_format 은 quiz_known_formats 밖이라 세지 않는다(응시에서도 fail-closed 로 빠진다).
    check('⑦-17 문항 개수 RPC 는 아는 형태만 센다(0109)', row?.n === 2, `n=${row?.n}`); }

  // ── ⑧ 문항 낡음 스냅샷(0114) ─────────────────────────────────────────────
  console.log('\n━━ ⑧ 문항 낡음(0114) ━━');
  { const { data } = await owner.from('quiz_items').select('source_updated_at').eq('id', QMC).maybeSingle();
    check('⑧-1 저장 시 근거 노하우 updated_at 이 트리거로 찍힌다', !!data?.source_updated_at, `v=${data?.source_updated_at}`); }
  { const later = new Date(Date.now() + 60_000).toISOString();
    await owner.from('playbook_entries').update({ updated_at: later }).eq('id', E[0]);
    const { data: q } = await owner.from('quiz_items').select('source_updated_at').eq('id', QMC).maybeSingle();
    check('⑧-2 노하우를 고쳐도 스냅샷은 그대로(=낡음 감지 가능)', Date.parse(q?.source_updated_at) < Date.parse(later), `snap=${q?.source_updated_at} now=${later}`); }
  { const { data: before } = await owner.from('quiz_items').select('source_updated_at').eq('id', QMC).maybeSingle();
    await owner.from('quiz_items').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', QMC);
    const { data: after } = await owner.from('quiz_items').select('source_updated_at').eq('id', QMC).maybeSingle();
    check('⑧-3 보관 토글은 스냅샷을 건드리지 않는다(발화 컬럼 아님)', before?.source_updated_at === after?.source_updated_at, `${before?.source_updated_at} vs ${after?.source_updated_at}`);
    await owner.from('quiz_items').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', QMC); }
  { await owner.from('quiz_items').update({ payload: { ask: '오픈 때 가장 먼저 할 일은?', choices: ['바닥 청소', '포스 켜기', '퇴근'], answer_index: 1, explain: '포스부터 켜요(수정)' } }).eq('id', QMC);
    const { data: q } = await owner.from('quiz_items').select('source_updated_at').eq('id', QMC).maybeSingle();
    const { data: e } = await owner.from('playbook_entries').select('updated_at').eq('id', E[0]).maybeSingle();
    check('⑧-4 문항을 고치면(=검수) 스냅샷 갱신 → 낡음 해제', Date.parse(q?.source_updated_at) >= Date.parse(e?.updated_at), `snap=${q?.source_updated_at} entry=${e?.updated_at}`); }

  // ── ⑨ 응시 단위 점수(0112) ───────────────────────────────────────────────
  console.log('\n━━ ⑨ 응시 점수(0112) ━━');
  { const { error } = await jA.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: E[0], staff_id: jAId, total: 3, correct: 2 });
    check('⑨-1 직원 본인 응시 기록', !error, error?.message ?? ''); }
  { const { error } = await jA.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: E[0], staff_id: ownerId, total: 3, correct: 3 });
    check('⑨-2 남의 명의 응시 기록 차단(WITH CHECK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { error } = await jA.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: E[0], staff_id: jAId, guest_name: '둘다', total: 1, correct: 1 });
    check('⑨-3 직원+손님 동시 기입 차단(check)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { error } = await jA.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: E[0], staff_id: jAId, total: 2, correct: 5 });
    check('⑨-4 맞은 개수 > 전체 차단(check)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { data } = await owner.from('quiz_attempts').select('entry_id, staff_id, total, correct');
    check('⑨-5 사장은 매장 전체 응시 열람', (data ?? []).some((a) => a.staff_id === jAId && a.total === 3 && a.correct === 2), `n=${data?.length}`); }
  {
    // 직원끼리는 서로 못 본다 — 사장 명의 기록을 admin 으로 심고 직원 시야에서 빠지는지 본다.
    await admin.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: E[1], staff_id: ownerId, total: 4, correct: 4 });
    const { data } = await jA.from('quiz_attempts').select('staff_id');
    check('⑨-6 직원은 본인 것만 열람(상호 비교 노출 회피)', (data ?? []).every((a) => a.staff_id === jAId), `n=${data?.length}`);
  }

  // ── ⑩ 외부 공유 링크(0113) — 로그인 없이 도는 유일한 경로 ─────────────────
  console.log('\n━━ ⑩ 외부 링크(0113) ━━');
  const g = guest();
  // ★토큰은 20자 이상이어야 한다(0113 quiz_links_token_len) — QA 토큰도 그 규칙을 지킨다.
  const TOK = `qa_token_ok_${s}`, TOK_EXP = `qa_token_exp_${s}`, TOK_REV = `qa_token_rev_${s}`;
  const plus = (ms) => new Date(Date.now() + ms).toISOString();
  { const { error } = await owner.from('quiz_links').insert([
      { id: `ql1_${s}`, unit_id: UNIT, course_id: CF, token: TOK, expires_at: plus(3 * 24 * 3600 * 1000) },
      { id: `ql2_${s}`, unit_id: UNIT, course_id: CF, token: TOK_EXP, expires_at: plus(-1000) },
      { id: `ql3_${s}`, unit_id: UNIT, course_id: CF, token: TOK_REV, expires_at: plus(3 * 24 * 3600 * 1000), revoked_at: new Date().toISOString() },
    ]);
    check('⑩-1 사장 링크 3건 생성(정상·만료·회수)', !error, error?.message ?? ''); }
  { const { data } = await jA.from('quiz_links').select('id');
    check('⑩-2 직원은 링크 열람 불가(관리 권한만)', (data ?? []).length === 0, `n=${data?.length}`); }
  { const { data } = await g.from('quiz_links').select('id');
    check('⑩-3 손님은 테이블 직접 접근 0행', (data ?? []).length === 0, `n=${data?.length}`); }
  { const { data } = await g.rpc('quiz_link_open', { p_token: TOK });
    const row = Array.isArray(data) ? data[0] : data;
    check('⑩-4 손님이 링크 열기(매장·코스·문항수)', row?.ok === true && !!row?.store_name && row?.course_name === '첫 출근' && row?.item_count >= 1, JSON.stringify(row)); }
  { const { data } = await g.rpc('quiz_link_open', { p_token: TOK_EXP });
    const row = Array.isArray(data) ? data[0] : data;
    check('⑩-5 만료 링크는 ok=false(사유를 구분해 말하지 않는다)', row?.ok === false, JSON.stringify(row)); }
  { const { data } = await g.rpc('quiz_link_open', { p_token: TOK_REV });
    const row = Array.isArray(data) ? data[0] : data;
    check('⑩-6 회수 링크도 ok=false', row?.ok === false, JSON.stringify(row)); }
  { const { data } = await g.rpc('quiz_link_items', { p_token: TOK_EXP, p_limit: 10 });
    check('⑩-7 ★만료 링크는 문항을 한 건도 안 내준다', (data ?? []).length === 0, `n=${data?.length}`); }
  let guestItems = [];
  { const { data, error } = await g.rpc('quiz_link_items', { p_token: TOK, p_limit: 10 });
    guestItems = data ?? [];
    check('⑩-8 손님 응시 조회 성공', !error && guestItems.length >= 1, `n=${guestItems.length} ${error?.message ?? ''}`); }
  { const leaked = leakedIn(guestItems);
    check('⑩-9 ★손님 payload 에도 정답 키 0개(0107 그대로)', leaked.length === 0, leaked.map((x) => x.id).join(',')); }
  { const { data } = await g.rpc('quiz_link_grade', { p_token: TOK, p_item_id: QMC, p_response: 1 });
    const row = Array.isArray(data) ? data[0] : data;
    check('⑩-10 손님 채점은 서버가 한다(정답이면 answer 안 알려줌)', row?.correct === true && (row?.answer ?? null) === null, JSON.stringify(row)); }
  { const { error } = await g.rpc('quiz_link_grade', { p_token: TOK_EXP, p_item_id: QMC, p_response: 1 });
    check('⑩-11 만료 링크로 채점 시도 → 예외', !!error && /link_unavailable/.test(error?.message ?? ''), error?.message ?? '(예외 없음!)'); }
  {
    // ★코스 밖 문항을 토큰으로 찍어보는 것 차단 — 열려 있으면 오답 응답으로 정답을 뽑아낼 수 있다.
    const OUT = `qi_out_${s}`;
    await owner.from('quiz_items').insert({ id: OUT, unit_id: UNIT, entry_ids: [E[3]], kind: 't0', format: 'mc4',
      payload: { ask: '정기 점검 문항', choices: ['a', 'b'], answer_index: 0, explain: 'x' } });
    const { error } = await g.rpc('quiz_link_grade', { p_token: TOK, p_item_id: OUT, p_response: 0 });
    check('⑩-12 ★그 코스에 없는 문항은 토큰으로 채점 불가', !!error && /item_not_found/.test(error?.message ?? ''), error?.message ?? '(뚫림!)');
  }
  { const { data, error } = await g.rpc('quiz_link_submit', { p_token: TOK, p_guest_name: '단기김', p_rows: [{ entry_id: E[0], total: 3, correct: 2 }] });
    check('⑩-13 손님 결과 기록(guest_name)', !error && data === 1, `n=${data} ${error?.message ?? ''}`); }
  { const { data } = await owner.from('quiz_attempts').select('guest_name, staff_id, total, correct').eq('entry_id', E[0]);
    check('⑩-14 사장 화면에 이름으로 보인다(staff_id=null)', (data ?? []).some((a) => a.guest_name === '단기김' && a.staff_id === null && a.total === 3 && a.correct === 2), JSON.stringify(data)); }
  { const { error } = await g.rpc('quiz_link_submit', { p_token: TOK, p_guest_name: '  ', p_rows: [{ entry_id: E[0], total: 1, correct: 1 }] });
    check('⑩-15 이름 없이 제출 차단', !!error && /name_required/.test(error?.message ?? ''), error?.message ?? '(차단 안됨!)'); }
  { const { data } = await g.rpc('quiz_link_submit', { p_token: TOK, p_guest_name: '침입자', p_rows: [{ entry_id: E[3], total: 1, correct: 1 }] });
    check('⑩-16 ★코스 밖 노하우에 점수 심기 차단(0행)', data === 0, `n=${data}`); }
  { const { error } = await owner.from('quiz_links').update({ revoked_at: new Date().toISOString() }).eq('token', TOK).select('id');
    const { data } = await g.rpc('quiz_link_items', { p_token: TOK, p_limit: 10 });
    check('⑩-17 회수하면 즉시 닫힌다', !error && (data ?? []).length === 0, `n=${data?.length}`); }

  // ── ⑪ 껍데기 업무 숨김(0110) ─────────────────────────────────────────────
  console.log('\n━━ ⑪ 껍데기 업무 숨김(0110) ━━');
  const SHELL = `t_shell_${s}`;
  { const { error } = await owner.from('work_templates').insert({ id: SHELL, unit_id: UNIT, section: 'etc', text: '옛 퀴즈 업무', scope: 'shared', created_at: now });
    const { data } = await owner.from('work_templates').select('hidden').eq('id', SHELL).maybeSingle();
    check('⑪-1 기본값 false — 기존 할일 판정이 안 바뀐다', !error && data?.hidden === false, `hidden=${data?.hidden}`); }
  { const { data } = await owner.from('work_templates').update({ hidden: true }).eq('id', SHELL).select('id');
    const { data: row } = await owner.from('work_templates').select('hidden').eq('id', SHELL).maybeSingle();
    check('⑪-2 숨기기', (data?.length ?? 0) === 1 && row?.hidden === true); }
  { const { data: row } = await jA.from('work_templates').select('id, hidden').eq('id', SHELL).maybeSingle();
    check('⑪-3 숨겨도 행은 남는다(지운 게 아니다 · 직원도 조회는 됨)', !!row && row.hidden === true, JSON.stringify(row)); }
  { const { data } = await owner.from('work_templates').update({ hidden: false }).eq('id', SHELL).select('id');
    const { data: row } = await owner.from('work_templates').select('hidden').eq('id', SHELL).maybeSingle();
    check('⑪-4 되돌리기(숨김 해제)', (data?.length ?? 0) === 1 && row?.hidden === false); }

  // ── ⑫ cascade: 노하우 삭제 → 코스 항목·통과 기록 소멸 / 코스 삭제 → 그 코스 항목만 ──
  console.log('\n━━ ⑫ cascade ━━');
  { await owner.from('playbook_entries').delete().eq('id', E[2]);
    const { data: ce } = await owner.from('course_entries').select('entry_id');
    const { data: ku } = await owner.from('knowhow_understanding').select('entry_id');
    check('⑫-1 노하우 삭제 → 코스 항목·통과 기록 cascade',
      !(ce ?? []).some((x) => x.entry_id === E[2]) && !(ku ?? []).some((x) => x.entry_id === E[2]), `ce=${ce?.length} ku=${ku?.length}`); }
  { await owner.from('training_courses').delete().eq('id', CS);
    const { data: rows } = await owner.from('course_entries').select('entry_id, course_id');
    const { data: entry } = await owner.from('playbook_entries').select('id').eq('id', E[0]).maybeSingle();
    check('⑫-2 코스 삭제 → 그 코스 항목만 소멸(노하우·타 코스 소속은 유지)',
      !(rows ?? []).some((x) => x.course_id === CS) && (rows ?? []).some((x) => x.course_id === CF && x.entry_id === E[0]) && !!entry,
      `n=${rows?.length}`); }
  { const { data: links } = await owner.from('quiz_links').select('id').eq('course_id', CS);
    check('⑫-3 코스 삭제 → 그 코스 링크도 소멸', (links ?? []).length === 0, `n=${links?.length}`); }

  // ── ⑬ 크로스테넌트 — 참조 id 는 FK 라 '존재'만 검사한다. '소유'까지 막히는지 실증 ──────────
  // 공격 모양: 내 unit_id 를 달고 **남의 매장 노하우/코스 id** 를 참조하는 행을 만든다.
  // 그대로 통과하면 definer 조인(my_training_history 등)이 그 행을 신뢰해 남의 제목이 새어 나간다.
  console.log('\n━━ ⑬ 크로스테넌트(참조 소유 검사) ━━');
  const { data: c2, error: c2e } = await owner.rpc('create_store', { p_store_name: 'TR 두번째매장', p_industry: '카페·디저트', p_biz_no: null });
  const UNIT_B = c2?.[0]?.unit_id;
  check('⑬-0 두 번째 매장 생성(격리 상대)', !c2e && !!UNIT_B, c2e?.message ?? `unit=${UNIT_B}`);
  const E_B = `pb_b_${s}`;
  const CB = `tc_b_${s}`;
  if (UNIT_B) {
    await admin.rpc('admin_activate_store', { p_unit_id: UNIT_B, p_days: 1, p_plan: 'multi' });
    // B 의 노하우·코스는 admin(서비스롤)으로 심는다 — 활성 매장을 A 로 둔 채 공격해야 의미가 있다.
    await admin.from('playbook_entries').insert({ ...mkEntry(E_B, 'B매장 비밀 레시피', '이건 B매장만 아는 방법이에요.'), unit_id: UNIT_B });
    await admin.from('training_courses').insert({ id: CB, unit_id: UNIT_B, key: 'first_day', name: 'B 첫 출근', min_items: 1, max_items: 5, position: 0 });
    // ★★활성 매장을 A 로 되돌린다. create_store 가 활성을 B 로 옮겨 놓으면 아래 공격들이
    //   "소유 검사에 막힌 것"이 아니라 "활성 매장이 달라서 막힌 것"이 되어 **테스트가 거짓 통과**한다.
    //   (owner 시점 공격의 전제 = 공격자가 A 를 활성으로 두고 B 의 id 를 쓴다.)
    await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  { const { data } = await owner.from('training_courses').select('id').eq('id', CF).maybeSingle();
    check('⑬-0b 활성 매장이 A 로 돌아왔다(아래 공격의 전제)', !!data, data ? '' : '(활성이 B 다 — 아래 결과는 무효)'); }
  { const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CF, entry_id: E_B, position: 9 });
    check('⑬-1 남의 매장 노하우를 내 코스에 담기 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(뚫림!)'); }
  { const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CB, entry_id: E[0], position: 9 });
    check('⑬-2 남의 매장 코스에 내 노하우 담기 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(뚫림!)'); }
  { const { error } = await jA.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: E_B, staff_name: 'QA직원' }).select('entry_id');
    check('⑬-3 ★남의 매장 노하우로 통과 기록 만들기 차단(제목 유출 경로)', !!error, error ? `거부 ${error.code ?? ''}` : '(뚫림!)'); }
  { const { error } = await jA.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: E_B, staff_id: jAId, total: 1, correct: 1 });
    check('⑬-4 남의 매장 노하우에 응시 점수 심기 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(뚫림!)'); }
  { const { error } = await owner.from('quiz_links').insert({ id: `qlx_${s}`, unit_id: UNIT, course_id: CB, token: `qa_x_${s}_padpadpad`, expires_at: plus(3600_000) });
    check('⑬-5 남의 매장 코스로 링크 만들기 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(뚫림!)'); }
  { const { error } = await owner.from('quiz_links').insert({ id: `qls_${s}`, unit_id: UNIT, course_id: CF, token: 'short', expires_at: plus(3600_000) });
    check('⑬-6 짧은 토큰 거부(추측 가능한 열쇠 차단)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  {
    // definer RPC 2중 방어 — 통과 행이 어떻게든 들어와도 남의 제목은 안 돌려준다.
    await admin.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: E_B, staff_id: jAId, staff_name: 'QA직원' });
    const { data: hist } = await jA.rpc('my_training_history');
    const row = (hist ?? []).find((h) => h.entry_id === E_B);
    check('⑬-7 ★definer 이력 RPC 가 남의 노하우 제목을 안 흘린다', !row || row.entry_title === '삭제된 노하우', JSON.stringify(row));
    await admin.from('knowhow_understanding').delete().eq('entry_id', E_B).eq('staff_id', jAId);
  }
  { const { data } = await jA.from('playbook_entries').select('id').eq('id', E_B);
    check('⑬-8 직원이 남의 매장 노하우 직접 조회 0행(기존 격리 회귀 없음)', (data ?? []).length === 0, `n=${data?.length}`); }

  await cleanupSeededPhones(URL_, SRV, qaPhones);
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 퀴즈 노하우축(0107~0114) QA · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
