// qa-brand-deploy.mjs — 본사(브랜드) 축 P4 배포 하니스: 사본·임베딩·버전 규칙·숨김·미러 뷰 (2026-09-23)
//
// 고정 계정만 쓴다(메모리 feedback_qa_use_fixed_accounts): 사장 owner@pilot… · 직원 staff2@pilot… · 본사 hq@pilot…
// 전제: 0215~0218 push + `node scripts/seed-brand-demo.mjs`. 끝나면 만든 것(작업실 원본·사본·배포 원장)을 지운다.
//
// 재는 것(지시서 §5 완료 기준 표 1행):
//   A 작업실 진입 — 담당자가 매니저로 붙고 활성 매장이 작업실 · my_units 는 여전히 0(매장으로 안 샘)
//   B 사본 생성 — 발행본만 · needs_review=false · stats 리셋 · 임베딩 벡터 복사 · 점주 알림 1행
//   C 미수정 자동 갱신 — 내용 갱신 + brand_version 올림 + local_modified_at **null 유지**(트리거 우회)
//   D 점주 수정 → 대기 — 내용 안 덮음 · brand_pending_version 기록 · 교차표 'modified'→'pending'
//   E 교체 / 유지 — apply_brand_pending(true) 는 원본으로 덮고 미수정으로 · (false) 는 내용 유지
//   F 숨김 — hide_brand_copy · 교차표 'hidden' · 숙지율 분모에서 빠짐 · 재배포해도 숨김 유지
//   G 경계 — 미연결 매장 0건 · 남의 매장 노하우를 원본으로 못 씀 · 직원은 숨김·교체 못 함 · 본사는 사본 직접 못 읽음
//   H 미러 뷰 — my_brand_mirror 가 brand_overview 와 **같은 값** · 남의 매장은 0행
//   J 퀴즈 배포(P5 · 0219·0220) — 퀴즈 사본 · course_entries·quiz_items.entry_ids 가 **그 매장 사본 id** · 없는 노하우만 선배포 ·
//     알림 한 행("퀴즈와 노하우 n건") · ★quiz_assignments 0행 · 버전 규칙 4종(코스 이름·문항 수정 둘 다 '수정') · 숨김(안 나간 발송 취소) ·
//     숨긴 노하우 사본을 근거로 하는 문항은 출제·개수에서 빠짐 · 경계(미연결·섞임·직원·본사 직접 읽기·매장 퀴즈를 원본으로)
//   I 해제 후 잔존 — 연결을 끊어도 사본(노하우·퀴즈)은 매장에 남는다(정본 §4-B)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const e = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !e[m[1]]) e[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return e;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const PW = 'pilot1234';
const OWNER = 'owner@pilot.squaretable.app';
const JUNIOR = 'staff2@pilot.squaretable.app';
const HQ = 'hq@pilot.squaretable.app';
const BRAND = 'brand_pilot';
const UNIT = 'store_001';        // 사장 owner@pilot 의 매장 = 연결 대상
const OTHER = 'store_002_demo';  // brand_other 소속 = 경계용(미연결)

let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const skipped = (n, why) => { skip++; console.log('  SKIP', n, '—', why); };
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(email) {
  const c = mk();
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return c;
}
const errCode = (e) => (e?.message ?? '').split(/[\s:]/)[0];
const SQ = (n) => ({
  situation: `QA 배포 상황 ${n}`, quagmire: '', uncover: '',
  action: { steps: [`단계 하나 ${n}`, `단계 둘 ${n}`] },
  result: { before: '', after: '', metric: '' },
  extract: { do: '', dont: `하지 말 것 ${n}` },
});

// 하니스가 만든 것만 지운다(고정 계정의 기존 데이터는 건드리지 않는다).
const SRC_PREFIX = 'pb_qadeploy_';
const SRC_C = 'tc_qadeploy_c';                 // 작업실 원본 퀴즈(J)
const QI_PREFIX = 'qi_qadeploy_';              // 작업실 원본 문항(J)
async function cleanup(wsUnit) {
  // J 퀴즈 — 사본 코스(cascade: course_entries·quiz_assignments) → 사본 문항 → 원본 문항 → 원본 코스 → 배포 원장.
  await svc.from('training_courses').delete().eq('brand_course_id', SRC_C);
  await svc.from('quiz_items').delete().like('brand_item_id', `${QI_PREFIX}%`);
  await svc.from('quiz_items').delete().like('id', `${QI_PREFIX}%`);
  await svc.from('training_courses').delete().eq('id', SRC_C);
  await svc.from('brand_deployments').delete().eq('source_id', SRC_C);
  const { data: srcs } = await svc.from('playbook_entries').select('id').like('id', `${SRC_PREFIX}%`);
  const srcIds = (srcs ?? []).map((r) => r.id);
  if (srcIds.length) {
    const { data: copies } = await svc.from('playbook_entries').select('id').in('brand_entry_id', srcIds);
    const copyIds = (copies ?? []).map((r) => r.id);
    // deployments 는 targets 를 cascade 로 끌고 간다. 사본 → 임베딩도 cascade.
    await svc.from('brand_deployments').delete().in('source_id', srcIds);
    if (copyIds.length) await svc.from('playbook_entries').delete().in('id', copyIds);
    await svc.from('playbook_entries').delete().in('id', srcIds);
  }
  await svc.from('owner_alerts').delete().eq('unit_id', UNIT).eq('kind', 'brand_deploy');
  // 연결을 시드 상태(active·summary·payer=brand)로.
  const { data: u } = await svc.from('units').select('owner_id').eq('id', UNIT).maybeSingle();
  const { data: cur } = await svc.from('brand_units').select('id, brand_id').eq('unit_id', UNIT).eq('status', 'active').maybeSingle();
  if (cur && cur.brand_id === BRAND) {
    await svc.from('brand_units').update({ payer: 'brand', visibility: 'summary', visibility_requested: null, payer_proposed: null, payer_proposed_by: null }).eq('id', cur.id);
  } else {
    if (cur) await svc.from('brand_units').update({ status: 'ended', ended_at: new Date().toISOString(), end_reason: 'qa_restore' }).eq('id', cur.id);
    await svc.from('brand_units').insert({ brand_id: BRAND, unit_id: UNIT, payer: 'brand', visibility: 'summary', accepted_by: u?.owner_id ?? null });
  }
  if (wsUnit) await svc.from('playbook_entries').delete().eq('unit_id', wsUnit).like('id', `${SRC_PREFIX}%`);
}

