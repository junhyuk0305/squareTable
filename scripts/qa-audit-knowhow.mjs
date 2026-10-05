#!/usr/bin/env node
// qa-audit-knowhow.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 노하우·퀴즈·AI 묶음 재현 검사.
//   [E1] 초안·외부용 퀴즈는 직원 카드와 자동 배정(신입 첫 퀴즈·재확인)에 안 나온다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 순수 함수는 앱 코드를 그대로 import 해서 돌린다.
// 실행: node --no-warnings scripts/qa-audit-knowhow.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
  check('★직원 카드가 staffCanSeeCourse 로 거른다', /if \(!staffCanSeeCourse\(c, sends\.length\)\) continue;/.test(board));

  for (const fn of ['approve_member', 'enqueue_knowhow_rechecks']) {
    const d = lastDef(fn);
    check(`★${fn} 이 외부용 코스를 고르지 않는다`, /coalesce\(c\.audience, 'staff'\) = 'staff'/.test(d.body), d.file);
    check(`★${fn} 이 만들던 퀴즈(일정·사장 발송 없음)를 고르지 않는다(0139 이전 코스는 예외)`,
      /c\.start_at is not null/.test(d.body) && /x\.origin = 'manual'/.test(d.body) && /c\.created_at < timestamptz '2026-08-11 00:00:00\+09'/.test(d.body), d.file);
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
  check('★카드 판정이 내 미완료 재확인 발송을 보고 바뀐 노하우를 due 로 띄운다',
    /a\.origin === 'recheck' && !a\.completedAt/.test(board) && /recheckEntryDue\(myRow\(id\)\?\.verifiedAt, entryById\.get\(id\)\?\.updated_at, recheck\)/.test(board));
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
  check('★fetchQuizSendStatus 가 rpc 를 부른다', /export async function fetchQuizSendStatus\(courseId: string\)/.test(db) && /rpc\('quiz_send_status', \{ p_course_id: courseId \}\)/.test(db));
  const scr = strip(read('src/app/owner/quiz/[id].tsx'));
  check('★사람 줄이 이유를 말한다(근무표에 없어 대기 중 · 두 번 안 열어 멈춤)',
    /fetchQuizSendStatus\(/.test(scr) && scr.includes('근무표에 없어 대기 중') && scr.includes('두 번 안 열어 멈춤'));
}

console.log('\n[E4] "푼 사람"은 담긴 노하우를 다 풀었을 때(맞힘과 무관) · 개인 결과는 그 사람의 실제 응시로');
{
  const d = lastDef('mark_quiz_completed');
  const b = d.body;
  check('★완료는 이 발송 뒤에 담긴 노하우를 전부 풀었을 때만(맞혔는지는 안 본다)',
    /t\.taken_at >= v_a\.sent_at/.test(b) && /from public\.course_entries ce/.test(b) && /return false;/.test(b), d.file);
  check('이미 알아 카드에 안 뜨는 노하우는 다시 풀지 않아도 된다(재확인 발송은 바뀐 뒤 통과만 인정)',
    /from public\.knowhow_understanding ku/.test(b) && /v_a\.origin <> 'recheck' or ku\.verified_at >= pe\.updated_at/.test(b), d.file);
  check('낼 문항이 없는 노하우·보관한 노하우는 셈에서 뺀다',
    /pe\.archived_at is null/.test(b) && /q\.format = any\(public\.quiz_known_formats\(\)\)/.test(b), d.file);
  check('본인·이미 나간 발송만', /a\.user_id = \(select auth\.uid\(\)\)/.test(b) && /a\.sent_at is not null/.test(b), d.file);
  const sheet = strip(read('src/components/work/UnderstandingCheckSheet.tsx'));
  check('★응시를 마치면(통과와 무관) 기록 저장 뒤 onFinished 를 부른다',
    /recordStaffQuizAttempt\(given\.current\)\.then\(\(\) => onFinished\?\.\(/.test(sheet));
  const store = strip(read('src/lib/store/useWorkStore.ts'));
  const mu = (store.match(/\n  markUnderstood: async[\s\S]*?\n  \},/) || [''])[0];
  const nf = (store.match(/\n  noteQuizFinished: \(entryIds\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('★통과(markUnderstood)가 발송을 완료로 찍지 않는다', !!mu && !/markQuizCompleted/.test(mu), mu.slice(0, 80));
  check('★noteQuizFinished 가 완료 판정을 서버에 맡긴다', /markQuizCompleted\(id\)/.test(nf));
  const board = strip(read('src/components/WorkBoard.tsx'));
  check('WorkBoard 가 응시 끝을 넘긴다', /onFinished=\{\(entryIds\) => useWorkStore\.getState\(\)\.noteQuizFinished\(entryIds\)\}/.test(board));

  const p = lastDef('quiz_course_person');
  check('★직원 응시(course_id 없음)도 담긴 노하우로 이 퀴즈에 묶는다',
    /a\.course_id is null and a\.entry_id in \(select ce\.entry_id from public\.course_entries ce where ce\.course_id = p_course_id\)/.test(p.body), p.file);
  const person = strip(read('src/app/owner/quiz/person.tsx'));
  check('★개인 결과의 문항 목록은 그 사람의 최근 응시(submission) 스냅샷 전부다(매장 500줄 상한·지운 문항 무관)',
    /fetchGuestAttemptItems\(sub\)/.test(person) && !/fetchStaffAttemptItems/.test(person));
}

console.log('\n[E5] 지운(보관한) 노하우는 할일·퀴즈 연결 판정에서 빠진다');
{
  const db = strip(read('src/lib/db.ts'));
  const fn = (name) => (db.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
  const wtk = fn('fetchTemplateKnowhow'), ce = fn('fetchCourseEntries');
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
  check('★같은 요청 키는 한 번만 차감한다',
    /insert into public\.ai_quota_requests \(request_key, unit_id\) values \(p_request_key, v_unit\)\s+on conflict \(request_key\) do nothing;/.test(b)
      && /if not found then/.test(b), d.file);
  check('0193 본문(캡 200/3,000 · 80%·100% 사장 알림 · 단위 1~60)을 그대로 쓴다',
    /then 3000 else 200 end/.test(b) && /'ai_cap', v_month, 80/.test(b) && /'ai_cap', v_month, 100/.test(b) && /least\(greatest\(coalesce\(p_units, 1\), 1\), 60\)/.test(b), d.file);
  const f = d.file ? read(`supabase/migrations/${d.file}`) : '';
  check('★consume_ai_quota 는 클라(authenticated)에서 닫는다',
    /revoke all on function public\.consume_ai_quota\(int\) from public, anon, authenticated;/.test(f));
  check('consume_ai_quota_for 는 service_role 만', /revoke all on function public\.consume_ai_quota_for\(text, int, text\) from public, anon, authenticated;/.test(f)
    && /grant\s+execute on function public\.consume_ai_quota_for\(text, int, text\) to service_role;/.test(f));
  const edge = strip(read('supabase/functions/ai/index.ts'));
  check('★엣지가 서비스 키로 매장 id·요청 키를 넘겨 차감한다',
    /serviceClient\(\)\.rpc\('consume_ai_quota_for', \{ p_unit: user\.unitId, p_units: unitsAfter, p_request_key: requestKey \}\)/.test(edge)
      && !/userClient\(authz\)\.rpc\('consume_ai_quota'/.test(edge));
  check('요청 키는 사용자별로 묶는다(남의 키로 차감을 피하지 못하게)', /const requestKey = rid \? `\$\{user\.id\}:\$\{rid\}` : null;/.test(edge));
  const cl = strip(read('src/lib/ai/client.ts'));
  check('★앱은 한 번 부를 때 요청 id 하나를 만들어 재시도에도 같은 id 를 보낸다',
    /const requestId = genId\('air'\);[\s\S]*for \(let attempt = 1;/.test(cl) && /body: JSON\.stringify\(\{ task, payload, requestId \}\)/.test(cl));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
