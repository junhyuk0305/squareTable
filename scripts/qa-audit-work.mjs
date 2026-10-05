#!/usr/bin/env node
// qa-audit-work.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 할일·알림·채팅 묶음 재현 검사.
//   [D2] 비공개 방 공지는 그 방 멤버에게만 푸시하고, 읽음 분모도 방 멤버 수다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 순수 함수는 앱 코드를 그대로 import 해서 돌린다.
//   [D1] 루틴 업무 시간 알림 · [D7] 근무표를 쓰는 매장은 근무자에게만 · [D8] 고정 공지 보존
//   [D9] 근무 변경 결과를 당사자에게 · [D10] 사장 알림 야간 보류 없음 (2026-10-06 결정)
//   서버 동작은 로컬 도커 DB 트랜잭션(고정 계정 store_001 · 끝나면 되돌림)으로 본다. 도커가 없으면 SKIP.
// 실행: node --no-warnings scripts/qa-audit-work.mjs
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
// 객체 리터럴 안 한 메서드(`name: (` 부터 같은 들여쓰기의 `},` 까지).
const storeMethod = (src, name) => (src.match(new RegExp(`\\n  ${name}: [^\\n]*=> \\{[\\s\\S]*?\\n  \\},`)) || [''])[0];
// 파일 안 export function 하나.
const fnBody = (src, name) => {
  const i = src.search(new RegExp(`export (const ${name} = |function ${name}\\()`));
  if (i < 0) return '';
  const j = src.indexOf('\n};\n', i);
  const k = src.indexOf('\n}\n', i);
  const end = [j, k].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? src.length;
  return src.slice(i, end + 3);
};

console.log('[D2] 비공개 방 공지는 그 방 멤버에게만 푸시하고, 읽음 분모도 방 멤버 수다');
{
  const notify = strip(read('src/lib/push/notify.ts'));
  const ns = fnBody(notify, 'notifyStaffNotice');
  check('★notifyStaffNotice 가 방 id 를 받아 두 발송(owners·staff)에 모두 싣는다',
    /notifyStaffNotice = \(author: string, text: string, roomId\?: string\)/.test(ns) && (ns.match(/\broomId,/g) || []).length === 2, ns.slice(0, 120));
  check('NotifyArgs 에 roomId 가 있다', /type NotifyArgs = \{[\s\S]*?roomId\?: string;[\s\S]*?\};/.test(notify));

  const store = strip(read('src/lib/store/useWorkStore.ts'));
  const pn = storeMethod(store, 'postNotice');
  check('★공지 올리기·재공지 둘 다 지금 방 id 로 알린다',
    (pn.match(/notifyStaffNotice\(authorName, text, room\)/g) || []).length === 2, `${(pn.match(/notifyStaffNotice\([^)]*\)/g) || []).join(' | ')}`);

  const edge = strip(read('supabase/functions/push/index.ts'));
  check('★엣지가 roomId 를 받아 호출자 매장의 방인지 확인한다',
    /roomId\?: string;/.test(edge) && /from\('work_rooms'\)[\s\S]{0,200}\.eq\('unit_id', callerUnit\)/.test(edge));
  check('★엣지가 기본방이 아닌 방이면 수신자를 work_room_members 로 거른다',
    /if \(!room\.is_default\)[\s\S]{0,300}from\('work_room_members'\)[\s\S]{0,300}recipientIds = recipientIds\.filter/.test(edge));

  const board = strip(read('src/components/WorkBoard.tsx'));
  check('★읽음 분모(memberCount)는 기본방이 아니면 이 방에 있는 사람 수다',
    /const memberCount = [^;]*isDefaultRoom[^;]*members\.filter\(\(m\) => m\.inRoom\)\.length/.test(board),
    (board.match(/const memberCount = [^;]*;/) || ['없음'])[0]);
}

