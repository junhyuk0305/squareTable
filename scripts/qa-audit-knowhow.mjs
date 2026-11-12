#!/usr/bin/env node
// qa-audit-knowhow.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 노하우·퀴즈·AI 묶음 재현 검사.
//   [E1] 초안·외부용 퀴즈는 직원 카드와 자동 배정(신입 첫 퀴즈·재확인)에 안 나온다.
//   [E11] 사장이 고른 퀴즈 마감 날짜를 모두에게 그대로 적용한다(2026-10-06 결정 · 서버 동작은 로컬 도커 트랜잭션).
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 순수 함수는 앱 코드를 그대로 import 해서 돌린다.
// 실행: node --no-warnings scripts/qa-audit-knowhow.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
// 주석을 뺀 코드(문자열 안의 // 는 드물어 무시한다).
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sqlStrip = (s) => s.replace(/--.*$/gm, '');
const migDir = new URL('../supabase/migrations/', import.meta.url);
const migFiles = () => readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
// 함수의 마지막 정의 본문. create [or replace] function public.<name>( … $$; 까지.
const lastDef = (name) => {
  let body = '', file = '';
  for (const f of migFiles()) {
    const s = readFileSync(new URL(f, migDir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body: sqlStrip(body), file };
};
// 로컬 도커 DB(트랜잭션 · 되돌림 · 고정 계정 store_001). 도커가 없으면 서버 동작은 SKIP.
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300); }
};
const tail = (o) => o.split('\n').filter((l) => /^R=|ERR=/.test(l)).join(' ').slice(0, 240);
let dbUp = true;
try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { dbUp = false; }
const tryImport = async (p) => { try { return await import(p); } catch (e) { return { __err: String(e?.message ?? e) }; } };

console.log('[E1] 초안·외부용 퀴즈는 직원 카드와 자동 배정에 안 나온다 (0139 이전 코스는 예전대로)');
{
  const sched = await tryImport('../src/lib/quiz/schedule.ts');
  const f = sched.staffCanSeeCourse;
  check('★staffCanSeeCourse 판정 함수가 있다', typeof f === 'function', sched.__err ?? '');
  if (typeof f === 'function') {
    const recent = '2026-10-01T03:00:00+00:00';
    check('★외부 사람용(guest)은 발송 원장과 무관하게 안 보인다',
      f({ audience: 'guest', startAt: '2026-10-01', createdAt: recent }, 0) === false
        && f({ audience: 'guest', startAt: '2026-10-01', createdAt: recent }, 3) === false);
    check('★만들던 퀴즈(일정 없음·원장 0건·0139 뒤에 만듦)는 안 보인다',
      f({ audience: null, startAt: null, createdAt: recent }, 0) === false);
    check('본사 사본(아직 안 보냄 · 원장 0건)도 안 보인다',
      f({ audience: 'staff', startAt: null, createdAt: recent }, 0) === false);
    check('원장 행이 있는 우리 직원 퀴즈는 보인다(누구에게 갔는지는 원장이 가른다)',
      f({ audience: 'staff', startAt: '2026-10-01', createdAt: recent }, 2) === true
        && f({ audience: null, startAt: null, createdAt: recent }, 1) === true);
    check('0139 이전에 만든 원장 0건 코스는 예전대로 보인다(하위 호환)',
      f({ audience: null, startAt: null, createdAt: '2026-08-01T00:00:00+09:00' }, 0) === true);
  }
  const board = strip(read('src/components/WorkBoard.tsx'));
  // ★d59735f(10-23 · P3): 발송된 퀴즈 카드는 staffQuizTodo 한 입구(외부용 제외)로, 발송 0건 옛 퀴즈는 staffCanSeeCourse(c, 0) 로 거른다.
  //   예전 한 줄(staffCanSeeCourse(c, sends.length))이 두 갈래로 나뉘었다. 두 갈래 모두와 입구의 실제 거르기를 본다.
  const prog = await tryImport('../src/lib/quiz/progress.ts');
  const todoOf = (audience) => typeof prog.staffQuizTodo === 'function'
    ? prog.staffQuizTodo([{ id: 'a1', courseId: 'c1', userId: 'u1', sentAt: '2026-10-01T00:00:00Z', completedAt: null }],
      [{ assignmentId: 'a1', pendingEntryIds: ['e1'], totalItems: 1, answeredItems: 0, state: 'todo' }],
      [{ id: 'c1', due_days: null, audience }], { userId: 'u1', cardRule: true }).length
    : -1;
  check('★직원 카드가 staffCanSeeCourse 로 거른다',
    /for \(const todo of staffQuizTodo\(assignments, quizProgress, courses, \{ userId, preferredId: quizParam, cardRule: true \}\)\)/.test(board)
      && /if \(assignments\.some\(\(a\) => a\.courseId === c\.id\) \|\| !staffCanSeeCourse\(c, 0\)\) continue;/.test(board)
      && todoOf('guest') === 0 && todoOf('staff') === 1 && todoOf(null) === 1,
    `${prog.__err ?? ''} guest=${todoOf('guest')} staff=${todoOf('staff')}`);

  for (const fn of ['enqueue_knowhow_rechecks']) {
    const d = lastDef(fn);
    check(`★${fn} 이 외부용 코스를 고르지 않는다`, /coalesce\(c\.audience, 'staff'\) = 'staff'/.test(d.body), d.file);
    check(`★${fn} 이 만들던 퀴즈(일정·사장 발송 없음)를 고르지 않는다(0139 이전 코스는 예외)`,
      /c\.start_at is not null/.test(d.body) && /x\.origin = 'manual'/.test(d.body) && /c\.created_at < timestamptz '2026-08-11 00:00:00\+09'/.test(d.body), d.file);
  }
  // ★0348(2026-11-04 사용자 결정): 신입 첫 퀴즈 자동 예약을 없앴다. 합류 본문(_admit_member 최고 정의)이 발송 행을 넣지 않는다.
  {
    const d = lastDef('_admit_member');
    check('★합류(_admit_member)는 퀴즈 발송 행을 만들지 않는다', !!d.body && !/insert into public\.quiz_assignments/.test(d.body), d.file);
  }
}

