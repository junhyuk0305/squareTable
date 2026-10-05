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

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
