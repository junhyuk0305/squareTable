// 로컬 수동 QA용 계정 세트 생성 — 사장(매장 2개) + 직원 2명 + 시드 데이터.
// 격리 매장(@example.com owner)이라 파일럿/실데이터 무접촉. 커밋 안 함(로컬 헬퍼).
// 실행: node scripts/qa-local-accounts.mjs   (.env=ANON, .env.seed=SERVICE_ROLE 자동 로드, 셸 env 우선)
//   접속 URL 이 127.0.0.1/localhost 가 아니면 멈춘다. 라이브는 --allow-remote 를 붙일 때만.
// 재실행 안전: 계정이 이미 있으면 로그인해서 매장/시드만 보장(멱등 지향).
// 정리(다 끝나면): node --env-file=.env.seed scripts/cleanup-orphan-stores.mjs --execute
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
// 셸 env 가 파일값보다 우선한다(로컬 도커 키를 넘길 수 있게).
const ENV_KEYS = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')), ...Object.fromEntries(ENV_KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: .env(ANON) + .env.seed(SERVICE_ROLE) 필요'); process.exit(2); }
// 접속 대상 가드(2026-10-23 Q-0): 라이브에 QA 계정이 생긴 사고 재발 방지. 네트워크 호출 전에 멈춘다.
let host = ''; try { host = new URL(URL_).hostname; } catch {}
if (!['127.0.0.1', 'localhost'].includes(host) && !process.argv.includes('--allow-remote')) {
  console.error(`중단: 접속 대상이 로컬이 아니다 — ${URL_}\n라이브에 만들려면 --allow-remote 를 명시한다.`); process.exit(2);
}
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
const SOLO_PHONE = '01099990021';
const qaPhones = ['01099990001', '01099990011', '01099990012', SOLO_PHONE];

