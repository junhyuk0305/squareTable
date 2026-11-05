#!/usr/bin/env node
// qa-judgment-diff.mjs — 같은 실체를 판정하는 클라 순수 함수 쌍에 같은 입력을 넣어 출력이 갈리는지 잰다(2026-11-03 P7).
//
// 근거 지도 = 산출물/오류탐지_2026-11-03/A1_판정복제지도.md (S1~S8).
// ★기대값을 여기서 다시 구현하지 않는다. 비교 대상은 src 의 실제 함수 두 개다.
//   - 모듈 함수: scripts/lib/qa-notif-hooks.mjs 훅으로 그대로 import 한다.
//   - 스토어·화면 안 함수/인라인 식: TS AST 로 그 선언·식의 원문을 잘라 vm 으로 돌린다(qa-quiz-owner-state 방식).
//   - 서버(SQL) 짝은 여기서 못 부른다. NOTE 줄로만 적고 세지 않는다.
// 출력: 케이스마다 DIFF/SAME. DIFF 는 FAIL 로 센다(수정 전 RED 가 목적). 백엔드·브라우저·AI 0.
// 실행: node scripts/qa-judgment-diff.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { installNotifHooks } = await import(pathToFileURL(join(ROOT, 'scripts/lib/qa-notif-hooks.mjs')).href);
installNotifHooks();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

let same = 0, diff = 0, skip = 0, notRun = 0;
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
/** 한 케이스. a·b 는 출력값(같으면 SAME). 던지면 '실행 못 한 케이스'. */
function compare(pair, name, fn) {
  try {
    const { a, b } = fn();
    if (JSON.stringify(a) === JSON.stringify(b)) { same++; console.log(`SAME ${pair} ${name} A=${show(a)} B=${show(b)}`); }
    else { diff++; console.log(`DIFF ${pair} ${name} A=${show(a)} B=${show(b)}`); }
  } catch (e) {
    notRun++; console.log(`ERROR ${pair} ${name} ${e?.message ?? e}`);
  }
}
const skipCase = (pair, name, why) => { skip++; console.log(`SKIP ${pair} ${name} (${why})`); };
const note = (pair, name, text) => console.log(`NOTE ${pair} ${name} ${text}`);

