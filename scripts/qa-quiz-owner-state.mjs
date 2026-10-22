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
