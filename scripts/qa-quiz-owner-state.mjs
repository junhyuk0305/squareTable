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

const stats = declarations('src/lib/quiz/progress.ts', ['currentSend']) + '\n' + declarations('src/lib/quiz/courseStats.ts', ['latestQuizAssignments', 'latestCourseAnswers']);
const panelSource = fs.readFileSync(new URL('../src/components/owner/quiz/QuizDeployPanel.tsx', import.meta.url), 'utf8');
// 7fc9214 부터 패널의 shortDate 는 공용 linkLastDayLabel 의 별칭이다. 지역 구현이 돌아오면 그걸 잰다.
const localShortDate = /function shortDate\(/.test(panelSource);
const schedule = declarations('src/lib/quiz/schedule.ts', ['addDaysKst', 'dayLabelKst', ...(localShortDate ? [] : ['linkLastDayLabel'])]);
const panel = declarations('src/components/owner/quiz/QuizDeployPanel.tsx', ['kstDay', 'endOfDayIso', ...(localShortDate ? ['shortDate'] : [])])
  + (localShortDate ? '' : '\nconst shortDate = linkLastDayLabel;');
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
// 2026-11-03: 안 나간 행(다시 알리기·재확인 대기)은 이미 나간 발송을 가리지 않는다(직원 화면과 같은 currentSend).
assert.equal(latest.find((r) => r.courseId === 'A').id, 'old', 'unsent pending row does not hide the sent assignment');
const newerSent = { ...pending, sentAt: '2026-10-22T00:00:00Z' };
assert.equal(latestQuizAssignments([newerSent, old]).find((r) => r.courseId === 'A').id, 'new', 'previous completion does not hide a newer sent assignment');
assert.equal(latestQuizAssignments([pending]).at(0).id, 'new', 'nothing sent yet: latest scheduled row');
// 재확인(0169 origin='recheck')이 예약돼 있어도 그 행이 나가기 전까지 완료자는 '완료'다(직원 화면과 같다 · 11-03 행동 변화).
const recheck = { ...pending, id: 'recheck', origin: 'recheck' };
const kept = latestQuizAssignments([recheck, { ...old, origin: 'manual' }]).find((r) => r.courseId === 'A');
assert.equal(kept.id, 'old', 'pending recheck does not hide a completed sent assignment');
assert.ok(kept.completedAt, 'completed person stays completed until the recheck is sent');

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
// 0348 이어 풀기: 다시 알리기가 앞 회차를 이어받으면(countFrom < sentAt) 앞 회차 답으로 '푸는 중'이다. 직원 화면 진행과 같은 기준.
const carriedB = { ...sends[1], countFrom: '2026-10-21T00:00:00Z' };
assert.equal(m.personState(carriedB, ans), 'in_progress', '0348 carried send counts the previous round answers');
assert.equal(m.countFromOf(carriedB), '2026-10-21T00:00:00Z');
assert.equal(m.countFromOf(sends[1]), sends[1].sentAt, 'count_from null = sent_at');
assert.equal(m.countFromOf(sends[3]), null, 'not sent = null');
// 처음부터 다시 풀기: 시작 시각이 누른 때로 가면 그 전 답은 진행이 아니다.
assert.equal(m.personState({ ...sends[1], countFrom: '2026-10-22T06:00:00Z' }, ans), 'not_started', '0348 restart starts from the tap');
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
assert.deepEqual({ ...m.answersStat(5, 2) }, { ...it }, 'N18 entry-level counts use the same warn rule as item answers');
assert.equal(m.answersStat(4, 4).warn, false, 'N18 below min answers never warns');
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
// 0348 다시 알리기: raise 코드마다 사람 말이 있다(⑨) · 사람별 결과 토스트.
assert.equal(e.quizErrorMessage({ message: 'resend_cooldown' }), '방금 보냈어요. 10분 뒤에 다시 보낼 수 있어요');
for (const c of ['forbidden', 'quiz_not_found']) assert.notEqual(e.quizErrorMessage({ message: c }), e.quizErrorMessage({ message: 'x' }), c);
assert.deepEqual({ ...m.resendResultLabel([{ result: 'sent' }]) }, { text: '다시 알렸어요', good: true });
assert.deepEqual({ ...m.resendResultLabel([{ result: 'sent' }, { result: 'cooldown' }, { result: 'queued' }]) },
  { text: '1명에게 다시 알렸어요 · 1명은 방금 받아 10분 뒤에 보낼 수 있어요 · 1명은 최근 7일에 2번 받아 그 뒤에 나가요', good: true }, '(j) partial result says counts');
assert.equal(m.resendResultLabel([{ result: 'cooldown' }, { result: 'not_member' }]).good, false);
// (o) 다 푼 사람은 다시 받지 않는다(11-04) — 결과를 따로 말한다.
assert.deepEqual({ ...m.resendResultLabel([{ result: 'completed' }]) }, { text: '이미 다 풀어서 보내지 않았어요', good: false });
assert.equal(m.resendResultLabel([{ result: 'sent' }, { result: 'completed' }]).text, '1명에게 다시 알렸어요 · 1명은 이미 다 풀어서 보내지 않았어요');
// 다 푼 적이 있으면(최신 발송이 미완료 재확인이어도) 다시 알리기 대상이 아니다(서버 quiz_course_done_by 짝).
assert.equal(m.doneBefore([{ userId: 'x', completedAt: '2026-10-01' }, { userId: 'x', completedAt: null }], 'x'), true);
assert.equal(m.doneBefore([{ userId: 'x', completedAt: null }, { userId: 'y', completedAt: 'z' }], 'x'), false);
// (p) 나간 직원은 진행 숫자·다시 알리기 대상에서 빠진다(명단을 모르면 빼지 않는다).
const members = new Set(['a', 'b']);
assert.equal(m.isCurrentStaff('c', members), false);
assert.equal(m.isCurrentStaff('c', null), true, 'unknown roster does not hide anyone');
assert.deepEqual({ ...m.staffProgress(sends, ans, members) }, { recipients: 2, done: 1, started: 0, notStarted: 1, notDone: 1 }, 'left staff c is not counted');
// (m) 좌석 잠김은 따로 말한다("보내지 못했어요"로 뭉개지 않는다).
assert.deepEqual({ ...m.resendResultLabel([{ result: 'locked' }]) }, { text: '인원 한도를 넘어 받을 수 없어요', good: false });
assert.equal(m.resendResultLabel([{ result: 'sent' }, { result: 'locked' }]).text, '1명에게 다시 알렸어요 · 1명은 인원 한도를 넘어 받을 수 없어요');
// 화면 문구의 10 = schedule.ts 상수(서버 값은 qa:quiz-resend 가 대조한다).
const cooldownMin = Number(fs.readFileSync(new URL('../src/lib/quiz/schedule.ts', import.meta.url), 'utf8').match(/export const RESEND_COOLDOWN_MINUTES\s*=\s*(\d+)/)?.[1]);
assert.ok(e.quizErrorMessage({ message: 'resend_cooldown' }).includes(`${cooldownMin}분`) && m.resendResultLabel([{ result: 'cooldown' }]).text.includes(`${cooldownMin}분`), 'cooldown copy matches RESEND_COOLDOWN_MINUTES');
console.log('PASS quiz metrics: state, progress, Q1/Q2 rate, guest submissions, item answers, person board, link submit results');

// ── P5-4 래칫: 화면에서 숫자에 "명"·"정답률"·"완료"를 직접 붙이지 않는다(metrics.ts 가 만든다).
// 대상 = src/app/owner/quiz* · training.tsx · TrainingCard.tsx. 주석은 뺀다.
// 예외는 아래 표에만 둔다. 줄 조각(파일 안에서 유일해야 한다) + 이유. 쓰이지 않는 예외도 실패다(표가 썩지 않게).
const RATCHET_ALLOW = [
  { file: 'src/app/owner/quiz-new.tsx', snippet: '`${to.length}명에게 보내요`', why: '만들기 화면에서 고른 받는 사람 수. 발송 전 선택 인원이라 metrics 정의 밖이다' },
  { file: 'src/app/owner/quiz-new.tsx', snippet: '`${to.length}명에게 보내기` : `${to.length}명에게 예약하기`', why: '같은 선택 인원의 버튼 문구' },
];
{
  const root = new URL('../', import.meta.url);
  const targets = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const p = `${dir}/${f.name}`;
      if (f.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f.name)) targets.push(p);
    }
  };
  for (const f of fs.readdirSync(new URL('src/app/owner', root), { withFileTypes: true })) {
    if (!f.name.startsWith('quiz')) continue;
    if (f.isDirectory()) walk(`src/app/owner/${f.name}`);
    else targets.push(`src/app/owner/${f.name}`);
  }
  targets.push('src/app/owner/training.tsx', 'src/components/work/TrainingCard.tsx');
  // 숫자(또는 ${…}/{…} 값) 바로 뒤의 명·완료, 바로 앞의 정답률·완료.
  const glued = /(?:\}|\d)\s*(?:명|완료)|(?:정답률|완료)\s*(?:\$\{|\{|\d)/;
  const used = new Set();
  const bad = [];
  for (const file of targets) {
    const src = fs.readFileSync(new URL(file, root), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    src.split('\n').forEach((line, i) => {
      if (!glued.test(line)) return;
      const allow = RATCHET_ALLOW.findIndex((a) => a.file === file && line.includes(a.snippet));
      if (allow >= 0) used.add(allow);
      else bad.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], 'P5 ratchet: number glued to 명/정답률/완료 outside metrics.ts — use metrics labels or add an allow entry with a reason');
  const stale = RATCHET_ALLOW.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.snippet}`);
  assert.deepEqual(stale, [], 'P5 ratchet: allow entries that no longer match — remove them');
  console.log(`PASS quiz P5 ratchet: ${targets.length} files, ${RATCHET_ALLOW.length} allowed exceptions`);
}
