#!/usr/bin/env node
// qa-query-rls.mjs — 0239 AI 질문 기록 권한 (H3 · 보안 체크리스트 10) · 로컬 도커 전용
//
// 무엇을 못박나:
//   [1] chat_queries(내 AI 질문 기록)
//       · 직원 B 는 직원 A 의 기록을 읽지도·고치지도·지우지도 못한다(0행). 지금(0019)은 매장 전원 for all.
//       · A 는 자기 기록을 읽고 만족도를 고친다(옛 앱 fetchChatQueries·updateChatSatisfaction).
//       · 사장·매니저는 매장 전체를 읽는다(옛 앱 fetchAiAnswers). 사장은 지울 수 있다.
//       · recompute_playbook_stats(정의자)는 B 가 불러도 A 의 기록까지 센다(통계가 반쪽이 되면 안 된다).
//   [2] unknown_queries(받은 질문)
//       · 읽기는 매장 전원 그대로(동료 답변 기능).
//       · 옛 앱 동료 흐름이 그대로 된다: 같은 질문 개수 올리기(bumpUnknownSimilar) · 기존 노하우로 답하기(resolveUnknown).
//       · 동료는 그 밖의 열을 못 바꾼다: junior_id · 질문 글 · 보관 상태 · 남의 이름으로 답하기.
//       · 개수는 한 번에 1씩만 오른다(직접 999 로 못 바꾼다). 새로 넣을 때도 0 부터.
//       · 지우기는 본인 또는 관리자만.
//   [3] 권한 — 새 트리거 함수는 anon·authenticated 실행 불가.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-query-rls.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return `psql 오류: ${String(e.stderr ?? e.message).trim()}`; }
};

