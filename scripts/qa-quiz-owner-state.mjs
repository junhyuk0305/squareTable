// No backend: execute the actual pure declarations used by owner quiz screens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function declarations(path, names) {
  const source = ts.createSourceFile(path, fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return names.map((name) => {
    const node = source.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(node, `${path}: ${name} exists`);
    return node.getText(source).replace(/^export\s+/, '');
  }).join('\n');
}

const stats = declarations('src/lib/quiz/courseStats.ts', ['latestQuizAssignments', 'latestCourseAnswers']);
const schedule = declarations('src/lib/quiz/schedule.ts', ['addDaysKst', 'dayLabelKst']);
const panel = declarations('src/components/owner/quiz/QuizDeployPanel.tsx', ['kstDay', 'endOfDayIso', 'shortDate']);
const panelSource = fs.readFileSync(new URL('../src/components/owner/quiz/QuizDeployPanel.tsx', import.meta.url), 'utf8');
// Test the actual local implementation if reintroduced, otherwise the imported shared helper.
const addDays = /function addDays\(/.test(panelSource)
  ? declarations('src/components/owner/quiz/QuizDeployPanel.tsx', ['addDays'])
  : 'const addDays = addDaysKst;';
const code = ts.transpileModule(`const pad2 = (n: number) => String(n).padStart(2, '0');\n${stats}\n${schedule}\n${addDays}\n${panel}\nglobalThis.api = { latestQuizAssignments, latestCourseAnswers, endOfDayIso, shortDate };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const context = vm.createContext({});
vm.runInContext(code, context);
const { latestQuizAssignments, latestCourseAnswers, endOfDayIso, shortDate } = context.api;

assert.equal(endOfDayIso('2026-10-22'), '2026-10-22T15:00:00.000Z', 'selected day remains open until next KST midnight');
assert.equal(endOfDayIso('2026-12-31'), '2026-12-31T15:00:00.000Z', 'year boundary');
assert.equal(endOfDayIso('2028-02-29'), '2028-02-29T15:00:00.000Z', 'leap day');
assert.equal(shortDate('2026-10-22T15:00:00.000Z'), '10월 22일', 'display includes selected day, independent of host timezone');

const old = { id: 'old', courseId: 'A', userId: 'u', scheduledOn: '2026-10-20', sentAt: '2026-10-20T00:00:00Z', completedAt: '2026-10-20T01:00:00Z' };
const pending = { ...old, id: 'new', scheduledOn: '2026-10-22', sentAt: null, completedAt: null };
const other = { ...old, id: 'B', courseId: 'B' };
const latest = latestQuizAssignments([pending, old, other]);
assert.equal(latest.length, 2, 'course scopes stay separate');
assert.equal(latest.find((r) => r.courseId === 'A').id, 'new', 'previous completion does not hide new assignment');

const sentAt = '2026-10-22T00:00:00Z';
const answers = [
  { itemId: 'one', takenAt: '2026-10-21T01:00:00Z', correct: true },
  ...['one', 'two', 'three', 'four'].map((itemId, i) => ({ itemId, takenAt: `2026-10-22T0${i + 1}:00:00Z`, correct: true })),
  { itemId: 'two', takenAt: '2026-10-22T06:00:00Z', correct: false },
];
const round = latestCourseAnswers(answers, sentAt);
assert.equal(round.length, 4, 'four separate entry submissions are one course result');
assert.equal(round.filter((r) => r.correct).length, 3, 'a repeat answer replaces the earlier item result');
assert.equal(latestCourseAnswers(answers, null).length, 0, 'scheduled assignment has no current answers');
assert.equal(latestCourseAnswers(answers, '2026-10-23T00:00:00Z').length, 0, 'earlier round cannot answer a later send');
console.log('PASS quiz owner state: expiry boundaries, latest assignment, course round answers');

// ── metrics.ts · errors.ts (P5) — whole modules, no runtime imports.
function moduleOf(path) {
  const out = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const ctx = vm.createContext({ exports: {} });
  vm.runInContext(out, ctx);
  return ctx.exports;
}
const m = moduleOf('src/lib/quiz/metrics.ts');
const e = moduleOf('src/lib/quiz/errors.ts');
const NOW = Date.parse('2026-10-23T00:00:00Z');
const openLink = { expiresAt: '2026-10-30T00:00:00Z', revokedAt: null };
assert.equal(m.quizState({ active: true, start_at: '2026-10-25' }, [], [openLink], NOW), 'link_open', 'N09 link-only quiz is open, not scheduled');
assert.equal(m.quizState({ active: false }, [], [openLink], NOW), 'archived');
assert.equal(m.quizState({ active: true, start_at: '2026-10-25' }, [], [{ ...openLink, revokedAt: 'x' }], NOW), 'scheduled');
assert.equal(m.quizState({ active: true }, [], [], NOW), 'draft');
assert.equal(m.QUIZ_STATE_LABEL[m.quizState({ active: true }, [{ userId: 'a', sentAt: 'x', completedAt: null }], [], NOW)], '발송 중');

const sends = [
  { userId: 'a', sentAt: '2026-10-22T00:00:00Z', completedAt: '2026-10-22T05:00:00Z' },
  { userId: 'b', sentAt: '2026-10-22T00:00:00Z', completedAt: null },
  { userId: 'c', sentAt: '2026-10-22T00:00:00Z', completedAt: null },
  { userId: 'd', sentAt: null, completedAt: null },
];
const ans = [
  { itemId: 'i1', staffId: 'a', submissionId: 's1', takenAt: '2026-10-22T01:00:00Z', correct: false },
  { itemId: 'i1', staffId: 'a', submissionId: 's2', takenAt: '2026-10-22T02:00:00Z', correct: true },
  { itemId: 'i2', staffId: 'a', submissionId: 's2', takenAt: '2026-10-22T02:00:00Z', correct: true },
  { itemId: 'i1', staffId: 'b', submissionId: 's3', takenAt: '2026-10-21T01:00:00Z', correct: true }, // before this send
  { itemId: 'i1', staffId: 'c', submissionId: 's4', takenAt: '2026-10-22T03:00:00Z', correct: true, source: 'self' },
  { itemId: 'i1', staffId: null, submissionId: 'g1', takenAt: '2026-10-22T04:00:00Z', correct: false },
  { itemId: 'i1', staffId: null, submissionId: 'g2', takenAt: '2026-10-22T05:00:00Z', correct: true },
];
const p = m.staffProgress(sends, ans);
assert.deepEqual({ ...p }, { recipients: 3, done: 1, started: 0, notStarted: 2, notDone: 2 }, 'N11/N17 scheduled excluded, self and old-round answers do not start');
assert.equal(m.doneLabel(p), '완료 1/3명');
assert.equal(m.allDone(m.staffProgress([], ans)), false, 'link-only is not done');
const r = m.quizRate(ans);
// staff first: a:i1 false, a:i2 true, b:i1 true (cumulative), c self excluded; guests: false, true
assert.deepEqual({ ...r }, { asked: 5, correct: 3, pct: 60 }, 'Q2 staff first attempt + all guest submissions, Q1 self excluded');
assert.equal(m.rateLabel(m.quizRate([])), '정답률 —');
assert.equal(m.rateFromStat({}).pct, null, 'no server column -> no rate');
assert.equal(m.guestSubmissions(ans), 2);
assert.equal(m.guestSubmissionsLabel(2), '링크 제출 2건');
const it = m.itemAnswers(ans, 'i1');
assert.equal(it.answers, 5, 'self excluded from item answers');
assert.equal(m.itemAnswersLabel(it), '답안 5건 · 오답 40%');
assert.equal(it.warn, true);
const pb = m.personBoard(ans, 'a');
assert.deepEqual({ rate: { ...pb.rate }, wrongItems: pb.wrongItems, submissions: pb.submissions }, { rate: { asked: 2, correct: 1, pct: 50 }, wrongItems: 1, submissions: 2 }, 'N05 person first attempt, no double count');
assert.equal(m.roundLabel([{ correct: true }, { correct: false }], 6), '6문제 중 1개 맞힘', 'N17 denominator = quiz item count');
assert.equal(m.resultsEmpty([], ans.filter((x) => x.staffId == null)), false, 'N10 guest results are not empty');
assert.equal(m.resultsEmpty([], []), true);

assert.equal(e.linkSubmitResultOf(null), 'ok');
assert.equal(e.linkSubmitResultOf({ message: 'link_unavailable' }), 'link_closed');
assert.equal(e.linkSubmitResultOf({ message: 'too_many_submissions' }), 'rate_limited');
assert.equal(e.linkSubmitResultOf({ message: 'bad_phone' }), 'bad_input');
assert.equal(e.linkSubmitResultOf({ message: 'Failed to fetch' }), 'network');
for (const k of ['ok', 'link_closed', 'rate_limited', 'bad_input', 'network']) assert.ok(e.LINK_SUBMIT_MESSAGE[k], k);
assert.equal(e.quizErrorMessage({ message: 'last_quiz_item' }).includes('보관'), true);
console.log('PASS quiz metrics: state, progress, Q1/Q2 rate, guest submissions, item answers, person board, link submit results');
