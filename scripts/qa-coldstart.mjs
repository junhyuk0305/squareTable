// 콜드스타트 슬라이스 A QA — 0086 starter 플래그 + 루틴 선주입 경로 + 사장 첫 질문(RLS) 실증.
// 실 백엔드 대상·자가정리(@example.com 계정은 cleanup-orphan-stores.mjs 수거 규칙).
// 검증 축:
//  ① owner_overview(0086)에 asked_ever·done_ever가 존재하고 초기 false
//  ② 사장 세션의 schedule_config dayparts 루틴 upsert/재조회(선주입 경로의 서버측 전제)
//  ③ 사장 세션의 chat_queries insert 허용(aha 스텝 전제 — RLS 매장단위 for-all)
//  ④ 각 행위 후 플래그·카운트 전이(knowhow→1, asked_ever→true, done_ever→true, staff→1)
//  ⑤ 크로스테넌트: 타 매장 사장에게 플래그·설정이 새지 않음
// 사용: node scripts/qa-coldstart.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) { console.error('FAIL: URL/ANON 필요(.env)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
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

const overviewOf = async (client, unit) => {
  const { data, error } = await client.rpc('owner_overview');
  if (error) throw new Error('owner_overview: ' + error.message);
  return (data ?? []).find((r) => r.unit_id === unit);
};