const phones = ['0181', '0182', '0183', '0184'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const signUp = async (i, name, role, birth) => {
  const c = mk();
  const r = await c.auth.signUp({
    email: `qa_qrls_${i}_${s}@example.com`, password: pw,
    options: { data: { name, role, phone: phones[i], birth_date: birth } },
  });
  if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
  users.push({ c, id: r.data.user?.id });
  return { c, id: r.data.user?.id };
};

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = await signUp(0, 'QA질문사장', 'owner', '1980-01-01');
  const A = await signUp(1, 'QA질문직원A', 'junior', '2000-01-01');
  const B = await signUp(2, 'QA질문직원B', 'junior', '2000-02-02');
  const M = await signUp(3, 'QA질문매니저', 'junior', '1995-03-03');

  const { data: st, error: e1 } = await O.c.rpc('create_store', { p_store_name: 'QA질문카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = row.unit_id; units.push(UNIT);
  const CODE = row.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  for (const [U, label] of [[A, 'A'], [B, 'B'], [M, 'M']]) {
    const j = await U.c.rpc('join_by_invite', { p_code: CODE });
    if (j.error) throw new Error(`${label} join_by_invite: ${j.error.message}`);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${label} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  {
    const { error } = await O.c.rpc('set_member_role', { p_uid: M.id, p_role: 'manager' });
    if (error) throw new Error('set_member_role: ' + error.message);
  }
  console.log(`setup: 매장 ${UNIT} · 사장 · 직원 A·B · 매니저`);

  // 노하우 1건(통계 재계산 대상). 쓰기는 사장 몫이라 service_role 로 심는다.
  const ENTRY = `pe_qrls_${s}`;
  {
    const { error } = await admin.from('playbook_entries').insert([{ id: ENTRY, unit_id: UNIT, category: '운영', title: 'QA 질문 권한 노하우', status: 'published' }]);
    if (error) throw new Error('노하우 시드: ' + error.message);
  }

  // ════════════════ [1] chat_queries ════════════════
  console.log('\n[1] chat_queries — 내 AI 질문 기록');
  // 옛 앱 insertChatQuery 그대로(행 전체 insert).
  const cq = (id, U, extra = {}) => ({
    id, unit_id: UNIT, junior_id: U.id, junior_name: 'x', query_text: `QA 질문 ${id}`,
    asked_at: new Date().toISOString(), matched_entry_ids: [ENTRY], match_confidence: 0.9, was_deflected: false, ...extra,
  });
  const CQ_A = `cq_qrls_a_${s}`, CQ_A2 = `cq_qrls_a2_${s}`, CQ_B = `cq_qrls_b_${s}`;
  {
    const r1 = await A.c.from('chat_queries').insert(cq(CQ_A, A));
    const r2 = await A.c.from('chat_queries').insert(cq(CQ_A2, A, { satisfaction: 'up' }));
    const r3 = await B.c.from('chat_queries').insert(cq(CQ_B, B));
    check('1-1 직원이 자기 기록을 넣는다(옛 앱 insertChatQuery)', !r1.error && !r2.error && !r3.error,
      r1.error?.message ?? r2.error?.message ?? r3.error?.message);
  }
  const exists = async (table, id) => ((await admin.from(table).select('id').eq('id', id)).data ?? []).length;
  {
    const { data, error } = await B.c.from('chat_queries').select('id').eq('id', CQ_A);
    check('1-2 직원 B 는 A 의 기록을 읽지 못한다(0행)', !error && (data ?? []).length === 0, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    const { data, error } = await B.c.from('chat_queries').select('id').eq('unit_id', UNIT);
    const ids = (data ?? []).map((x) => x.id);
    check('1-3 직원 B 가 매장 전체를 읽으면 자기 것만 나온다', !error && ids.length === 1 && ids[0] === CQ_B, error?.message ?? JSON.stringify(ids));
  }
  {
    const { data, error } = await B.c.from('chat_queries').update({ satisfaction: 'down' }).eq('id', CQ_A).select('id');
    const { data: after } = await admin.from('chat_queries').select('satisfaction').eq('id', CQ_A).maybeSingle();
    check('1-4 직원 B 는 A 의 만족도를 못 고친다(0행)', !error && (data ?? []).length === 0 && after?.satisfaction == null,
      error?.message ?? `rows=${(data ?? []).length} sat=${after?.satisfaction}`);
  }
  {
    const { data, error } = await B.c.from('chat_queries').delete().eq('id', CQ_A).select('id');
    check('1-5 직원 B 는 A 의 기록을 못 지운다(0행)', !error && (data ?? []).length === 0 && (await exists('chat_queries', CQ_A)) === 1,
      error?.message ?? `deleted=${(data ?? []).length}`);
  }
  {
    // stamp_author 가 junior_id 를 호출자로 덮는다 — 남의 이름으로 넣어도 내 행이 된다.
    const id = `cq_qrls_forge_${s}`;
    const { error } = await B.c.from('chat_queries').insert(cq(id, A));
    const { data: r } = await admin.from('chat_queries').select('junior_id').eq('id', id).maybeSingle();
    check('1-6 남의 이름으로 넣어도 내 행으로 저장된다', !error && r?.junior_id === B.id, error?.message ?? JSON.stringify(r));
  }
  {
    const { data, error } = await A.c.from('chat_queries').select('id').eq('junior_id', A.id);
    const up = await A.c.from('chat_queries').update({ satisfaction: 'down' }).eq('id', CQ_A).select('id');
    check('1-7 A 는 자기 기록을 읽고 만족도를 고친다(옛 앱 fetchChatQueries·updateChatSatisfaction)',
      !error && (data ?? []).length === 2 && !up.error && (up.data ?? []).length === 1,
      error?.message ?? up.error?.message ?? `read=${(data ?? []).length} upd=${(up.data ?? []).length}`);
  }
  for (const [U, label] of [[O, '사장'], [M, '매니저']]) {
    // 옛 앱 fetchAiAnswers 그대로.
    const { data, error } = await U.c.from('chat_queries')
      .select('id, query_text, junior_name, asked_at, matched_entry_ids, satisfaction')
      .gte('asked_at', new Date(Date.now() - 30 * 86400e3).toISOString())
      .order('asked_at', { ascending: false }).limit(1000);
    const ids = new Set((data ?? []).map((x) => x.id));
    check(`1-8 ${label}는 매장 전체 기록을 읽는다(옛 앱 fetchAiAnswers)`, !error && ids.has(CQ_A) && ids.has(CQ_B), error?.message ?? `n=${ids.size}`);
  }
  {
    const r = await B.c.rpc('recompute_playbook_stats', { p_entry_ids: [ENTRY] });
    const { data: e } = await admin.from('playbook_entries').select('stats').eq('id', ENTRY).maybeSingle();
    // A 2건 + B 1건 + 1-6 의 B 1건 = 4. 만족도: A2 up · A down(1-7).
    check('1-9 직원 B 가 부른 통계 재계산도 매장 전체를 센다(정의자)',
      !r.error && e?.stats?.query_hits_30d === 4 && e?.stats?.thumbs_up === 1 && e?.stats?.thumbs_down === 1,
      r.error?.message ?? JSON.stringify(e?.stats));
  }
  {
    const { data, error } = await O.c.from('chat_queries').delete().eq('id', CQ_A2).select('id');
    check('1-10 사장은 기록을 지울 수 있다', !error && (data ?? []).length === 1, error?.message ?? `deleted=${(data ?? []).length}`);
  }

  // ════════════════ [2] unknown_queries ════════════════
  console.log('\n[2] unknown_queries — 받은 질문');
  // 옛 앱 insertUnknown 그대로(행 전체 insert).
  const uq = (id, extra = {}) => ({
    id, unit_id: UNIT, junior_name: 'x', query_text: `QA 받은 질문 ${id}`, asked_at: new Date().toISOString(),
    presumed_category: null, presumed_subcategory: null, match_attempted: true, best_match_confidence: 0.2,
    best_match_entry_id: null, status: 'pending_owner_answer', fallback_action: null, owner_notified_at: null,
    owner_will_answer: false, similar_queries_count: 0, ai_general_answer: '', anonymous: false, ...extra,
  });
  const UQ1 = `uq_qrls_1_${s}`, UQ2 = `uq_qrls_2_${s}`, UQ3 = `uq_qrls_3_${s}`, UQ4 = `uq_qrls_4_${s}`, UQ5 = `uq_qrls_5_${s}`;
  {
    const errs = [];
    for (const id of [UQ1, UQ2, UQ3, UQ4]) {
      const { error } = await A.c.from('unknown_queries').insert({ ...uq(id), junior_id: A.id });
      if (error) errs.push(error.message);
    }
    check('2-1 직원 A 가 질문을 넣는다(옛 앱 insertUnknown)', errs.length === 0, errs.join(' / '));
  }
  {
    const { error } = await A.c.from('unknown_queries').insert({ ...uq(UQ5), junior_id: A.id, similar_queries_count: 999 });
    const { data: r } = await admin.from('unknown_queries').select('similar_queries_count').eq('id', UQ5).maybeSingle();
    check('2-2 새로 넣을 때 개수는 0 부터(999 로 못 넣는다)', !error && r?.similar_queries_count === 0, error?.message ?? JSON.stringify(r));
  }
  const uqRow = async (id) => (await admin.from('unknown_queries').select('*').eq('id', id).maybeSingle()).data;
  {
    // 옛 앱 fetchUnknownQueue 그대로.
    const { data, error } = await B.c.from('unknown_queries').select('*').eq('status', 'pending_owner_answer')
      .order('asked_at', { ascending: true }).limit(1000);
    const ids = new Set((data ?? []).map((x) => x.id));
    check('2-3 직원 B 는 매장 받은 질문을 읽는다(동료 답변 기능 유지)', !error && ids.has(UQ1) && ids.has(UQ2), error?.message ?? `n=${ids.size}`);
  }
  {
    // 옛 앱 bumpUnknownSimilar: 로컬 개수 + 1 을 그대로 쓴다.
    const { data, error } = await B.c.from('unknown_queries').update({ similar_queries_count: 1 }).eq('id', UQ1).select('id');
    const r = await uqRow(UQ1);
    check('2-4 직원 B 가 같은 질문 개수를 올린다(옛 앱 bumpUnknownSimilar)', !error && (data ?? []).length === 1 && r?.similar_queries_count === 1,
      error?.message ?? `rows=${(data ?? []).length} cnt=${r?.similar_queries_count}`);
  }
  {
    const { error } = await B.c.from('unknown_queries').update({ similar_queries_count: 999 }).eq('id', UQ1).select('id');
    const r = await uqRow(UQ1);
    check('2-5 개수를 999 로 써도 1 만 오른다', !error && r?.similar_queries_count === 2, error?.message ?? `cnt=${r?.similar_queries_count}`);
  }
  {
    const { error } = await B.c.from('unknown_queries').update({ similar_queries_count: 0 }).eq('id', UQ1).select('id');
    const r = await uqRow(UQ1);
    check('2-6 개수를 줄이지 못한다', !error && r?.similar_queries_count === 2, error?.message ?? `cnt=${r?.similar_queries_count}`);
  }
  {
    const { error } = await B.c.from('unknown_queries').update({ junior_id: B.id }).eq('id', UQ2).select('id');
    const r = await uqRow(UQ2);
    check('2-7 직원 B 는 junior_id 를 못 바꾼다', !!error && r?.junior_id === A.id, error?.message ?? `junior=${r?.junior_id}`);
  }
  {
    const { error } = await B.c.from('unknown_queries').update({ query_text: '바꿈' }).eq('id', UQ2).select('id');
    const r = await uqRow(UQ2);
    check('2-8 직원 B 는 A 의 질문 글을 못 바꾼다', !!error && r?.query_text !== '바꿈', error?.message ?? `text=${r?.query_text}`);
  }
  {
    // 옛 앱 updateUnknownStatus(보관) 모양.
    const { error } = await B.c.from('unknown_queries').update({ status: 'archived' }).eq('id', UQ2).select('id');
    const r = await uqRow(UQ2);
    check('2-9 직원 B 는 A 의 질문을 보관 처리하지 못한다', !!error && r?.status === 'pending_owner_answer', error?.message ?? `status=${r?.status}`);
  }
  {
    const { data, error } = await B.c.from('unknown_queries').delete().eq('id', UQ2).select('id');
    check('2-10 직원 B 는 A 의 질문을 못 지운다(0행)', !error && (data ?? []).length === 0 && (await exists('unknown_queries', UQ2)) === 1,
      error?.message ?? `deleted=${(data ?? []).length}`);
  }
  {
    const { error } = await B.c.from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: A.id }).eq('id', UQ3).select('id');
    const r = await uqRow(UQ3);
    check('2-11 직원 B 는 남의 이름(answered_by)으로 답하지 못한다', !!error && r?.status === 'pending_owner_answer', error?.message ?? `status=${r?.status}`);
  }
  {
    // 옛 앱 resolveUnknown 그대로(동료가 기존 노하우로 답한다).
    const { data, error } = await B.c.from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: B.id }).eq('id', UQ1).select('id');
    const r = await uqRow(UQ1);
    check('2-12 직원 B 가 A 의 질문에 기존 노하우로 답한다(옛 앱 resolveUnknown)',
      !error && (data ?? []).length === 1 && r?.status === 'resolved_with_entry' && r?.answered_by === B.id && r?.resolved_with_entry_id === ENTRY,
      error?.message ?? JSON.stringify(r));
  }
  {
    const { error } = await B.c.from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: `${ENTRY}_x`, answered_by: B.id }).eq('id', UQ1).select('id');
    const r = await uqRow(UQ1);
    check('2-13 이미 답한 질문의 답을 동료가 덮어쓰지 못한다', !!error && r?.resolved_with_entry_id === ENTRY, error?.message ?? JSON.stringify(r));
  }
  {
    const { data, error } = await O.c.from('unknown_queries').update({ status: 'archived' }).eq('id', UQ2).select('id');
    const r = await uqRow(UQ2);
    check('2-14 사장은 상태를 바꾼다(옛 앱 updateUnknownStatus)', !error && (data ?? []).length === 1 && r?.status === 'archived',
      error?.message ?? `status=${r?.status}`);
  }
  {
    const { error } = await O.c.from('unknown_queries').update({ junior_id: O.id }).eq('id', UQ2).select('id');
    const r = await uqRow(UQ2);
    check('2-15 사장도 junior_id 는 못 바꾼다', !!error && r?.junior_id === A.id, error?.message ?? `junior=${r?.junior_id}`);
  }
  {
    const { data, error } = await O.c.from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: ENTRY, answered_by: O.id }).eq('id', UQ4).select('id');
    check('2-16 사장이 답한다(옛 앱 coach resolveUnknown)', !error && (data ?? []).length === 1, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    const { data, error } = await A.c.from('unknown_queries').delete().eq('id', UQ5).select('id');
    check('2-17 A 는 자기 질문을 지운다', !error && (data ?? []).length === 1, error?.message ?? `deleted=${(data ?? []).length}`);
  }
  {
    const { data, error } = await M.c.from('unknown_queries').delete().eq('id', UQ2).select('id');
    check('2-18 매니저는 질문을 지운다', !error && (data ?? []).length === 1, error?.message ?? `deleted=${(data ?? []).length}`);
  }

  // ════════════════ [3] 권한 ════════════════
  console.log('\n[3] 권한');
  {
    const out = psql(`select has_function_privilege('anon','public.guard_unknown_query_write()','EXECUTE')::text || ',' ||
      has_function_privilege('authenticated','public.guard_unknown_query_write()','EXECUTE')::text`);
    check('3-1 guard_unknown_query_write 는 anon·authenticated 실행 불가', out === 'false,false', out);
  }
  {
    const out = psql(`select string_agg(polname || ':' || polcmd::text, ',' order by polname) from pg_policy
      where polrelid in ('public.chat_queries'::regclass, 'public.unknown_queries'::regclass)`);
    check('3-2 for all 정책이 없고 명령별 정책 8개만 있다',
      out === 'cq_delete:d,cq_insert:a,cq_select:r,cq_update:w,uq_delete:d,uq_insert:a,uq_select:r,uq_update:w', out);
  }
} catch (e) {
  fail++;
  console.log('  FAIL 예외', e?.message ?? e);
} finally {
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nqa:query-rls  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
