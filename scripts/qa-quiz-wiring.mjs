// 퀴즈 화면 연결 검사(백엔드 없음). 마무리 2026-10-23 항목 1·2.
//   ① 화면 세 곳(홈·벨·카드)이 같은 입구(staffQuizTodo)를 스토어 courses 그대로 넘겨 부르는가. 카드만 1회성 규칙을 켠다.
//   ② 같은 입력에서 홈 수 = 벨 수 = 할 퀴즈 수(퀴즈별 최신 발송 하나), 카드는 그 부분집합.
//   ③ WorkBoard·useWorkStore 보류 변경(WorkBoard_보류변경_2026-10-23.md 1~4)이 들어갔나.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// 주석은 뺀다(설명 문장에 함수 이름이 나와도 호출이 아니다).
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const out = mkdtempSync(join(tmpdir(), 'quiz-wiring-'));
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/lib/quiz/progress.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--ignoreConfig'], { stdio: 'pipe' });
const P = createRequire(import.meta.url)(join(out, 'progress.js'));
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '—', e.message.split('\n')[0]); } };

// ── ② 순수 판정: 화면이 넘기는 모양(스토어 training_courses 행 · 발송 · 진행) 그대로 ──
const asg = (id, courseId, sentAt) => ({ id, courseId, userId: 'me', sentAt, completedAt: null });
const prog = (assignmentId) => ({ assignmentId, pendingEntryIds: ['e'], totalItems: 2, answeredItems: 0, state: 'todo' });
// 스토어 courses 행(snake) — 1회성 A·B · 주기 P · 손님용 G
const courses = [
  { id: 'A', name: 'A', due_days: null, audience: 'staff' },
  { id: 'B', name: 'B', due_days: null, audience: 'staff' },
  { id: 'P', name: 'P', due_days: 30, audience: 'staff' },
  { id: 'G', name: 'G', due_days: null, audience: 'guest' },
];
const sends = [asg('a1', 'A', '2026-10-20'), asg('a2', 'A', '2026-10-21'), asg('b1', 'B', '2026-10-21'), asg('p1', 'P', '2026-10-21'), asg('g1', 'G', '2026-10-21')];
const rows = sends.map((s) => prog(s.id));
check('staffQuizTodo 가 있다', () => assert.equal(typeof P.staffQuizTodo, 'function'));
check('벨·홈: 다른 퀴즈는 각각 · 재발송은 최신 하나 · 손님용 제외', () => {
  const bell = P.staffQuizTodo(sends, rows, courses, { userId: 'me' }).map((t) => t.assignment.id);
  assert.deepEqual(bell, ['a2', 'b1', 'p1']);
});
check('카드: 1회성은 앞선 하나 · 주기는 숨김 · 벨의 부분집합', () => {
  const bell = new Set(P.staffQuizTodo(sends, rows, courses, { userId: 'me' }).map((t) => t.assignment.id));
  const cards = P.staffQuizTodo(sends, rows, courses, { userId: 'me', cardRule: true }).map((t) => t.assignment.id);
  assert.deepEqual(cards, ['a2']);
  assert.ok(cards.every((id) => bell.has(id)));
});
check('카드: 알림이 가리킨 퀴즈는 규칙보다 앞선다', () => {
  assert.deepEqual(P.staffQuizTodo(sends, rows, courses, { userId: 'me', cardRule: true, preferredId: 'b1' }).map((t) => t.assignment.id), ['a2', 'b1']);
});
check('진행을 못 읽으면(undefined) 완료 여부만 본다', () => {
  assert.deepEqual(P.staffQuizTodo(sends, undefined, courses, { userId: 'me' }).map((t) => t.assignment.id), ['a2', 'b1', 'p1']);
});

