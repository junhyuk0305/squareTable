#!/usr/bin/env node
// qa-unknown-askers.mjs — 같은 질문을 한 사람도 답 알림을 받는다 (0249 · Q23 · 보안 M3 · 로컬 도커 전용)
//
// 무엇을 못박나:
//   [1] 표 unknown_query_askers — RLS on · 읽기는 본인 행만 · 앱은 직접 쓸 수 없다. ask_same_question 은 anon 이 못 부른다.
//   [2] ask_same_question(p_uq_id) — 같은 사람이 두 번 눌러도 1행 · 개수는 서버가 +1(새로 들어갈 때만) ·
//       원 질문자는 개수를 올리지 않는다 · 다른 매장 사람은 거부 · 동시에 눌러도 하나도 안 사라진다 · 답이 끝난 질문은 거부.
//   [3] 남의 askers 행은 select 0행(사장도). 같은 질문을 한 사람의 id 를 돌려주는 RPC 가 없다(question_askers 없음).
//   [4] unknown_queries 가 resolved_with_entry 로 바뀌면 원 질문자 + askers 에게 member_notices(question_answered) 1행씩.
//       답한 사람 · 이미 나간 사람은 빼고, 다시 저장해도 두 번 넣지 않는다.
//   [5] 옛 앱 경로(bumpUnknownSimilar 직접 UPDATE · resolveUnknown 직접 UPDATE)는 그대로 된다.
//   [6] 앱 — 같은 질문 합치기가 ask_same_question 을 부르고, 답 알림을 클라이언트가 보내지 않는다(서버가 넣는다).
//   [7] 엣지 — 옛 앱이 보내는 클라이언트 답 알림(tag q-answered)은 버리고, 크론 sweepMemberNotices 가 보낸다.
//
// 지금(0248)은 두 번째 사람의 id 가 어디에도 남지 않아 답 알림을 원 질문자 한 명만 받는다.
//   개수도 클라이언트가 계산한 값을 써서 같은 사람이 여러 번 누르면 계속 오른다.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-unknown-askers.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error(`중단: 로컬 도커 전용 하니스다(계정을 가입시킨다). 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

