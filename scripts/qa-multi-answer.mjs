// qa-multi-answer.mjs — 받은 질문에 여러 직원이 답한다(C3 · 0910) · 로컬 실세션 · LLM 호출 0회.
//
// 무엇을 증명하나(정본 = 산출물/첫사용측정_2026-11-17/세션C_화면데이터어긋남수정_2026-11-19.md C3 절):
//   1. 직원 A 가 답 제안 → 질문 행의 답 수(proposal_count)가 1. 직원 B 는 새로고침 없이 질문 행 UPDATE 이벤트로 1 을 받는다.
//      B 는 A 의 제안 본문을 못 읽는다(ps_select 그대로 · 숫자만 보인다).
//   2. B 도 답 → 2. 사장은 같은 질문(source_uq_id) 아래 제안 둘을 읽는다.
//   3. 사장이 B 를 승인(코치 길 = save_unknown_answer → review_suggestion) → A 는 자동 반려(0582 · 검토한 사람 없음), B 는 승인.
//   4. 다른 질문에 둘이 답한 뒤 A 가 취소 → 1. 사장이 B 를 반려 → 0 · 승인 대기(uq_in_review) false.
//   5. 직원이 답 수를 직접 써도 실제 수로 돌아온다(위조 불가).
//   6. 옛 앱 호환: 답이 있는 동안 uq_in_review = true(옛 앱은 지금처럼 첫 답 뒤 질문을 숨긴다).
//   7. 전체 자가점검: 칸 값 ≠ 실제 대기 제안 수인 행 0개.
// 동시에 두 답을 내는 겹침 보장 케이스는 qa-race.mjs MA 다.
// 사용: npm run qa:multi-answer:local
import './lib/require-local-target.mjs';
import { localEnv, makeLocal, makeWorld, cleanupWorld } from './lib/qa-fz-local.mjs';