console.log('\n[D3] 담당자가 모두 나간 "매장 전체" 할일도 알림이 간다 · 나간 사람은 담당자에서 빠진다');
{
  const t = lastDef('due_task_reminders');
  const b = t.body;
  const iFilter = b.search(/from unnest\(v_rec\) x\s+where exists \(\s*select 1 from public\.unit_members m\s+where m\.unit_id = t\.unit_id and m\.user_id = x::uuid\s*\);\s*end if;/);
  const iFall = b.search(/if cardinality\(t\.owner_ids\) = 0\s+or \(coalesce\(array_length\(v_rec, 1\), 0\) = 0 and t\.scope is distinct from 'private'\) then/);
  check('★담당자를 먼저 매장 멤버로 거르고, 다 빠지면 매장 전체 할일은 근무자 → 전원 갈래로 내려간다',
    iFilter > 0 && iFall > iFilter && /public\.workers_at\(/.test(b.slice(iFall)), `${t.file} filter=${iFilter} fall=${iFall}`);
  check('개인 할일은 담당자가 나가도 근무자에게 내려가지 않는다(내용이 남에게 가지 않게)', /t\.scope is distinct from 'private'/.test(b));
  check('0254 담당자 갈래·0265 잠긴 매장 제외는 그대로', /if cardinality\(t\.owner_ids\) > 0 then/.test(b) && /and not public\.unit_access_locked\(w\.unit_id\)/.test(b));
  const tr = lastDef('wt_drop_departed_assignee');
  const trFile = tr.file ? read(`supabase/migrations/${tr.file}`) : '';
  check('★매장을 나가면(unit_members 삭제) 그 매장 "매장 전체" 할일 담당자에서 뺀다',
    /array_remove\(owner_ids, old\.user_id\)/.test(tr.body) && /coalesce\(scope, 'shared'\) = 'shared'/.test(tr.body)
      && /after delete on public\.unit_members/.test(trFile), tr.file || '없음');
  check('이미 나간 사람이 담당자로 남은 할일도 한 번 정리한다', /update public\.work_templates[\s\S]{0,400}not exists \(select 1 from public\.unit_members/.test(sqlStrip(trFile)));
}

console.log('\n[D5] 자정을 넘는 근무의 "지금 근무자"는 전날 시작한 근무로 판정한다');
{
  const w = lastDef('workers_at');
  const b = w.body;
  const parts = b.split(/\bunion\b/);
  const today = parts[0] ?? '', prev = parts[1] ?? '';
  check('★오늘 요일 심야 행은 시작 시각 이후만 잡는다(자정 뒤 꼬리는 오늘 행으로 안 잡는다)',
    parts.length === 2 && /else p_time >= st\.start_time/.test(today) && !/or p_time < st\.end_time/.test(today), w.file);
  check('★전날 시작한 심야 근무는 끝 시각 전까지 근무자로 잡는다',
    /st\.start_time > st\.end_time/.test(prev) && /p_time < st\.end_time/.test(prev)
      && /st\.weekday = extract\(dow from \(p_day::date - 1\)\)::int/.test(prev) && /st\.shift_date = p_day::date - 1/.test(prev));
  check('전날 행도 적용 기간·그날 예외·옛 재직 표시를 전날 날짜로 본다',
    /st\.valid_from <= p_day::date - 1/.test(prev) && /e\.date = p_day::date - 1/.test(prev) && /archived_tenure_id is null/.test(prev));
  check('workers_at 권한 유지(service_role 전용)',
    !!w.file && read(`supabase/migrations/${w.file}`).includes('revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;')
      && read(`supabase/migrations/${w.file}`).includes('grant  execute on function public.workers_at(text, text, text) to service_role;'));
}

console.log('\n[D6] 23:56~23:59 로 정한 할일 알림도 자정 직후 틱에 어제 날짜로 나간다');
{
  const t = lastDef('due_task_reminders');
  const b = t.body;
  check('★자정 직후 틱(하한이 뒤집힌 때)에는 어제 날짜의 하한 뒤 미발송분도 후보다',
    /v_prev\s+text := to_char\(v_now - interval '1 day', 'YYYY-MM-DD'\)/.test(b)
      && /select v_prev where v_floor >= v_time and w\.remind_at > v_floor/.test(b), t.file);
  check('★후보 날짜(cand_day)로 발생일·발송 원장·완료·근무자·out_date 를 본다',
    /task_occurs_on\(w\.recurrence, w\.date, w\.due_date, w\.hidden, c\.d\)/.test(b)
      && /s\.remind_date = c\.d/.test(b) && /d\.work_date = c\.d/.test(b)
      && /public\.workers_at\(t\.unit_id, t\.cand_day, t\.remind_at\)/.test(b) && /out_date\s+:= t\.cand_day/.test(b));
  check('D3·0265 변경은 그대로', /t\.scope is distinct from 'private'/.test(b) && /and not public\.unit_access_locked\(w\.unit_id\)/.test(b));
}

console.log('\n[D11] 알림함 배선 — 배정 시각 기록 · 사장 알림함 공지·배정 · 채팅에서 본 멘션 읽음 (판정 진리표는 qa:notif-axis)');
{
  const tr = lastDef('wt_track_assigned');
  const trFile = tr.file ? read(`supabase/migrations/${tr.file}`) : '';
  check('★서버가 담당자별 배정 시각·배정한 사람을 남긴다(assigned_meta · 옛 앱 경로 포함 트리거)',
    /add column if not exists assigned_meta jsonb/.test(trFile) && /before insert or update on public\.work_templates/.test(trFile)
      && /auth\.uid\(\)/.test(tr.body), tr.file || '없음');
  check('트리거 이름이 wt_sync_owner_ids 뒤에 돈다(owner_id 만 바꾼 옛 앱도 잡힌다)', 'wt_track_assigned' > 'wt_sync_owner_ids' && /create trigger wt_track_assigned/.test(trFile));
  const db = strip(read('src/lib/db.ts'));
  check('앱이 assigned_meta 를 읽는다(mapTemplateRow)', /assignedMeta: r\.assigned_meta/.test(db));
  for (const [p, re] of [
    ['src/app/owner/notifications.tsx', /buildOwnerNotifications\(ownerArgs, received\)/],
    ['src/components/NotificationBell.tsx', /ownerUnreadCount\([^)]*alerts, received\)/],
    ['src/lib/utils/crossStoreNotifs.ts', /buildOwnerNotifications\(ownerArgsOf\(d, me, nameOf, ackAt\), receivedArgsOf\(d, me, today, nameOf, ackAt\)\)/],
  ]) check(`★${p} 사장 목록·배지에 받은 공지·배정을 넣는다`, re.test(strip(read(p))));
  const board = strip(read('src/components/WorkBoard.tsx'));
  check('★채팅을 보고 있으면 이 방의 나를 언급한 글을 읽음 처리한다',
    /unreadMentionIds\(/.test(board) && /markAllRead\(/.test(board) && /useFocusEffect\(/.test(board));
}

console.log('\n[D12] 노하우 개선 제안은 실제로 고쳐 저장해야 반영된다 · 결과를 제안한 직원에게 알린다');
{
  const sug = strip(read('src/app/owner/suggestions.tsx'));
  const reflect = (sug.match(/function reflect\(s: PlaybookSuggestion\) \{[\s\S]*?\n  \}/) || [''])[0];
  const improve = reflect.split('} else {')[0];
  check('★"반영하기"를 눌러도 바로 승인하지 않는다(개선 분기)', !!reflect && !/approve\(/.test(improve), improve.slice(0, 200));
  check('★개선 분기가 수정 화면에 sugId 를 넘긴다', /pathname: '\/owner\/edit\/\[id\]', params: \{[^}]*sugId: s\.id/.test(improve));
  const edit = strip(read('src/app/owner/edit/[id].tsx'));
  const onUpdated = (edit.match(/const onUpdated = useCallback\([\s\S]*?\n  \);/) || [''])[0];
  const iOk = onUpdated.indexOf('if (!ok) return;');
  const iApprove = onUpdated.search(/approveSuggestion\(sugId, entry\.id\)/);
  check('★수정 화면은 저장이 성공한 뒤에만 제안을 승인한다', /sugId\?: string/.test(edit) && iOk > 0 && iApprove > iOk, `ok=${iOk} approve=${iApprove}`);

  const store = strip(read('src/lib/store/useSuggestionStore.ts'));
  const ap = storeMethod(store, 'approve'), rj = storeMethod(store, 'reject');
  check('★반영되면 제안한 사람에게 알린다(저장 성공 뒤)', /\.then\(\(ok\) => \{[^}]*notifyUserSuggestionResult\(before\.proposer_id, true, before\.text\)/.test(ap), ap.slice(0, 300));
  check('★반려되면 제안한 사람에게 알린다(저장 성공 뒤)', /\.then\(\(ok\) => \{[^}]*notifyUserSuggestionResult\(before\.proposer_id, false, before\.text\)/.test(rj));
  const notify = strip(read('src/lib/push/notify.ts'));
  const nf = fnBody(notify, 'notifyUserSuggestionResult');
  check('알림은 제안한 사람 한 명에게(audience user) · 내 공간(/junior/chat)으로', /audience: 'user'/.test(nf) && /url: '\/junior\/chat'/.test(nf) && /tag: 'suggestion-result'/.test(nf));
  check('엣지 탭 경로표에 suggestion-result 가 있다', /case 'suggestion-result': return '\/junior\/chat';/.test(strip(read('supabase/functions/push/index.ts'))));
}

console.log('\n[D13] 채팅방 만들기 — 멤버 초대 하나가 실패해도 이미 만든 방을 지우지 않는다');
{
  const store = strip(read('src/lib/store/useRoomStore.ts'));
  const cr = storeMethod(store, 'createRoom');
  const memberGuard = (cr.match(/guardWrite\(\s*addRoomMember\(m\.roomId, m\.userId\),[\s\S]*?\)\)\)/) || [''])[0];
  check('★방 만들기 실패(insertRoom)만 방을 되돌린다', /guardWrite\(\s*insertRoom\(room\),\s*\(\) => set\(\(s\) => \(\{ rooms: s\.rooms\.filter\(\(r\) => r\.id !== room\.id\)/.test(cr), cr.slice(0, 200));
  check('★초대 실패는 그 사람만 빼고 알린다(방은 남긴다)', !!memberGuard && !/rooms:/.test(memberGuard) && /다시 초대해 주세요/.test(memberGuard), memberGuard.slice(0, 200));
}

// ── 로컬 도커 DB(트랜잭션 · 되돌림 · 고정 계정 store_001) ─────────────────────
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300); }
};
const rows = (o) => o.split('\n').filter((l) => /^R=|ERR=/.test(l));
const tail = (o) => rows(o).join(' ').slice(0, 240);
let dbUp = true;
try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { dbUp = false; }
const IDS = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.m', (select id::text from auth.users where email = 'staff@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.t', to_char((now() at time zone 'Asia/Seoul') - interval '1 minute', 'HH24:MI'), true);
select set_config('qa.day', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD'), true);
select set_config('qa.d3', to_char(public.kst_today() + 3, 'YYYY-MM-DD'), true);
delete from public.shift_templates where unit_id = 'store_001';
`;
const asUser = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
// 지금 store_001 에 나갈 할일 알림: 'R=<할일 id>:<수신자 수>:<직원 j 포함>'
const DUE = `select 'R=' || out_template_id || ':' || coalesce(array_length(out_recipients, 1), 0) || ':' || (current_setting('qa.j') = any(out_recipients))
  from public.due_task_reminders() where out_unit_id = 'store_001' order by 1;`;

console.log('\n[D1] 루틴 업무(schedule_config.dayparts routines[].remindAt)에도 업무 시간 알림이 간다');
{
  const t = lastDef('due_task_reminders');
  const b = t.body;
  check('★due_task_reminders 가 매장 설정(dayparts)의 루틴 remindAt 을 읽는다',
    /public\.schedule_config/.test(b) && /'routines'/.test(b) && /'remindAt'/.test(b), t.file);
  check('★루틴 할일 id 는 앱과 같은 dpr_ + 루틴 id 다(완료 표시·발송 원장 키)', /'dpr_' \|\|/.test(b));
  check('★그날 대체본(0146 replaces_routine_id)이 있으면 원본 루틴은 건너뛴다', /replaces_routine_id/.test(b));
  check('0254·0265·0269·0271 변경은 그대로',
    /if cardinality\(t\.owner_ids\) > 0 then/.test(b) && /not public\.unit_access_locked\(/.test(b) && /t\.scope is distinct from 'private'/.test(b) && /v_prev/.test(b));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const ROUT = `
insert into public.schedule_config (unit_id, dayparts) values ('store_001', jsonb_build_array(jsonb_build_object('id', 'open', 'label', '오픈',
  'routines', jsonb_build_array(
    jsonb_build_object('id', 'qa_rt1', 'text', '오픈 청소', 'remindAt', current_setting('qa.t')),
    jsonb_build_object('id', 'qa_rt2', 'text', '재고 확인', 'remindAt', current_setting('qa.t'), 'assigneeId', current_setting('qa.j')),
    jsonb_build_object('id', 'qa_rt3', 'text', '시간 없음')))))
on conflict (unit_id) do update set dayparts = excluded.dayparts;
`;
    const r0 = psql(`${IDS}${ROUT}${DUE}\nrollback;\n`);
    const got = rows(r0).filter((l) => l.startsWith('R=dpr_'));
    check('★시간을 정한 루틴 2개가 나간다(시간 없는 루틴은 안 나감)', got.length === 2, tail(r0));
    check('★담당자 없는 루틴 = 매장 전원(근무표 안 쓰는 매장) · 담당자 있는 루틴 = 담당자 한 명',
      got.includes('R=dpr_qa_rt1:3:true') && got.includes('R=dpr_qa_rt2:1:true'), tail(r0));
    const r1 = psql(`${IDS}${ROUT}insert into public.work_done (unit_id, work_date, template_id, data) values ('store_001', current_setting('qa.day'), 'dpr_qa_rt1', '{}'::jsonb);\n${DUE}\nrollback;\n`);
    check('★오늘 완료한 루틴(work_done dpr_)은 안 나간다', !tail(r1).includes('dpr_qa_rt1') && tail(r1).includes('dpr_qa_rt2'), tail(r1));
    const r2 = psql(`${IDS}${ROUT}insert into public.work_templates (id, unit_id, section, text, date, replaces_routine_id) values ('qa_rep1', 'store_001', 'open', '오늘만 다르게', current_setting('qa.day'), 'qa_rt1');\n${DUE}\nrollback;\n`);
    check('★오늘 대체본이 있는 루틴은 원본이 안 나간다', !tail(r2).includes('dpr_qa_rt1') && tail(r2).includes('dpr_qa_rt2'), tail(r2));
    const r3 = psql(`${IDS}${ROUT}insert into public.task_reminder_sent (template_id, remind_date, unit_id) values ('dpr_qa_rt1', current_setting('qa.day'), 'store_001');\nselect 'R=ledger';\n${DUE}\nrollback;\n`);
    check('★발송 원장에 루틴 키(dpr_)를 넣을 수 있다(엣지 선점) · 넣은 뒤엔 다시 안 나간다',
      r3.includes('R=ledger') && !tail(r3).includes('dpr_qa_rt1') && tail(r3).includes('dpr_qa_rt2'), tail(r3));
  }
}

console.log('\n[D7] 근무표를 쓰는 매장은 그 시각 근무자에게만, 근무자가 없으면 보내지 않는다');
{
  const t = lastDef('due_task_reminders');
  check('★근무자가 없을 때 매장 전원으로 가는 갈래는 근무표를 안 쓰는 매장에서만 탄다',
    /and not exists \(\s*select 1 from public\.shift_templates st\s+where st\.unit_id = t\.unit_id/.test(t.body), t.file);
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const TASK = `insert into public.work_templates (id, unit_id, section, text, scope, remind_at) values ('qa_t7', 'store_001', 'open', '오픈 준비', 'shared', current_setting('qa.t'));\n`;
    const a = psql(`${IDS}${TASK}${DUE}\nrollback;\n`);
    check('근무표를 안 쓰는 매장 = 지금처럼 매장 전원', rows(a).includes('R=qa_t7:3:true'), tail(a));
    const B = `insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from)
  values ('qa_s7b', 'store_001', current_setting('qa.j'), null, public.kst_today() + 1, '09:00', '13:00', public.kst_today() + 1);\n`;
    const b = psql(`${IDS}${TASK}${B}${DUE}\nrollback;\n`);
    check('★근무표를 쓰는데(내일 근무 1건) 지금 근무자가 없으면 안 보낸다', !tail(b).includes('qa_t7') && !tail(b).includes('ERR='), tail(b));
    const C = `insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from)
  values ('qa_s7c', 'store_001', current_setting('qa.j'), extract(dow from public.kst_today())::int, null, '00:00', '23:59', public.kst_today());\n`;
    const c = psql(`${IDS}${TASK}${C}${DUE}\nrollback;\n`);
    check('★지금 근무자가 있으면 그 사람에게만', rows(c).includes('R=qa_t7:1:true'), tail(c));
    const OWN = `update public.work_templates set owner_ids = array[current_setting('qa.m')::uuid] where id = 'qa_t7';\n`;
    const d = psql(`${IDS}${TASK}${OWN}${B}${DUE}\nrollback;\n`);
    check('담당자가 정해진 할일은 근무와 상관없이 담당자에게(지금 규칙 유지)', rows(d).includes('R=qa_t7:1:false'), tail(d));
  }
}

console.log('\n[D8] 고정 공지는 피드 90일 창과 6개월 파기에서 빠진다');
{
  const g = lastDef('purge_retention_global');
  check('★6개월 파기 크론(purge_retention_global)이 고정 공지를 남긴다',
    /delete from public\.work_feed where created_at < v_6mo\s+and coalesce\(data->>'pinned', ''\) <> 'true'/.test(g.body), g.file);
  const o = lastDef('purge_old_records');
  check('★사장 기회 정리(purge_old_records)도 고정 공지를 남긴다',
    /delete from public\.work_feed where unit_id = v_unit and created_at < v_cutoff\s+and coalesce\(data->>'pinned', ''\) <> 'true'/.test(o.body), o.file);
  const db = strip(read('src/lib/db.ts'));
  const ff = (db.match(/export async function fetchFeed\(\)[\s\S]*?\n\}\n/) || [''])[0];
  check('★fetchFeed 가 고정 공지를 기간·상한과 무관하게 따로 읽어 합친다',
    /\.eq\('data->>pinned', 'true'\)/.test(ff) && /FEED_WINDOW_DAYS/.test(ff), ff.slice(0, 200));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const F = `insert into public.work_feed (id, unit_id, feed_date, data, created_at) values
  ('qa_f8p', 'store_001', '2026-01-01', '{"id":"qa_f8p","kind":"notice","pinned":true}'::jsonb, now() - interval '7 months'),
  ('qa_f8o', 'store_001', '2026-01-01', '{"id":"qa_f8o","kind":"notice"}'::jsonb, now() - interval '7 months'),
  ('qa_f8u', 'store_001', '2026-01-01', '{"id":"qa_f8u","kind":"notice","pinned":false}'::jsonb, now() - interval '7 months');
select public.purge_retention_global();
select 'R=' || id from public.work_feed where id like 'qa_f8%' order by id;\n`;
    const r = psql(`${IDS}${F}rollback;\n`);
    check('★7개월 된 고정 공지는 남고, 고정 아님·고정 푼 공지는 지운다', rows(r).join(',') === 'R=qa_f8p', tail(r));
  }
}

console.log('\n[D9] 대타 확정·시간 수정 결과·사장의 근무 변경을 당사자에게 알린다(푸시 + 알림함)');
{
  const a = lastDef('approve_swap');
  check('★approve_swap 이 받은 사람(accepted_by · 맞교환 상대)에게 구성원 알림을 넣는다',
    /public\.put_schedule_notice\(s\.unit_id, s\.accepted_by, 'swap_confirmed'/.test(a.body), a.file);
  const d = lastDef('decide_shift_time');
  check('★decide_shift_time 이 승인·반려 결과를 요청 직원에게 넣는다',
    (d.body.match(/public\.put_schedule_notice\(r\.unit_id, r\.staff_id, 'shift_time_result'/g) || []).length === 2, d.file);
  const n = lastDef('notify_shift_changed');
  check('★notify_shift_changed: 사장·매니저만 · 이 매장 멤버에게만 · 본인 제외',
    !!n.file && /public\.auth_can_manage\(\)/.test(n.body) && /public\.unit_members/.test(n.body) && /'shift_changed'/.test(n.body), n.file || '없음');
  const p = lastDef('put_schedule_notice');
  const pf = p.file ? sqlStrip(read(`supabase/migrations/${p.file}`)) : '';
  check('put_schedule_notice 는 클라가 못 부른다 · url = /junior/schedule',
    /revoke all on function public\.put_schedule_notice\(text, text, text, text, text\) from public, anon, authenticated;/.test(pf) && /'\/junior\/schedule'/.test(p.body), p.file || '없음');
  check('★member_notices 종류에 swap_confirmed · shift_time_result · shift_changed 가 있다',
    /'swap_confirmed', 'shift_time_result', 'shift_changed'/.test(pf));
  const st = strip(read('src/lib/store/useScheduleStore.ts'));
  const method = (m) => (st.match(new RegExp(`\\n  ${m}: [\\s\\S]*?(?=\\n  [a-zA-Z]+: )`)) || [''])[0];
  for (const m of ['addTemplate', 'applySeriesOps', 'overrideShiftDay', 'restoreException']) {
    check(`★스토어 ${m} 가 저장 성공 뒤 당사자에게 알린다(notifyShiftChanged)`, /notifyShiftChanged\(/.test(method(m)));
  }
  check('★스토어가 내 근무 알림(member_notices)을 읽는다', /fetchScheduleNotices\(\)/.test(st) && /\bnotices:/.test(st));
  const nt = strip(read('src/lib/utils/notifications.ts'));
  check('★직원 알림함에 근무 알림(kind schedule · /junior/schedule)이 있다',
    /\| 'schedule'/.test(nt) && /kind: 'schedule'/.test(nt));
  check('직원 화면·벨·앱 배지가 근무 알림을 넘긴다',
    /scheduleNotices/.test(strip(read('src/app/junior/notifications.tsx'))) && /scheduleNotices/.test(strip(read('src/components/NotificationBell.tsx')))
      && /scheduleNotices/.test(strip(read('src/lib/push/appBadge.ts'))));
  check('알림 모양 표(JUNIOR_KIND_UI)에 schedule 이 있다', /\n  schedule: \{/.test(read('src/components/NotificationList.tsx')));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const SH = `insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from) values
  ('qa_d9_t', 'store_001', current_setting('qa.j'), null, current_setting('qa.d3')::date, '09:00', '13:00', current_setting('qa.d3')::date);\n`;
    const NOTE = (who, kind) => `reset role;\nselect 'R=' || kind || '|' || title || '|' || url from public.member_notices
  where user_id = current_setting('qa.${who}')::uuid and kind = '${kind}' and unit_id = 'store_001' and created_at = now();\n`;
    const sw = psql(`${IDS}${SH}insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by, created_at, updated_at)
  values ('qa_d9_s', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.d3'), 'qa_d9_t', 'accepted', current_setting('qa.m'), now(), now());
${asUser('o')}select 'R=approve:' || public.approve_swap('qa_d9_s', false);\n${NOTE('m', 'swap_confirmed')}rollback;\n`);
    check('★대타 승인 → 받은 사람(매니저 m)에게 "대타 근무가 확정됐어요"', sw.includes('R=approve:true') && /R=swap_confirmed\|대타 근무가 확정됐어요\|\/junior\/schedule/.test(sw), tail(sw));
    const REQ = `insert into public.shift_change_requests (id, unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end)
  values ('qa_d9_r', 'store_001', current_setting('qa.j'), 'qa_d9_t', current_setting('qa.d3')::date, '09:00', '13:00', '10:00', '14:00');\n`;
    const ap = psql(`${IDS}${SH}${REQ}${asUser('o')}select 'R=decide:' || public.decide_shift_time('qa_d9_r', true, false);\n${NOTE('j', 'shift_time_result')}rollback;\n`);
    check('★시간 수정 승인 → 요청 직원에게 "근무 시간 수정이 승인됐어요"', ap.includes('R=decide:true') && /R=shift_time_result\|근무 시간 수정이 승인됐어요/.test(ap), tail(ap));
    const rj = psql(`${IDS}${SH}${REQ}${asUser('o')}select 'R=decide:' || public.decide_shift_time('qa_d9_r', false, false);\n${NOTE('j', 'shift_time_result')}rollback;\n`);
    check('★시간 수정 반려 → 요청 직원에게 "근무 시간 수정이 반려됐어요"', rj.includes('R=decide:true') && /R=shift_time_result\|근무 시간 수정이 반려됐어요/.test(rj), tail(rj));
    const ch = psql(`${IDS}${asUser('o')}select 'R=notify:' || public.notify_shift_changed(current_setting('qa.j'), current_setting('qa.d3')::date, false);\n${NOTE('j', 'shift_changed')}rollback;\n`);
    check('★사장이 근무를 바꾸면 그 직원에게 "근무표가 바뀌었어요"', ch.includes('R=notify:true') && /R=shift_changed\|근무표가 바뀌었어요\|\/junior\/schedule/.test(ch), tail(ch));
    const self = psql(`${IDS}${asUser('j')}select 'R=notify:' || public.notify_shift_changed(current_setting('qa.m'), current_setting('qa.d3')::date, false);\nrollback;\n`);
    check('직원은 근무 변경 알림을 넣지 못한다', self.includes('R=notify:false'), tail(self));
    const out = psql(`${IDS}${asUser('o')}select 'R=notify:' || public.notify_shift_changed('00000000-0000-0000-0000-000000000000', current_setting('qa.d3')::date, false);\nrollback;\n`);
    check('이 매장 멤버가 아니면 넣지 않는다', out.includes('R=notify:false'), tail(out));
  }
}

console.log('\n[D10] 사장 알림에도 야간 보류(08:00 까지 미룸)가 없다 · 직원 알림에도 넣지 않는다');
{
  const s = lastDef('sweep_owner_alerts');
  check('★sweep_owner_alerts 선점에 22:00~08:00 시각 조건이 없다', !!s.file && !/'08:00'/.test(s.body) && !/'22:00'/.test(s.body), s.file);
  check('하루 넘게 밀린 행은 보내지 않는 규칙은 그대로', /a\.created_at > v_now - interval '1 day'/.test(s.body));
  check('직원 알림(sweep_unit_closures · sweep_member_notices)에도 시각 조건이 없다',
    !/'08:00'|'22:00'/.test(lastDef('sweep_unit_closures').body) && !/'08:00'|'22:00'/.test(lastDef('sweep_member_notices').body));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const r = psql(`${IDS}delete from public.unit_member_prefs where unit_id = 'store_001';
insert into public.owner_alerts (unit_id, kind, period, step, title, body) values ('store_001', 'ai_cap', 'qa_d10', 80, 'QA', 'QA');
select count(*) from public.sweep_owner_alerts(((date_trunc('day', now() at time zone 'Asia/Seoul') + interval '2 hours 30 minutes') at time zone 'Asia/Seoul'));
select 'R=' || (claimed_at is not null) from public.owner_alerts where unit_id = 'store_001' and period = 'qa_d10';
rollback;\n`);
    check('★개인 방해금지를 안 켠 매장도 새벽 2:30 에 바로 선점(발송)한다', rows(r).includes('R=true'), tail(r));
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
