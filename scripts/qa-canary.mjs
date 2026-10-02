// qa-canary.mjs — 라이브가 **살아 있나**만 본다. 읽기 전용 · 쓰기 0 · AI 호출 0. (2026-09-23)
//
// 왜: 라이브가 조용히 깨져도 지금은 사용자가 말해 줘야 안다. 기존 하니스들은 크고 느리고
//   계정·매장을 만들었다 지우므로 자주 돌릴 수 없다. 이 파일은 **핵심 길 6개만** 한 번씩 찔러
//   "죽었다/살았다"만 답한다. GitHub Actions 크론이 이것을 돌린다(.github/workflows/qa-canary.yml).
//
// ★★대상 DB 결정 줄(이 파일에서 유일하게 중요한 줄) ───────────────────────────
//   `process.env` **만** 본다. `.env`·`.env.seed` 파일을 읽지 않는다.
//   다른 하니스는 파일을 섞어 읽어서 "로컬인 줄 알고 라이브를 치는" 사고가 났다
//   (2026-09-23 · scripts/lib/seed-target.mjs 머리주석). 이 파일은 그 혼동 자체를 없앤다 —
//   **환경변수로 준 곳만 친다. 안 주면 안 돈다.**
//   필요: EXPO_PUBLIC_SUPABASE_URL · EXPO_PUBLIC_SUPABASE_ANON_KEY · QA_EMAIL · QA_PASSWORD
//
// 재는 것(6):
//   1 로그인        — 고정 계정(메모리 feedback_qa_use_fixed_accounts). ⛔계정 신설 없음
//   2 노하우 조회   — playbook_entries 가 내 매장 행을 준다
//   3 의미검색      — match_playbook 1회. **이미 있는 임베딩을 되먹인다**(임베딩 API 호출 0 = AI 캡 0)
//   4 퀴즈 출제     — quiz_items_for 1회(0220 이 재정의한, 제일 자주 도는 경로)
//   5 사진          — 서명 URL 1건 발급 + 200 확인(0198·0218 정책이 살아 있나)
//   6 사장 홈       — owner_today
//
// ⛔쓰지 않는다: insert·update·delete·upsert·RPC 중 volatile 한 것. 유일한 부수효과는
//   로그인이 만드는 세션 하나이고, 끝에 signOut 으로 닫는다.
// 종료 코드: 실패 1건이라도 있으면 1(= Actions 가 빨간불). SKIP 은 실패가 아니다.

import { createClient } from '@supabase/supabase-js';

const URL_  = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON  = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL;
const PW    = process.env.QA_PASSWORD;

if (!URL_ || !ANON || !EMAIL || !PW) {
  console.error('✗ 환경변수 필요: EXPO_PUBLIC_SUPABASE_URL · EXPO_PUBLIC_SUPABASE_ANON_KEY · QA_EMAIL · QA_PASSWORD');
  console.error('  (이 하니스는 .env 파일을 읽지 않는다 — 대상을 흐리지 않기 위해서다)');
  process.exit(2);
}

let pass = 0, fail = 0, skip = 0;
const ok   = (n, extra = '') => { pass++; console.log(`  ✓ ${n}${extra ? ' ' + extra : ''}`); };
const bad  = (n, extra = '') => { fail++; console.log(`  ✗ ${n}${extra ? ' ' + extra : ''}`); };
const pass_or_fail = (n, cond, extra = '') => (cond ? ok(n) : bad(n, extra));
const skipped = (n, why) => { skip++; console.log(`  – ${n} (건너뜀: ${why})`); };

const db = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`\nqa:canary — 대상 ${URL_}\n`);

