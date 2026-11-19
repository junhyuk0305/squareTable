// qa-quiz-link-count.mjs — "링크 제출 N건"은 정리한 제출을 세지 않는다(0932 · 2026-11-19 사용자 결정) · 로컬 도커 전용 · 자가정리 · LLM 0회
//
// 무엇을 증명하나:
//   (1) 사장 목록의 quiz_course_stats.guest_submissions 가 정리한(cleared_at) 제출을 빼고 센다.
//       설정 탭 링크 섹션(fetchGuestQuizSubmissions · db.ts cleared_at 거르기)과 같은 기준이다.
//   (2) 정답률 분모(first_asked)는 정리한 제출의 답도 그대로 센다(정답률은 바꾸지 않는다).
// 사용: node scripts/qa-quiz-link-count.mjs --local
import { localEnv, makeLocal, makeWorld, cleanupWorld, ok } from './lib/qa-fz-local.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin } = L;
let pass = 0, fail = 0;
const check = (n, good, extra = '') => {
  if (good) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); }
};

const worlds = [];
try {
  const w = await makeWorld(L, env, { tag: 'lc', staffN: 0, courses: [{ items: 2 }] });
  worlds.push(w);
  const C = w.courses[0];
  // 손님 제출 둘(문항 2개씩). 하나는 정리한다.
  for (const [k, sub] of ['s1', 's2'].entries()) {
    const sid = `sub_lc_${sub}_${w.s}`;
    await ok(admin.from('quiz_attempts').insert({ unit_id: w.unit, entry_id: C.entry, guest_name: `손님${k}`, total: 2, correct: 1,
      submission_id: sid, course_id: C.id, cleared_at: sub === 's1' ? new Date().toISOString() : null }), 'quiz_attempts');
    await ok(admin.from('quiz_attempt_items').insert(C.items.map((it, i) => ({ unit_id: w.unit, submission_id: sid, item_id: it.id, ord: i,
      format: 'mc4', payload: {}, correct: i === 0, course_id: C.id, entry_ids: [C.entry] }))), 'quiz_attempt_items');
  }
  const stats = await ok(w.owner.c.rpc('quiz_course_stats'), 'quiz_course_stats');
  const st = stats.find((r) => r.course_id === C.id);
  check('(1) 링크 제출 = 정리 안 한 1건', Number(st?.guest_submissions) === 1, JSON.stringify(st?.guest_submissions));
  check('(2) 정답률 분모는 정리한 제출도 센다(문항 4개)', Number(st?.first_asked) === 4, JSON.stringify(st?.first_asked));
} catch (err) {
  fail++; console.log('  ✗ 중단:', err.message);
} finally {
  const cl = await cleanupWorld(L, env, worlds).catch((err) => ({ left: -1, detail: [err.message] }));
  check('정리: 남은 행 0', cl.left === 0, cl.detail?.join(' ') ?? '');
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} 통과 · ${fail} 실패 · LLM 0회`);
process.exit(fail === 0 ? 0 : 1);
