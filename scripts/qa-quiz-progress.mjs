import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'quiz-progress-'));
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/lib/quiz/progress.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--ignoreConfig'], { stdio: 'pipe' });
const { isNextQuizRequest, quizTodo, legacyQuizOpen } =createRequire(import.meta.url)(join(out, 'progress.js'));
const a = { id: 'a', courseId: 'A', userId: 'me', sentAt: '2026-10-22', completedAt: null };
const b = { ...a, id: 'b', courseId: 'B', completedAt: '2026-10-22' };
const progress = [{ assignmentId: 'a', pendingEntryIds: ['shared'], totalItems: 4, answeredItems: 3 }, { assignmentId: 'b', pendingEntryIds: [], totalItems: 4, answeredItems: 4 }];
const ids = (list) => list.map((t) => t.assignment.id);
assert.deepEqual(ids(quizTodo([a, b], progress, { userId: 'me' })), ['a'], 'B completion must not hide A sharing same knowhow');
assert.deepEqual(quizTodo([b], progress, { userId: 'me' }), []);
assert.deepEqual(quizTodo([a, b], progress, { userId: 'someone-else' }), [], 'other user cannot receive assignment');
assert.deepEqual(quizTodo([a], [], { userId: 'me' }), [], 'missing server progress is not a fabricated pending quiz');
assert.deepEqual(quizTodo([a], [{ ...progress[0], totalItems: 0 }], { userId: 'me' }), [], 'no active items cannot become a quiz');
const newer = { ...a, id: 'new', sentAt: '2026-10-23' };
const rows = [...progress, { ...progress[0], assignmentId: 'new' }];
assert.deepEqual(ids(quizTodo([a, newer], rows, { userId: 'me' })), ['new']);
assert.deepEqual(ids(quizTodo([a, newer], rows, { userId: 'me', preferredId: 'a' })), ['a'], 'notification must open its assignment');
assert.deepEqual(quizTodo([{ ...a, completedAt: 'done' }, newer], rows, { userId: 'me', preferredId: 'a' }), [], 'completed notification must not open a different assignment');
assert.equal(isNextQuizRequest('1792598400000'), true);
assert.equal(isNextQuizRequest('missing-assignment'), false, 'unknown notification is not next-quiz request');
assert.deepEqual(ids(quizTodo([a], [{ ...progress[0], pendingEntryIds: [], answeredItems: 4 }], { userId: 'me' })), ['a'], 'saved answers with failed completion must remain recoverable');
// quizTodo(0332 · P3): 재발송은 최신 하나 · void 제외 · 1회성은 앞선 하나 · 알림이 가리킨 퀴즈는 규칙보다 앞선다.
const q = (id, courseId, sentAt, extra = {}) => ({ id, courseId, userId: 'me', sentAt, completedAt: null, ...extra });
const row = (assignmentId, state, total = 2, answered = 0) => ({ assignmentId, pendingEntryIds: ['e'], totalItems: total, answeredItems: answered, state });
const sendsT = [q('a1', 'A', '2026-10-20'), q('a2', 'A', '2026-10-21'), q('b1', 'B', '2026-10-21'), q('v1', 'V', '2026-10-21'), q('p1', 'P', '2026-10-21')];
const rowsT = [row('a1', 'todo'), row('a2', 'todo'), row('b1', 'todo'), row('v1', 'void', 0), row('p1', 'todo')];
const coursesT = [{ id: 'A', dueDays: null }, { id: 'B', dueDays: null }, { id: 'V', dueDays: null }, { id: 'P', dueDays: 7 }];
assert.deepEqual(quizTodo(sendsT, rowsT, { userId: 'me' }).map((t) => t.assignment.id).sort(), ['a2', 'b1', 'p1'], 'resend counts once (latest) and void is not a todo');
// 10-23 사용자: 벨·홈은 다른 퀴즈면 각각(1회성 규칙 없음). 카드만 cardRule 을 켠다.
assert.deepEqual(quizTodo(sendsT, rowsT, { userId: 'me', courses: coursesT }).map((t) => t.assignment.id), ['a2', 'b1', 'p1'], 'bell/home: each quiz once, no one-time rule');
assert.deepEqual(quizTodo(sendsT, rowsT, { userId: 'me', courses: coursesT, cardRule: true }).map((t) => t.assignment.id), ['a2'], 'card rule: first one-time quiz only, periodic hidden');
assert.deepEqual(quizTodo(sendsT, rowsT, { userId: 'me', courses: coursesT, cardRule: true, preferredId: 'b1' }).map((t) => t.assignment.id), ['a2', 'b1'], 'notified quiz beats the card rule');
assert.deepEqual(quizTodo(sendsT, [], { userId: 'me' }), [], 'no progress row is not a fabricated todo');
assert.deepEqual(quizTodo([q('d', 'A', '2026-10-21', { completedAt: 'x' })], [row('d', 'todo')], { userId: 'me' }), [], 'locally completed is done');
assert.equal(quizTodo([q('n', 'A', '2026-10-21')], [row('n', undefined, 2, 2)], { userId: 'me' })[0]?.state, 'answered', 'old server rows derive state from numbers');
// 진행 조회 실패: 화면은 [] 대신 undefined 를 넘긴다(quizProgressError). 완료 여부 폴백으로 안 푼 퀴즈가 남아야 한다.
assert.deepEqual(quizTodo(sendsT, undefined, { userId: 'me' }).map((t) => t.assignment.id).sort(), ['a2', 'b1', 'p1', 'v1'], 'progress read failure falls back to completedAt (quizzes do not vanish)');
assert.deepEqual(quizTodo([...sendsT.slice(0, 1), q('x', 'B', '2026-10-21', { completedAt: 'x' })], undefined, { userId: 'me' }).map((t) => t.assignment.id), ['a1'], 'fallback still drops completed');
// 시트·카드 문구(P5 · N12 · N13): 회차 결과를 퀴즈 결과처럼 말하지 않는다.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/lib/quiz/checkCopy.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--ignoreConfig'], { stdio: 'pipe' });
const copy = createRequire(import.meta.url)(join(out, 'checkCopy.js'));
assert.equal(copy.roundResultText(3, 3, { answered: 0, total: 6 }), '이번 3문제를 다 맞혔어요. 퀴즈는 3문제 남았어요.', 'N13: 6-item quiz, round 1 all correct is not done');
assert.equal(copy.roundResultText(3, 3, { answered: 3, total: 6 }), '이해 확인이 끝났어요.', 'done only when quiz has no items left');
assert.equal(copy.roundResultText(3, 1, { answered: 3, total: 6 }), '3개 중 1개 맞았어요. 퀴즈를 다 풀었어요.');
assert.equal(copy.roundResultText(3, 3), '이해 확인이 끝났어요.', 'no progress prop keeps old copy');
assert.equal(copy.roundStepText(2, { answered: 0, total: 6 }), '이번에 2문제 남았어요');
assert.equal(copy.roundStepText(2), '2문제 남았어요');
assert.equal(copy.cardProgressText({ answered: 0, total: 6 }), '아직 시작 전', 'N12: zero is a state word');
assert.equal(copy.cardProgressText({ answered: 3, total: 6 }), '3/6문제', 'N12: card counts answered items');
// P4 옛 퀴즈: 판정은 퀴즈별로 읽은 내 제출 집합만 본다(최근 200행 목록에 기대지 않는다).
assert.equal(legacyQuizOpen(['e1', 'e2'], new Set(['e1', 'e2'])), false, 'legacy quiz fully submitted is done');
assert.equal(legacyQuizOpen(['e1', 'e2'], new Set(['e1'])), true, 'legacy quiz with unsubmitted entry stays open');
assert.equal(legacyQuizOpen(['e1'], null), true, 'legacy read failure keeps the quiz (no vanish)');
console.log('quiz progress: 31 regression checks passed');
