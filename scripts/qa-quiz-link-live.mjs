// qa-quiz-link-live.mjs — 게스트 링크가 **정말 열리는가**(2026-08-26).
//
// "링크로 정확히 들어갈 수 있는 게 맞냐"는 의심을 코드 읽기가 아니라 실호출로 답한다.
//   K1 사장이 만든 링크 행이 저장되는가
//   K2 로그인 **없이**(anon) quiz_link_open 이 열리는가 — 여기가 진짜 관문이다
//   K3 anon 이 문항을 받는가(quiz_link_items)
//   K4 anon 이 채점을 받는가(quiz_link_grade)
//   K5 만료·회수된 토큰은 **안 열리는가**(닫힘이 실제로 닫히는가)
//   K6 배포 주소 /q/<token> 가 앱을 돌려주는가(SPA 폴백) — QA_PROD_ORIGIN 있을 때만
//
// 계정: 고정 QA 계정(qa.owner@example.com). 없으면 scripts/qa-local-accounts.mjs 먼저.
// 자가정리: 이 스크립트가 만든 코스·문항·링크는 끝에 지운다.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')), ...process.env };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = env.QA_EMAIL ?? 'qa.owner@example.com';
const PW = env.QA_PASSWORD ?? 'QaTest1234!';
if (!URL_ || !ANON) { console.error('FAIL: .env 의 SUPABASE URL/ANON 필요'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

const owner = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const guest = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } }); // 로그인 안 함 = 손님

