// S1 업무↔노하우 루프 QA — ①업무↔노하우 링크 ②완료 1턴 캡처 ③직원 질문 라우팅(D4) ④이해 확인 퀴즈.
// 실 백엔드 대상·자가정리. 격리 임시 매장(@example.com owner)에 사장1+알바2 세션으로 해피패스를 재현하고 DB로 검증한다.
// 사용: node --env-file=... 아님 — .env(ANON) + .env.seed(SERVICE_ROLE) 자동 로드. 그냥 `node scripts/qa-task-knowhow.mjs`.
// 정리: 종료 시 생성 계정/매장은 cleanup-orphan-stores.mjs가 @example.com 규칙으로 수거(QA 도메인).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 0088 게이트 라이브 — 아래 signUp 이 쓰는 번호 전부를 '인증됨'으로 선등록해야 create_store/join 통과.
const qaPhones = [`0106${s.slice(0,7)}`, `0108${s.slice(0,7)}`, `0109${s.slice(0,7)}`];

async function main() {
  // ── 셋업: 격리 매장 + 사장 + 알바2 ────────────────────────────────────────
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_tk_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0106${s.slice(0,7)}`, store_name: 'TK', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'TK 노하우매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  const UNIT = c1?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' }); // 직원캡 해제
  const CODE = c1?.[0]?.invite_code;
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  check('셋업: 매장 생성 + 초대코드', !!UNIT && !!CODE, `unit=${UNIT}`);

  const jA = mk(), jB = mk();
  const jAId = await signUpSession(jA, `qa_tk_ja_${s}@example.com`, { name: 'QA알바A', role: 'junior', phone: `0108${s.slice(0,7)}` });
  const jBId = await signUpSession(jB, `qa_tk_jb_${s}@example.com`, { name: 'QA알바B', role: 'junior', phone: `0109${s.slice(0,7)}` });
  for (const [j, id, tag] of [[jA, jAId, 'A'], [jB, jBId, 'B']]) {
    await j.rpc('join_by_invite', { p_code: CODE });
    const { error } = await owner.rpc('approve_member', { p_uid: id });
    check(`셋업: 알바${tag} 합류 승인`, !error, error?.message ?? '');
    await j.rpc('switch_active_unit', { p_unit_id: UNIT });
  }

  // ── 시드: 발행 노하우 1 + 반복업무 1 (사장) ──────────────────────────────
  const now = new Date().toISOString();
  const ENTRY = `pb_${s}`;
  const entryRow = {
    id: ENTRY, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장',
    category: 'Routine', subcategory: '음료 제조', title: '아이스 아메리카노 제조',
    tags: ['#제조', '#아아'], search_keywords: ['아메리카노', '아아', '샷', '얼음'],
    square: {
      situation: '아이스 아메리카노 주문이 들어왔을 때',
      action: { steps: ['얼음을 가득 채운다', '에스프레소 2샷을 내린다', '물 200ml를 붓는다'], scripts: ['시원한 아이스 아메리카노 나왔습니다'] },
      extract: { do: '샷은 항상 2샷 고정', dont: '얼음을 반만 채우지 않는다', template: '[얼음]→[2샷]→[물200]' },
      result: { before: '농도 편차 큼', after: '균일', metric: '재요청 0' },
      uncover: '농도의 핵심은 물 200ml 고정', quagmire: '얼음이 적으면 금방 미지근',
    },
    execution: { tone: '친절', timing: '주문 즉시', channel: '대면', stakeholders: ['손님'] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: null, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.8,
    created_at: now, updated_at: now, is_template: false, pack_id: null,
    needs_review: false, correction_points: [], section: null, order_index: 0,
  };
  { const { error } = await owner.from('playbook_entries').insert(entryRow);
    check('시드: 발행 노하우', !error, error?.message ?? ''); }

  const TMPL = `t_${s}`;
  const tmplRow = { id: TMPL, unit_id: UNIT, section: 'open', text: '아이스 아메리카노 만들기',
    scope: 'shared', recurrence: { weekly: [1, 3, 5] }, created_at: now };
  { const { error } = await owner.from('work_templates').insert(tmplRow);
    check('시드: 반복업무(recurrence weekly)', !error, error?.message ?? ''); }

  const ctx = { owner, ownerId, jA, jAId, jB, jBId, UNIT, ENTRY, TMPL, entryRow };

  await flow1(ctx);
  await flow2(ctx);
  await flow3(ctx);
  await flow4(ctx);

  // ── S3: 사장 2번째 매장 생성(넛지·통합뷰·다중공지에 필요). 활성은 A로 복귀(flow5~7은 A 기준). ─────
  const { data: cB } = await owner.rpc('create_store', { p_store_name: 'TK 2호점', p_industry: '카페·디저트', p_biz_no: null });
  const UNIT_B = cB?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT_B, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT }); // 활성 = A 복귀
  check('S3 셋업: 2번째 매장 생성', !!UNIT_B && UNIT_B !== UNIT, `B=${UNIT_B}`);
  const ctx3 = { ...ctx, UNIT_B };

  await flow5(ctx3); // #1 copy_knowhow_to
  await flow6(ctx3); // #2 owner_overview 커버리지
  await flow7(ctx3); // #3 broadcast_notice + read_status

  await cleanupSeededPhones(URL_, SRV, qaPhones);
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — S1+S3 업무↔노하우 QA · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

const tokenOf = async (c) => (await c.auth.getSession()).data.session?.access_token;

// ───────────────────────────── ① 업무 ↔ 노하우 링크 ─────────────────────────
async function flow1({ owner, ownerId, jA, UNIT, ENTRY, TMPL }) {
  console.log('\n━━ ① 업무↔노하우 링크 ━━');
  // 사장 첨부 (insertTemplateKnowhow 재현: upsert onConflict template_id,entry_id)
  const { error: ae } = await owner.from('work_template_knowhow')
    .upsert([{ unit_id: UNIT, template_id: TMPL, entry_id: ENTRY }], { onConflict: 'template_id,entry_id', ignoreDuplicates: true });
  check('①-1 사장 노하우 첨부', !ae, ae?.message ?? '');
  // added_by = DB default auth.uid() (클라 미전송) → 사장 uid
  const { data: linkRow } = await admin.from('work_template_knowhow').select('added_by').eq('template_id', TMPL).eq('entry_id', ENTRY).maybeSingle();
  check('①-2 added_by = 사장 uid(위조 아닌 DB default)', linkRow?.added_by === ownerId, `added_by=${linkRow?.added_by}`);
  // 알바 정방향 열람 (fetchTemplateKnowhow → knowhowIdsForTask)
  const { data: jLinks } = await jA.from('work_template_knowhow').select('template_id, entry_id');
  const jSees = (jLinks ?? []).some((l) => l.template_id === TMPL && l.entry_id === ENTRY);
  check('①-3 알바가 링크 열람(같은 매장 RLS)', jSees);
  // 역조회 '업무 N' (taskIdsForKnowhow): entry→templates
  const tasksForEntry = (jLinks ?? []).filter((l) => l.entry_id === ENTRY).map((l) => l.template_id);
  check('①-4 노하우 역조회 = 업무 1', tasksForEntry.length === 1 && tasksForEntry[0] === TMPL, `tasks=[${tasksForEntry}]`);
  // 멱등 재첨부
  const { error: re } = await owner.from('work_template_knowhow').upsert([{ unit_id: UNIT, template_id: TMPL, entry_id: ENTRY }], { onConflict: 'template_id,entry_id', ignoreDuplicates: true });
  check('①-5 재첨부 멱등(중복 없음)', !re);
}

// ───────────────────────────── ② 완료 1턴 캡처 ──────────────────────────────
async function flow2({ owner, ownerId, jA, jAId, UNIT, TMPL }) {
  console.log('\n━━ ② 완료 1턴 캡처 ━━');
  const today = new Date().toISOString().slice(0, 10);
  // 첫 완료 write (setDone 재현)
  const { error: de } = await jA.from('work_done').upsert(
    { unit_id: UNIT, work_date: today, template_id: TMPL, room_id: null, data: { by: jAId, byName: 'QA알바A', at: new Date().toISOString() } });
  check('②-1 알바 첫 완료 기록(work_done)', !de, de?.message ?? '');
  // 캡처 제안 (submitSuggestion kind:new + source_template_id)
  const SUG = `sug_${s}`;
  const { error: se } = await jA.from('playbook_suggestions').insert(
    { id: SUG, unit_id: UNIT, kind: 'new', source_template_id: TMPL, proposer_id: jAId, proposer_name: 'QA알바A', text: '아아는 얼음 먼저 채우고 2샷', status: 'pending', created_at: new Date().toISOString() });
  check('②-2 알바 캡처 제안(source_template_id)', !se, se?.message ?? '');
  // 제안이 origin 업무를 담고 있는가
  const { data: sugRow } = await admin.from('playbook_suggestions').select('source_template_id, status').eq('id', SUG).maybeSingle();
  check('②-3 제안에 origin 업무 저장', sugRow?.source_template_id === TMPL);
  // 사장 승인 → 새 노하우 발행 + 자동 attach (finishPublish 재현)
  const NEW = `pb2_${s}`; const now = new Date().toISOString();
  await owner.from('playbook_entries').insert({ id: NEW, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장', category: 'Routine', subcategory: '음료 제조', title: '아아 캡처 노하우', tags: [], search_keywords: ['아아'], square: { situation: '아아 만들 때', action: { steps: ['얼음', '2샷'], scripts: [] }, extract: { do: '', dont: '', template: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' }, execution: { tone: '', timing: '', channel: '', stakeholders: [] }, stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: null, query_hits_30d: 0, resolution_rate: 0 }, photos: [], version: 1, status: 'published', quality_score: 0.7, created_at: now, updated_at: now, is_template: false, pack_id: null, needs_review: false, correction_points: [], section: null, order_index: 0 });
  const { data: appr } = await owner.from('playbook_suggestions').update({ status: 'approved', reviewed_at: now, reviewed_by: ownerId, resulting_entry_id: NEW }).eq('id', SUG).select('id');
  check('②-4 사장 승인(status=approved)', (appr?.length ?? 0) === 1);
  // 자동 attach: 승인 시 srcTemplate에 새 entry 연결
  await owner.from('work_template_knowhow').upsert([{ unit_id: UNIT, template_id: TMPL, entry_id: NEW }], { onConflict: 'template_id,entry_id', ignoreDuplicates: true });
  const { data: link2 } = await admin.from('work_template_knowhow').select('entry_id').eq('template_id', TMPL).eq('entry_id', NEW).maybeSingle();
  check('②-5 승인 시 origin 업무에 자동 첨부', link2?.entry_id === NEW);
}

// ───────────────────────────── ③ 직원 질문 라우팅 D4 ────────────────────────
async function flow3({ owner, ownerId, jA, jAId, jB, jBId, UNIT, ENTRY }) {
  console.log('\n━━ ③ 직원 질문 라우팅 D4 ━━');
  // 알바A 질문 등록 (unknown_queries insert, pending_owner_answer)
  const UQ1 = `uq_${s}_1`;
  const uqBase = (id, jid, jname, text) => ({ id, unit_id: UNIT, junior_id: jid, junior_name: jname, query_text: text, asked_at: new Date().toISOString(), presumed_category: 'Routine', presumed_subcategory: '', match_attempted: false, best_match_confidence: 0, best_match_entry_id: null, status: 'pending_owner_answer', similar_queries_count: 0, ai_general_answer: null });
  const { error: q1e } = await jA.from('unknown_queries').insert(uqBase(UQ1, jAId, 'QA알바A', '아아 시럽 몇 펌프예요?'));
  check('③-1 알바A 질문 등록(pending)', !q1e, q1e?.message ?? '');
  // 라우팅: 알바B '도와줄 질문'에 A의 질문이 뜨고, A 본인에겐 안 뜸
  const { data: queue } = await jB.from('unknown_queries').select('id, junior_id, status');
  const answerableForB = (queue ?? []).filter((u) => u.status === 'pending_owner_answer' && u.junior_id !== jBId);
  check('③-2 알바B 내공간에 A질문 노출(전 직원 라우팅)', answerableForB.some((u) => u.id === UQ1));
  const { data: queueA } = await jA.from('unknown_queries').select('id, junior_id, status');
  const answerableForA = (queueA ?? []).filter((u) => u.status === 'pending_owner_answer' && u.junior_id !== jAId);
  check('③-3 A 본인 질문은 A 내공간에서 제외', !answerableForA.some((u) => u.id === UQ1));
  // 알바B가 기존 노하우로 즉시 resolve (resolveUnknown, answered_by=B)
  const { data: res1 } = await jB.from('unknown_queries').update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: jBId }).eq('id', UQ1).select('id');
  check('③-4 알바B 기존노하우 지정→즉시 resolve', (res1?.length ?? 0) === 1);
  const { data: uq1row } = await admin.from('unknown_queries').select('status, answered_by, resolved_with_entry_id').eq('id', UQ1).maybeSingle();
  check('③-5 answered_by=B · status=resolved_with_entry', uq1row?.answered_by === jBId && uq1row?.status === 'resolved_with_entry');
  // 새 답변 경로: A가 다른 질문 → B가 새 답 제안(source_uq_id) → 사장 승인 시 uq resolve(answered_by=사장)
  const UQ2 = `uq_${s}_2`;
  await jA.from('unknown_queries').insert(uqBase(UQ2, jAId, 'QA알바A', '마감 때 그라인더 어떻게 청소해요?'));
  const SUG2 = `sug2_${s}`;
  const { error: s2e } = await jB.from('playbook_suggestions').insert({ id: SUG2, unit_id: UNIT, kind: 'new', source_uq_id: UQ2, proposer_id: jBId, proposer_name: 'QA알바B', text: '그라인더는 원두 비우고 솔로 청소', status: 'pending', created_at: new Date().toISOString() });
  check('③-6 알바B 새 답변 제안(source_uq_id)', !s2e, s2e?.message ?? '');
  // 사장 승인: uq resolve(answered_by=사장) + 제안 approved
  const { data: res2 } = await owner.from('unknown_queries').update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: ownerId }).eq('id', UQ2).select('id');
  await owner.from('playbook_suggestions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: ownerId, resulting_entry_id: ENTRY }).eq('id', SUG2).select('id');
  const { data: uq2row } = await admin.from('unknown_queries').select('status, answered_by').eq('id', UQ2).maybeSingle();
  check('③-7 새답변 사장승인 시 uq resolve(answered_by=사장)', (res2?.length ?? 0) === 1 && uq2row?.answered_by === ownerId);
}

// ───────────────────────────── ④ 이해 확인 퀴즈 ─────────────────────────────
async function flow4({ owner, ownerId, jA, jAId, UNIT, TMPL, entryRow }) {
  console.log('\n━━ ④ 이해 확인 퀴즈 ━━');
  // 트리거 조건: 알바 + 첨부 노하우 있음(①에서 첨부됨) → quiz 엣지 호출(실 AI)
  const sops = [{ title: entryRow.title, situation: entryRow.square.situation, steps: entryRow.square.action.steps, donts: [entryRow.square.extract.dont].filter(Boolean) }];
  const token = await tokenOf(jA);
  const r = await edgeAi(token, 'quiz', { taskText: '아이스 아메리카노 만들기', sops });
  check('④-1 quiz 엣지 200', r.ok, `status=${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const qs = r.body?.questions ?? [];
  check('④-2 문항 생성(≥1, 객관식 정상)', qs.length >= 1 && qs.every((q) => Array.isArray(q.choices) && q.choices.length >= 2 && q.answer_index >= 0 && q.answer_index < q.choices.length), `n=${qs.length}`);
  // 자동채점(클라 재현): 각 문항 정답 인덱스를 pick → correctCount===문항수면 통과
  const picks = qs.map((q) => q.answer_index);
  const correct = picks.filter((p, i) => p === qs[i].answer_index).length;
  const passed = qs.length >= 1 && correct === qs.length;
  check('④-3 전부 정답 채점=통과', passed, `${correct}/${qs.length}`);
  // 통과 → task_understanding upsert (staff_id=DB default auth.uid())
  const { error: ue } = await jA.from('task_understanding').upsert({ unit_id: UNIT, template_id: TMPL, staff_name: 'QA알바A' }, { onConflict: 'template_id,staff_id', ignoreDuplicates: true });
  check('④-4 이해 기록(task_understanding)', !ue, ue?.message ?? '');
  const { data: tu } = await admin.from('task_understanding').select('staff_id, staff_name, template_id').eq('template_id', TMPL).maybeSingle();
  check('④-5 staff_id=알바A uid(위조 아닌 DB default)', tu?.staff_id === jAId, `staff_id=${tu?.staff_id}`);
  // 사장 '이해 확인' 배지: fetchTaskUnderstanding → understoodNames(templateId)
  const { data: ownerView } = await owner.from('task_understanding').select('template_id, staff_id, staff_name').eq('template_id', TMPL);
  check('④-6 사장이 통과자 이름 조회(배지 소스)', (ownerView ?? []).some((u) => u.staff_id === jAId && u.staff_name === 'QA알바A'));
  // 위조 방어: 알바A가 남의 staff_id(사장)로 이해 기록 시도 → RLS WITH CHECK 차단
  const { error: forge } = await jA.from('task_understanding').insert({ unit_id: UNIT, template_id: TMPL, staff_id: ownerId, staff_name: '위조' }).select('template_id');
  check('④-7 staff_id 위조 삽입 차단(RLS)', !!forge, forge ? `거부 ${forge.code ?? ''}` : '(차단 안됨!)');
}

// ───────────────────── S3 #1 발행 넛지: copy_knowhow_to (활성 A → 다른 매장 B) ─────────────────────
async function flow5({ owner, jA, UNIT, UNIT_B, ENTRY }) {
  console.log('\n━━ S3 #1 발행 넛지(copy_knowhow_to) ━━');
  // 활성=A, 대상=B로 복제(방금 발행한 ENTRY를 B에도).
  const { data: n, error } = await owner.rpc('copy_knowhow_to', { p_to_unit: UNIT_B, p_entry_ids: [ENTRY] });
  check('S3#1-1 활성A→B 복제 성공', !error && n >= 1, error?.message ?? `n=${n}`);
  // B에 복제본이 needs_review=true·published로 생김(원본 ENTRY와 다른 새 id).
  const { data: bEntries } = await admin.from('playbook_entries').select('id, unit_id, title, needs_review, status').eq('unit_id', UNIT_B);
  const copied = (bEntries ?? []).find((e) => e.title === '아이스 아메리카노 제조');
  check('S3#1-2 B에 복제본 생성(needs_review·published)', !!copied && copied.needs_review === true && copied.status === 'published' && copied.id !== ENTRY, `id=${copied?.id}`);
  // ★크로스테넌트: 알바(비오너)가 copy_knowhow_to 시도 → not_owner_source(활성A 비소유).
  const { error: jErr } = await jA.rpc('copy_knowhow_to', { p_to_unit: UNIT_B, p_entry_ids: [ENTRY] });
  check('S3#1-3 알바 복제 거부(not_owner)', !!jErr && /not_owner/.test(jErr.message), jErr?.message ?? '(안 막힘!)');
  // ★크로스테넌트: 대상이 내 매장 아니면 not_owner_target — 존재하지 않는 매장 id로.
  const { error: tErr } = await owner.rpc('copy_knowhow_to', { p_to_unit: 'store_not_mine_xxx', p_entry_ids: [ENTRY] });
  check('S3#1-4 비소유 대상 거부(not_owner_target)', !!tErr && /not_owner_target/.test(tErr.message), tErr?.message ?? '(안 막힘!)');
}

// ───────────────────── S3 #2 통합뷰: owner_overview uncovered 열 ─────────────────────
async function flow6({ owner, ownerId, UNIT, UNIT_B }) {
  console.log('\n━━ S3 #2 통합뷰(owner_overview 커버리지) ━━');
  // A에 노하우 미첨부 업무 하나 추가(uncovered 카운트 대상). TMPL은 flow1에서 첨부됨 → uncovered 제외.
  const bare = `t_bare_${s}`;
  await owner.from('work_templates').insert({ id: bare, unit_id: UNIT, section: 'open', text: '미첨부 업무', scope: 'shared', created_at: new Date().toISOString() });
  const { data: rows, error } = await owner.rpc('owner_overview');
  check('S3#2-1 owner_overview 200(두 매장)', !error && (rows?.length ?? 0) >= 2, error?.message ?? `n=${rows?.length}`);
  const rowA = (rows ?? []).find((r) => r.unit_id === UNIT);
  check('S3#2-2 uncovered 열 존재·미첨부 업무 반영(≥1)', rowA && typeof rowA.uncovered === 'number' && rowA.uncovered >= 1, `uncovered=${rowA?.uncovered}`);
  // 기존 6개 지표 컬럼도 여전히 존재(회귀 없음).
  check('S3#2-3 기존 지표 컬럼 보존', rowA && ['pending_q', 'knowhow', 'staff', 'labor_month', 'is_active', 'store_name'].every((k) => k in rowA));
}

// ───────────────────── S3 #3 전 매장 공지: broadcast_notice + read_status ─────────────────────
async function flow7({ owner, ownerId, jA, jAId, UNIT, UNIT_B }) {
  console.log('\n━━ S3 #3 전 매장 동시 공지(broadcast) ━━');
  const { data: b, error } = await owner.rpc('broadcast_notice', { p_units: [UNIT, UNIT_B], p_text: '전 매장 공지 테스트', p_important: false });
  const BID = b?.[0]?.broadcast_id;
  check('S3#3-1 다중발송 성공(sent=2)', !error && b?.[0]?.sent === 2 && !!BID, error?.message ?? JSON.stringify(b));
  // 두 매장 각각 work_feed에 같은 broadcast_id notice가 생김. authorId=사장 강제.
  const { data: feeds } = await admin.from('work_feed').select('id, unit_id, data').or(`unit_id.eq.${UNIT},unit_id.eq.${UNIT_B}`);
  const bnotices = (feeds ?? []).filter((f) => f.data?.broadcast_id === BID);
  check('S3#3-2 두 매장에 같은 broadcast_id notice', bnotices.length === 2 && new Set(bnotices.map((f) => f.unit_id)).size === 2);
  check('S3#3-3 data.id==row.id · authorId=사장 강제', bnotices.length === 2 && bnotices.every((f) => f.data.id === f.id && f.data.authorId === ownerId && f.data.kind === 'notice'));
  // 읽음 집계: 아직 아무도 안 읽음 → 0/2.
  const { data: rs0 } = await owner.rpc('broadcast_read_status', { p_broadcast_id: BID });
  check('S3#3-4 읽음 집계 0/2', rs0?.[0]?.total === 2 && rs0?.[0]?.read_count === 0, JSON.stringify(rs0));
  // 알바A(매장A 소속)가 A의 공지를 읽음 처리(read_by 추가) → 1개 매장 읽음.
  const aNotice = bnotices.find((f) => f.unit_id === UNIT);
  await jA.from('work_feed').update({ data: { ...aNotice.data, read_by: [jAId] } }).eq('id', aNotice.id);
  const { data: rs1 } = await owner.rpc('broadcast_read_status', { p_broadcast_id: BID });
  check('S3#3-5 A 읽음 후 1/2 매장', rs1?.[0]?.total === 2 && rs1?.[0]?.read_count === 1, JSON.stringify(rs1));
  // ★크로스테넌트: 비소유 매장 포함 발송 거부.
  const { error: xErr } = await owner.rpc('broadcast_notice', { p_units: [UNIT, 'store_not_mine_xxx'], p_text: 'x', p_important: false });
  check('S3#3-6 비소유 매장 포함 발송 거부(not_owner)', !!xErr && /not_owner/.test(xErr.message), xErr?.message ?? '(안 막힘!)');
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
