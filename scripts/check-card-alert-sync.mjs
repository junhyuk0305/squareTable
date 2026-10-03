// check-card-alert-sync.mjs — 앱(iOS·안드)에서 카드 결제 알림을 어떻게 보일지 정한 표가 두 곳에서 같은지 잰다.
//   알림함 = src/lib/utils/notifications.ts ownerAlertForPlatform (SHOW_BILLING=false 경로)
//   앱 기기 푸시 = supabase/functions/push/index.ts nativeOwnerAlertText
// 엣지는 src 를 import 하지 못해 같은 표가 두 벌이다(2026-10-03). 한쪽만 고치면 같은 행이 잠금화면에는 뜨고
// 알림함에는 없는(또는 그 반대) 상태가 되는데, 게이트·하니스는 전부 green 으로 남는다 → 이 검사가 그 틈을 막는다.
// 백엔드를 쓰지 않는다. 사용법: node scripts/check-card-alert-sync.mjs (실패 시 exit 1)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 파일에서 `function <name>(` 부터 그 함수를 닫는 줄 맨 앞 `}` 까지 잘라 JS 로 바꾼다. */
function extract(file, name) {
  const src = readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const start = src.search(new RegExp(`(export )?function ${name}\\(`));
  if (start < 0) throw new Error(`${file}: ${name} 을 찾지 못했다`);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`${file}: ${name} 의 끝을 찾지 못했다`);
  const body = src.slice(start, end + 2).replace(/^export /, '');
  return ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

const client = new Function('SHOW_BILLING', `${extract('src/lib/utils/notifications.ts', 'ownerAlertForPlatform')}; return ownerAlertForPlatform;`)(false);
const edge = new Function(`${extract('supabase/functions/push/index.ts', 'nativeOwnerAlertText')}; return nativeOwnerAlertText;`)();

// 두 결과를 같은 말로 옮긴다: hide(앱에 안 보냄) · original(원문 그대로) · {title, body}(바꾼 문구).
const fromClient = (a, r) => (r === null ? 'hide' : r === a ? 'original' : JSON.stringify({ title: r.title, body: r.body }));
const fromEdge = (r) => (r === 'skip' ? 'hide' : r === null ? 'original' : JSON.stringify({ title: r.title, body: r.body }));

const KINDS = ['card_fail', 'card_renew', 'card_end', 'seat_lock', 'ai_cap', 'brand_invite', 'sub_renewed', 'sub_ending', 'sub_ended'];
const STEPS = [undefined, 0, 1, 2, 3, 4];
let fail = 0;
let n = 0;
for (const kind of KINDS) {
  for (const step of STEPS) {
    const a = { id: 1, unit_id: 'u', kind, step, title: '10월 9일에 매장 이용료 39,000원이 결제돼요', body: '원문', created_at: '' };
    const c = fromClient(a, client(a));
    const e = fromEdge(edge(kind, step));
    n++;
    if (c !== e) { fail++; console.log(`✗ ${kind} step=${step}: 알림함=${c} · 푸시=${e}`); }
  }
}
console.log(`${fail ? '✗' : '✓'} 카드 알림 앱 표 동기화: ${n - fail}/${n} 일치`);
process.exit(fail ? 1 : 0);