const id = (p) => `${p}_lk${String(Date.now()).slice(-8)}`;
const token = () => (globalThis.crypto?.randomUUID?.() ?? `t${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '');

async function main() {
  const { data: auth, error: aErr } = await owner.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (aErr || !auth?.user) { console.error('로그인 실패 — qa-local-accounts.mjs 먼저:', aErr?.message); process.exit(2); }
  const uid = auth.user.id;
  const { data: prof } = await owner.from('profiles').select('unit_id').eq('id', uid).maybeSingle();
  const UNIT = prof?.unit_id;
  if (!UNIT) { console.error('활성 매장이 없다'); process.exit(2); }

  const courseId = id('tc'), entryId = id('pb'), itemId = id('qz'), linkId = id('ql');
  const tk = token(), tkDead = token();
  const now = new Date().toISOString();
  const cleanup = [];

  try {
    // ── 재료: 노하우 1건 + 코스 + 담기 + 문항 1개 ───────────────────────
    const { error: eErr } = await owner.from('playbook_entries').insert({
      id: entryId, unit_id: UNIT, creator_id: uid, creator_name: 'QA사장',
      category: 'Know-how', subcategory: '일반', title: '링크검증용 노하우', tags: [], search_keywords: ['링크검증'],
      square: { situation: '마감 때 가스 밸브를 잠가요.', action: { steps: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
      execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
      stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
      photos: [], version: 1, status: 'published', quality_score: 0.6,
      created_at: now, updated_at: now, is_template: false, pack_id: null,
      needs_review: false, correction_points: [], section: null, order_index: 0,
    });
    if (eErr) throw new Error('노하우 시드: ' + eErr.message);
    cleanup.push(() => owner.from('playbook_entries').delete().eq('id', entryId));

    const { error: cErr } = await owner.from('training_courses').insert({
      id: courseId, unit_id: UNIT, key: `q_${courseId}`, name: '링크 검증 퀴즈',
      description: null, preset: null, min_items: 1, max_items: 10,
      due_days: null, start_at: null, answer_days: null, position: 0, active: true,
    });
    if (cErr) throw new Error('코스: ' + cErr.message);
    cleanup.push(() => owner.from('training_courses').delete().eq('id', courseId));

    await owner.from('course_entries').insert({ course_id: courseId, entry_id: entryId, unit_id: UNIT });
    cleanup.push(() => owner.from('course_entries').delete().eq('course_id', courseId));

    const { error: iErr } = await owner.from('quiz_items').insert({
      id: itemId, unit_id: UNIT, entry_ids: [entryId], kind: 't3', format: 'mc4',
      // ★format 은 서버의 quiz_known_formats() 에 있는 이름이어야 한다 — 없으면 fail-closed 로
      //   손님에게 **한 건도 안 나간다**(0107 §3). 'choices' 는 그 목록에 없다.
      payload: { ask: '마감 때 무엇을 잠그나요?', choices: ['가스 밸브', '창문', '냉장고'], answer_index: 0, explain: '가스 밸브를 잠가요.' },
      status: 'active', source: 'owner', created_by: uid, created_at: now, source_updated_at: now,
    });
    if (iErr) throw new Error('문항: ' + iErr.message);
    cleanup.push(() => owner.from('quiz_items').delete().eq('id', itemId));

    // ── K1 링크 행 ──────────────────────────────────────────────────────
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const { error: lErr } = await owner.from('quiz_links').insert({
      id: linkId, course_id: courseId, unit_id: UNIT, token: tk,
      expires_at: tomorrow, revoked_at: null, created_at: now, created_by: uid,
    });
    check('K1 링크 저장', !lErr, lErr?.message ?? '');
    cleanup.push(() => owner.from('quiz_links').delete().eq('id', linkId));
    if (lErr) throw new Error('링크 저장 실패라 이후 검사가 의미 없다');

    // 회수된 링크(닫힘이 실제로 닫히는지 볼 대조군)
    const deadId = id('qld');
    await owner.from('quiz_links').insert({
      id: deadId, course_id: courseId, unit_id: UNIT, token: tkDead,
      expires_at: tomorrow, revoked_at: now, created_at: now, created_by: uid,
    });
    cleanup.push(() => owner.from('quiz_links').delete().eq('id', deadId));

    // ── K2 로그인 없이 열리는가 ─────────────────────────────────────────
    const { data: open, error: oErr } = await guest.rpc('quiz_link_open', { p_token: tk });
    const info = Array.isArray(open) ? open[0] : open;
    check('K2 anon 으로 링크 열림', !oErr && !!info && info.ok !== false,
      oErr?.message ?? JSON.stringify(info ?? null).slice(0, 160));
    if (info) console.log('     →', JSON.stringify(info).slice(0, 200));

    // ── K3 문항 ─────────────────────────────────────────────────────────
    // p_limit 없이 = 코스 문항 **전부**(0188에서 5개 표본·20개 상한 폐기). 클라가 부르는 방식과 같게 둔다.
    const { data: items, error: itErr } = await guest.rpc('quiz_link_items', { p_token: tk, p_limit: null });
    check('K3 anon 이 문항을 받음', !itErr && Array.isArray(items) && items.length > 0,
      itErr?.message ?? `items=${JSON.stringify(items ?? null).slice(0, 120)}`);

    // ── K4 채점 ─────────────────────────────────────────────────────────
    if (Array.isArray(items) && items.length > 0) {
      const first = items[0];
      const { data: g, error: gErr } = await guest.rpc('quiz_link_grade', {
        p_token: tk, p_item_id: first.id, p_response: { choice: 0 },
      });
      const grade = Array.isArray(g) ? g[0] : g;
      check('K4 anon 이 채점을 받음', !gErr && !!grade, gErr?.message ?? JSON.stringify(grade ?? null).slice(0, 160));
      if (grade) console.log('     →', JSON.stringify(grade).slice(0, 200));
    } else {
      check('K4 anon 이 채점을 받음', false, '문항이 없어 못 함');
    }

    // ── K5 회수된 토큰은 닫혀 있는가 ────────────────────────────────────
    const { data: dead, error: dErr } = await guest.rpc('quiz_link_open', { p_token: tkDead });
    const deadInfo = Array.isArray(dead) ? dead[0] : dead;
    const closed = !!dErr || !deadInfo || deadInfo.ok === false;
    check('K5 회수된 링크는 안 열림', closed, JSON.stringify(deadInfo ?? null).slice(0, 160));

    // ── K6 배포 주소가 /q/ 를 앱으로 돌려주는가 ──────────────────────────
    const prod = env.QA_PROD_ORIGIN ?? 'https://dochackchack.com';
    try {
      const res = await fetch(`${prod}/q/${tk}`, { redirect: 'follow' });
      const html = await res.text();
      check(`K6 ${prod}/q/<token> 가 앱을 돌려줌`, res.ok && /<div id="root"|react|expo/i.test(html),
        `status=${res.status} len=${html.length}`);
    } catch (e) {
      check(`K6 ${prod}/q/<token>`, false, '요청 실패: ' + String(e).slice(0, 120));
    }
  } finally {
    for (const c of cleanup.reverse()) { try { await c(); } catch {} }
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  통과 ${pass} · 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