// ── ①' 옛 퀴즈(발송 원장 없음)까지 넣은 할 퀴즈 수 = openQuizzes 하나(검증 후속 10-23) ──
check('openQuizzes: 발송 퀴즈 + 옛 퀴즈 · legacyOpenQuizIds 판정', () => {
  assert.equal(typeof P.openQuizzes, 'function');
  assert.equal(typeof P.legacyOpenQuizIds, 'function');
  const lc = [...courses, { id: 'L', name: 'L', due_days: null, audience: 'staff', min_items: 1, created_at: '2026-08-01T00:00:00+09:00' }];
  const ce = [{ courseId: 'L', entryId: 'e1', position: 0 }, { courseId: 'L', entryId: 'e2', position: 1 }];
  const legacy = P.legacyOpenQuizIds(lc, sends, ce, { e1: 1, e2: 1 }, { L: new Set(['e1']) });
  assert.deepEqual(legacy, ['L']);
  assert.deepEqual(P.legacyOpenQuizIds(lc, sends, ce, { e1: 1, e2: 1 }, { L: new Set(['e1', 'e2']) }), []);
  assert.equal(P.openQuizzes(sends, rows, lc, 'me', legacy).length, 4);
});
const bellUi = src('src/components/NotificationBell.tsx');
const badge = src('src/lib/push/appBadge.ts');
const list = src('src/app/junior/notifications.tsx');
check('홈·벨·앱 배지·알림 목록이 옛 퀴즈 판정(useLegacyQuizOpen)을 같이 넘긴다', () => {
  const homeS = src('src/lib/hooks/useJuniorHomeData.ts'), notifS = src('src/lib/utils/notifications.ts');
  for (const [name, s] of [['home', homeS], ['bell', bellUi], ['badge', badge], ['list', list]]) assert.match(s, /useLegacyQuizOpen\(/, name);
  assert.match(homeS, /openQuizzes\(/);
  assert.match(notifS, /openQuizzes\(/);
});

// ── ① 세 화면이 같은 입구를 같은 입력으로 부른다 ──
const home = src('src/lib/hooks/useJuniorHomeData.ts');
const notif = src('src/lib/utils/notifications.ts');
const board = src('src/components/WorkBoard.tsx');
check('홈은 staffQuizTodo 를 스토어 courses 로 부른다(카드 규칙 없음)', () => {
  // 진행 조회 실패면 벨처럼 undefined 를 넘긴다(같은 입력).
  assert.match(home, /openQuizzes\(assignments, quizProgressError \? undefined : quizProgress, courses, userId, legacy\.ids \?\? \[\]\)/);
  assert.doesNotMatch(home, /\bquizTodo\(/);
});
check('벨(목록·배지·허브)은 staffQuizTodo 하나(카드 규칙 없음)', () => {
  assert.match(notif, /openQuizzes\(assignments, progress, courses, me, legacy\)/);
  assert.match(notif, /myOpenQuizzes\(assignments, me, quizProgress, quizCourses, legacyQuizIds\)/);
  assert.match(notif, /myOpenQuizzes\(assignments, me, quizProgress, courses, legacyQuizIds\)/);
  assert.doesNotMatch(notif, /\bquizTodo\(/);
  assert.doesNotMatch(notif, /cardRule/);
});
check('카드는 staffQuizTodo + cardRule', () => {
  assert.match(board, /staffQuizTodo\(assignments, quizProgress, courses, \{ userId, preferredId: quizParam, cardRule: true \}\)/);
  assert.doesNotMatch(board, /pendingCourseAssignment/);
});

// ── ③ 보류 변경 ──
check('WorkBoard: 진행 알약·시트 남은 문항 · lastResult 제거', () => {
  assert.match(board, /progress=\{c\.progress\}/);
  assert.match(board, /quizProgress=\{selfCheck\.quizProgress\}/);
  assert.doesNotMatch(board, /lastResult/);
});
check('WorkBoard: "지난번 퀴즈" 줄은 lastSubmission 조회로', () => {
  assert.match(board, /lastSubmission=\{/);
  assert.match(board, /fetchMyLastQuizSubmissions\(/);
});
check('WorkBoard: 옛 퀴즈 카드는 이해 기록이 아니라 이 퀴즈의 내 제출을 본다', () => {
  assert.match(board, /lastQuizAttemptOf\(quizAttempts, \[id\], userId, c\.id\)/);
  assert.doesNotMatch(board, /recheckEntryDue\(myRow\(/);
  assert.doesNotMatch(board, /isRegularDue\(myRow\(/);
});
check('useWorkStore: 이해 기록·코스 노하우 조회 실패가 loadError 에 잇는다', () => {
  const store = src('src/lib/store/useWorkStore.ts');
  assert.match(store, /fetchKnowhowUnderstandingResult\(\)/);
  assert.match(store, /fetchCourseEntriesResult\(\)/);
  assert.match(store, /loadError: templates\.error \|\| done\.error \|\| feed\.error \|\| understanding\.error \|\| courseEntries\.error/);
});

console.log('RESULT', fails ? 'RED' : 'GREEN', 'fails=' + fails);
process.exitCode = fails ? 1 : 0;