console.log('\n[E2] 노하우가 바뀌어 재확인이 나가면 직원 카드에 그 노하우가 "다시 확인"으로 뜬다');
{
  const sched = await tryImport('../src/lib/quiz/schedule.ts');
  const f = sched.recheckEntryDue;
  check('★recheckEntryDue 판정 함수가 있다', typeof f === 'function', sched.__err ?? '');
  if (typeof f === 'function') {
    const passed = '2026-10-01T01:00:00.000Z', edited = '2026-10-03T01:00:00+00:00';
    check('★재확인 발송이 와 있고, 통과 뒤 노하우가 바뀌었으면 다시 확인할 것', f(passed, edited, true) === true);
    check('재확인 발송이 없으면 노하우가 바뀌어도 카드를 새로 띄우지 않는다(서버 빈도 상한을 따른다)', f(passed, edited, false) === false);
    check('통과 뒤 안 바뀐 노하우는 다시 묻지 않는다', f(edited, passed, true) === false);
    check('통과 기록이 없으면 재확인이 아니다', f(undefined, edited, true) === false);
  }
  const db = strip(read('src/lib/db.ts'));
  check('★발송 원장을 읽을 때 origin 도 읽는다', /const QUIZ_ASSIGNMENT_COLS = '[^']*\borigin\b[^']*'/.test(db) && /origin: r\.origin \?\? 'manual'/.test(db));
  check('QuizAssignment 에 origin 이 있다', /origin\?: string;/.test(read('src/lib/quiz/types.ts')));
  const board = strip(read('src/components/WorkBoard.tsx'));
  // ★d59735f(10-23 · P3) + 0332·0348: 발송된 퀴즈(재확인 포함)의 남은 항목은 서버 진행(quiz_assignment_progress)이 정한다.
  //   카드는 pending.pendingEntryIds 를 그대로 띄운다. 재확인 발송은 앞 회차를 이어받지 않아(count_from 없음) 발송 시각부터 다시 센다.
  //   그래서 "바뀐 노하우를 다시 확인"은 재확인 발송 카드가 그 노하우를 남은 항목으로 띄우는 것으로 본다.
  const progE2 = await tryImport('../src/lib/quiz/progress.ts');
  const recheckCard = typeof progE2.staffQuizTodo === 'function'
    ? progE2.staffQuizTodo([
      { id: 'old', courseId: 'c1', userId: 'u1', sentAt: '2026-09-01T00:00:00Z', completedAt: '2026-09-02T00:00:00Z', origin: 'manual' },
      { id: 'rc', courseId: 'c1', userId: 'u1', sentAt: '2026-10-03T02:00:00Z', completedAt: null, origin: 'recheck' },
    ], [{ assignmentId: 'rc', pendingEntryIds: ['e1'], totalItems: 1, answeredItems: 0, state: 'todo' }],
    [{ id: 'c1', due_days: null, audience: 'staff' }], { userId: 'u1', cardRule: true })
    : [];
  const carry = migFiles().map((f) => [f, read(`supabase/migrations/${f}`)])
    .filter(([, s]) => /create or replace function public\.quiz_assignment_carry_count_from\(/.test(s)).at(-1);
  check('★카드 판정이 내 미완료 재확인 발송을 보고 바뀐 노하우를 due 로 띄운다',
    /const ids = new Set\(pending\.pendingEntryIds\);/.test(board) && /\.filter\(\(e\) => ids\.has\(e\.entryId\) && !!titleOf\(e\.entryId\)\)/.test(board)
      && recheckCard.length === 1 && recheckCard[0].assignment.id === 'rc' && recheckCard[0].state === 'todo'
      && !!carry && /if new\.origin is distinct from 'manual' then return new; end if;/.test(sqlStrip(carry[1])),
    `${progE2.__err ?? ''} cards=${JSON.stringify(recheckCard.map((t) => t.assignment.id))} carry=${carry?.[0] ?? '없음'}`);
  check('★1회성 재확인 카드는 앞선 1회성 카드에 가려지지 않는다',
    /c === firstOnce \|\| c\.items\.some\(\(it\) => it\.state === 'due'\)/.test(board));
}

console.log('\n[E3] 퀴즈가 안 나가는 이유(근무표에 없음·자동 정지)를 사장 퀴즈 상세에 보인다');
{
  const d = lastDef('quiz_send_status');
  const b = d.body;
  check('★서버 판정 함수 quiz_send_status 가 있다', !!d.file, '없음');
  check('관리 권한·활성 매장의 퀴즈만 본다', /public\.auth_can_manage\(\)/.test(b) && /c\.unit_id = public\.auth_unit_id\(\)/.test(b), d.file);
  check('★근무표를 쓰는 매장에서 앞으로 근무가 하나도 없으면 not_scheduled',
    /'not_scheduled'/.test(b) && /st\.staff_id = a\.user_id::text/.test(b) && /st\.archived_tenure_id is null/.test(b)
      && /st\.shift_date >= v_date/.test(b) && /st\.valid_to is null or st\.valid_to >= v_date/.test(b), d.file);
  check('★연속 2회 안 연 사람은 auto_stopped (due_quiz_sends 와 같은 셈)',
    /'auto_stopped'/.test(b) && /if h\.opened_at is not null then exit; end if;/.test(b) && /if h\.sent_at > now\(\) - interval '24 hours' then continue; end if;/.test(b), d.file);
  const f = d.file ? read(`supabase/migrations/${d.file}`) : '';
  check('권한: authenticated 만 실행', /revoke all on function public\.quiz_send_status\(text\) from public, anon, authenticated;/.test(f)
    && /grant\s+execute on function public\.quiz_send_status\(text\) to authenticated;/.test(f));
  const db = strip(read('src/lib/db.ts'));
  check('★fetchQuizSendStatus 가 rpc 를 부른다', /export async function fetchQuizSendStatus\(courseId: string(, strict = false)?\)/.test(db) && /rpc\('quiz_send_status', \{ p_course_id: courseId \}\)/.test(db));
  const scr = strip(read('src/app/owner/quiz/[id].tsx'));
  // 문구는 recipientReadiness.ts 표 한 곳(P5 · 2026-10-16) — 화면은 readinessText 로 읽는다.
  const rr = strip(read('src/lib/recipientReadiness.ts'));
  check('★사람 줄이 이유를 말한다(근무표에 없어 대기 중 · 두 번 안 열어 멈춤)',
    /fetchQuizSendStatus\(/.test(scr) && /readinessText\(/.test(scr) && rr.includes('근무표에 없어 대기 중') && rr.includes('두 번 안 열어 멈춤'));
}

console.log('\n[E4] "푼 사람"은 담긴 노하우를 다 풀었을 때(맞힘과 무관) · 개인 결과는 그 사람의 실제 응시로');
{
  // ★0326→0332→0348: 완료 판정은 함수 하나로 모였다(0332 "질문 하나에 함수 하나").
  //   mark_quiz_completed → quiz_assignment_state('answered' 일 때만) → quiz_assignment_pending(문항 단위 · 발송 퀴즈의 servable 문항)
  //   → quiz_course_servable(보관·모르는 형식 제외). 노하우 단위 셈은 10-22 사용자 결정으로 문항 단위가 됐다.
  const d = lastDef('mark_quiz_completed');
  const b = d.body;
  const st = lastDef('quiz_assignment_state'), pd = lastDef('quiz_assignment_pending');
  const cf = lastDef('quiz_assignment_count_from'), sv = lastDef('quiz_course_servable'), lv = lastDef('quiz_course_live');
  check('★완료는 이 발송 뒤에 담긴 노하우를 전부 풀었을 때만(맞혔는지는 안 본다)',
    /select s\.state into v_state from public\.quiz_assignment_state\(a\.id\) s;/.test(b)
      && /if v_state is distinct from 'answered' then return false; end if;/.test(b)
      && /when v_answered >= v_total then 'answered'/.test(st.body) && /from public\.quiz_assignment_pending\(a\.id\) p/.test(st.body)
      && /cross join lateral public\.quiz_course_servable\(a\.unit_id,\s*a\.course_id\) q/.test(pd.body)
      && /ai\.created_at\s*>=\s*public\.quiz_assignment_count_from\(a\)/.test(pd.body) && /ai\.course_id\s*=\s*a\.course_id/.test(pd.body)
      && !/correct/.test(pd.body)
      && /coalesce\(a\.count_from, a\.sent_at\)/.test(cf.body),
    `${d.file} · state ${st.file} · pending ${pd.file} · count_from ${cf.file}`);
  // 옛 규칙("이미 아는 노하우는 다시 안 풀어도 된다 · knowhow_understanding 면제")은 0326 에서 의도적으로 뺐다:
  //   "본인이 발송 후 낸 답만 센다. 전체 이해 기록이나 다른 코스의 답으로 대체하지 않는다"(0326·0330·0348 pending 머리말).
  //   재확인 발송은 앞 회차를 이어받지 않는다(E2 carry_count_from). 같은 성질을 지금 규칙으로 본다.
  check('이미 알아 카드에 안 뜨는 노하우는 다시 풀지 않아도 된다(재확인 발송은 바뀐 뒤 통과만 인정)',
    !!pd.body && !/knowhow_understanding/.test(pd.body) && !/knowhow_understanding/.test(st.body) && !/knowhow_understanding/.test(b)
      && /not ai\.self_check/.test(pd.body),
    `pending ${pd.file} — 0326 결정: 이해 기록으로 대체하지 않는다 · 자청 답 제외`);
  check('낼 문항이 없는 노하우·보관한 노하우는 셈에서 뺀다',
    /pe\.archived_at is null/.test(sv.body) && /q\.format = any\(public\.quiz_known_formats\(\)\)/.test(sv.body)
      && /public\.quiz_course_live\(p_unit, p_course\)/.test(sv.body) && /pe\.archived_at is null/.test(lv.body)
      && /when v_total = 0 then 'void'/.test(st.body),
    `servable ${sv.file} · live ${lv.file}`);
  check('본인·이미 나간 발송만',
    /x\.user_id\s*=\s*(\(select )?auth\.uid\(\)\)?/.test(b) && /x\.sent_at is not null/.test(b) && /x\.unit_id\s*=\s*public\.auth_unit_id\(\)/.test(b), d.file);
  const sheet = strip(read('src/components/work/UnderstandingCheckSheet.tsx'));
  // ★260c9c4(10-22 · 0326 계약): 저장이 .then 사슬에서 await 로 바뀌었다. 같은 성질 = 저장 성공(submissionId) 뒤,
  //   통과 분기(onPass) 밖에서 onFinished 를 부른다.
  const rec = sheet.indexOf('const submissionId = await recordStaffQuizAttempt(given.current');
  const okGate = sheet.indexOf('if (!submissionId) { setSaveFailed(true); return; }', rec);
  const passIf = sheet.indexOf('if (marks.length === items.length && marks.every(Boolean)) {', okGate);
  const passEnd = passIf < 0 ? -1 : sheet.indexOf('\n      }\n', passIf);
  const fin = sheet.indexOf('await onFinished?.(', okGate);
  check('★응시를 마치면(통과와 무관) 기록 저장 뒤 onFinished 를 부른다',
    rec >= 0 && okGate > rec && passIf > okGate && passEnd > passIf && fin > passEnd,
    JSON.stringify({ rec, okGate, passIf, passEnd, fin }));
  const store = strip(read('src/lib/store/useWorkStore.ts'));
  const mu = (store.match(/\n  markUnderstood: async[\s\S]*?\n  \},/) || [''])[0];
  // ★260c9c4·d59735f: 발송 id 를 받는 async 로 바뀌었다(이번 호출로 완료됐을 때만 사장 알림 · 실패면 던진다).
  const nf = (store.match(/\n  noteQuizFinished: async \([^)]*\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('★통과(markUnderstood)가 발송을 완료로 찍지 않는다', !!mu && !/markQuizCompleted/.test(mu), mu.slice(0, 80));
  check('★noteQuizFinished 가 완료 판정을 서버에 맡긴다',
    /const done = await markQuizCompleted\(id\);/.test(nf) && /if \(!done\) continue;/.test(nf), nf.slice(0, 120));
  const board = strip(read('src/components/WorkBoard.tsx'));
  check('WorkBoard 가 응시 끝을 넘긴다', /onFinished=\{\(entryIds\) => useWorkStore\.getState\(\)\.noteQuizFinished\(entryIds, selfCheck\.assignmentId\)\}/.test(board));

  // ★0330(퀴즈 문항 course_id 필수 · 축소) + 0332: 코스 없이 낸 옛 서명 제출도 저장할 때 문항의 퀴즈로 귀속한다.
  //   예전엔 읽기(quiz_course_person)가 course_id null 행을 노하우로 묶었다. 이제 쓰기(quiz_staff_record_internal)가 묶고,
  //   개인 결과 화면은 quiz_course_attempt_items(course_id = 이 퀴즈)를 읽는다.
  const rw = lastDef('quiz_staff_record_internal');
  const ai = lastDef('quiz_course_attempt_items');
  const notNull = read('supabase/migrations/0330_quiz_item_course_required.sql');
  check('★직원 응시(course_id 없음)도 담긴 노하우로 이 퀴즈에 묶는다',
    /v_course := coalesce\(p_course_id, q\.course_id\);/.test(rw.body)
      && /insert into public\.quiz_attempt_items\s*\([^)]*\bcourse_id\b[^)]*\)\s*values\([^;]*\bv_course\b/.test(rw.body)
      && /alter table public\.quiz_items alter column course_id set not null;/.test(notNull)
      && /where ai\.course_id=p_course_id/.test(ai.body),
    `record ${rw.file} · attempt_items ${ai.file}`);
  // ★22393cb(10-23 · P5 N05·N16): 개인 결과는 이 퀴즈 답 행 전부(페이지로 끝까지)를 읽어 그 사람 것만 거른다.
  //   문항별 정오 = 문항마다 마지막 답의 스냅샷(payload). 지금 문항 표(fetchStaffAttemptItems)를 다시 읽지 않는다.
  const person = strip(read('src/app/owner/quiz/person.tsx'));
  const dbE4 = strip(read('src/lib/db.ts'));
  const fca = (dbE4.match(/export async function fetchQuizCourseAttemptItems\([\s\S]*?\n\}/) || [''])[0];
  check('★개인 결과의 문항 목록은 그 사람의 최근 응시(submission) 스냅샷 전부다(매장 500줄 상한·지운 문항 무관)',
    /fetchQuizCourseAttemptItems\(cid\)/.test(person) && /\.filter\(\(r\) => r\.staffId === sid && r\.source !== 'self'\)/.test(person)
      && /latestCourseAnswers\(rows\)/.test(person) && !/fetchStaffAttemptItems/.test(person)
      && /for \(let offset = 0; ; offset \+= pageSize\)/.test(fca) && /\.range\(offset, offset \+ pageSize - 1\)/.test(fca)
      && /if \(\(data \?\? \[\]\)\.length < pageSize\) break;/.test(fca) && /payload: r\.payload/.test(fca));
}

console.log('\n[E5] 지운(보관한) 노하우는 할일·퀴즈 연결 판정에서 빠진다');
{
  const db = strip(read('src/lib/db.ts'));
  const fn = (name) => (db.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
  const wtk = fn('fetchTemplateKnowhow'), ce = fn('fetchCourseEntriesResult');
  check('★할일 첨부 노하우는 읽을 수 있는(보관 안 된) 노하우와 묶인 것만 읽는다',
    /select\('template_id, entry_id, playbook_entries!inner\(id\)'\)/.test(wtk), wtk.slice(0, 160));
  check('★퀴즈에 담긴 노하우도 읽을 수 있는 노하우와 묶인 것만 읽는다',
    /select\('course_id, entry_id, position, playbook_entries!inner\(id\)'\)/.test(ce), ce.slice(0, 160));
  const pol = read('supabase/migrations/0248_knowhow_archive.sql');
  check('전제: 노하우 읽기 정책이 보관한 노하우를 아무에게도 안 보인다(0248)',
    /create policy playbook_entries_read[\s\S]{0,600}and archived_at is null/.test(pol));
}

console.log('\n[E6] 카테고리 이름 바꾸기·"확인 완료"는 노하우 내용 변경(updated_at)으로 치지 않는다');
{
  const db = strip(read('src/lib/db.ts'));
  const fn = (name) => (db.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
  const ren = fn('renameEntrySection'), upd = fn('updateEntry');
  check('★카테고리 일괄 이동이 updated_at 을 안 쓴다', !!ren && !/updated_at/.test(ren), ren.slice(0, 200));
  check('★updateEntry 는 내용이 아닌 칸(section·needs_review·verification)만 바뀌면 updated_at 을 안 쓴다',
    /const NON_CONTENT_KEYS = new Set\(\['section', 'needs_review', 'verification'\]\)/.test(db)
      && /Object\.keys\(patch\)\.some\(\(k\) => !NON_CONTENT_KEYS\.has\(k\)\)/.test(upd), upd.slice(0, 300));
}

console.log('\n[E7] 앱을 다시 켠 뒤에도 이전 대화의 "사장님께 물어보기"가 실제로 질문을 보낸다');
{
  const store = strip(read('src/lib/store/useChatStore.ts'));
  const reg = (store.match(/\n  registerToOwner: async \(queryId\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('★등록 준비물이 메모리에 없으면 대화 기록(history)에서 다시 만든다',
    /const q = get\(\)\.history\.find\(\(h\) => h\.id === queryId\);/.test(reg)
      && /get\(\)\.pendingDeflects\[queryId\] \?\? \(q \? deflectFromHistory\(q\) : null\)/.test(reg), reg.slice(0, 300));
  check('★다시 만드는 질문은 원래 문장·물은 사람·후보 노하우를 그대로 쓴다',
    /function deflectFromHistory\(q: ChatQuery\): UnknownQuery/.test(store)
      && /q\.matched_entry_ids\[0\] \?\? q\.candidate_entry_ids\?\.\[0\] \?\? null/.test(store)
      && /buildDeflect\(q\.query_text, q\.junior_id, q\.junior_name, q\.asked_at,/.test(store));
  check('답할 때 미리 만드는 준비물도 같은 빌더를 쓴다', /pendingDeflects: \{ \.\.\.s\.pendingDeflects, \[cqId\]: buildDeflect\(text, session\.userId, session\.userName, now, meta\) \}/.test(store));
}

console.log('\n[E9] AI 사용량: 재시도는 한 번만 차감 · 직원이 차감 함수를 직접 못 부른다');
{
  const d = lastDef('consume_ai_quota_for');
  const b = d.body;
  check('★서버 전용 차감 함수 consume_ai_quota_for(매장 id 를 엣지가 넘긴다)가 있다',
    /consume_ai_quota_for\(p_unit text, p_units int default 1, p_request_key text default null\)/.test(b) && /v_unit\s+text := p_unit;/.test(b), d.file);
  // 0302(라이브 QA 결함 3): 같은 키는 두 번째(재시도)만 무료, 세 번째부터는 매번 센다.
  check('★같은 요청 키는 재시도 한 번만 무료(세 번째부터 차감)',
    /on conflict \(request_key\) do update set hits = r\.hits \+ 1\s+returning r\.hits into v_hits;/.test(b)
      && /if v_hits = 2 then/.test(b), d.file);
  // ★0369(11-10 · 상한 숫자 한 곳): 200/3,000 은 unit_ai_cap 으로 옮겼다. 차감 함수는 그것을 부르고 숫자를 따로 갖지 않는다.
  const cap = lastDef('unit_ai_cap');
  check('0193 본문(캡 200/3,000 · 80%·100% 사장 알림 · 단위 1~60)을 그대로 쓴다',
    /from public\.unit_ai_cap\(v_unit\)/.test(b) && !/then 3000/.test(b)
      && /when public\.effective_plan\(p_unit\) in \('single', 'multi'\) then 3000/.test(cap.body) && /else 200/.test(cap.body)
      && /'ai_cap', v_month, 80/.test(b) && /'ai_cap', v_month, 100/.test(b) && /least\(greatest\(coalesce\(p_units, 1\), 1\), 60\)/.test(b),
    `${d.file} · cap ${cap.file}`);
  const f = d.file ? read(`supabase/migrations/${d.file}`) : '';
  // 옛 ai 엣지 호환: 0276 은 열어 두고(확장), 새 엣지 배포 뒤 0297 이 닫는다(축소).
  const close = read('supabase/migrations/0297_ai_quota_close_client.sql');
  check('★consume_ai_quota 는 클라(authenticated)에서 닫는다(0297)',
    /revoke all on function public\.consume_ai_quota\(int\) from public, anon, authenticated;/.test(close));
  check('★0276 은 옛 엣지가 쓰는 consume_ai_quota 권한을 건드리지 않는다',
    !/revoke[^;]*public\.consume_ai_quota\(int\)/.test(f));
  check('consume_ai_quota_for 는 service_role 만', /revoke all on function public\.consume_ai_quota_for\(text, int, text\) from public, anon, authenticated;/.test(f)
    && /grant\s+execute on function public\.consume_ai_quota_for\(text, int, text\) to service_role;/.test(f));
  const edge = strip(read('supabase/functions/ai/index.ts'));
  check('★엣지가 서비스 키로 매장 id·요청 키를 넘겨 차감한다',
    /serviceClient\(\)\.rpc\('consume_ai_quota_for', \{ p_unit: user\.unitId, p_units: unitsAfter, p_request_key: requestKey \}\)/.test(edge)
      && !/userClient\(authz\)\.rpc\('consume_ai_quota'/.test(edge));
  check('요청 키는 사용자별로 묶는다(남의 키로 차감을 피하지 못하게)', /const requestKey = rid \? `\$\{user\.id\}:\$\{rid\}` : null;/.test(edge));
  const cl = strip(read('src/lib/ai/client.ts'));
  check('★앱은 한 번 부를 때 요청 id 하나를 만들어 재시도에도 같은 id 를 보낸다',
    /const requestId = genId\('air'\);[\s\S]*for \(let attempt = 1;/.test(cl) && /body: JSON\.stringify\(\{ task, payload, requestId[ ,]/.test(cl));   // ★공간(2번 덩이): 뒤에 대상 자리(unitId)가 붙을 수 있다
  const gen = strip(read('src/lib/quiz/generate.ts'));
  check('★퀴즈 문항 만들기 재시도도 같은 요청 id 를 보낸다',
    /const requestId = genId\('air'\);[\s\S]*for \(let attempt = 1;/.test(gen) && /body: JSON\.stringify\(\{ task: 'quiz_item', payload, requestId \}\)/.test(gen));
}

console.log('\n[E10] 사장이 노하우를 지우면 직원 폰에도 실시간으로 빠진다');
{
  const all = migFiles().map((f) => [f, sqlStrip(read(`supabase/migrations/${f}`))]);
  const hit = all.filter(([, s]) => /create table if not exists public\.knowhow_events/.test(s)).at(-1);
  const s = hit?.[1] ?? '';
  check('★보관 신호 테이블 knowhow_events 가 있다(같은 매장 사람만 읽는다)',
    !!hit && /create policy knowhow_events_read on public\.knowhow_events\s+for select using \(unit_id = \(select public\.auth_unit_id\(\)\)\)/.test(s), hit?.[0] ?? '없음');
  check('★노하우 archived_at 이 바뀌면 트리거가 신호 한 줄을 남긴다',
    /after update of archived_at on public\.playbook_entries/.test(s) && /insert into public\.knowhow_events \(unit_id, entry_id, kind\)/.test(s));
  check('★realtime publication 멤버다', /alter publication supabase_realtime add table public\.knowhow_events;/.test(s));
  check('클라는 신호를 쓰지 못한다(읽기만)', /revoke all on table public\.knowhow_events from public, anon, authenticated;/.test(s) && /grant select on table public\.knowhow_events to authenticated;/.test(s));
  const db = strip(read('src/lib/db.ts'));
  const sub = (db.match(/export function subscribePlaybook\([\s\S]*?\n\}/) || [''])[0];
  check('★노하우 구독이 보관 신호도 듣는다(받으면 다시 읽는다)',
    /\.on\('postgres_changes', \{ event: 'INSERT', schema: 'public', table: 'knowhow_events' \}, onChange\)/.test(sub), sub.slice(0, 200));
}

console.log('\n[E11] 사장이 달력으로 고른 마감 날짜를 모든 직원에게 그대로 적용한다(받은 날부터 다시 세지 않음 · 옛 행은 그대로)');
{
  const d = lastDef('claim_quiz_send');
  check('★claim_quiz_send 가 발송 행의 고른 날짜(due_date)를 먼저 쓴다',
    /a\.due_date/.test(d.body) && /coalesce\(v_fixed,/.test(d.body), d.file);
  check('고른 날짜가 없는 행(옛 행·입사·재확인·다시 보내기)은 받은 날 + answer_days 그대로',
    /\(now\(\) at time zone 'Asia\/Seoul'\)::date \+ v_days/.test(d.body), d.file);
  const f = d.file ? read(`supabase/migrations/${d.file}`) : '';
  check('권한 그대로: service_role 만', /revoke execute on function public\.claim_quiz_send\(text\) from public, anon, authenticated;/.test(f)
    && /grant\s+execute on function public\.claim_quiz_send\(text\) to service_role;/.test(f), d.file);
  const db = strip(read('src/lib/db.ts'));
  const ins = (db.match(/export async function insertQuizAssignments\([\s\S]*?\n\}/) || [''])[0];
  check('★insertQuizAssignments 가 고른 마감 날짜를 due_date 로 싣는다',
    /dueDate: string \| null = null/.test(ins) && /due_date: dueDate/.test(ins), ins.slice(0, 200));
  check('발송 원장을 읽을 때 due_date 도 읽는다', /const QUIZ_ASSIGNMENT_COLS = '[^']*\bdue_date\b[^']*'/.test(db) && /dueDate: r\.due_date \?\? null/.test(db));
  const qn = strip(read('src/app/owner/quiz-new.tsx'));
  check('★만들기 화면이 달력으로 고른 날짜(dueAt)를 그대로 넘긴다', /insertQuizAssignments\(courseId, to, scheduledOn, dueAt\)/.test(qn));
  const board = strip(read('src/lib/quiz/useQuizBoard.ts'));
  check('목록 한 줄의 마감도 고른 날짜를 쓴다', /\.dueDate/.test(board));
  const det = strip(read('src/app/owner/quiz/[id].tsx'));
  check('상세의 응시 기한이 고른 날짜를 "○월 ○일까지"로 보인다', /factsOf\(items\.length, course\.answer_days, course\.due_days, fixedDue\)/.test(det) && /일까지`/.test(det));

  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    // 사장이 오늘 보내며 마감을 '오늘+2'로 골랐다(answer_days=4 로 저장됐다고 가정). 직원은 근무일을 기다려 늦게 받아도 같은 날짜여야 한다.
    const SQL = `
begin;
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.m', (select id::text from auth.users where email = 'staff@pilot.squaretable.app'), true);
insert into public.training_courses (id, unit_id, key, name, start_at, answer_days, audience)
  values ('qa_e11_c', 'store_001', 'qa_e11', 'QA E11', public.kst_today(), 4, 'staff');
insert into public.quiz_assignments (id, unit_id, course_id, user_id, scheduled_on, due_date)
  values ('qa_e11_a', 'store_001', 'qa_e11_c', current_setting('qa.j')::uuid, public.kst_today() - 3, public.kst_today() + 2);
insert into public.quiz_assignments (id, unit_id, course_id, user_id, scheduled_on)
  values ('qa_e11_b', 'store_001', 'qa_e11_c', current_setting('qa.m')::uuid, public.kst_today());
select 'R=claimA:' || public.claim_quiz_send('qa_e11_a');
select 'R=claimB:' || public.claim_quiz_send('qa_e11_b');
select 'R=dueA:' || (due_on - public.kst_today()) from public.quiz_assignments where id = 'qa_e11_a';
select 'R=dueB:' || (due_on - public.kst_today()) from public.quiz_assignments where id = 'qa_e11_b';
rollback;
`;
    const o = psql(SQL);
    check('★고른 날짜가 있는 발송: 늦게 받아도 마감 = 고른 날짜(오늘+2)', o.includes('R=claimA:true') && o.includes('R=dueA:2'), tail(o));
    check('고른 날짜가 없는 옛 방식 발송: 마감 = 받은 날 + 4일', o.includes('R=claimB:true') && o.includes('R=dueB:4'), tail(o));
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