// ── AST 추출 ──────────────────────────────────────────────────────────────
function sourceOf(rel) {
  return ts.createSourceFile(rel, fs.readFileSync(join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function findVar(sf, name, pred = () => true) {
  let hit;
  const walk = (n) => {
    if (hit) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && pred(n)) { hit = n; return; }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  if (!hit) throw new Error(`${sf.fileName}: 변수 ${name} 없음`);
  return hit;
}
function fnText(sf, name) {
  const n = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!n) throw new Error(`${sf.fileName}: 함수 ${name} 없음`);
  return n.getText(sf).replace(/^export\s+/, '');
}
/** useMemo(fn, deps) / useStore(fn) 첫 인자 원문. */
function hookArg(sf, name, callee) {
  const init = findVar(sf, name).initializer;
  if (!init || !ts.isCallExpression(init) || init.expression.getText(sf) !== callee) throw new Error(`${name} 이 ${callee}(...) 가 아니다`);
  return init.arguments[0].getText(sf);
}
function runTs(code, ctx) {
  const js = ts.transpileModule(`var __out;
${code}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const c = vm.createContext({ ...ctx });
  vm.runInContext(js, c);
  return c.__out;
}

// ── 로드 ──────────────────────────────────────────────────────────────────
const N = await imp('src/lib/utils/notifications.ts');
const S = await imp('src/lib/utils/schedule.ts');
const P = await imp('src/lib/quiz/progress.ts');
const M = await imp('src/lib/quiz/metrics.ts');
const R = await imp('src/lib/utils/room.ts');
const QS = await imp('src/lib/quiz/schedule.ts');
const SUB = await imp('src/lib/utils/subscription.ts');

// useScheduleStore.ts: swapTargets · canAcceptSwap (스토어 파일이라 선언만 자른다)
const schedSf = sourceOf('src/lib/store/useScheduleStore.ts');
const { canAcceptSwap } = runTs(`${fnText(schedSf, 'swapTargets')}\n${fnText(schedSf, 'canAcceptSwap')}\n__out = { swapTargets, canAcceptSwap };`, {});

// courseStats.ts: latestQuizAssignments (react·db import 때문에 선언만)
const csSf = sourceOf('src/lib/quiz/courseStats.ts');
const { latestQuizAssignments, latestCourseAnswers } = runTs(`${fnText(csSf, 'latestQuizAssignments')}\n${fnText(csSf, 'latestCourseAnswers')}\n__out = { latestQuizAssignments, latestCourseAnswers };`, { currentSend: P.currentSend });

// [id].tsx: latestSend(useMemo) · fixedDue · currentDue · factsOf
const idSf = sourceOf('src/app/owner/quiz/[id].tsx');
const detailOf = runTs(`${fnText(idSf, 'factsOf')}
__out = function (sends: any[], c: any) {
  const latestSend = (${hookArg(idSf, 'latestSend', 'useMemo')})();
  const fixedDue = ${findVar(idSf, 'fixedDue').initializer.getText(idSf)};
  const currentDue = ${findVar(idSf, 'currentDue').initializer.getText(idSf)};
  return { rowId: latestSend?.id ?? null, fixedDue, currentDue, deadline: factsOf(0, c.answer_days, c.due_days, fixedDue)[1][1] };
};`, { cycleLabel: QS.cycleLabel, currentSend: P.currentSend });

// useQuizBoard.ts: buildQuizzes 안 sent · cycle · 'sending' 분기 블록(lastRow·fixed·caption)
const qbSf = sourceOf('src/lib/quiz/useQuizBoard.ts');
const lastRowStmt = findVar(qbSf, 'lastRow').parent.parent;
const lastRowBlock = lastRowStmt.parent;
if (!ts.isBlock(lastRowBlock)) throw new Error('lastRow 가 블록 안에 있지 않다');
const listOf = runTs(`__out = function (sends: any[], c: any) {
  const sent = ${findVar(qbSf, 'sent', (n) => /sends\.filter/.test(n.initializer?.getText(qbSf) ?? '')).initializer.getText(qbSf)};
  const cycle = ${findVar(qbSf, 'cycle', (n) => /cycleLabel/.test(n.initializer?.getText(qbSf) ?? '')).initializer.getText(qbSf)};
  let caption: string;
  ${lastRowBlock.statements.map((s) => s.getText(qbSf)).join('\n')}
  return { rowId: lastRow.id, dueDate: lastRow.dueDate ?? null, caption };
};`, { cycleLabel: QS.cycleLabel });

// useJuniorHomeData.ts: openQuizCount(useMemo)
const homeSf = sourceOf('src/lib/hooks/useJuniorHomeData.ts');
const homeCount = runTs(`__out = function (assignments: any, quizProgress: any, quizProgressError: any, courses: any, userId: any, legacy: any) {
  return (${hookArg(homeSf, 'openQuizCount', 'useMemo')})();
};`, { openQuizzes: P.openQuizzes });

// useOwnerDashboardData.ts: pendingSuggestions(useSuggestionStore 셀렉터)
const dashSf = sourceOf('src/lib/hooks/useOwnerDashboardData.ts');
const dashPending = runTs(`__out = ${hookArg(dashSf, 'pendingSuggestions', 'useSuggestionStore')};`, {});

const TODAY = '2026-11-03';
const D = (n) => S.addDays(TODAY, n);
const nameOf = () => '이름';

// ══ S1 받은 교대 요청: isIncomingSwap(벨) vs canAcceptSwap(근무표·서버 accept_swap 과 같은 규칙) ══
const swap = (over) => ({ id: 'sw1', unit_id: 'u', template_id: 't1', requester_id: 'R', kind: 'cover', status: 'open', date: TODAY, target_staff_id: null, target_staff_ids: null, created_at: `${TODAY}T00:00:00+00:00`, ...over });
const s1 = (name, r, me) => compare('S1-수신자', name, () => ({ a: N.isIncomingSwap(r, me, TODAY), b: canAcceptSwap(r, me, TODAY) }));
s1('S1-1 지정대타·비지정자D', swap({ target_staff_ids: ['B'] }), 'D');
s1('S1-2 지정대타·지정자B', swap({ target_staff_ids: ['B'] }), 'B');
s1('S1-3 ids만 맞교환[B,C]·B', swap({ kind: 'swap', target_staff_ids: ['B', 'C'] }), 'B');
s1('S1-4 단수B·ids[C]·B', swap({ kind: 'swap', target_staff_id: 'B', target_staff_ids: ['C'] }), 'B');
s1('S1-5 cover·ids[]', swap({ target_staff_ids: [] }), 'D');
s1('S1-6 지난날짜', swap({ date: D(-1) }), 'D');
s1('S1-7 본인요청', swap(), 'R');
// 경계 격자: kind × 단수 × 목록, 보는 사람 = ME
const LISTS = { null: null, '[]': [], '[me]': ['ME'], '[other]': ['O'], '[me,other]': ['ME', 'O'] };
for (const kind of ['cover', 'swap']) for (const single of [null, 'ME', 'O']) for (const [lk, lv] of Object.entries(LISTS)) {
  s1(`격자 ${kind}·단수=${single ?? 'null'}·ids=${lk}`, swap({ kind, target_staff_id: single, target_staff_ids: lv }), 'ME');
}
note('S1-수신자', 'S1-5 서버', 'accept_swap(0179) 는 coalesce(ids,…)=\'{}\' → any(\'{}\') 거짓으로 거부한다고 A1 은 읽었다. 클라 둘은 빈 배열을 null(누구나)로 본다. ids=[] 가 실제 저장되는지가 전제(SQL 이라 여기선 못 잰다).');
// 매니저 벨(managerPersonalRows targetedToMe) vs canAcceptSwap
const managerSwapRows = (r, me) => N.buildManagerNotifications(
  { queue: [], suggestions: [], swaps: [r], pending: [], nameOf, feed: [], userId: me, ackAt: null, claims: [], alerts: [], assignments: [], timeRequests: [] },
  { feed: [], taskTemplates: [], done: {}, today: TODAY, suggestions: [], userId: me, nameOf, ackAt: null, scheduleNotices: [] },
).filter((x) => x.kind === 'swap').length > 0;
const s1m = (name, r, me) => compare('S1-매니저벨', name, () => ({ a: managerSwapRows(r, me), b: canAcceptSwap(r, me, TODAY) }));
s1m('S1-8 ids만 맞교환[MGR]', swap({ kind: 'swap', target_staff_ids: ['MGR'] }), 'MGR');
s1m('ids만 대타[MGR]', swap({ target_staff_ids: ['MGR'] }), 'MGR');
s1m('단수 맞교환 MGR', swap({ kind: 'swap', target_staff_id: 'MGR' }), 'MGR');
s1m('공개 대타(대상 없음)', swap(), 'MGR');

// ══ S2 퀴즈 현재 발송·마감일: 상세 latestSend/fixedDue vs 목록 lastRow/dueDate ══
const qa = (over) => ({ id: 'x1', courseId: 'C', userId: 'X', scheduledOn: '2026-11-03', sentAt: '2026-11-03T00:00:00+00:00', completedAt: null, dueOn: '2026-11-05', dueDate: '2026-11-05', ...over });
const course = { id: 'C', answer_days: 2, due_days: null, active: true };
const s2 = (name, sends, rowCheck = false) => {
  const sentAny = sends.some((a) => !!a.sentAt);
  if (!sentAny) { skipCase('S2-마감', name, '나간 행 0 → 목록은 sending 분기를 안 탄다(quizState) · 비교할 목록 마감이 없다'); return; }
  compare('S2-마감', name, () => {
    const d = detailOf(sends, course), l = listOf(sends, course);
    return { a: d.fixedDue, b: l.dueDate };
  });
  if (rowCheck) {
    compare('S2-행선택', name, () => {
      // 한 사람 케이스만. A = 상세 latestSend · B = progress.currentSend(직원 화면·latestQuizAssignments 와 같은 판정).
      const d = detailOf(sends, course), l = listOf(sends, course);
      const lqa = latestQuizAssignments(sends).map((r) => r.id).join(',');
      const cur = P.currentSend(sends)?.id ?? null;
      if (l.rowId !== cur || lqa !== cur) note('S2-행선택', name, `목록 lastRow=${l.rowId} · latestQuizAssignments=${lqa}`);
      return { a: d.rowId, b: cur };
    });
  }
  const d = detailOf(sends, course), l = listOf(sends, course);
  note('S2-마감', name, `화면: 상세 '응시 기한'='${d.deadline}' · 설정 달력 처음값=${d.currentDue} · 목록 부제='${l.caption}'`);
};
const X1 = qa({});
s2('S2-1 기본', [X1], true);
s2('S2-2 마감당일 다시알리기(안나감·due null)', [X1, qa({ id: 'x2', scheduledOn: '2026-11-06', sentAt: null, dueOn: null, dueDate: null })], true);
s2('S2-3 다른사람 미래예약', [X1, qa({ id: 'y1', userId: 'Y', scheduledOn: '2026-11-10', sentAt: null, dueOn: null, dueDate: '2026-11-12' })]);
s2('S2-4 예약만', [qa({ sentAt: null })]);
s2('S2-5 scheduledOn 동률·sentAt 다름', [qa({ id: 'x', sentAt: '2026-11-03T01:00:00+00:00', dueDate: '2026-11-05' }), qa({ id: 'y', userId: 'Y', sentAt: '2026-11-03T00:00:00+00:00', dueDate: '2026-11-07' })]);
s2('S2-5b 동률 입력순서 반대', [qa({ id: 'y', userId: 'Y', sentAt: '2026-11-03T00:00:00+00:00', dueDate: '2026-11-07' }), qa({ id: 'x', sentAt: '2026-11-03T01:00:00+00:00', dueDate: '2026-11-05' })]);
s2('S2-7 sentAt 형식 섞임(Z vs .5+00:00)', [qa({ id: 'z', sentAt: '2026-11-03T01:00:00Z', dueDate: '2026-11-05' }), qa({ id: 'p', sentAt: '2026-11-03T01:00:00.5+00:00', dueDate: '2026-11-07' })], true);
s2('S2-8 완료 뒤 새 발송(due null)', [qa({ id: 'old', scheduledOn: '2026-11-01', sentAt: '2026-11-01T00:00:00+00:00', completedAt: '2026-11-01T02:00:00+00:00', dueDate: '2026-11-03' }), qa({ id: 'new', scheduledOn: '2026-11-04', sentAt: '2026-11-04T00:00:00+00:00', dueDate: null, dueOn: '2026-11-06' })], true);
s2('S2-9 나간 다시알리기 due null', [X1, qa({ id: 'x2', scheduledOn: '2026-11-06', sentAt: '2026-11-06T00:00:00+00:00', dueDate: null, dueOn: '2026-11-08' })], true);
s2('S2-10 재확인 예약(안나감·due 있음)', [X1, qa({ id: 'rc', scheduledOn: '2026-12-03', sentAt: null, dueOn: null, dueDate: '2026-12-05' })], true);
s2('S2-11 sentAt null 이 맨 뒤 scheduledOn·due 동일', [X1, qa({ id: 'x2', scheduledOn: '2026-11-04', sentAt: null, dueOn: null, dueDate: '2026-11-05' })], true);

// ══ S3 매니저 본인 퀴즈: 매니저 알림 목록 · 매니저 벨 배지 · 매니저 홈(/junior/home = useJuniorHomeData) ══
// 인자는 각 호출부가 넘기는 키 그대로 옮긴다(판정은 src 함수가 한다):
//   목록·벨·앱 배지 = 셋 다 hooks/useManageNotifArgs 하나(courses · received.quizProgress · received.legacyQuizIds 포함 · B 묶음 11-05)
const MGR = 'MGR';
const ownerArgsM = (assignments, cs) => ({ queue: [], suggestions: [], swaps: [], pending: [], nameOf, feed: [], userId: MGR, ackAt: null, claims: [], alerts: [], assignments, ...(cs ? { courses: cs } : {}), timeRequests: [] });
const receivedM = (progress, err, legacy) => ({ feed: [], taskTemplates: [], done: {}, today: TODAY, suggestions: [], userId: MGR, nameOf, ackAt: null, scheduleNotices: [], quizProgress: err ? undefined : progress, legacyQuizIds: legacy });
const listQuiz = (assignments, cs, progress, err, legacy) => N.buildManagerNotifications(ownerArgsM(assignments, cs), receivedM(progress, err, legacy)).filter((r) => r.kind === 'training' && r.unread).length;
const badgeCount = (assignments, cs, progress, err, legacy) => N.manageUnreadCount('manager', ownerArgsM(assignments, cs), receivedM(progress, err, legacy));
const ma = (over) => ({ id: 'm1', courseId: 'C', userId: MGR, scheduledOn: TODAY, sentAt: `${TODAY}T00:00:00+00:00`, completedAt: null, dueOn: null, dueDate: null, ...over });
const prow = (assignmentId, state, total = 2, answered = 0) => ({ assignmentId, pendingEntryIds: ['e'], totalItems: total, answeredItems: answered, state });
const courses = [{ id: 'C', name: '퀴즈', due_days: null, audience: 'staff', created_at: '2026-10-01T00:00:00+00:00' }];
const S3 = [
  ['S3-1 멈춘 퀴즈(void)', { assignments: [ma({})], progress: [prow('m1', 'void', 0)] }],
  ['S3-2 진행 행 없음', { assignments: [ma({})], progress: [] }],
  ['S3-3 다 풀었음(answered)', { assignments: [ma({})], progress: [prow('m1', 'answered', 2, 2)] }],
  ['S3-4 옛 퀴즈 열림', { assignments: [], progress: [], legacy: ['L'] }],
  ['S3-5 외부용(guest) 퀴즈', { assignments: [ma({ courseId: 'G' })], progress: [prow('m1', 'todo')], cs: [...courses, { id: 'G', name: '손님', audience: 'guest', due_days: null }] }],
  ['S3-6 같은 퀴즈 재발송 2건', { assignments: [ma({}), ma({ id: 'm2', sentAt: `${TODAY}T01:00:00+00:00` })], progress: [prow('m1', 'todo'), prow('m2', 'todo')] }],
  ['S3-7 진행 조회 실패', { assignments: [ma({})], progress: [], err: true }],
  ['S3-8 todo 기본', { assignments: [ma({})], progress: [prow('m1', 'todo')] }],
  ['S3-9 완료함', { assignments: [ma({ completedAt: `${TODAY}T02:00:00+00:00` })], progress: [prow('m1', 'done', 2, 2)] }],
];
for (const [name, { assignments, progress, err = false, cs = courses, legacy = [] }] of S3) {
  compare('S3-목록vs홈', name, () => ({ a: listQuiz(assignments, cs, progress, err, legacy), b: homeCount(assignments, progress, err, cs, MGR, { ids: legacy }) }));
  compare('S3-배지vs목록', name, () => ({ a: badgeCount(assignments, cs, progress, err, legacy), b: N.buildManagerNotifications(ownerArgsM(assignments, cs), receivedM(progress, err, legacy)).filter((r) => r.unread).length }));
}

// ══ S4 승인 대기 교대: isSwapAwaitingApproval(벨) vs swapApprovable(홈·근무표·서버 approve_swap 35일) ══
const acc = (over) => swap({ status: 'accepted', accepted_by: 'B', ...over });
const s4 = (name, r) => compare('S4-승인대기', name, () => ({ a: N.isSwapAwaitingApproval(r), b: S.swapApprovable(r, TODAY) }));
s4('S4-1 근무일 오늘-36', acc({ date: D(-36) }));
s4('S4-2 근무일 오늘-10', acc({ date: D(-10) }));
s4('S4-3 맞교환 target_date 오늘-36', acc({ kind: 'swap', date: D(1), target_date: D(-36) }));
s4('S4-4 경계 오늘-35', acc({ date: D(-35) }));
s4('S4-5 open', swap({ status: 'open' }));
s4('경계 오늘+0', acc({}));
note('S4-승인대기', '허브', 'my_units_notif_data 0346:413 은 created_at 30일 창이다(SQL · 여기선 못 잰다). S4-2(생성 31일 전)는 허브 0·벨 1·홈 1 이 A1 의 읽은 기대다.');

// ══ S8 시각 문자열 비교: isAfterAck(문자열) vs room.unreadCount(tsMs 밀리초) ══
const roomUnread = (at, ack) => R.unreadCount([{ kind: 'message', authorId: 'other', createdAt: at }], { id: 'r', isDefault: true }, 'me', { lastReadAt: ack }) > 0;
const s8 = (name, at, ack) => compare('S8-읽음', name, () => ({ a: N.isAfterAck(at, ack), b: roomUnread(at, ack) }));
s8('S8-1 같은 밀리초(항목 마이크로초)', '2026-11-03T05:00:00.123456+00:00', '2026-11-03T05:00:00.123Z');
s8('S8-1b 같은 밀리초(ack 마이크로초)', '2026-11-03T05:00:00.123Z', '2026-11-03T05:00:00.123456+00:00');
s8('ack 초단위Z · 항목 0.5초 뒤 +00:00', '2026-11-03T05:00:00.5+00:00', '2026-11-03T05:00:00Z');
s8('ack .999Z · 항목 1초 뒤 +00:00', '2026-11-03T05:00:01+00:00', '2026-11-03T05:00:00.999Z');
s8('같은 형식 1초 뒤', '2026-11-03T05:00:01.000Z', '2026-11-03T05:00:00.000Z');
// S8-2 assignedAtOf 폴백(시간대 없음) — 앞쪽 값은 src assignedAtOf 가 만든다.
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
compare('S8-읽음', `S8-2 assignedAtOf 폴백(호스트 TZ=${tz})`, () => {
  const at = N.assignedAtOf({ id: 't', assignedMeta: undefined, createdAt: undefined }, 'me', TODAY);
  return { a: { at, unread: N.isAfterAck(at, '2026-11-03T00:30:00.000Z') }, b: { at, unread: roomUnread(at, '2026-11-03T00:30:00.000Z') } };
});
// S8-3 현재 발송 고르기: progress.currentSend(>) vs useQuizBoard lastRow(localeCompare)
compare('S8-발송순서', 'S8-3 Z vs .5+00:00', () => {
  const rows = [qa({ id: 'z', sentAt: '2026-11-03T01:00:00Z' }), qa({ id: 'p', sentAt: '2026-11-03T01:00:00.5+00:00' })];
  return { a: P.currentSend(rows)?.id, b: listOf(rows, course).rowId };
});
compare('S8-발송순서', 'S8-3b 입력 순서 반대', () => {
  const rows = [qa({ id: 'p', sentAt: '2026-11-03T01:00:00.5+00:00' }), qa({ id: 'z', sentAt: '2026-11-03T01:00:00Z' })];
  return { a: P.currentSend(rows)?.id, b: listOf(rows, course).rowId };
});
note('S8-발송순서', 'S8-3 참고', `실제 늦은 행 = p (tsMs z=${new Date('2026-11-03T01:00:00Z').getTime()} p=${new Date('2026-11-03T01:00:00.5+00:00').getTime()})`);
// S8-4 사람 상태: metrics.personState(>=) vs courseStats.latestCourseAnswers(<) — 같은 발송·같은 답
const s84 = (name, sentAt, takenAt) => compare('S8-진행', name, () => {
  const a = { id: 'a', courseId: 'C', userId: 'X', sentAt, completedAt: null };
  const answers = [{ staffId: 'X', itemId: 'i1', takenAt, correct: true, source: 'quiz' }];
  return { a: M.personState(a, answers) === 'in_progress', b: latestCourseAnswers(answers, sentAt).length > 0 };
});
s84('S8-4 발송 .123Z · 답 .123400+00:00', '2026-11-03T05:00:00.123Z', '2026-11-03T05:00:00.123400+00:00');
s84('발송 Z(초) · 답 .5+00:00', '2026-11-03T05:00:00Z', '2026-11-03T05:00:00.5+00:00');
note('S8-진행', 'S8-4 참고', '둘 다 문자열 비교라 서로는 같다. 밀리초로 보면 답이 발송 뒤다(in_progress 가 맞다). 위 B 는 시각 규칙의 두 번째 사본이지 정답이 아니다.');

// ══ S6(A1 1-7) 야간 근무 꼬리: overlapsStaffShift — 서버 workers_at 0270 은 SQL 이라 비교 불가 ══
{
  const tpl = (over) => ({ id: 'n1', unit_id: 'u', staff_id: 'S', weekday: null, date: D(-1), start: '22:00', end: '02:00', valid_from: null, valid_to: null, ...over });
  try {
    const tail = S.overlapsStaffShift([tpl({})], [], [], 'S', TODAY, '01:00', '05:00');
    const sameDay = S.overlapsStaffShift([tpl({ date: TODAY })], [], [], 'S', TODAY, '23:00', '23:30');
    note('S6-야간', '어제 22:00~02:00 + 오늘 01:00~05:00', `클라 overlapsStaffShift=${tail} · 서버 workers_at 0270 문서상 기대(어제 시작 심야 꼬리도 오늘 근무자)=true → 클라가 경고를 못 낸다(의심 근거 · 세지 않음)`);
    note('S6-야간', '대조: 같은 날 22:00~02:00 + 23:00~23:30', `클라=${sameDay}(기대 true)`);
  } catch (e) { notRun++; console.log(`ERROR S6-야간 ${e?.message ?? e}`); }
}

// ══ 그 밖(A1 1-3·1-9) ══
// 제안 대기: 사장 홈(useOwnerDashboardData pendingSuggestions) vs 할 일 배지·벨(isPendingSuggestionToReview)
const sg = (over) => ({ id: 's', status: 'pending', proposer_id: 'J', ...over });
const sPair = (name, list, me) => compare('S9-제안대기', name, () => ({ a: dashPending({ suggestions: list }), b: list.filter((x) => N.isPendingSuggestionToReview(x, me)).length }));
sPair('사장이 올린 pending', [sg({ proposer_id: 'OWN' })], 'OWN');
sPair('직원이 올린 pending', [sg({})], 'OWN');
sPair('반영됨', [sg({ status: 'approved' })], 'OWN');
// 요금제: effectivePlanOf(쓸 수 있는 요금제) vs deriveSubscription(entitled) — 원시 plan 을 넘기는 경우
const NOW = Date.parse('2026-11-03T00:00:00Z');
// A = 세션 경로(effectivePlanOf 로 강등한 plan 을 deriveSubscription 에) · B = 원시 plan 을 그대로 deriveSubscription 에.
const subPair = (name, s) => compare('S10-요금제', name, () => {
  const plan = SUB.effectivePlanOf(s, NOW);
  const viaSession = SUB.deriveSubscription({ ...s, plan }, NOW), raw = SUB.deriveSubscription(s, NOW);
  return { a: { plan, entitled: viaSession.entitled, state: viaSession.state }, b: { plan: s.plan, entitled: raw.entitled, state: raw.state } };
});
subPair('active·paidUntil 지남·원시 plan single', { plan: 'single', subStatus: 'active', paidUntil: '2026-11-01T00:00:00Z', trialEndsAt: '' });
subPair('trialing 지남·원시 plan single', { plan: 'single', subStatus: 'trialing', paidUntil: '', trialEndsAt: '2026-11-01T00:00:00Z' });
subPair('active·paidUntil 남음·single', { plan: 'single', subStatus: 'active', paidUntil: '2026-12-01T00:00:00Z', trialEndsAt: '' });
note('S10-요금제', '해석', '호출부(billing.tsx:114·233·332)가 세션 plan(이미 강등)을 넘기면 A 가 실제 경로다. 원시 plan 을 넘기는 호출부가 생기면 B 처럼 잠긴다(subscription.ts 주석 "전면 무료 모드 분기가 여기 없는 이유" · 2026-08-06 강등 결정).');

skipCase('S5-옛퀴즈', '전체', 'B 가 서버 quiz_legacy_open_courses(0338 SQL) · A 는 WorkBoard.tsx 컴포넌트 렌더 안 인라인(518-552)이라 순수 함수 쌍이 없다');
skipCase('S6-발송이유', '전체', '두 쪽 다 서버 SQL(quiz_send_status 0301 · due_quiz_sends 0332)');
skipCase('S7-허브50행', '전체', 'A 가 서버 my_units_notif_data(0346) 행 자르기 · SQL');
skipCase('1-4 isRequestDue', '기기 시간대', 'new Date().getDay() 기기 시간대 의존 · 한 프로세스에서 TZ 를 바꿔 비교할 수 없다(자식 프로세스 TZ 분리가 필요)');

console.log(`\nSAME ${same} · DIFF ${diff} · skip ${skip} · 실행 못 한 케이스 ${notRun} · AI 호출 0회`);
process.exit(diff > 0 || notRun > 0 ? 1 : 0);
