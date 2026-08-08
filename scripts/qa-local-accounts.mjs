// 로컬 수동 QA용 계정 세트 생성 — 사장(매장 2개) + 직원 2명 + 시드 데이터.
// 격리 매장(@example.com owner)이라 파일럿/실데이터 무접촉. 커밋 안 함(로컬 헬퍼).
// 실행: node scripts/qa-local-accounts.mjs   (.env=ANON, .env.seed=SERVICE_ROLE 자동 로드)
// 재실행 안전: 계정이 이미 있으면 로그인해서 매장/시드만 보장(멱등 지향).
// 정리(다 끝나면): node --env-file=.env.seed scripts/cleanup-orphan-stores.mjs --execute
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: .env(ANON) + .env.seed(SERVICE_ROLE) 필요'); process.exit(2); }
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });

// ── 고정 계정(외우기 쉬운 값) ─────────────────────────────────────────────
const PW = 'QaTest1234!';
const OWNER = 'qa.owner@example.com';
const STAFF1 = 'qa.staff1@example.com';
const STAFF2 = 'qa.staff2@example.com';

async function ensureUser(client, email, meta) {
  // 있으면 로그인, 없으면 가입. 반환 { id, isNew }.
  let { data, error } = await client.auth.signInWithPassword({ email, password: PW });
  if (data?.user) return { id: data.user.id, isNew: false };
  ({ data, error } = await client.auth.signUp({ email, password: PW, options: { data: { birth_date: '1994-03-03', ...meta } } }));
  if (error || !data.session) throw new Error(`가입 실패 ${email}: ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return { id: data.user.id, isNew: true };
}

// 0088 게이트 라이브 — 고정 계정 번호를 '인증됨'으로 선등록해야 create_store/join 통과.
const qaPhones = ['01099990001', '01099990011', '01099990012'];

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const owner = mk();
  const o = await ensureUser(owner, OWNER, { name: 'QA사장', role: 'owner', phone: '01099990001', store_name: 'QA', industry: '카페·디저트' });
  console.log(`사장 ${o.isNew ? '생성' : '기존'}: ${OWNER}`);

  // 매장 확인/생성 — 소유 매장이 2개 미만이면 채운다.
  let units = (await owner.rpc('my_units')).data ?? [];
  async function ensureStore(name, industry) {
    let u = units.find((x) => x.store_name === name);
    if (!u) {
      const { data } = await owner.rpc('create_store', { p_store_name: name, p_industry: industry, p_biz_no: null });
      const id = data?.[0]?.unit_id, code = data?.[0]?.invite_code;
      await admin.rpc('admin_activate_store', { p_unit_id: id, p_days: 30, p_plan: 'multi' }); // 다점포·직원캡 해제(30일)
      units = (await owner.rpc('my_units')).data ?? [];
      return { unit_id: id, invite_code: code, store_name: name };
    }
    await admin.rpc('admin_activate_store', { p_unit_id: u.unit_id, p_days: 30, p_plan: 'multi' });
    const { data: row } = await admin.from('units').select('invite_code').eq('id', u.unit_id).maybeSingle();
    return { unit_id: u.unit_id, invite_code: row?.invite_code, store_name: name };
  }
  const A = await ensureStore('QA 카페 본점', '카페·디저트');
  const B = await ensureStore('QA 카페 2호점', '카페·디저트');
  await owner.rpc('switch_active_unit', { p_unit_id: A.unit_id });
  console.log(`매장 A: ${A.store_name} (${A.unit_id})  초대코드 ${A.invite_code}`);
  console.log(`매장 B: ${B.store_name} (${B.unit_id})`);

  // 직원 2명 — A에 합류·승인.
  for (const [email, name, phone] of [[STAFF1, 'QA직원1', '01099990011'], [STAFF2, 'QA직원2', '01099990012']]) {
    const j = mk();
    const ju = await ensureUser(j, email, { name, role: 'junior', phone });
    const mine = (await j.rpc('my_units')).data ?? [];
    if (!mine.some((x) => x.unit_id === A.unit_id)) {
      await j.rpc('join_by_invite', { p_code: A.invite_code });
      await owner.rpc('switch_active_unit', { p_unit_id: A.unit_id });
      await owner.rpc('approve_member', { p_uid: ju.id });
    }
    console.log(`직원 ${ju.isNew ? '생성' : '기존'}·A합류: ${email} (${name})`);
  }
  await owner.rpc('switch_active_unit', { p_unit_id: A.unit_id });

  // ── 시드(매장 A) — 이미 있으면 건너뜀 ──────────────────────────────────
  const now = new Date().toISOString();
  const entry = (id, title, sub, situation, steps, dont) => ({
    id, unit_id: A.unit_id, creator_id: o.id, creator_name: 'QA사장', category: 'Routine', subcategory: sub,
    title, tags: [], search_keywords: [title], square: { situation, action: { steps }, extract: { do: '', dont, template: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '', timing: '', channel: '', stakeholders: [] }, stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: null, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.8, created_at: now, updated_at: now, is_template: false, pack_id: null, needs_review: false, correction_points: [], section: null, order_index: 0,
  });
  const existing = (await owner.from('playbook_entries').select('id').eq('unit_id', A.unit_id)).data ?? [];
  const has = (id) => existing.some((e) => e.id === id);
  const E1 = 'qa_pb_americano', E2 = 'qa_pb_closing';
  if (!has(E1)) await owner.from('playbook_entries').insert(entry(E1, '아이스 아메리카노 제조', '음료 제조', '아이스 아메리카노 주문이 들어왔을 때', ['얼음을 가득 채운다', '에스프레소 2샷을 내린다', '물 200ml를 붓는다'], '얼음을 반만 채우지 않는다'));
  if (!has(E2)) await owner.from('playbook_entries').insert(entry(E2, '마감 청소', '마감', '영업 마감 후 청소할 때', ['그라인더 원두를 비운다', '스팀 노즐을 닦는다', '바닥을 쓸고 닦는다'], '기름통을 그대로 두지 않는다'));

  const tmpl = (id, text) => ({ id, unit_id: A.unit_id, section: 'open', text, scope: 'shared', recurrence: { weekly: [1, 2, 3, 4, 5] }, created_at: now });
  const exT = (await owner.from('work_templates').select('id').eq('unit_id', A.unit_id)).data ?? [];
  const hasT = (id) => exT.some((t) => t.id === id);
  const T1 = 'qa_t_americano', T2 = 'qa_t_closing';
  if (!hasT(T1)) await owner.from('work_templates').insert(tmpl(T1, '아이스 아메리카노 만들기'));
  if (!hasT(T2)) await owner.from('work_templates').insert(tmpl(T2, '마감 정리'));
  // T1에 노하우 첨부(①칩·④퀴즈 재료). T2는 미첨부(②캡처·#2 커버리지 재료).
  await owner.from('work_template_knowhow').upsert([{ unit_id: A.unit_id, template_id: T1, entry_id: E1 }], { onConflict: 'template_id,entry_id', ignoreDuplicates: true });

  console.log('\n══════════ 로컬 QA 계정 (모두 비번 동일) ══════════');
  console.log(`비밀번호(공통): ${PW}`);
  console.log(`사장   : ${OWNER}   → 매장 2개(본점·2호점) 소유 = S3 전부 노출`);
  console.log(`직원1  : ${STAFF1}  → QA 카페 본점 소속`);
  console.log(`직원2  : ${STAFF2}  → QA 카페 본점 소속`);
  console.log('시드(본점): 노하우 2개, 반복업무 2개(아메리카노=노하우 첨부됨 / 마감정리=미첨부)');
  console.log('════════════════════════════════════════════════');
  await cleanupSeededPhones(URL_, SRV, qaPhones);
  process.exit(0);
}
main().catch((e) => { console.error('SETUP ERROR:', e); process.exit(1); });
