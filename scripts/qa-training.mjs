// 훈련 코스(0099, 첫 훈련 + 정기 훈련) QA — 사장 코스 구성(문답/기존 노하우·순서·빼기)과
// 직원 카드(순서·통과·정기 재확인 verified_at 갱신)를 실 백엔드로 재현하고 RLS 경계를 검증한다.
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
  { const { error } = await owner.from('training_items').upsert([
      { unit_id: UNIT, template_id: T[0], course: 'first_day', position: 0 },
      { unit_id: UNIT, template_id: T[1], course: 'first_day', position: 1 },
      { unit_id: UNIT, template_id: T[2], course: 'first_day', position: 2 },
      { unit_id: UNIT, template_id: T[3], course: 'regular', position: 0 },
    ], { onConflict: 'template_id', ignoreDuplicates: true });
    check('①-4 코스 등록(첫 3 + 정기 1)', !error, error?.message ?? ''); }
  { const { error } = await owner.from('training_items').insert({ unit_id: UNIT, template_id: T[0], course: 'regular', position: 5 });
    check('①-5 같은 업무 이중 등록 차단(PK)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { error } = await owner.from('training_items').insert({ unit_id: UNIT, template_id: T[1], course: 'weekly', position: 9 });
    check('①-6 미정의 코스명 차단(check)', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }

  // ── ② 순서 변경(ti_update) + 코스에서 빼기 ───────────────────────────────
  console.log('\n━━ ② 수정(순서·빼기) ━━');
  // 사장 스왑: T0(0) ↔ T1(1)
  await owner.from('training_items').update({ position: 1 }).eq('template_id', T[0]);
  await owner.from('training_items').update({ position: 0 }).eq('template_id', T[1]);
  const { data: afterSwap } = await owner.from('training_items').select('template_id, position').eq('course', 'first_day').order('position');
  check('②-1 사장 순서 스왑(ti_update)', afterSwap?.[0]?.template_id === T[1] && afterSwap?.[1]?.template_id === T[0]);
  // 되돌리기(이후 검증은 원래 순서 기준)
  await owner.from('training_items').update({ position: 0 }).eq('template_id', T[0]);
  await owner.from('training_items').update({ position: 1 }).eq('template_id', T[1]);
  // 빼기: 정기에서 T3 제거 → 업무·노하우는 남아야 함
  { const { error } = await owner.from('training_items').delete().eq('template_id', T[3]);
    check('②-2 코스에서 빼기', !error, error?.message ?? ''); }
  const { data: tmplLeft } = await owner.from('work_templates').select('id').eq('id', T[3]).maybeSingle();
  const { data: entryLeft } = await owner.from('playbook_entries').select('id').eq('id', E[3]).maybeSingle();
  check('②-3 빼도 업무·노하우는 남음', !!tmplLeft && !!entryLeft);
  // 정기 재등록(이후 정기 due 검증에 사용)
  await owner.from('training_items').upsert([{ unit_id: UNIT, template_id: T[3], course: 'regular', position: 0 }], { onConflict: 'template_id', ignoreDuplicates: true });

  // ── ③ RLS 경계: 직원 조작 차단 ───────────────────────────────────────────
  console.log('\n━━ ③ RLS 경계 ━━');
  { const { error } = await jA.from('training_items').insert({ unit_id: UNIT, template_id: T[0], course: 'first_day', position: 9 }).select('template_id');
    check('③-1 직원 코스 등록 차단', !!error, error ? `거부 ${error.code ?? ''}` : '(차단 안됨!)'); }
  { const { data } = await jA.from('training_items').update({ position: 9 }).eq('template_id', T[0]).select('template_id');
    check('③-2 직원 순서 변경 차단(0행)', (data?.length ?? 0) === 0, `n=${data?.length}`); }
  { await jA.from('training_items').delete().eq('template_id', T[0]);
    const { data: still } = await owner.from('training_items').select('template_id').eq('template_id', T[0]).maybeSingle();
    check('③-3 직원 코스 삭제 차단', !!still); }
  const { data: jItems } = await jA.from('training_items').select('template_id, course, position').order('position');
  check('③-4 직원 코스 열람은 허용(첫3+정기1)', (jItems?.length ?? 0) === 4, `n=${jItems?.length}`);

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

  // ── ⑤ cascade: 업무 삭제 → 코스 항목 소멸 ────────────────────────────────
  console.log('\n━━ ⑤ cascade ━━');
  await owner.from('work_templates').delete().eq('id', T[2]);
  const { data: afterDel } = await owner.from('training_items').select('template_id');
  check('⑤-1 업무 삭제 시 코스 항목 cascade', !(afterDel ?? []).some((i) => i.template_id === T[2]), `n=${afterDel?.length}`);

  await cleanupSeededPhones(URL_, SRV, qaPhones);
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 훈련 코스(0099) QA · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