// 다른 매장 사장(owner-solo@pilot · lib/qa-fixed-accounts.mjs 의 FIXED.other).
// qa-roles·qa-user-reports 가 로그인하고, qa-review-security 가 매장 번호 store_solo_local 을 쓴다.
// 라이브에는 있고 로컬 시드에는 없어서 여기서 만든다. 매장 번호를 정해야 해서 create_store 를 쓰지 않고 service_role 로 넣는다.
const SOLO_EMAIL = 'owner-solo@pilot.squaretable.app', SOLO_PW = 'pilot1234', SOLO_UNIT = 'store_solo_local';
async function ensureSoloOwner() {
  let { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let u = users.find((x) => x.email === SOLO_EMAIL);
  if (!u) {
    const { data, error } = await admin.auth.admin.createUser({
      email: SOLO_EMAIL, password: SOLO_PW, email_confirm: true,
      user_metadata: { name: '솔로사장', role: 'owner', birth_date: '1990-01-01' },
    });
    if (error) throw new Error(`owner-solo 생성 실패: ${error.message}`);
    u = data.user;
  }
  // 매장 insert 트리거(trg_units_phone_verified)가 사장 번호 인증을 본다. 번호는 위 qaPhones 로 인증해 둔다.
  await admin.from('profiles').update({ phone: SOLO_PHONE, role: 'owner', name: '솔로사장' }).eq('id', u.id).throwOnError();
  await admin.from('units').upsert({ id: SOLO_UNIT, store_name: '솔로 매장(로컬)', industry: '카페·디저트', owner_id: u.id, kind: 'store' }, { onConflict: 'id' }).throwOnError();
  await admin.from('unit_members').upsert({ user_id: u.id, unit_id: SOLO_UNIT, role: 'owner' }, { onConflict: 'user_id,unit_id' }).throwOnError();
  await admin.from('profiles').update({ unit_id: SOLO_UNIT, active_unit_id: SOLO_UNIT }).eq('id', u.id).throwOnError();
  console.log(`다른 매장 사장: ${SOLO_EMAIL} → ${SOLO_UNIT}`);
}

// 공간 주인(qa.space@example.com) + 공간 1개 · 2026-11-12 S5.
// 공간 화면 브라우저 하니스·크롤러의 'space' 세션이 쓴다. 사장 계정은 owner_cannot_create_space 라 따로 만든다.
// 입구는 허용 목록(space_entry_allowlist)에 넣어 연다. 전화 게이트는 컷오프 이전 계정으로 면제한다(qa-space-isolation 과 같은 방식).
// 공간은 create_space 를 그 계정 세션으로 부른다(번호·주인 칸을 서버가 정한다). 이미 있으면 그대로 쓴다.
const SPACE_EMAIL = 'qa.space@example.com', SPACE_NAME = 'QA 공간(로컬)';
async function ensureSpaceOwner() {
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let u = users.find((x) => x.email === SPACE_EMAIL);
  if (!u) {
    const { data, error } = await admin.auth.admin.createUser({
      email: SPACE_EMAIL, password: PW, email_confirm: true,
      user_metadata: { name: 'QA공간주인', role: 'junior', birth_date: '1994-03-03' },
    });
    if (error) throw new Error(`공간 주인 생성 실패: ${error.message}`);
    u = data.user;
  }
  // 전화가 비면 앱이 '가입 폼을 안 거친 계정'으로 보고 /complete-profile 로 보낸다(profileSetup.ts · S5 남은 것). 번호를 채운다.
  await admin.from('profiles').update({ name: 'QA공간주인', phone: '01099990031', created_at: '2020-01-01' }).eq('id', u.id).throwOnError();
  await admin.from('space_entry_allowlist').upsert({ user_id: u.id, note: 'qa-local-accounts' }, { onConflict: 'user_id', ignoreDuplicates: true }).throwOnError();
  const c = mk();
  const { error: le } = await c.auth.signInWithPassword({ email: SPACE_EMAIL, password: PW });
  if (le) throw new Error(`공간 주인 로그인 실패: ${le.message}`);
  const { data: own } = await admin.from('unit_members').select('unit_id, units!inner(kind)').eq('user_id', u.id).eq('role', 'space_owner').eq('units.kind', 'space');
  let spaceId = own?.[0]?.unit_id;
  if (!spaceId) {
    const { data, error } = await c.rpc('create_space', { p_name: SPACE_NAME }).single();
    if (error) throw new Error(`create_space 실패: ${error.message}`);
    spaceId = data.space_id;
  }
  const { error: ee } = await c.rpc('enter_space', { p_space: spaceId });
  if (ee) throw new Error(`enter_space 실패: ${ee.message}`);
  // 크롤러 표본(/l/[token] · /link/[id] · /space/answer/[qid]) — 열린 링크 1개와 답 기다리는 질문 1개를 둔다.
  const LINK_TITLE = 'QA 고정 링크';
  const nowIso = new Date().toISOString();
  let { data: lk } = await admin.from('edu_links').select('id, token').eq('unit_id', spaceId).eq('title', LINK_TITLE).is('closed_at', null).gt('expires_at', nowIso).limit(1);
  let link = lk?.[0];
  if (!link) {
    const { data, error } = await c.rpc('edu_link_create', { p_unit: spaceId, p_title: LINK_TITLE, p_entry_ids: [], p_days: 30 });
    if (error) throw new Error(`edu_link_create 실패: ${error.message}`);
    link = Array.isArray(data) ? data[0] : data;
  }
  const { count: waiting } = await admin.from('unknown_queries').select('id', { count: 'exact', head: true }).eq('unit_id', spaceId).eq('status', 'pending_owner_answer');
  if (!waiting) {
    const g = mk(); // 손님 = 로그인 없음
    const { data: a, error: ae } = await g.rpc('edu_link_ask', { p_token: link.token, p_key: null, p_name: 'QA손님', p_text: '고정 질문: 마감 때 무엇을 먼저 하나요?' }).single();
    if (ae) throw new Error(`edu_link_ask 실패: ${ae.message}`);
    const { error: se } = await g.rpc('edu_link_send', { p_token: link.token, p_key: a.guest_key, p_cq: a.cq_id, p_unhelpful: false });
    if (se) throw new Error(`edu_link_send 실패: ${se.message}`);
  }
  console.log(`공간 주인: ${SPACE_EMAIL} → ${spaceId} · 링크 ${link.id} · 답 기다리는 질문 ${waiting || 1}개`);
}

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  await ensureSoloOwner();
  await ensureSpaceOwner();
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