const env = localEnv();
const L = makeLocal(env);
const t = { pass: 0, fail: 0, skip: 0 };
const check = (name, ok, detail = '') => {
  if (ok) t.pass++; else t.fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTO_NOTE = '다른 답으로 해결된 질문이에요.';

let w = null;
const channels = [];
try {
  w = await makeWorld(L, env, { tag: 'ma', staffN: 3, courses: [] });
  const [A, B, C] = w.staff; // C = 질문한 직원
  const uq1 = `uq_ma1_${w.s}`, uq2 = `uq_ma2_${w.s}`;
  for (const id of [uq1, uq2]) {
    L.psql(`insert into public.unknown_queries(id, unit_id, junior_id, junior_name, query_text, status)
      values (${q(id)}, ${q(w.unit)}, ${q(C.id)}, 'QA_C', 'QA 여러 답 질문 ${id}', 'pending_owner_answer')`);
  }

  const readUq = async (who, id) => {
    const r = await who.c.from('unknown_queries').select('id, proposal_count, in_review:uq_in_review').eq('id', id).maybeSingle();
    return r.error ? { err: r.error.message } : r.data;
  };
  const propose = async (who, id, sug, text) => who.c.from('playbook_suggestions').insert({
    id: sug, unit_id: w.unit, kind: 'new', source_uq_id: id, proposer_id: who.id, proposer_name: `QA_${who.key}`, text, status: 'pending',
  });

  // B 의 실시간 구독(앱 subscribeUnknownQueue 와 같은 필터).
  const events = [];
  await B.c.realtime.setAuth();
  await new Promise((resolve, reject) => {
    const ch = B.c.channel(`qa_ma_${w.s}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'unknown_queries', filter: `unit_id=eq.${w.unit}` }, (p) => events.push(p.new))
      .subscribe((st) => { if (st === 'SUBSCRIBED') resolve(); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') reject(new Error(`realtime ${st}`)); });
    channels.push([B.c, ch]);
  });
  const waitEvent = async (pred, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (events.some(pred)) return true; await sleep(150); }
    return false;
  };

  // ── 1. A 가 답 ──
  const sA1 = `sug_ma_a1_${w.s}`, sB1 = `sug_ma_b1_${w.s}`;
  const pa = await propose(A, uq1, sA1, 'QA A 의 답');
  check('A 답 제안 저장', !pa.error, pa.error?.message ?? '');
  const b1 = await readUq(B, uq1);
  check('B 가 읽은 답 수 = 1', b1?.proposal_count === 1, JSON.stringify(b1));
  check('B 화면에 새로고침 없이 이벤트(답 수 1)', await waitEvent((n) => n.id === uq1 && n.proposal_count === 1), `이벤트 ${events.length}건`);
  const peek = await B.c.from('playbook_suggestions').select('id').eq('source_uq_id', uq1);
  check('B 는 A 의 제안 본문을 못 읽는다(0행)', !peek.error && (peek.data ?? []).length === 0, peek.error?.message ?? `${(peek.data ?? []).length}행`);
  check('옛 앱 칸 uq_in_review = true(옛 앱은 지금처럼 숨긴다)', b1?.in_review === true, JSON.stringify(b1));

  // ── 2. B 도 답 → 사장 화면에 한 질문 아래 둘 ──
  const pb = await propose(B, uq1, sB1, 'QA B 의 답');
  check('B 도 답 제안 저장', !pb.error, pb.error?.message ?? '');
  const a2 = await readUq(A, uq1);
  check('답 수 = 2', a2?.proposal_count === 2, JSON.stringify(a2));
  check('B 이벤트(답 수 2)', await waitEvent((n) => n.id === uq1 && n.proposal_count === 2));
  const own = await w.owner.c.from('playbook_suggestions').select('id, proposer_id').eq('source_uq_id', uq1).eq('status', 'pending');
  check('사장은 한 질문 아래 제안 2개를 읽는다', !own.error && (own.data ?? []).length === 2, own.error?.message ?? `${(own.data ?? []).length}개`);

  // ── 3. 사장이 B 를 승인(코치 길) ──
  const ent = `pb_ma1_${w.s}`;
  const sv = await w.owner.c.rpc('save_unknown_answer', {
    p_uq_id: uq1, p_entry: { id: ent, title: 'QA 승인 답', category: '서비스', creator_role: 'owner' }, p_suggestion_id: sB1,
  });
  check('save_unknown_answer(B 제안) ok', !sv.error, sv.error?.message ?? JSON.stringify(sv.data));
  const rv = await w.owner.c.rpc('review_suggestion', { p_id: sB1, p_status: 'approved', p_resulting_entry_id: ent });
  check('review_suggestion(B 승인) ok·already', !rv.error && ['ok', 'already'].includes(rv.data?.status), rv.error?.message ?? JSON.stringify(rv.data));
  const st = L.psql(`select string_agg(id || '=' || status || '/' || coalesce(reviewed_by::text, '-') || '/' || coalesce(owner_note, '-'), ',' order by id)
    from public.playbook_suggestions where source_uq_id = ${q(uq1)}`);
  check('A 는 자동 반려 · B 는 승인', st === `${sA1}=rejected/-/${AUTO_NOTE},${sB1}=approved/${w.owner.id}/-`, st);
  const mine = await A.c.from('playbook_suggestions').select('status, owner_note, reviewed_by').eq('id', sA1).maybeSingle();
  check('A 는 자기 제안의 자동 반려를 읽는다(안내 파생 재료)', mine.data?.status === 'rejected' && mine.data?.owner_note === AUTO_NOTE && mine.data?.reviewed_by === null, JSON.stringify(mine.data));
  const a3 = await readUq(A, uq1);
  check('해결된 질문의 답 수 = 0(대기 제안 없음)', a3?.proposal_count === 0, JSON.stringify(a3));

  // ── 4. 다른 질문: 둘 다 답 → A 취소 → 사장이 B 반려 ──
  const sA2 = `sug_ma_a2_${w.s}`, sB2 = `sug_ma_b2_${w.s}`;
  await propose(A, uq2, sA2, 'QA A 두번째');
  await propose(B, uq2, sB2, 'QA B 두번째');
  check('질문 2 답 수 = 2', (await readUq(B, uq2))?.proposal_count === 2);
  const wd = await A.c.rpc('suggestion_withdraw', { p_id: sA2 });
  check('A 취소 ok', !wd.error, wd.error?.message ?? '');
  const b4 = await readUq(B, uq2);
  check('A 취소 뒤 답 수 = 1', b4?.proposal_count === 1, JSON.stringify(b4));
  check('B 이벤트(취소 뒤 1)', await waitEvent((n) => n.id === uq2 && n.proposal_count === 1 && events.filter((e) => e.id === uq2).length >= 3));
  const rj = await w.owner.c.rpc('review_suggestion', { p_id: sB2, p_status: 'rejected', p_owner_note: 'QA 반려' });
  check('사장 B 반려 ok', !rj.error && rj.data?.status === 'ok', rj.error?.message ?? JSON.stringify(rj.data));
  const b5 = await readUq(B, uq2);
  check('반려 뒤 답 수 = 0 · uq_in_review = false', b5?.proposal_count === 0 && b5?.in_review === false, JSON.stringify(b5));

  // ── 5. 위조: 직원이 답 수를 직접 쓴다 ──
  const fg = await B.c.from('unknown_queries').update({ proposal_count: 99 }).eq('id', uq2).select('proposal_count');
  const after = Number(L.psql(`select proposal_count from public.unknown_queries where id = ${q(uq2)}`));
  check('직원이 직접 쓴 답 수는 실제 수(0)로 돌아온다', after === 0, `${fg.error ? `err ${fg.error.message}` : 'ok'} · 칸 ${after}`);

  // ── 7. 전체 자가점검 ──
  const bad = Number(L.psql(`select count(*) from public.unknown_queries u
    where u.proposal_count is distinct from (select count(*) from public.playbook_suggestions ps
      where ps.source_uq_id = u.id and ps.unit_id = u.unit_id and ps.status = 'pending')`));
  check('칸 값 ≠ 실제 대기 제안 수인 행 = 0(로컬 전체)', bad === 0, `${bad}행`);
} catch (e) {
  check('셋업·실행', false, e.message.slice(0, 240));
} finally {
  for (const [c, ch] of channels) await c.removeChannel(ch).catch(() => {});
  if (w) {
    try {
      L.psql(`delete from public.playbook_suggestions_withdrawn where unit_id = ${q(w.unit)}; delete from public.peer_answer_log where unit_id = ${q(w.unit)}`);
      const cl = await cleanupWorld(L, env, [w]);
      check('정리 뒤 남은 행 = 0', cl.left === 0, cl.detail.join(' '));
    } catch (e) { check('정리', false, e.message.slice(0, 200)); }
  }
}
console.log(`\n${t.fail ? 'RED' : 'GREEN'} — pass ${t.pass} · fail ${t.fail} · skip ${t.skip} (AI 호출 0회)`);
process.exitCode = t.fail ? 1 : 0;