async function main() {
  console.log('— 콜드스타트 QA (0086 starter flags · 루틴 선주입 · 사장 첫 질문) —');

  // ── 셋업: 매장 A(카페) + 크로스테넌트용 매장 B ──────────────────────────
  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_cs_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0106${s.slice(0, 7)}`, store_name: 'CS', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'CS 콜드매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  const UNIT = c1?.[0]?.unit_id;
  const CODE = c1?.[0]?.invite_code;
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  check('셋업: 매장 A 생성', !!UNIT && !!CODE, `unit=${UNIT}`);

  const ownerB = mk();
  await signUpSession(ownerB, `qa_cs_b_${s}@example.com`, { name: 'QA사장B', role: 'owner', phone: `0107${s.slice(0, 7)}`, store_name: 'CSB', industry: '카페·디저트' });
  const { data: c2 } = await ownerB.rpc('create_store', { p_store_name: 'CS B매장', p_industry: '카페·디저트', p_biz_no: null });
  const UNIT_B = c2?.[0]?.unit_id;
  await ownerB.rpc('switch_active_unit', { p_unit_id: UNIT_B });
  check('셋업: 매장 B 생성', !!UNIT_B && UNIT_B !== UNIT);

  // ── ① 초기 상태: 0086 열 존재 + 전부 미완료 ────────────────────────────
  let ov = await overviewOf(owner, UNIT);
  check('① overview에 asked_ever·done_ever 존재', ov && 'asked_ever' in ov && 'done_ever' in ov);
  check('① 초기: knowhow=0 · staff=0 · asked_ever=false · done_ever=false',
    ov && Number(ov.knowhow) === 0 && Number(ov.staff) === 0 && ov.asked_ever === false && ov.done_ever === false);

  // ── ② 루틴 선주입 경로: dayparts upsert → 재조회 (RLS 통과) ─────────────
  const dayparts = [
    { id: 'open', label: '오픈', routines: [1, 2, 3, 4].map((i) => ({ id: `rt_o${i}_${s}`, text: `오픈 루틴 ${i}` })) },
    { id: 'mid', label: '미들', routines: [] },
    { id: 'close', label: '마감', routines: [1, 2, 3, 4].map((i) => ({ id: `rt_c${i}_${s}`, text: `마감 루틴 ${i}` })) },
    { id: 'etc', label: '기타', routines: [] },
  ];
  { const { error } = await owner.from('schedule_config').upsert({ unit_id: UNIT, open: '09:00', close: '22:00', closed_days: [], note: '', dayparts, updated_at: new Date().toISOString() });
    check('② schedule_config dayparts 루틴 upsert', !error, error?.message ?? ''); }
  { const { data } = await owner.from('schedule_config').select('dayparts').maybeSingle();
    const dp = data?.dayparts ?? [];
    const openN = dp.find((d) => d.id === 'open')?.routines?.length ?? 0;
    const closeN = dp.find((d) => d.id === 'close')?.routines?.length ?? 0;
    check('② 재조회: 오픈/마감 루틴 4+4', openN === 4 && closeN === 4, `open=${openN} close=${closeN}`); }

  // ── ③ 노하우 1건 발행 → knowhow 전이 ───────────────────────────────────
  const now = new Date().toISOString();
  { const { error } = await owner.from('playbook_entries').insert({ id: `pb_cs_${s}`, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장', category: 'Routine', subcategory: '음료 제조', title: '콜드스타트 시드 노하우', tags: [], search_keywords: ['시드'], square: { situation: '테스트', action: { steps: ['한다'], scripts: [] }, extract: { do: '', dont: '', template: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' }, execution: { tone: '', timing: '', channel: '', stakeholders: [] }, stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: null, query_hits_30d: 0, resolution_rate: 0 }, photos: [], version: 1, status: 'published', quality_score: 0.7, created_at: now, updated_at: now, is_template: false, pack_id: null, needs_review: false, correction_points: [], section: null, order_index: 0 });
    check('③ 노하우 발행 insert', !error, error?.message ?? ''); }
  ov = await overviewOf(owner, UNIT);
  check('③ knowhow 0→1 전이', Number(ov?.knowhow) === 1);

  // ── ④ 사장 첫 질문: chat_queries insert(RLS) → asked_ever 전이 ──────────
  { const { error } = await owner.from('chat_queries').insert({ id: `cq_cs_${s}`, unit_id: UNIT, junior_id: ownerId, junior_name: 'QA사장', query_text: '마감 청소 어디까지 해요?', asked_at: now, matched_entry_ids: [], match_confidence: 0, was_deflected: true, response_block: null, satisfaction: null, resolved_at: null });
    check('④ 사장 세션 chat_queries insert 허용', !error, error?.message ?? ''); }
  ov = await overviewOf(owner, UNIT);
  check('④ asked_ever false→true 전이', ov?.asked_ever === true);

  // ── ⑤ 첫 할일 완료: work_feed task_done → done_ever 전이 ────────────────
  const today = now.slice(0, 10);
  { const { error } = await owner.from('work_feed').insert({ id: `wf_cs_${s}`, unit_id: UNIT, feed_date: today, data: { id: `wf_cs_${s}`, kind: 'task_done', date: today, refId: 'tpl_x', authorId: ownerId, authorName: 'QA사장', createdAt: now } });
    check('⑤ work_feed task_done insert', !error, error?.message ?? ''); }
  ov = await overviewOf(owner, UNIT);
  check('⑤ done_ever false→true 전이', ov?.done_ever === true);

  // ── ⑥ 직원 합류 → staff 전이(체크리스트 졸업 데이터 완성) ────────────────
  const j = mk();
  const jId = await signUpSession(j, `qa_cs_j_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: `0108${s.slice(0, 7)}` });
  await j.rpc('join_by_invite', { p_code: CODE });
  { const { error } = await owner.rpc('approve_member', { p_uid: jId });
    check('⑥ 직원 합류 승인', !error, error?.message ?? ''); }
  ov = await overviewOf(owner, UNIT);
  check('⑥ staff 0→1 전이(졸업 4/4 데이터)', Number(ov?.staff) === 1);

  // ── ⑦ 크로스테넌트: B 사장에게 A의 흔적이 없다 ─────────────────────────
  const ovB = await overviewOf(ownerB, UNIT_B);
  const { data: bSeesA } = await ownerB.rpc('owner_overview');
  check('⑦ B overview에 A 매장 없음', !(bSeesA ?? []).some((r) => r.unit_id === UNIT));
  check('⑦ B 플래그는 자기 것(asked_ever=false)', ovB?.asked_ever === false && ovB?.done_ever === false);
  { const { data } = await ownerB.from('schedule_config').select('unit_id').eq('unit_id', UNIT);
    check('⑦ B가 A schedule_config 조회 0행', (data ?? []).length === 0); }
  { const { error } = await ownerB.from('chat_queries').insert({ id: `cq_csx_${s}`, unit_id: UNIT, junior_id: 'x', junior_name: 'x', query_text: 'x', asked_at: now, matched_entry_ids: [], match_confidence: 0, was_deflected: true, response_block: null, satisfaction: null, resolved_at: null });
    check('⑦ B의 A매장 chat_queries insert 차단(42501)', !!error, error?.code ?? ''); }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL(예외):', e.message); process.exit(1); });
