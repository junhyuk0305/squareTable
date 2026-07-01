// scripts/seed-eval.mjs — 격리된 "평가 전용" 매장 하나를 심는다(운영/파일럿과 완전 분리).
//   store_eval + 테스트 사장/알바 계정 + 노하우 12건(새 id eval_*, stats 0) + 임베딩 + 매칭 라벨셋.
//   운영 store_001 을 절대 건드리지 않는다(다른 unit_id·다른 id 접두사·다른 계정).
//
// 왜 별도 스크립트인가: seed.mjs 는 UNIT_ID='store_001' 하드코딩 + pb_* id 재사용이라,
//   같은 DB에 두 번째 매장을 만들면 playbook_entries.id(전역 PK)가 충돌한다. 그래서 id를
//   eval_ 로 접두하고 라벨셋도 그에 맞춰 생성한다.
//
// 실행(.env.seed 의 service_role + .env 의 anon 사용):
//   node scripts/seed-eval.mjs
//   (환경변수로도 덮어쓰기 가능: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVAL_PASSWORD)
//
// 멱등: 다시 돌려도 안전(계정 존재하면 재사용, 매장/노하우 upsert, 라벨셋 덮어씀).
// 임베딩은 Edge 'embed'(서버 Gemini 키 사용)로 처리 → 로컬 GEMINI_API_KEY 불필요.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(__dir, '..', 'src', 'data', p), 'utf8'));
const readEnv = (file) => {
  try {
    const t = readFileSync(join(__dir, '..', file), 'utf8');
    const o = {};
    for (const line of t.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    }
    return o;
  } catch { return {}; }
};

const envSeed = readEnv('.env.seed');
const envApp = readEnv('.env');

const URL = process.env.SUPABASE_URL || envSeed.SUPABASE_URL || envApp.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || envSeed.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || envApp.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SERVICE) { console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.seed).'); process.exit(1); }
if (!ANON) { console.error('✗ EXPO_PUBLIC_SUPABASE_ANON_KEY 필요(.env) — 임베딩 로그인용.'); process.exit(1); }

const UNIT_ID = 'store_eval';
const OWNER_EMAIL = process.env.EVAL_OWNER_EMAIL || 'eval-owner@squaretable.test';
const STAFF_EMAIL = process.env.EVAL_STAFF_EMAIL || 'eval-staff@squaretable.test';
const PASSWORD = process.env.EVAL_PASSWORD || 'evaltest1234';
const ID_PREFIX = 'eval_';

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 계정 프로비저닝(seed.mjs 와 동일 패턴) ──────────────────────
async function ensureUser(email, meta) {
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: meta,
  });
  if (error) {
    if (/already.*registered|exists|been registered/i.test(error.message)) {
      const { data: list } = await db.auth.admin.listUsers();
      const found = list.users.find((u) => u.email === email);
      console.log(`  · 기존 계정 사용: ${email}`);
      return found;
    }
    throw error;
  }
  console.log(`  · 계정 생성: ${email} / 비번 ${PASSWORD}`);
  return data.user;
}

// ── 임베딩 텍스트(searchClient.buildEmbedText / backfill 과 동일 구성) ──
const CAT_LABEL = { Routine: '루틴', Event: '돌발', Context: '원칙', 'Know-how': '꿀팁' };
function buildEmbedText(e) {
  const sq = e.square ?? {};
  return [e.title, CAT_LABEL[e.category] ?? e.category, sq.situation,
    (sq.action?.steps ?? []).join(' '), sq.extract?.dont, (e.search_keywords ?? []).join(' ')]
    .filter(Boolean).join('\n').slice(0, 4000);
}

