#!/usr/bin/env node
// qa-audit-work.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 할일·알림·채팅 묶음 재현 검사.
//   [D2] 비공개 방 공지는 그 방 멤버에게만 푸시하고, 읽음 분모도 방 멤버 수다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 순수 함수는 앱 코드를 그대로 import 해서 돌린다.
// 실행: node --no-warnings scripts/qa-audit-work.mjs
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

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
