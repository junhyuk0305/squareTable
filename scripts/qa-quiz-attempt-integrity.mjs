#!/usr/bin/env node
// qa-quiz-attempt-integrity.mjs — 응시 기록이 **응시자가 지어낼 수 없는 것**인지 실증(0203).
//
// 왜 이 게이트가 있나 (2026-09-14 보안 QA 에서 실측으로 드러난 것):
//   게스트 링크는 카톡방에 도는 물건이고 제출 함수는 anon 에게 열려 있다. 그 함수가 배열을
//   그대로 순회해서, **같은 item_id 를 200번 보내면 200행이 적혔다.** 코스에 문항이 1개뿐인데
//   사장 화면 점수가 '0/200' 으로 찍혔다. 세 가지가 동시에 깨진다:
//     ① 응시자가 자기 점수를 지어낸다(맞힌 문항만 반복해서 보내면 100%)
//     ② 그 행들이 0199 quiz_course_stats 의 sum(correct)/sum(total) 로 들어가 **코스 정답률**을 오염
//     ③ 요청 1건당 최대 500행 쓰기 증폭(제출 횟수 제한은 없다)
//   0203 이 두 제출 함수(게스트·직원)의 순회를 distinct on (item_id) 로 바꿔 닫았다.
//
// 이 게이트가 재는 것 — **행 수와 점수라는 원시 데이터**다. "버튼이 보인다"는 증거가 아니다.
//   D1 같은 문항 200번 → 1행 · total 1        (중복 증폭·점수 조작 차단)
//   D2 서로 다른 문항 N개 → N행 · total N     (양성 대조: 정상 응시를 막지 않는다)
//   D3 상한 500 초과 → too_many_rows           (남용 하드상한 유지)
//   D4 코스에 없는 문항 id → 0행               (남의 노하우에 점수 심기 차단)
//   ⛔ D2 를 빼지 말 것 — 중복만 막고 정상까지 막으면 게이트는 green 인데 제품이 죽는다.
//
// 계정: 고정 QA 계정(QA_EMAIL, 기본 qa.owner@example.com). 계정을 새로 만들지 않는다.
// 자가정리: 만든 매장 자료·응시 기록을 끝에 지운다. 사용: npm run qa:quiz-integrity
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')), ...process.env };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = env.QA_EMAIL ?? 'qa.owner@example.com';
const PW = env.QA_PASSWORD ?? 'QaTest1234!';
if (!URL_ || !ANON || !SRV) { console.error('FAIL: .env + .env.seed 의 URL/ANON/SERVICE_ROLE 필요'); process.exit(2); }