async function main() {
  const ctx = readJson('context-pack.json');
  const srcEntries = readJson('playbook-entries.json');

  console.log('1) 평가 매장 upsert (store_eval)');
  await db.from('units').upsert({
    id: UNIT_ID,
    store_name: '평가테스트 카페(eval)',
    industry: ctx.industry,
    subcategory: ctx.subcategory,
    invite_code: 'EVAL01',
    context: { ...ctx, unit_id: UNIT_ID, store_name: '평가테스트 카페(eval)' },
  }).throwOnError();

  console.log('2) 테스트 계정 프로비저닝');
  const owner = await ensureUser(OWNER_EMAIL, { name: '평가사장', role: 'owner', unit_id: UNIT_ID });
  const staff = await ensureUser(STAFF_EMAIL, { name: '평가알바', role: 'junior', unit_id: UNIT_ID });
  await db.from('profiles').update({ unit_id: UNIT_ID, role: 'owner', name: '평가사장' }).eq('id', owner.id);
  await db.from('profiles').update({ unit_id: UNIT_ID, role: 'junior', name: '평가알바' }).eq('id', staff.id);
  await db.from('units').update({ owner_id: owner.id }).eq('id', UNIT_ID);

  // 프로필 검증(트리거 변경으로 행이 없을 수 있음 → 명확히 실패시킨다).
  const { data: profs } = await db.from('profiles').select('id, unit_id, role').eq('unit_id', UNIT_ID);
  if (!profs || profs.length < 2) {
    console.error(`✗ 프로필 세팅 불완전(unit=${UNIT_ID} 프로필 ${profs?.length ?? 0}개). 트리거 확인 필요.`);
    process.exit(1);
  }

  console.log('3) 노하우 12건 upsert (id=eval_*, stats 0, creator=평가사장)');
  const entries = srcEntries.map((e) => ({
    ...e,
    id: ID_PREFIX + e.id,
    unit_id: UNIT_ID,
    creator_id: owner.id,
    creator_name: '평가사장',
    status: 'published',
    stats: { query_hits_30d: 0, resolution_rate: 0, thumbs_up: 0, thumbs_down: 0 },
  }));
  await db.from('playbook_entries').upsert(entries).throwOnError();

  console.log('4) 매칭 라벨셋 생성 (scripts/eval-labelset.json, expected id → eval_*)');
  const sample = JSON.parse(readFileSync(join(__dir, 'eval-labelset.sample.json'), 'utf8'));
  const remap = (id) => (id == null ? null : ID_PREFIX + id);
  const cases = (sample.cases || []).map((c) => ({
    ...c,
    ...(c.expected_entry_id !== undefined ? { expected_entry_id: remap(c.expected_entry_id) } : {}),
    ...(c.expected_entry_ids ? { expected_entry_ids: c.expected_entry_ids.map(remap) } : {}),
  }));
  writeFileSync(
    join(__dir, 'eval-labelset.json'),
    JSON.stringify({
      version: 1,
      notes: `store_eval(격리 평가매장) 바인딩. expected_entry_id는 eval_* (seed-eval.mjs 생성). 운영 store_001 과 무관.`,
      cases,
    }, null, 2) + '\n',
  );

  console.log('5) 임베딩 생성 (Edge embed, 서버 Gemini 키 사용 · 페이싱)');
  // 운영 store_001 을 안 건드리려 service_role 직접쓰기 대신, eval 사장 토큰으로 Edge 'embed' 호출.
  const H = { apikey: ANON, 'Content-Type': 'application/json' };
  const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: H, body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
  })).json();
  if (!auth.access_token) { console.error('✗ eval 사장 로그인 실패(임베딩 생략):', auth.error_description || ''); process.exit(1); }
  const AH = { ...H, Authorization: `Bearer ${auth.access_token}` };

  let ok = 0, fail = 0;
  for (const e of entries) {
    let done = false;
    for (let attempt = 1; attempt <= 4 && !done; attempt++) {
      const res = await fetch(`${URL}/functions/v1/ai`, {
        method: 'POST', headers: AH,
        body: JSON.stringify({ task: 'embed', payload: { entryId: e.id, text: buildEmbedText(e) } }),
      });
      if (res.status === 429) { await sleep(9000 * attempt); continue; } // 분당 캡 회복 대기
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok !== false) { ok++; done = true; process.stdout.write('.'); }
      else { fail++; console.warn(`\n   ✗ ${e.id}: ${res.status} ${JSON.stringify(j).slice(0, 120)}`); done = true; }
    }
    await sleep(8000); // user 분당 캡(10) 밑으로 페이싱 (~7.5/min)
  }
  console.log(`\n   임베딩 성공 ${ok} / 실패 ${fail}`);

  console.log('\n✓ 평가 매장 시드 완료');
  console.log(`  매장: ${UNIT_ID} (평가테스트 카페)`);
  console.log(`  사장 로그인: ${OWNER_EMAIL} / ${PASSWORD}`);
  console.log(`  알바 로그인: ${STAFF_EMAIL} / ${PASSWORD}`);
  console.log(`  노하우: ${entries.length}건 (eval_*), 라벨셋: scripts/eval-labelset.json`);
  console.log(`\n  다음: OPS_EMAIL=${OWNER_EMAIL} OPS_PW=${PASSWORD} node scripts/eval-knowhow-ops.mjs`);
}

main().catch((e) => { console.error('✗ 시드 실패:', e.message ?? e); process.exit(1); });
