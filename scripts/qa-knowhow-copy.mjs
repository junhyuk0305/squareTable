#!/usr/bin/env node
// qa-knowhow-copy.mjs — 다점포 노하우 복제(0059) 라이브 증명 + 크로스테넌트 격리.
// 실행: node --env-file=.env.seed scripts/qa-knowhow-copy.mjs   (service_role = 임베딩 시드 + 스윕)
//
// 검증:
//  · 오너 O: 매장 A(소스)·B(대상). A에 발행 노하우 1건(+임베딩 시드) → 활성 B로 전환 → copy_knowhow(A,[id]).
//  · 복제결과: B에 새 id·needs_review=true·photos=[]·stats={}·published, 임베딩도 복제(즉시 검색가능).
//  · 격리(핵심): 라이벌 오너 X 는 list_unit_knowhow(A)/copy_knowhow(A,…) 둘 다 소유검증에서 거부.
//  · same_unit / too_many 가드.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const f of ['.env', '.env.seed']) {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    }
  } catch {}
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON) { console.error('FAIL: URL/ANON 필요'); process.exit(2); }
if (!SRV) { console.error('FAIL: SERVICE_ROLE 필요(.env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const rid = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  PASS', n, x)) : (fail++, console.log('  FAIL', n, x)); };
const phone = () => '010' + String(Math.floor(1e7 + Math.random() * 8e7));
const vec768 = '[' + Array.from({ length: 768 }, (_, i) => (i === 0 ? 0.1 : 0.001)).join(',') + ']';

async function makeOwner(tag) {
  const c = mk();
  const { data: su, error: se } = await c.auth.signUp({ email: `kc_${tag}_${rid}@example.com`, password: pw, options: { data: { name: `KC_${tag}`, role: 'owner', phone: phone(), birth_date: '1990-01-15' } } });
  if (se) throw new Error(`${tag} signUp: ${se.message}`);
  if (!su.session) throw new Error(`${tag} no session`);
  return { c, uid: su.user.id };
}
async function createStore(c, name) {
  const { data, error } = await c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
  if (error) throw new Error(`create_store ${name}: ${error.message}`);
  return (Array.isArray(data) ? data[0] : data).unit_id;
}