// ── 1 로그인 ───────────────────────────────────────────────────────────────
const { data: auth, error: authErr } = await db.auth.signInWithPassword({ email: EMAIL, password: PW });
if (authErr || !auth?.user) {
  bad('1 로그인', authErr?.message ?? '세션 없음');
  // ★`process.exit` 로 끊지 않는다 — 열린 핸들이 있으면 Windows 노드가 UV 어설션으로 죽어
  //   종료 코드가 127 로 뒤바뀐다(메모리 qa_harness_traps 4). exitCode 만 세우고 자연 종료한다.
  process.exitCode = 1;
}
// 로그인이 실패했으면 나머지는 의미가 없다. 아래는 전부 세션이 있을 때만 돈다.
else {
ok('1 로그인', EMAIL);

// ── 2 노하우 조회 ──────────────────────────────────────────────────────────
const { data: prof } = await db.from('profiles').select('active_unit_id, unit_id').eq('id', auth.user.id).maybeSingle();
const UNIT = prof?.active_unit_id ?? prof?.unit_id ?? null;
const ent = await db.from('playbook_entries')
  .select('id, title, photos').eq('status', 'published').limit(5);
const entries = ent.data ?? [];
pass_or_fail('2 노하우 조회', !ent.error && entries.length > 0,
  ent.error?.message ?? `unit=${UNIT} 0행 — 매장에 발행 노하우가 없다`);

// ── 3 의미검색(match_playbook) — 있는 임베딩을 되먹인다(AI 호출 0) ─────────
if (!UNIT) {
  skipped('3 의미검색', '활성 매장을 못 찾았다');
} else {
  const emb = await db.from('playbook_embeddings').select('embedding').limit(1).maybeSingle();
  if (emb.error || !emb.data?.embedding) {
    skipped('3 의미검색', emb.error?.message ?? '읽을 임베딩이 없다');
  } else {
    const vec = typeof emb.data.embedding === 'string' ? emb.data.embedding : JSON.stringify(emb.data.embedding);
    const m = await db.rpc('match_playbook', { query_embedding: vec, p_unit_id: UNIT, match_count: 5 });
    // 자기 자신이 최소 1건 잡혀야 한다 — 0행이면 색인이나 함수가 죽은 것이다.
    pass_or_fail('3 의미검색(match_playbook)', !m.error && (m.data ?? []).length > 0,
      m.error?.message ?? '0행 — 색인 또는 함수 이상');
  }
}

// ── 4 퀴즈 출제(quiz_items_for) — 0220 이 재정의한 경로 ────────────────────
if (entries.length === 0) {
  skipped('4 퀴즈 출제', '근거 노하우가 없다');
} else {
  const q = await db.rpc('quiz_items_for', { p_entry_ids: entries.map((e) => e.id), p_limit: 5 });
  // 문항이 0건일 수는 있다(그 노하우로 만든 문항이 없을 뿐). **오류가 나면** 죽은 것이다.
  pass_or_fail('4 퀴즈 출제(quiz_items_for)', !q.error, q.error?.message);
}

// ── 5 사진 서명 URL — 0198·0218 정책이 살아 있나 ───────────────────────────
// ★노하우의 `photos` 가 아니라 **스토리지 폴더를 직접 본다.** 파일럿 매장은 노하우에 사진을
//   안 달아 둬서(photos=[]) 그 길로는 영영 건너뛰게 되는데, 사진 경로는 실제로 깨졌던 자리라
//   (0211 이 auth_owns_unit 권한을 회수해 죽었던 것 · 0215 복구) 감시에서 빠지면 안 된다.
//   list + createSignedUrl 둘 다 읽기이고, `photos_tenant_read` 정책을 그대로 지난다.
const listed = UNIT
  ? await db.storage.from('playbook-photos').list(UNIT, { limit: 5 })
  : { data: [], error: null };
const photoName = (listed.data ?? []).map((f) => f.name).find((n) => n && !n.startsWith('.'));
if (!UNIT) {
  skipped('5 사진 서명 URL', '활성 매장을 못 찾았다');
} else if (listed.error) {
  bad('5 사진 폴더 조회', listed.error.message);
} else if (!photoName) {
  skipped('5 사진 서명 URL', `${UNIT} 폴더에 파일이 없다`);
} else {
  const s = await db.storage.from('playbook-photos').createSignedUrl(`${UNIT}/${photoName}`, 60);
  if (s.error || !s.data?.signedUrl) {
    bad('5 사진 서명 URL', s.error?.message ?? '발급 실패');
  } else {
    const r = await fetch(s.data.signedUrl);
    pass_or_fail('5 사진 서명 URL + 조회', r.status === 200, `status=${r.status}`);
  }
}

// ── 6 사장 홈 ──────────────────────────────────────────────────────────────
const home = await db.rpc('owner_today');
pass_or_fail('6 사장 홈(owner_today)', !home.error, home.error?.message);

await db.auth.signOut();
}

console.log(`\n── 결과 ── pass ${pass} / fail ${fail} / skip ${skip}`);
if (fail > 0) process.exitCode = 1;