let ws = null;
try {
  const H = await login(HQ);
  const O = await login(OWNER);
  const J = await login(JUNIOR);
  const hqId = (await H.auth.getUser()).data.user.id;
  await cleanup(null);

  // ── A 작업실 진입(0215) ─────────────────────────────────────────────────
  console.log('\nA 작업실 진입');
  const ent = await H.rpc('brand_enter_workspace');
  ws = ent.data ?? null;
  check('A1 담당자가 작업실에 들어간다(ws id 반환)', !ent.error && typeof ws === 'string' && ws.startsWith('ws_'), ent.error?.message);
  if (!ws) throw new Error('작업실을 못 얻어 이후를 잴 수 없다 — seed-brand-demo.mjs 를 먼저 돌려라');
  const again = await H.rpc('brand_enter_workspace');
  check('A2 두 번 불러도 같은 값(멱등)', !again.error && again.data === ws, again.error?.message);
  const { data: mem } = await svc.from('unit_members').select('role').eq('user_id', hqId).eq('unit_id', ws).maybeSingle();
  check('A3 역할은 매니저다(owner 아님 — 정본 §6-2 ③)', mem?.role === 'manager', JSON.stringify(mem));
  const { data: prof } = await svc.from('profiles').select('active_unit_id, role').eq('id', hqId).maybeSingle();
  check('A4 활성 매장이 작업실', prof?.active_unit_id === ws, JSON.stringify(prof));
  const mu = await H.rpc('my_units');
  check('A5 my_units 는 여전히 0행(작업실이 매장으로 안 샌다)', !mu.error && (mu.data ?? []).length === 0, `${(mu.data ?? []).length}행`);
  const jEnter = await J.rpc('brand_enter_workspace');
  check('A6 담당자 아닌 계정은 작업실에 못 들어간다(not_brand_member)', errCode(jEnter.error) === 'not_brand_member', jEnter.error?.message);

  // 원본 2건을 작업실에 넣는다(service_role — 편집기 대신. 편집기 자체는 브라우저 QA 몫).
  const SRC_A = `${SRC_PREFIX}a`;
  const SRC_B = `${SRC_PREFIX}b`;
  const base = (id, n) => ({
    id, unit_id: ws, creator_id: hqId, creator_name: '스퀘어 F&B', creator_role: 'owner',
    category: 'Routine', subcategory: '일반', title: `QA 본사 노하우 ${n}`, tags: ['#QA'],
    square: SQ(n), execution: { timing: '', channel: '', tone: '' }, stats: {},
    search_keywords: ['QA'], version: 1, status: 'published', quality_score: 0,
    section: 'QA섹션', order_index: n === 'A' ? 1 : 2, photos: [`${ws}/qa-${n}.jpg`],
  });
  const insSrc = await svc.from('playbook_entries').insert([base(SRC_A, 'A'), base(SRC_B, 'B')]);
  check('A7 작업실에 원본 2건 준비', !insSrc.error, insSrc.error?.message);
  // 임베딩도 넣는다 — 배포가 벡터를 복사하는지 재려면 원본에 벡터가 있어야 한다.
  const vec = `[${Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
  const insEmb = await svc.from('playbook_embeddings').insert([
    { entry_id: SRC_A, unit_id: ws, embedding: vec },
    { entry_id: SRC_B, unit_id: ws, embedding: vec },
  ]);
  check('A8 원본 임베딩 준비', !insEmb.error, insEmb.error?.message);
  const wsList = await H.rpc('brand_knowhow_list');
  check('A9 본사 노하우 표에 2건이 보인다', !wsList.error && (wsList.data ?? []).filter((r) => r.id.startsWith(SRC_PREFIX)).length === 2, wsList.error?.message);
  check('A10 아직 배포 0(deployed_units=0 · version=0)', (wsList.data ?? []).filter((r) => r.id.startsWith(SRC_PREFIX)).every((r) => r.deployed_units === 0 && r.version === 0));

  // ── B 사본 생성 ─────────────────────────────────────────────────────────
  console.log('\nB 사본 생성');
  const dep1 = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A, SRC_B], p_unit_ids: [UNIT] });
  check('B1 배포 성공(2건 × 1매장 = created 2)', !dep1.error && (dep1.data ?? []).filter((r) => r.action === 'created').length === 2, dep1.error?.message ?? JSON.stringify(dep1.data));
  const { data: copies } = await svc.from('playbook_entries').select('*').eq('unit_id', UNIT).in('brand_entry_id', [SRC_A, SRC_B]);
  check('B2 매장에 사본 2건', (copies ?? []).length === 2, `${(copies ?? []).length}건`);
  const cA = (copies ?? []).find((c) => c.brand_entry_id === SRC_A);
  check('B3 사본은 발행본 · needs_review=false(본사가 내린 것은 점검 대상이 아니다)', cA?.status === 'published' && cA?.needs_review === false, JSON.stringify({ s: cA?.status, n: cA?.needs_review }));
  check('B4 stats 리셋 · brand_version=1 · local_modified_at null · brand_hidden_at null',
    JSON.stringify(cA?.stats ?? {}) === '{}' && cA?.brand_version === 1 && cA?.local_modified_at === null && cA?.brand_hidden_at === null,
    JSON.stringify({ st: cA?.stats, v: cA?.brand_version, m: cA?.local_modified_at, h: cA?.brand_hidden_at }));
  check('B5 사진은 작업실 경로를 그대로 참조(복사 안 함)', (cA?.photos ?? [])[0] === `${ws}/qa-A.jpg`, JSON.stringify(cA?.photos));
  check('B6 part_id·source_id·verification 은 리셋', cA?.part_id === null && cA?.source_id === null && cA?.verification === null);
  const { data: cEmb } = await svc.from('playbook_embeddings').select('entry_id, unit_id').eq('entry_id', cA?.id).maybeSingle();
  check('B7 임베딩 벡터가 복사됐다(배포 즉시 검색됨)', cEmb?.unit_id === UNIT, JSON.stringify(cEmb));
  const { data: al } = await svc.from('owner_alerts').select('kind, title, body').eq('unit_id', UNIT).eq('kind', 'brand_deploy');
  check('B8 점주 알림 brand_deploy **1행**(노하우 2건을 한 문장으로)', (al ?? []).length === 1 && (al[0].body ?? '').includes('2건'), JSON.stringify(al));
  const list2 = await H.rpc('brand_knowhow_list');
  check('B9 표에 배포 매장 1곳·버전 1', (list2.data ?? []).filter((r) => r.id.startsWith(SRC_PREFIX)).every((r) => r.deployed_units === 1 && r.version === 1));
  const mx1 = await H.rpc('brand_deploy_matrix');
  check('B10 교차표 = current 2칸', !mx1.error && (mx1.data ?? []).filter((r) => r.unit_id === UNIT && r.status === 'current').length === 2, mx1.error?.message ?? JSON.stringify(mx1.data));

  // ── C 미수정 자동 갱신 ──────────────────────────────────────────────────
  console.log('\nC 미수정 사본 자동 갱신');
  await svc.from('playbook_entries').update({ title: 'QA 본사 노하우 A(고침)', square: SQ('A2') }).eq('id', SRC_A);
  const dep2 = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [UNIT] });
  check('C1 재배포 → updated', !dep2.error && (dep2.data ?? [])[0]?.action === 'updated', dep2.error?.message ?? JSON.stringify(dep2.data));
  const { data: cA2 } = await svc.from('playbook_entries').select('*').eq('id', cA.id).maybeSingle();
  check('C2 내용이 갱신됐다', cA2?.title === 'QA 본사 노하우 A(고침)', cA2?.title);
  check('C3 brand_version 이 2로 올랐다', cA2?.brand_version === 2, String(cA2?.brand_version));
  check('C4 ★local_modified_at 은 여전히 null(같은 UPDATE 의 버전 상승으로 0216 트리거 우회)', cA2?.local_modified_at === null, String(cA2?.local_modified_at));
  check('C5 brand_pending_version 은 null', cA2?.brand_pending_version === null, String(cA2?.brand_pending_version));

  // ── D 점주가 고치면 대기 ────────────────────────────────────────────────
  console.log('\nD 점주 수정 → 새 버전 대기');
  const oEdit = await O.from('playbook_entries').update({ title: '우리 매장식 제목' }).eq('id', cA.id).select('id');
  check('D1 점주가 사본 본문을 고친다(RLS 로 그 매장 행)', !oEdit.error && (oEdit.data ?? []).length === 1, oEdit.error?.message);
  const { data: cA3 } = await svc.from('playbook_entries').select('local_modified_at').eq('id', cA.id).maybeSingle();
  check('D2 ★0216 트리거가 local_modified_at 을 찍었다', !!cA3?.local_modified_at, String(cA3?.local_modified_at));
  const mxMod = await H.rpc('brand_deploy_matrix');
  check('D3 교차표가 modified 로 보인다', (mxMod.data ?? []).some((r) => r.entry_id === SRC_A && r.unit_id === UNIT && r.status === 'modified'), JSON.stringify(mxMod.data));
  await svc.from('playbook_entries').update({ square: SQ('A3') }).eq('id', SRC_A);
  const dep3 = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [UNIT] });
  check('D4 재배포 → pending(갱신하지 않는다)', !dep3.error && (dep3.data ?? [])[0]?.action === 'pending', dep3.error?.message ?? JSON.stringify(dep3.data));
  const { data: cA4 } = await svc.from('playbook_entries').select('*').eq('id', cA.id).maybeSingle();
  check('D5 ★내용이 덮이지 않았다(점주 제목 유지)', cA4?.title === '우리 매장식 제목', cA4?.title);
  check('D6 brand_pending_version=3 · brand_version=2 그대로', cA4?.brand_pending_version === 3 && cA4?.brand_version === 2, JSON.stringify({ p: cA4?.brand_pending_version, v: cA4?.brand_version }));
  check('D7 local_modified_at 이 밀리지 않았다(대기 기록은 수정이 아니다)', cA4?.local_modified_at === cA3?.local_modified_at);
  const mxPend = await H.rpc('brand_deploy_matrix');
  check('D8 교차표가 pending 으로 보인다', (mxPend.data ?? []).some((r) => r.entry_id === SRC_A && r.unit_id === UNIT && r.status === 'pending'));
  const { data: al2 } = await svc.from('owner_alerts').select('body').eq('unit_id', UNIT).eq('kind', 'brand_deploy');
  check('D9 대기만 생긴 배포의 알림은 "새 버전" 문구', (al2 ?? []).some((a) => (a.body ?? '').includes('새 버전')), JSON.stringify(al2));

  // ── E 교체 / 유지 ───────────────────────────────────────────────────────
  console.log('\nE 교체 / 내 수정 유지');
  const jApply = await J.rpc('apply_brand_pending', { p_entry_id: cA.id, p_replace: true });
  check('E1 직원은 답할 수 없다(not_owner)', errCode(jApply.error) === 'not_owner', jApply.error?.message);
  const keep = await O.rpc('apply_brand_pending', { p_entry_id: cA.id, p_replace: false });
  const { data: cA5 } = await svc.from('playbook_entries').select('*').eq('id', cA.id).maybeSingle();
  check('E2 유지 → 내용 그대로 · pending 비움 · brand_version=3(같은 버전 재질문 없음)',
    !keep.error && cA5?.title === '우리 매장식 제목' && cA5?.brand_pending_version === null && cA5?.brand_version === 3,
    keep.error?.message ?? JSON.stringify({ t: cA5?.title, p: cA5?.brand_pending_version, v: cA5?.brand_version }));
  check('E3 유지는 local_modified_at 을 지우지 않는다(여전히 수정본)', !!cA5?.local_modified_at);
  const noPend = await O.rpc('apply_brand_pending', { p_entry_id: cA.id, p_replace: true });
  check('E4 기다리는 버전이 없으면 거부(no_pending_version)', errCode(noPend.error) === 'no_pending_version', noPend.error?.message);
  // 다시 대기를 만들고 이번엔 교체.
  await svc.from('playbook_entries').update({ title: 'QA 본사 노하우 A(v4)', square: SQ('A4') }).eq('id', SRC_A);
  await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [UNIT] });
  const repl = await O.rpc('apply_brand_pending', { p_entry_id: cA.id, p_replace: true });
  const { data: cA6 } = await svc.from('playbook_entries').select('*').eq('id', cA.id).maybeSingle();
  check('E5 교체 → 원본 내용으로 덮고 미수정으로 돌아간다(local_modified_at null)',
    !repl.error && cA6?.title === 'QA 본사 노하우 A(v4)' && cA6?.local_modified_at === null && cA6?.brand_pending_version === null,
    repl.error?.message ?? JSON.stringify({ t: cA6?.title, m: cA6?.local_modified_at }));
  const mxCur = await H.rpc('brand_deploy_matrix');
  check('E6 교체 뒤 교차표가 current 로 돌아온다', (mxCur.data ?? []).some((r) => r.entry_id === SRC_A && r.unit_id === UNIT && r.status === 'current'));

  // ── F 숨김 ──────────────────────────────────────────────────────────────
  console.log('\nF 숨김');
  const jHide = await J.rpc('hide_brand_copy', { p_entry_id: cA.id, p_hidden: true });
  check('F1 직원은 숨길 수 없다(not_owner)', errCode(jHide.error) === 'not_owner', jHide.error?.message);
  const { data: ownEntry } = await svc.from('playbook_entries').select('id').eq('unit_id', UNIT).is('brand_entry_id', null).eq('status', 'published').limit(1);
  if (ownEntry?.[0]) {
    const notCopy = await O.rpc('hide_brand_copy', { p_entry_id: ownEntry[0].id, p_hidden: true });
    check('F2 매장 자체 노하우는 숨김 대상이 아니다(not_brand_copy)', errCode(notCopy.error) === 'not_brand_copy', notCopy.error?.message);
  } else skipped('F2 매장 자체 노하우 숨김 거부', 'store_001 에 자체 노하우가 없다');
  const hid = await O.rpc('hide_brand_copy', { p_entry_id: cA.id, p_hidden: true });
  const { data: cA7 } = await svc.from('playbook_entries').select('brand_hidden_at, local_modified_at').eq('id', cA.id).maybeSingle();
  check('F3 점주가 숨긴다', !hid.error && !!cA7?.brand_hidden_at, hid.error?.message);
  check('F4 숨김은 "수정"이 아니다(local_modified_at 안 찍힘)', cA7?.local_modified_at === null);
  const mxHid = await H.rpc('brand_deploy_matrix');
  check('F5 본사에는 hidden 으로만 보인다', (mxHid.data ?? []).some((r) => r.entry_id === SRC_A && r.unit_id === UNIT && r.status === 'hidden'));
  // 숙지율 분모 — 숨긴 사본은 빠진다. 지금 사본 2건 중 1건 숨김 · 이해 행 0 → 0/1 = 0
  const ovH = await H.rpc('brand_overview');
  const rowH = (ovH.data ?? []).find((r) => r.unit_id === UNIT);
  check('F6 숙지율이 계산된다(사본이 생겼으므로 null 이 아니다)', rowH && rowH.mastery !== null, JSON.stringify(rowH?.mastery));
  await svc.from('playbook_entries').update({ square: SQ('A5') }).eq('id', SRC_A);
  await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [UNIT] });
  const { data: cA8 } = await svc.from('playbook_entries').select('brand_hidden_at, brand_version').eq('id', cA.id).maybeSingle();
  check('F7 재배포해도 숨김은 유지되고 내용만 갱신된다', !!cA8?.brand_hidden_at && cA8?.brand_version === 5, JSON.stringify(cA8));
  const back = await O.rpc('hide_brand_copy', { p_entry_id: cA.id, p_hidden: false });
  const { data: cA9 } = await svc.from('playbook_entries').select('brand_hidden_at').eq('id', cA.id).maybeSingle();
  check('F8 되살리기', !back.error && cA9?.brand_hidden_at === null, back.error?.message);

  // ── G 경계 ──────────────────────────────────────────────────────────────
  console.log('\nG 경계');
  const notConn = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [OTHER] });
  check('G1 미연결(다른 브랜드) 매장에는 못 보낸다(not_connected)', errCode(notConn.error) === 'not_connected', notConn.error?.message);
  const { data: otherCopies } = await svc.from('playbook_entries').select('id').eq('unit_id', OTHER).not('brand_entry_id', 'is', null);
  check('G2 ★미연결 매장에 사본 0건(거부가 전부아니면전무였다)', (otherCopies ?? []).length === 0, `${(otherCopies ?? []).length}건`);
  const mixed = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_B], p_unit_ids: [UNIT, OTHER] });
  check('G3 연결·미연결이 섞이면 **전부** 거부(조용히 건너뛰지 않는다)', errCode(mixed.error) === 'not_connected', mixed.error?.message);
  const { data: bCopies } = await svc.from('playbook_entries').select('brand_version').eq('unit_id', UNIT).eq('brand_entry_id', SRC_B);
  check('G4 섞인 배포가 롤백돼 B 사본의 버전이 그대로다', bCopies?.[0]?.brand_version === 1, JSON.stringify(bCopies));
  const storeSrc = ownEntry?.[0]
    ? await H.rpc('brand_deploy_entries', { p_entry_ids: [ownEntry[0].id], p_unit_ids: [UNIT] })
    : null;
  if (storeSrc) check('G5 남의 매장 노하우를 원본으로 못 쓴다(entry_not_in_workspace)', errCode(storeSrc.error) === 'entry_not_in_workspace', storeSrc.error?.message);
  else skipped('G5 매장 노하우를 원본으로 쓰기 거부', 'store_001 에 자체 노하우가 없다');
  const hqRead = await H.from('playbook_entries').select('id').eq('unit_id', UNIT);
  check('G6 본사가 매장 사본을 **직접** 읽으면 0행(RLS 정책 0개 유지)', !hqRead.error && (hqRead.data ?? []).length === 0, `${(hqRead.data ?? []).length}행`);
  const jDeploy = await J.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [UNIT] });
  check('G7 직원은 배포 못 함(not_brand_member)', errCode(jDeploy.error) === 'not_brand_member', jDeploy.error?.message);
  const jMx = await J.rpc('brand_deploy_matrix');
  check('G8 직원의 교차표 0행', !jMx.error && (jMx.data ?? []).length === 0);

  // ── H 미러 뷰(대칭 가시성) ──────────────────────────────────────────────
  console.log('\nH 미러 뷰');
  const mir = await O.rpc('my_brand_mirror');
  const mRow = (mir.data ?? []).find((r) => r.unit_id === UNIT);
  const ovN = await H.rpc('brand_overview');
  const hRow = (ovN.data ?? []).find((r) => r.unit_id === UNIT);
  check('H1 점주 미러 뷰에 내 매장 1행', !mir.error && !!mRow, mir.error?.message);
  check('H2 ★본사가 보는 값과 **같다**(같은 SQL 을 지난다)',
    !!mRow && !!hRow && JSON.stringify(mRow) === JSON.stringify(hRow),
    JSON.stringify({ mine: mRow, hq: hRow }));
  check('H3 미러 뷰에 남의 매장은 없다', !(mir.data ?? []).some((r) => r.unit_id === OTHER));
  const jMir = await J.rpc('my_brand_mirror');
  check('H4 직원의 미러 뷰 0행(사장만)', !jMir.error && (jMir.data ?? []).length === 0);
  // 수준을 올리면 미러 뷰도 같이 열린다(둘이 같은 본문이라는 증거).
  await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  const mir2 = await O.rpc('my_brand_mirror');
  const m2 = (mir2.data ?? []).find((r) => r.unit_id === UNIT);
  check('H5 운영 공개로 올리면 미러 뷰의 운영 컬럼도 숫자가 된다', m2 && typeof m2.tasks_done_30d === 'number', JSON.stringify(m2));
  await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'summary' });

  // ── J 퀴즈 배포(P5 · 0219·0220) ────────────────────────────────────────
  console.log('\nJ 퀴즈 배포');
  const QI_A = `${QI_PREFIX}a`;
  const QI_B = `${QI_PREFIX}b`;
  const mc4 = (ask) => ({ ask, choices: ['하나', '둘', '셋', '넷'], answer_index: 0, explain: '설명' });
  // 작업실 원본 = 코스 1 + 항목 A·B + 문항 2(A 근거 · B 근거). service_role 로 준비(빌더 자체는 브라우저 실측 몫).
  const insC = await svc.from('training_courses').insert({
    id: SRC_C, unit_id: ws, key: 'q_qadeploy_c', name: 'QA 본사 퀴즈', description: null, preset: null,
    min_items: 1, max_items: 10, due_days: null, start_at: null, answer_days: 3, audience: null, position: 0, active: true,
  });
  const insCe = await svc.from('course_entries').insert([
    { course_id: SRC_C, entry_id: SRC_A, unit_id: ws, position: 0 },
    { course_id: SRC_C, entry_id: SRC_B, unit_id: ws, position: 1 },
  ]);
  const insQi = await svc.from('quiz_items').insert([
    { id: QI_A, unit_id: ws, entry_ids: [SRC_A], kind: 't0', format: 'mc4', payload: mc4('A 문항'), source: 'ai', status: 'active', created_by: hqId },
    { id: QI_B, unit_id: ws, entry_ids: [SRC_B], kind: 't0', format: 'mc4', payload: mc4('B 문항'), source: 'ai', status: 'active', created_by: hqId },
  ]);
  check('J1 작업실에 원본 퀴즈(코스 1 · 항목 2 · 문항 2) 준비', !insC.error && !insCe.error && !insQi.error, insC.error?.message ?? insCe.error?.message ?? insQi.error?.message);
  const ql0 = await H.rpc('brand_quiz_list');
  const q0 = (ql0.data ?? []).find((r) => r.id === SRC_C);
  check('J2 본사 퀴즈 표에 보인다(문항 2 · 노하우 2 · 배포 0 · 버전 0)', !ql0.error && q0 && q0.items === 2 && q0.entries === 2 && q0.deployed_units === 0 && q0.version === 0, ql0.error?.message ?? JSON.stringify(q0));

  // "없으면 먼저 자동 배포"를 재려고 매장의 B 사본을 지운다(A 사본은 그대로 — 건드리지 않아야 한다).
  await svc.from('playbook_entries').delete().eq('unit_id', UNIT).eq('brand_entry_id', SRC_B);
  const { data: cA0 } = await svc.from('playbook_entries').select('id, brand_version').eq('unit_id', UNIT).eq('brand_entry_id', SRC_A).maybeSingle();
  const { data: qzBefore } = await svc.from('quiz_assignments').select('id').eq('unit_id', UNIT);

  const dc1 = await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT] });
  check('J3 배포 성공(created · 노하우 1건 함께)', !dc1.error && (dc1.data ?? []).length === 1 && dc1.data[0].action === 'created' && dc1.data[0].entries_added === 1, dc1.error?.message ?? JSON.stringify(dc1.data));
  const { data: cc } = await svc.from('training_courses').select('*').eq('unit_id', UNIT).eq('brand_course_id', SRC_C).maybeSingle();
  check('J4 매장에 퀴즈 사본 1행(brand_version=1 · key=brand:<원본> · start_at null · audience null · 미수정)',
    cc && cc.brand_version === 1 && cc.key === `brand:${SRC_C}` && cc.start_at === null && cc.audience === null && cc.local_modified_at === null && cc.brand_hidden_at === null && cc.name === 'QA 본사 퀴즈' && cc.answer_days === 3,
    JSON.stringify(cc));
  const { data: cB1 } = await svc.from('playbook_entries').select('id, brand_version').eq('unit_id', UNIT).eq('brand_entry_id', SRC_B).maybeSingle();
  const { data: cA1 } = await svc.from('playbook_entries').select('id, brand_version').eq('unit_id', UNIT).eq('brand_entry_id', SRC_A).maybeSingle();
  check('J5 없던 노하우 B 만 자동 배포됐고 있던 A 는 버전이 그대로다', !!cB1 && cA1?.brand_version === cA0?.brand_version, JSON.stringify({ b: cB1, a0: cA0, a1: cA1 }));
  const { data: ceCopy } = await svc.from('course_entries').select('entry_id, position').eq('course_id', cc?.id ?? '').order('position');
  check('J6 ★사본의 course_entries 가 **그 매장 사본 id** 를 가리킨다(작업실 id 아님)',
    (ceCopy ?? []).map((r) => r.entry_id).join(',') === `${cA1?.id},${cB1?.id}`, JSON.stringify({ ce: ceCopy, a: cA1?.id, b: cB1?.id }));
  const { data: qiCopy } = await svc.from('quiz_items').select('id, entry_ids, brand_item_id, status, source_updated_at, payload').eq('unit_id', UNIT).in('brand_item_id', [QI_A, QI_B]);
  const qiA = (qiCopy ?? []).find((q) => q.brand_item_id === QI_A);
  const qiB = (qiCopy ?? []).find((q) => q.brand_item_id === QI_B);
  check('J7 ★문항 사본 2건 · entry_ids 가 매장 사본 id · 활성 · 낡음 스냅샷(0114) 찍힘',
    qiA && qiB && qiA.entry_ids.join() === cA1?.id && qiB.entry_ids.join() === cB1?.id && qiA.status === 'active' && !!qiA.source_updated_at,
    JSON.stringify(qiCopy));
  const { data: qzAfter } = await svc.from('quiz_assignments').select('id').eq('unit_id', UNIT);
  check('J8 ★★본사 배포는 quiz_assignments 를 만들지 않는다(발송은 매장 엔진)', (qzAfter ?? []).length === (qzBefore ?? []).length, `${(qzBefore ?? []).length}→${(qzAfter ?? []).length}`);
  const { data: alJ } = await svc.from('owner_alerts').select('title, body').eq('unit_id', UNIT).eq('kind', 'brand_deploy').order('created_at', { ascending: false }).limit(1);
  check('J9 점주 알림 한 행 — 퀴즈와 함께 간 노하우가 **같은 문장**에', (alJ?.[0]?.title ?? '').includes('퀴즈') && (alJ?.[0]?.body ?? '').includes('퀴즈와 노하우 1건'), JSON.stringify(alJ));
  const cm1 = await H.rpc('brand_course_matrix');
  check('J10 퀴즈 교차표 = current', !cm1.error && (cm1.data ?? []).some((r) => r.course_id === SRC_C && r.unit_id === UNIT && r.status === 'current'), cm1.error?.message ?? JSON.stringify(cm1.data));
  const ql1 = await H.rpc('brand_quiz_list');
  const q1 = (ql1.data ?? []).find((r) => r.id === SRC_C);
  check('J11 표에 배포 매장 1곳 · 버전 1', q1?.deployed_units === 1 && q1?.version === 1, JSON.stringify(q1));

  // 미수정 자동 갱신 — 원본 이름·문항을 고쳐 재배포.
  await svc.from('training_courses').update({ name: 'QA 본사 퀴즈(고침)' }).eq('id', SRC_C);
  await svc.from('quiz_items').update({ payload: mc4('A 문항(고침)') }).eq('id', QI_A);
  const dc2 = await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT] });
  const { data: cc2 } = await svc.from('training_courses').select('name, brand_version, local_modified_at, brand_pending_version').eq('id', cc?.id ?? '').maybeSingle();
  const { data: qiA2 } = await svc.from('quiz_items').select('payload').eq('id', qiA?.id ?? '').maybeSingle();
  check('J12 재배포 → updated · 이름·문항 갱신 · brand_version=2 · ★local_modified_at 은 null(코스 트리거 우회 + 문항 트리거는 배포 중 잠김)',
    !dc2.error && dc2.data?.[0]?.action === 'updated' && dc2.data[0].entries_added === 0 && cc2?.name === 'QA 본사 퀴즈(고침)' && cc2?.brand_version === 2 && cc2?.local_modified_at === null && qiA2?.payload?.ask === 'A 문항(고침)',
    dc2.error?.message ?? JSON.stringify({ r: dc2.data, c: cc2, q: qiA2?.payload }));

  // 점주가 코스 이름을 고치면 '수정됨'(0219 코스 트리거).
  const oName = await O.from('training_courses').update({ name: '우리 매장 퀴즈' }).eq('id', cc.id).select('id');
  const { data: cc3 } = await svc.from('training_courses').select('local_modified_at').eq('id', cc.id).maybeSingle();
  check('J13 점주가 이름을 고치면 local_modified_at 이 찍힌다', !oName.error && (oName.data ?? []).length === 1 && !!cc3?.local_modified_at, oName.error?.message ?? JSON.stringify(cc3));
  // 문항 수정도 '수정'이다(0219 문항 트리거) — 코스 스탬프를 비운 뒤 문항만 고쳐서 따로 잰다.
  await svc.from('training_courses').update({ local_modified_at: null }).eq('id', cc.id);
  const oItem = await O.from('quiz_items').update({ payload: mc4('우리 매장식 A 문항') }).eq('id', qiA.id).select('id');
  const { data: cc4 } = await svc.from('training_courses').select('local_modified_at').eq('id', cc.id).maybeSingle();
  check('J14 ★점주가 문항을 고쳐도 퀴즈 사본에 local_modified_at 이 찍힌다(재배포가 문항을 되돌리지 않게)', !oItem.error && (oItem.data ?? []).length === 1 && !!cc4?.local_modified_at, oItem.error?.message ?? JSON.stringify(cc4));
  const cmMod = await H.rpc('brand_course_matrix');
  check('J15 교차표 modified', (cmMod.data ?? []).some((r) => r.course_id === SRC_C && r.unit_id === UNIT && r.status === 'modified'));

  // 수정본 → 대기.
  await svc.from('training_courses').update({ name: 'QA 본사 퀴즈(v3)' }).eq('id', SRC_C);
  await svc.from('quiz_items').update({ payload: mc4('A 문항(v3)') }).eq('id', QI_A);
  const dc3 = await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT] });
  const { data: cc5 } = await svc.from('training_courses').select('name, brand_version, brand_pending_version').eq('id', cc.id).maybeSingle();
  const { data: qiA3 } = await svc.from('quiz_items').select('payload').eq('id', qiA.id).maybeSingle();
  check('J16 재배포 → pending · 이름·문항 안 덮음 · brand_pending_version=3',
    !dc3.error && dc3.data?.[0]?.action === 'pending' && cc5?.name === '우리 매장 퀴즈' && cc5?.brand_version === 2 && cc5?.brand_pending_version === 3 && qiA3?.payload?.ask === '우리 매장식 A 문항',
    dc3.error?.message ?? JSON.stringify({ r: dc3.data, c: cc5, q: qiA3?.payload }));
  const jKeep = await J.rpc('apply_brand_course_pending', { p_course_id: cc.id, p_replace: false });
  check('J17 직원은 답할 수 없다(not_owner)', errCode(jKeep.error) === 'not_owner', jKeep.error?.message);
  const keepC = await O.rpc('apply_brand_course_pending', { p_course_id: cc.id, p_replace: false });
  const { data: cc6 } = await svc.from('training_courses').select('name, brand_version, brand_pending_version, local_modified_at').eq('id', cc.id).maybeSingle();
  check('J18 유지 → 내용 그대로 · pending 비움 · brand_version=3 · 여전히 수정본', !keepC.error && cc6?.name === '우리 매장 퀴즈' && cc6?.brand_pending_version === null && cc6?.brand_version === 3 && !!cc6?.local_modified_at, keepC.error?.message ?? JSON.stringify(cc6));
  await svc.from('training_courses').update({ name: 'QA 본사 퀴즈(v4)' }).eq('id', SRC_C);
  await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT] });
  const replC = await O.rpc('apply_brand_course_pending', { p_course_id: cc.id, p_replace: true });
  const { data: cc7 } = await svc.from('training_courses').select('name, brand_version, brand_pending_version, local_modified_at').eq('id', cc.id).maybeSingle();
  const { data: qiA4 } = await svc.from('quiz_items').select('payload').eq('id', qiA.id).maybeSingle();
  check('J19 교체 → 이름·문항이 원본으로 · 미수정으로 돌아간다(local_modified_at null · brand_version=4)',
    !replC.error && cc7?.name === 'QA 본사 퀴즈(v4)' && cc7?.local_modified_at === null && cc7?.brand_pending_version === null && cc7?.brand_version === 4 && qiA4?.payload?.ask === 'A 문항(v3)',
    replC.error?.message ?? JSON.stringify({ c: cc7, q: qiA4?.payload }));

  // 숨김 — 아직 안 나간 발송은 취소된다. 나간 것은 남는다.
  const jrId = (await J.auth.getUser()).data.user.id;
  const insQz = await svc.from('quiz_assignments').insert([
    { id: 'qz_qadeploy_pending', unit_id: UNIT, course_id: cc.id, user_id: jrId, scheduled_on: '2026-01-01', sent_at: null },
    { id: 'qz_qadeploy_sent', unit_id: UNIT, course_id: cc.id, user_id: jrId, scheduled_on: '2026-01-02', sent_at: new Date().toISOString() },
  ]);
  const jHideC = await J.rpc('hide_brand_course', { p_course_id: cc.id, p_hidden: true });
  check('J20 직원은 퀴즈를 숨길 수 없다(not_owner)', errCode(jHideC.error) === 'not_owner', jHideC.error?.message);
  const hidC = await O.rpc('hide_brand_course', { p_course_id: cc.id, p_hidden: true });
  const { data: cc8 } = await svc.from('training_courses').select('brand_hidden_at, local_modified_at').eq('id', cc.id).maybeSingle();
  const { data: qzLeft } = await svc.from('quiz_assignments').select('id').in('id', ['qz_qadeploy_pending', 'qz_qadeploy_sent']);
  check('J21 점주가 숨긴다 · 안 나간 발송만 취소(나간 것은 기록으로 남는다) · 숨김은 수정이 아니다',
    !insQz.error && !hidC.error && !!cc8?.brand_hidden_at && cc8?.local_modified_at === null && (qzLeft ?? []).map((r) => r.id).join() === 'qz_qadeploy_sent',
    insQz.error?.message ?? hidC.error?.message ?? JSON.stringify({ c: cc8, qz: qzLeft }));
  const cmHid = await H.rpc('brand_course_matrix');
  check('J22 본사에는 hidden 으로만 보인다', (cmHid.data ?? []).some((r) => r.course_id === SRC_C && r.unit_id === UNIT && r.status === 'hidden'));
  await svc.from('training_courses').update({ name: 'QA 본사 퀴즈(v5)' }).eq('id', SRC_C);
  await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT] });
  const { data: cc9 } = await svc.from('training_courses').select('name, brand_hidden_at, brand_version').eq('id', cc.id).maybeSingle();
  check('J23 재배포해도 숨김은 유지되고 내용만 갱신된다', cc9?.name === 'QA 본사 퀴즈(v5)' && !!cc9?.brand_hidden_at && cc9?.brand_version === 5, JSON.stringify(cc9));
  const backC = await O.rpc('hide_brand_course', { p_course_id: cc.id, p_hidden: false });
  check('J24 되살리기', !backC.error, backC.error?.message);
  await svc.from('quiz_assignments').delete().like('id', 'qz_qadeploy_%');

  // 숨긴 노하우 사본을 근거로 하는 문항은 출제·개수에서 빠진다(지시서 §1 #5 · 0220).
  await O.rpc('hide_brand_copy', { p_entry_id: cA1.id, p_hidden: true });
  const served = await J.rpc('quiz_items_for', { p_entry_ids: [cA1.id, cB1.id], p_limit: 10 });
  const counts = await J.rpc('quiz_item_counts');
  check('J25 ★숨긴 노하우(A)의 문항은 직원 응시에서 빠지고 B 문항만 나간다',
    !served.error && (served.data ?? []).some((r) => r.id === qiB.id) && !(served.data ?? []).some((r) => r.id === qiA.id),
    served.error?.message ?? JSON.stringify((served.data ?? []).map((r) => r.id)));
  check('J26 개수도 같은 기준(A 는 0 · B 는 1)',
    !counts.error && !(counts.data ?? []).some((r) => r.entry_id === cA1.id) && (counts.data ?? []).some((r) => r.entry_id === cB1.id && r.n >= 1),
    counts.error?.message ?? JSON.stringify(counts.data));
  await O.rpc('hide_brand_copy', { p_entry_id: cA1.id, p_hidden: false });
  const served2 = await J.rpc('quiz_items_for', { p_entry_ids: [cA1.id, cB1.id], p_limit: 10 });
  check('J27 되살리면 다시 나간다', (served2.data ?? []).some((r) => r.id === qiA.id));

  // 경계.
  const notConnC = await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [OTHER] });
  const mixedC = await H.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT, OTHER] });
  const { data: otherC } = await svc.from('training_courses').select('id').eq('unit_id', OTHER).eq('brand_course_id', SRC_C);
  check('J28 미연결 매장·섞인 대상은 전부 거부(not_connected) · 사본 0건', errCode(notConnC.error) === 'not_connected' && errCode(mixedC.error) === 'not_connected' && (otherC ?? []).length === 0, `${notConnC.error?.message} / ${mixedC.error?.message} / ${(otherC ?? []).length}`);
  const jDepC = await J.rpc('brand_deploy_course', { p_course_id: SRC_C, p_unit_ids: [UNIT] });
  check('J29 직원은 퀴즈를 배포 못 함(not_brand_member)', errCode(jDepC.error) === 'not_brand_member', jDepC.error?.message);
  const storeC = await H.rpc('brand_deploy_course', { p_course_id: cc.id, p_unit_ids: [UNIT] });
  check('J30 매장 퀴즈(사본 포함)를 원본으로 못 쓴다(course_not_in_workspace)', errCode(storeC.error) === 'course_not_in_workspace', storeC.error?.message);
  const hqReadC = await H.from('training_courses').select('id').eq('unit_id', UNIT);
  const hqReadQ = await H.from('quiz_items').select('id').eq('unit_id', UNIT);
  check('J31 본사가 매장 퀴즈·문항을 **직접** 읽으면 0행(RLS 정책 0개 유지)', !hqReadC.error && (hqReadC.data ?? []).length === 0 && !hqReadQ.error && (hqReadQ.data ?? []).length === 0);
  const jCm = await J.rpc('brand_course_matrix');
  const jQl = await J.rpc('brand_quiz_list');
  check('J32 직원의 퀴즈 표·교차표 0행', !jCm.error && (jCm.data ?? []).length === 0 && !jQl.error && (jQl.data ?? []).length === 0);

  // ── I 해제 후 잔존 ──────────────────────────────────────────────────────
  console.log('\nI 해제 후 사본 잔존');
  const end = await O.rpc('end_brand_unit', { p_unit_id: UNIT, p_reason: 'qa_deploy' });
  const { data: leftover } = await svc.from('playbook_entries').select('id, status, brand_entry_id').eq('unit_id', UNIT).in('brand_entry_id', [SRC_A, SRC_B]);
  check('I1 ★해제해도 사본은 매장에 남는다(정본 §4-B)', !end.error && (leftover ?? []).length === 2 && leftover.every((r) => r.status === 'published'), end.error?.message ?? JSON.stringify(leftover));
  const { data: leftC } = await svc.from('training_courses').select('id, active').eq('unit_id', UNIT).eq('brand_course_id', SRC_C);
  check('I1b 퀴즈 사본도 남는다(P5)', (leftC ?? []).length === 1 && leftC[0].active === true, JSON.stringify(leftC));
  const mxEnd = await H.rpc('brand_deploy_matrix');
  check('I2 해제 뒤 본사 교차표에서는 사라진다(active 연결만)', !(mxEnd.data ?? []).some((r) => r.unit_id === UNIT));
  const depEnd = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC_A], p_unit_ids: [UNIT] });
  check('I3 해제 뒤에는 더 못 보낸다(not_connected)', errCode(depEnd.error) === 'not_connected', depEnd.error?.message);
  const { data: leftCopy } = await svc.from('playbook_entries').select('id').eq('unit_id', UNIT).eq('brand_entry_id', SRC_A).maybeSingle();
  const applyEnd = leftCopy ? await O.rpc('apply_brand_pending', { p_entry_id: leftCopy.id, p_replace: true }) : { error: { message: 'x' } };
  check('I4 해제 뒤 교체 시도는 거부된다(원본을 못 읽는다)', !!applyEnd.error, JSON.stringify(applyEnd.error));

  await O.auth.signOut(); await H.auth.signOut(); await J.auth.signOut();
} catch (e) {
  fail++;
  console.log('\n✗ 하니스 중단:', String(e).slice(0, 400));
}
await cleanup(ws);
// ★건너뛴 것을 통과로 세지 않는다(AGENTS 게이트 거짓말 3종).
console.log(`\n── 결과 ── pass ${pass} / fail ${fail}${skip ? ` / skip ${skip}` : ''}`);
process.exit(fail ? 1 : 0);