async function main() {
  console.log('· 노하우 복제 라이브 증명:', URL, '\n');
  const O = await makeOwner('O');
  const A = await createStore(O.c, `KC소스_${rid}`);   // 소스매장(생성 → 활성)
  const B = await createStore(O.c, `KC대상_${rid}`);   // 대상매장(생성 → 활성으로 이동)
  // 이 시점 활성=B. A에 노하우를 넣으려면 A로 전환.
  await O.c.rpc('switch_active_unit', { p_unit_id: A });

  // A에 발행 노하우 1건 (활성=A라 RLS insert 통과)
  const srcId = `pb_${rid}_src`;
  const { error: insErr } = await O.c.from('playbook_entries').insert({
    id: srcId, unit_id: A, creator_id: O.uid, creator_name: 'KC_O',
    category: 'Know-how', subcategory: '응대', title: '환불 응대 표준',
    tags: ['환불', '응대'], search_keywords: ['환불'],
    square: { situation: '머리카락 클레임', todo: '사과 후 재조리', forbidden: '언쟁' },
    photos: ['photos/some/path.webp'], status: 'published', needs_review: false,
  });
  check('소스 노하우 발행 insert', !insErr, insErr?.message ?? '');
  // 임베딩 시드(service_role) — 복제 시 함께 넘어오는지 확인용
  const { error: embErr } = await admin.from('playbook_embeddings').insert({ entry_id: srcId, unit_id: A, embedding: vec768 });
  check('소스 임베딩 시드', !embErr, embErr?.message ?? '');

  // 활성 = B(대상)로 전환 후 복제
  await O.c.rpc('switch_active_unit', { p_unit_id: B });

  // list_unit_knowhow(A): 소유자라 목록 반환
  const { data: listed, error: listErr } = await O.c.rpc('list_unit_knowhow', { p_from_unit: A });
  check('list_unit_knowhow(A): 발행 1건 반환', !listErr && (listed?.length ?? 0) === 1 && listed?.[0]?.id === srcId, listErr?.message ?? `n=${listed?.length}`);

  // copy_knowhow(A,[srcId]) → 1
  const { data: copied, error: copyErr } = await O.c.rpc('copy_knowhow', { p_from_unit: A, p_entry_ids: [srcId] });
  check('copy_knowhow → 복제수 1', !copyErr && copied === 1, copyErr?.message ?? `n=${copied}`);

  // B(활성)에서 복제본 확인
  const { data: bEntries } = await O.c.from('playbook_entries').select('*').eq('unit_id', B);
  const copy = bEntries?.find((e) => e.title === '환불 응대 표준');
  check('B에 복제본 존재', !!copy, `rows=${bEntries?.length}`);
  check('복제본 새 id (소스와 다름)', copy && copy.id !== srcId, copy?.id);
  check('복제본 unit_id = B', copy?.unit_id === B, copy?.unit_id);
  check('복제본 needs_review=true', copy?.needs_review === true, String(copy?.needs_review));
  check('복제본 photos 드롭([])', Array.isArray(copy?.photos) && copy.photos.length === 0, JSON.stringify(copy?.photos));
  check('복제본 square 보존', copy?.square?.situation === '머리카락 클레임', JSON.stringify(copy?.square));
  check('복제본 status=published', copy?.status === 'published', copy?.status);

  // 임베딩 복제 확인(service_role — B 유닛에 새 entry_id 임베딩)
  const { data: bEmb } = await admin.from('playbook_embeddings').select('entry_id, unit_id').eq('unit_id', B);
  check('임베딩도 복제됨(B에 1건, 새 id)', (bEmb?.length ?? 0) === 1 && bEmb?.[0]?.entry_id === copy?.id, `rows=${bEmb?.length}`);

  // same_unit 가드: 활성=B에서 from=B 복제 시도
  const { error: sameErr } = await O.c.rpc('copy_knowhow', { p_from_unit: B, p_entry_ids: [copy?.id] });
  check('same_unit 가드', /same_unit/.test(sameErr?.message ?? ''), sameErr?.message ?? '(거부 안됨!)');

  // ── ★크로스테넌트: 라이벌 오너 X 는 A를 못 읽고 못 복제 ──
  const X = await makeOwner('X');
  const C = await createStore(X.c, `KC라이벌_${rid}`);  // X 활성=C
  const { data: xList, error: xListErr } = await X.c.rpc('list_unit_knowhow', { p_from_unit: A });
  check('X→list_unit_knowhow(A) 거부(not_owner)', /not_owner/.test(xListErr?.message ?? '') && !xList?.length, xListErr?.message ?? `leaked n=${xList?.length}`);
  const { data: xCopy, error: xCopyErr } = await X.c.rpc('copy_knowhow', { p_from_unit: A, p_entry_ids: [srcId] });
  check('X→copy_knowhow(A) 거부(not_owner_source)', /not_owner_source/.test(xCopyErr?.message ?? ''), xCopyErr?.message ?? `copied=${xCopy}`);
  // X의 C에 A 노하우가 새지 않았는지 재확인
  const { data: cEntries } = await X.c.from('playbook_entries').select('id').eq('unit_id', C);
  check('X 매장 C에 유출 0건', (cEntries?.length ?? 0) === 0, `rows=${cEntries?.length}`);

  // ── 통합뷰(owner_overview, 0060) — 소유 매장만 집계 + 크로스테넌트 격리 ──
  const { data: ov, error: ovErr } = await O.c.rpc('owner_overview');
  check('owner_overview: O는 2개 매장', !ovErr && (ov?.length ?? 0) === 2, ovErr?.message ?? `n=${ov?.length}`);
  const ovA = ov?.find((r) => r.unit_id === A);
  const ovB = ov?.find((r) => r.unit_id === B);
  check('통합뷰: A·B 모두 포함', !!ovA && !!ovB, `A=${!!ovA} B=${!!ovB}`);
  check('통합뷰: B 노하우 ≥ 1(복제 반영)', (ovB?.knowhow ?? 0) >= 1, `B.knowhow=${ovB?.knowhow}`);
  check('통합뷰: 활성 = B', ovB?.is_active === true && ovA?.is_active === false, `B.active=${ovB?.is_active} A.active=${ovA?.is_active}`);
  // 크로스테넌트: X의 통합뷰엔 O의 매장(A/B)이 절대 없어야 함(소유 매장만)
  const { data: ovX, error: ovXErr } = await X.c.rpc('owner_overview');
  const leaked = (ovX ?? []).some((r) => r.unit_id === A || r.unit_id === B);
  check('통합뷰 크로스테넌트: X에 O매장 유출 0', !ovXErr && !leaked && (ovX?.length ?? 0) === 1 && ovX?.[0]?.unit_id === C, `n=${ovX?.length} leaked=${leaked}`);

  // 정리(service_role 스윕: 계정+매장)
  try { await O.c.rpc('delete_my_account'); } catch {}
  try { await X.c.rpc('delete_my_account'); } catch {}
  for (const uid of [O.uid, X.uid]) { try { await admin.auth.admin.deleteUser(uid); } catch {} }
  for (const u of [A, B, C]) { try { await admin.from('units').delete().eq('id', u); } catch {} }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