const phones = ['0114', '0115', '0116', '0117', '0118', '0119', '0127'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const ENTRY = `pe_qa_ua_${s}`; // 해결에 쓰는 노하우 id(FK 없음 · 트리거는 없는 id 를 견딘다)

const errOf = (r) => (r.error ? `${r.error.code ?? ''} ${r.error.message}` : '');
const countOf = async (id) => (await admin.from('unknown_queries').select('similar_queries_count').eq('id', id).maybeSingle()).data?.similar_queries_count;
const askersOf = async (id) => {
  const { data, error } = await admin.from('unknown_query_askers').select('user_id').eq('uq_id', id);
  return error ? `오류 ${error.code ?? ''} ${error.message}` : (data ?? []).map((x) => x.user_id).sort();
};
/** 이 사람이 받은 답 알림(service_role 로 읽는다). */
const answeredOf = async (uid) => {
  const { data, error } = await admin.from('member_notices').select('id, unit_id, kind, title, body, url')
    .eq('user_id', uid).eq('kind', 'question_answered').order('id');
  return error ? `오류 ${error.code ?? ''} ${error.message}` : (data ?? []);
};
const len = (r) => (Array.isArray(r) ? r.length : r);

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const up = async (i, name, role, birth) => {
    const c = mk();
    const r = await c.auth.signUp({
      email: `qa_ua_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: birth } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    const u = { c, id: r.data.user?.id, name };
    users.push(u);
    return u;
  };
  const O = await up(0, 'QA같은질문사장', 'owner', '1980-01-01');
  const A = await up(1, 'QA원질문자', 'junior', '2000-01-01');
  const B = await up(2, 'QA같은질문B', 'junior', '2000-01-01');
  const C = await up(3, 'QA같은질문C', 'junior', '2000-01-01');
  const D = await up(4, 'QA나간직원D', 'junior', '2000-01-01');
  const E = await up(5, 'QA같은질문E', 'junior', '2000-01-01');
  const X = await up(6, 'QA다른매장사장', 'owner', '1980-01-01');

  const mkStore = async (U, name) => {
    const { data: st, error } = await U.c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    const row = Array.isArray(st) ? st[0] : st;
    if (error || !row?.unit_id) throw new Error('create_store: ' + (error?.message ?? 'no row'));
    units.push(row.unit_id);
    await U.c.rpc('switch_active_unit', { p_unit_id: row.unit_id });
    return row;
  };
  const store = await mkStore(O, 'QA같은질문카페');
  const UNIT = store.unit_id;
  await mkStore(X, 'QA다른카페');
  // 직원 5명 — 무료 좌석(3명)을 넘으므로 유료로 연다(qa-day-marks 와 같은 방식).
  { const a = await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' }); if (a.error) throw new Error('admin_activate_store: ' + a.error.message); }
  for (const U of [A, B, C, D, E]) {
    const j = await U.c.rpc('join_by_invite', { p_code: store.invite_code });
    if (j.error) throw new Error(`${U.name} join_by_invite: ${j.error.message}`);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${U.name} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  console.log(`셋업 — 매장 ${UNIT} · 사장 + 직원 5명 · 다른 매장 사장 1명`);

  // 옛 앱 insertUnknown 그대로(행 전체 insert). stamp_author 가 junior_id 를 호출자로 덮는다.
  const ask = async (U, id, text) => {
    const { error } = await U.c.from('unknown_queries').insert({
      id, unit_id: UNIT, junior_id: U.id, junior_name: U.name, query_text: text, asked_at: new Date().toISOString(),
      presumed_category: null, presumed_subcategory: null, match_attempted: true, best_match_confidence: 0.2,
      best_match_entry_id: null, status: 'pending_owner_answer', fallback_action: null, owner_notified_at: null,
      owner_will_answer: false, similar_queries_count: 0, ai_general_answer: '', anonymous: true,
    });
    if (error) throw new Error(`${U.name} insertUnknown: ${error.message}`);
  };
  const UQ1 = `uq_ua_1_${s}`, UQ2 = `uq_ua_2_${s}`, UQ3 = `uq_ua_3_${s}`;
  await ask(A, UQ1, 'QA 마감 때 커피머신 청소는 어떻게 해요?');
  await ask(A, UQ2, 'QA 우유 유통기한은 어디서 봐요?');
  await ask(A, UQ3, 'QA 포스 영수증 재출력은?');
  const same = (U, id) => U.c.rpc('ask_same_question', { p_uq_id: id });

  // ═══════ 1. 표 · 권한 ═══════
  console.log('\n[1] unknown_query_askers 표 — RLS · 본인만 읽기 · 앱 직접 쓰기 불가');
  {
    const t = await admin.from('unknown_query_askers').select('uq_id').limit(1);
    check('1-1 unknown_query_askers 표가 있다', !t.error, errOf(t));
    const ins = await B.c.from('unknown_query_askers').insert({ uq_id: UQ1, user_id: B.id, unit_id: UNIT });
    check('1-2 앱(authenticated)은 askers 행을 직접 넣을 수 없다', !!ins.error, ins.error ? errOf(ins) : '들어감');
    const an = await mk().rpc('ask_same_question', { p_uq_id: UQ1 });
    check('1-3 anon 은 ask_same_question 을 실행할 수 없다', !!an.error && /42501|PGRST202/.test(an.error.code ?? ''), errOf(an) || '실행됨');
    const qa = await B.c.rpc('question_askers', { p_uq_id: UQ1 });
    check('1-4 같은 질문을 한 사람 id 를 돌려주는 question_askers RPC 가 없다(보안 M3)', !!qa.error, qa.error ? errOf(qa) : '있음');
  }

  // ═══════ 2. ask_same_question ═══════
  console.log('\n[2] ask_same_question — 1인 1행 · 개수는 서버가 · 원 질문자 제외 · 다른 매장 거부');
  {
    const r1 = await same(B, UQ1);
    check('2-1 ★B 가 같은 질문 → 개수 1 · 돌려준 값도 1', !r1.error && r1.data === 1 && (await countOf(UQ1)) === 1, errOf(r1) || `ret=${r1.data} cnt=${await countOf(UQ1)}`);
    const r2 = await same(B, UQ1);
    const ak = await askersOf(UQ1);
    check('2-2 ★B 가 두 번 눌러도 askers 1행 · 개수 그대로 1', !r2.error && JSON.stringify(ak) === JSON.stringify([B.id]) && (await countOf(UQ1)) === 1,
      errOf(r2) || `askers=${JSON.stringify(ak)} cnt=${await countOf(UQ1)}`);
    const r3 = await same(C, UQ1);
    check('2-3 C 가 같은 질문 → 개수 2', !r3.error && r3.data === 2 && (await countOf(UQ1)) === 2, errOf(r3) || `ret=${r3.data}`);
    const r4 = await same(A, UQ1);
    check('2-4 원 질문자 A 가 다시 물어도 개수 그대로 2 · askers 에 A 없음', !r4.error && (await countOf(UQ1)) === 2 && !(await askersOf(UQ1)).includes?.(A.id),
      errOf(r4) || `cnt=${await countOf(UQ1)}`);
    const r5 = await same(X, UQ1);
    check('2-5 다른 매장 사람은 거부 · 개수 그대로', !!r5.error && (await countOf(UQ1)) === 2, r5.error ? errOf(r5) : `ret=${r5.data}`);
    const [p1, p2] = await Promise.all([same(D, UQ1), same(E, UQ1)]);
    check('2-6 ★D · E 가 동시에 눌러도 개수 4(하나도 안 사라진다)', !p1.error && !p2.error && (await countOf(UQ1)) === 4,
      errOf(p1) || errOf(p2) || `cnt=${await countOf(UQ1)}`);
    const r6 = await same(C, UQ2);
    check('2-7 C 가 UQ2 도 같은 질문', !r6.error && (await countOf(UQ2)) === 1, errOf(r6));
  }

  // ═══════ 3. 읽기 ═══════
  console.log('\n[3] askers 읽기 — 본인 행만');
  {
    const mine = await B.c.from('unknown_query_askers').select('uq_id, user_id');
    check('3-1 B 는 자기 행만 읽는다(1행)', !mine.error && (mine.data ?? []).length === 1 && mine.data[0].user_id === B.id, errOf(mine) || JSON.stringify(mine.data));
    const other = await B.c.from('unknown_query_askers').select('user_id').eq('user_id', C.id);
    check('3-2 ★B 는 C 의 행을 못 읽는다(0행)', !other.error && (other.data ?? []).length === 0, errOf(other) || JSON.stringify(other.data));
    const own = await O.c.from('unknown_query_askers').select('user_id').eq('uq_id', UQ1);
    check('3-3 ★사장도 남의 askers 행을 못 읽는다(0행 · 익명 질문 보호)', !own.error && (own.data ?? []).length === 0, errOf(own) || JSON.stringify(own.data));
    const del = await B.c.from('unknown_query_askers').delete().eq('user_id', B.id).select('uq_id');
    check('3-4 B 도 자기 행을 지우지 못한다', !!del.error || (del.data ?? []).length === 0, errOf(del) || JSON.stringify(del.data));
  }

  // ═══════ 4. 해결 → 답 알림 ═══════
  console.log('\n[4] 해결하면 원 질문자 + askers 에게 question_answered (답한 사람 · 나간 사람 제외)');
  {
    const l = await D.c.rpc('leave_store');
    if (l.error) throw new Error('D leave_store: ' + l.error.message);
    // 옛 앱 resolveUnknown 그대로(사장 coach 경로).
    const r = await O.c.from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: O.id }).eq('id', UQ1).select('id');
    check('4-1 사장이 UQ1 을 해결한다(옛 앱 resolveUnknown)', !r.error && (r.data ?? []).length === 1, errOf(r));
    const [a, b, c, d, e, o] = await Promise.all([A, B, C, D, E, O].map((U) => answeredOf(U.id)));
    check('4-2 ★원 질문자 A 에게 1행', len(a) === 1, JSON.stringify(a));
    check('4-3 ★같은 질문 B · C · E 에게 1행씩', len(b) === 1 && len(c) === 1 && len(e) === 1, `B=${len(b)} C=${len(c)} E=${len(e)}`);
    check('4-4 나간 D 와 답한 사장에게는 없다', len(d) === 0 && len(o) === 0, `D=${len(d)} O=${len(o)}`);
    const n = Array.isArray(b) ? b[0] : null;
    check('4-5 알림 = 이 매장 · 질문 글 · 직원 채팅으로(/junior/chat)', !!n && n.unit_id === UNIT && n.body.includes('커피머신') && n.url === '/junior/chat' && !!n.title,
      JSON.stringify(n));
    await O.c.from('unknown_queries').update({ resolved_with_entry_id: ENTRY }).eq('id', UQ1);
    check('4-6 다시 저장해도 두 번 넣지 않는다', len(await answeredOf(B.id)) === 1, String(len(await answeredOf(B.id))));

    // 동료 B 가 UQ2 를 기존 노하우로 답한다(옛 앱 JuniorMySpace → resolveUnknown).
    const r2 = await B.c.from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: B.id }).eq('id', UQ2).select('id');
    check('4-7 동료 B 가 UQ2 를 답한다', !r2.error && (r2.data ?? []).length === 1, errOf(r2));
    check('4-8 ★UQ2 → A · C 에게 가고 답한 B 에게는 안 간다', len(await answeredOf(A.id)) === 2 && len(await answeredOf(C.id)) === 2 && len(await answeredOf(B.id)) === 1,
      `A=${len(await answeredOf(A.id))} C=${len(await answeredOf(C.id))} B=${len(await answeredOf(B.id))}`);
    const r7 = await same(E, UQ1);
    check('4-9 답이 끝난 질문에는 같은 질문을 걸 수 없다', !!r7.error, r7.error ? errOf(r7) : `ret=${r7.data}`);
  }

  // ═══════ 5. 옛 앱 경로 ═══════
  console.log('\n[5] 옛 앱 bumpUnknownSimilar(직접 UPDATE)는 전환 기간 동안 그대로 된다');
  {
    const { data, error } = await C.c.from('unknown_queries').update({ similar_queries_count: 1 }).eq('id', UQ3).select('id');
    check('5-1 C 가 옛 경로로 개수를 올린다', !error && (data ?? []).length === 1 && (await countOf(UQ3)) === 1, error?.message ?? `cnt=${await countOf(UQ3)}`);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
}

// ═══════ 6. 앱 — 소스 ═══════
console.log('\n[6] 앱 — 같은 질문은 ask_same_question · 답 알림은 서버가');
{
  const db = readFileSync(join(ROOT, 'src/lib/db.ts'), 'utf8');
  const store = readFileSync(join(ROOT, 'src/lib/store/useUnknownQueueStore.ts'), 'utf8');
  check('6-1 db.ts askSameQuestion 이 rpc(ask_same_question) 를 부른다', /export async function askSameQuestion[\s\S]{0,400}rpc\('ask_same_question'/.test(db));
  check('6-2 ★같은 질문 합치기가 askSameQuestion 을 부르고 bumpUnknownSimilar 를 안 쓴다', /askSameQuestion\(/.test(store) && !/bumpUnknownSimilar/.test(store));
  check('6-3 ★답 알림을 클라이언트가 보내지 않는다(notifyUserQuestionAnswered 없음 · 보안 M3)', !/notifyUserQuestionAnswered/.test(store));
}

// ═══════ 7. 엣지 ═══════
console.log('\n[7] 엣지 push/index.ts — 옛 앱 클라이언트 답 알림은 버리고 크론이 보낸다');
{
  const edgeSrc = readFileSync(join(ROOT, 'supabase/functions/push/index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const serve = edgeSrc.slice(edgeSrc.indexOf('Deno.serve('));
  const iSkip = serve.search(/tag === 'q-answered'/);
  check('7-1 ★클라이언트가 보낸 q-answered 알림은 보내지 않는다(서버 알림과 두 번 가지 않게)', iSkip > 0 && iSkip < serve.indexOf('await deliver('));
  const start = edgeSrc.search(/async function sweepMemberNotices\(/);
  const src = start < 0 ? null
    : ts.transpileModule(edgeSrc.slice(start, edgeSrc.indexOf('\n}\n', start) + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  if (src) {
    const calls = [];
    const fakeAdmin = {
      rpc: async () => ({ data: [{ out_id: 9, out_user_id: 'u9', out_unit_id: 's9', out_kind: 'question_answered', out_title: '내 질문에 답이 왔어요', out_body: 'q', out_url: '/junior/chat' }], error: null }),
      from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
    };
    const fn = new Function('createClient', 'SUPABASE_URL', 'deliver', `${src}; return sweepMemberNotices;`)(
      () => fakeAdmin, 'http://x', async (_a, scope, targets, notif) => { calls.push({ scope, targets, notif }); return { sent: 1 }; });
    await fn('tok');
    check('7-2 크론 sweepMemberNotices 가 question_answered 를 그 사람에게 그 문구·경로로 보낸다',
      calls.length === 1 && calls[0].targets[0] === 'u9' && calls[0].notif.url === '/junior/chat' && calls[0].notif.title === '내 질문에 답이 왔어요', JSON.stringify(calls));
  } else check('7-2 sweepMemberNotices 가 있다', false);
}

for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