// service_role 은 **셋업·덤프 전용**이다 — 판정에는 안 쓴다(RLS 를 우회하므로 결과가 무효가 된다).
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const guest = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } }); // 로그인 안 함

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  OK ', n, extra)) : (fail++, console.log('  XX ', n, extra)); };
const id = (p) => `${p}_ig${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 1e3)}`;
const tok = () => (globalThis.crypto?.randomUUID?.() ?? `t${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '');

const ITEMS = 3;             // D2 양성 대조용 문항 수
const DUP = 200;             // D1 반복 횟수
const now = new Date().toISOString();

async function main() {
  const { data: auth, error: aErr } = await owner.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (aErr || !auth?.user) { console.error('로그인 실패 — scripts/qa-local-accounts.mjs 먼저:', aErr?.message); process.exit(2); }
  const uid = auth.user.id;
  const { data: prof } = await owner.from('profiles').select('unit_id').eq('id', uid).maybeSingle();
  const UNIT = prof?.unit_id;
  if (!UNIT) { console.error('활성 매장이 없다'); process.exit(2); }

  const entryId = id('pb'), courseId = id('tc'), linkId = id('ql'), tk = tok();
  const itemIds = Array.from({ length: ITEMS }, () => id('qz'));
  const cleanup = [];
  const subs = [];   // 정리할 submission_id

  try {
    await owner.from('playbook_entries').insert({
      id: entryId, unit_id: UNIT, creator_id: uid, creator_name: 'QA사장',
      category: 'Know-how', subcategory: '일반', title: '무결성 검증용 노하우', tags: [], search_keywords: ['무결성'],
      square: { situation: '마감 때 가스 밸브를 잠가요.', action: { steps: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
      execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
      stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
      photos: [], version: 1, status: 'published', quality_score: 0.6,
      created_at: now, updated_at: now, is_template: false, pack_id: null,
      needs_review: false, correction_points: [], section: null, order_index: 0,
    });
    cleanup.push(() => owner.from('playbook_entries').delete().eq('id', entryId));

    await owner.from('training_courses').insert({
      id: courseId, unit_id: UNIT, key: `q_${courseId}`, name: '무결성 검증',
      description: null, preset: null, min_items: 1, max_items: 10,
      due_days: null, start_at: null, answer_days: null, position: 0, active: true,
    });
    cleanup.push(() => owner.from('training_courses').delete().eq('id', courseId));
    await owner.from('course_entries').insert({ course_id: courseId, entry_id: entryId, unit_id: UNIT });
    cleanup.push(() => owner.from('course_entries').delete().eq('course_id', courseId));

    for (const iid of itemIds) {
      await owner.from('quiz_items').insert({
        id: iid, unit_id: UNIT, entry_ids: [entryId], kind: 't3', format: 'mc4',
        payload: { ask: '마감 때 무엇을 잠그나요?', choices: ['가스 밸브', '창문', '냉장고'], answer_index: 0, explain: '가스 밸브를 잠가요.' },
        status: 'active', source: 'owner', created_by: uid, created_at: now, source_updated_at: now,
      });
      cleanup.push(() => owner.from('quiz_items').delete().eq('id', iid));
    }

    await owner.from('quiz_links').insert({
      id: linkId, course_id: courseId, unit_id: UNIT, token: tk,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), revoked_at: null, created_at: now, created_by: uid,
    });
    cleanup.push(() => owner.from('quiz_links').delete().eq('id', linkId));

    const submit = (answers, name) => guest.rpc('quiz_link_submit', {
      p_token: tk, p_guest_name: name, p_guest_phone: null, p_phone_verified: false, p_answers: answers,
    });
    // 판정은 **원시 행**으로 한다 — 함수 반환값만 믿지 않는다(반환은 quiz_attempts 행 수다).
    const rowsOf = async (sub) => (await admin.from('quiz_attempt_items').select('id', { count: 'exact', head: true }).eq('submission_id', sub)).count;
    const attemptOf = async (name) => (await admin.from('quiz_attempts').select('submission_id,total,correct').eq('course_id', courseId).eq('guest_name', name)).data ?? [];

    // ── D1 같은 문항 200번 ────────────────────────────────────────────────
    const n1 = `DUP${Date.now()}`;
    const r1 = await submit(Array.from({ length: DUP }, () => ({ item_id: itemIds[0], response: { choice: 0 } })), n1);
    const a1 = await attemptOf(n1);
    a1.forEach((r) => subs.push(r.submission_id));
    const c1 = a1[0] ? await rowsOf(a1[0].submission_id) : -1;
    check(`D1 같은 문항 ${DUP}번 → 문항 기록 1행`, c1 === 1, `error=${r1.error?.message ?? '-'} rows=${c1}`);
    check('D1 점수 분모도 1 (응시자가 점수를 지어낼 수 없다)', a1.length === 1 && a1[0].total === 1, `total=${a1[0]?.total}`);

    // ── D2 양성 대조: 서로 다른 문항 3개 ──────────────────────────────────
    const n2 = `OKC${Date.now()}`;
    const r2 = await submit(itemIds.map((iid) => ({ item_id: iid, response: { choice: 0 } })), n2);
    const a2 = await attemptOf(n2);
    a2.forEach((r) => subs.push(r.submission_id));
    const c2 = a2[0] ? await rowsOf(a2[0].submission_id) : -1;
    check(`D2 대조: 서로 다른 문항 ${ITEMS}개 → ${ITEMS}행 (정상 응시를 막지 않는다)`, c2 === ITEMS, `error=${r2.error?.message ?? '-'} rows=${c2}`);
    check(`D2 대조: 점수 분모 = ${ITEMS}`, a2.length === 1 && a2[0].total === ITEMS, `total=${a2[0]?.total}`);

    // ── D3 남용 하드상한 ──────────────────────────────────────────────────
    const r3 = await submit(Array.from({ length: 501 }, () => ({ item_id: itemIds[0], response: { choice: 0 } })), `CAP${Date.now()}`);
    check('D3 501건 → too_many_rows (하드상한 유지)', /too_many_rows/.test(r3.error?.message ?? ''), r3.error?.message ?? `(안 막힘! rows=${r3.data})`);

    // ── D4 코스에 없는 문항 ───────────────────────────────────────────────
    const n4 = `GHOST${Date.now()}`;
    const r4 = await submit([{ item_id: 'qz_not_in_this_course', response: { choice: 0 } }], n4);
    const a4 = await attemptOf(n4);
    a4.forEach((r) => subs.push(r.submission_id));
    check('D4 코스에 없는 문항 id → 기록 0건 (남의 노하우에 점수 심기 차단)',
      Number(r4.data ?? -1) === 0 && a4.length === 0, `rows=${r4.data} attempts=${a4.length}`);
  } finally {
    for (const sub of subs) {
      try { await admin.from('quiz_attempt_items').delete().eq('submission_id', sub); } catch {}
      try { await admin.from('quiz_attempts').delete().eq('submission_id', sub); } catch {}
    }
    try { await admin.from('quiz_attempts').delete().eq('course_id', courseId); } catch {}
    for (const c of cleanup.reverse()) { try { await c(); } catch {} }
  }

  console.log(`\n${fail ? 'FAIL' : 'PASS'} — 응시 기록 무결성(0203) · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(2); });
