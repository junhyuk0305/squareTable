// check-push-route-sync.mjs — 푸시를 누르면 열리는 화면의 표가 엣지와 앱에서 같은지 잰다(Q25 · 보안 M8).
//   ① 사장 알림: 앱 알림함 = src/lib/utils/notifications.ts ownerAlertRoute(kind)
//               앱 기기 푸시 = supabase/functions/push/index.ts ownerAlertRouteEdge(kind)
//   ② 앱이 부르는 발송: 앱 = src/lib/push/notify.ts 각 헬퍼의 url (옛 엣지가 그대로 싣는 값)
//               엣지 = clientPushRoute(audience, tag) (새 엣지는 클라이언트 url 을 버리고 이 값을 싣는다)
// 엣지는 src 를 import 하지 못해 같은 표가 두 벌이다. 한쪽만 고치면 알림함과 푸시가 다른 화면을 연다.
// 백엔드를 쓰지 않는다. 사용법: node scripts/check-push-route-sync.mjs (실패 시 exit 1)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** 파일에서 `function <name>(` 부터 그 함수를 닫는 줄 맨 앞 `}` 까지 잘라 JS 로 바꾼다. */
function extract(file, name) {
  const src = read(file);
  const start = src.search(new RegExp(`(export )?function ${name}\\(`));
  if (start < 0) throw new Error(`${file}: ${name} 을 찾지 못했다`);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`${file}: ${name} 의 끝을 찾지 못했다`);
  const body = src.slice(start, end + 2).replace(/^export /, '');
  return ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

let fail = 0;
let n = 0;

// ① 사장 알림 kind 전부(OwnerAlert['kind'] 유니온 = 서버 CHECK 와 같은 목록)
try {
  const types = read('src/types/index.ts');
  const block = types.slice(types.indexOf('export type OwnerAlert = {'), types.indexOf('step?:', types.indexOf('export type OwnerAlert = {')));
  const kinds = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  if (kinds.length < 10) throw new Error(`OwnerAlert kind 를 ${kinds.length}개만 읽었다`);
  const client = new Function(`${extract('src/lib/utils/notifications.ts', 'ownerAlertRoute')}; return ownerAlertRoute;`)();
  const edge = new Function(`${extract('supabase/functions/push/index.ts', 'ownerAlertRouteEdge')}; return ownerAlertRouteEdge;`)();
  for (const kind of [...kinds, 'unknown_kind', undefined]) {
    n++;
    const c = client(kind);
    const e = edge(kind);
    if (c !== e) { fail++; console.log(`✗ 사장 알림 ${kind}: 알림함=${c} · 푸시=${e}`); }
  }
} catch (e) {
  fail++; n++;
  console.log(`✗ 사장 알림 표: ${e.message}`);
}

// ② notify.ts 헬퍼(audience · tag · url) ↔ 엣지 clientPushRoute(audience, tag)
try {
  const notify = read('src/lib/push/notify.ts');
  const calls = [...notify.matchAll(/pushNotify\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  const rows = calls.map((b) => ({
    audience: /audience:\s*'([\w_]+)'/.exec(b)?.[1],
    tag: /tag:\s*'([\w-]+)'/.exec(b)?.[1],
    url: /url:\s*'([^']+)'/.exec(b)?.[1],
  })).filter((r) => r.audience && r.tag && r.url);
  if (rows.length < 10) throw new Error(`notify.ts 헬퍼를 ${rows.length}개만 읽었다`);
  const edge = new Function(`${extract('supabase/functions/push/index.ts', 'clientPushRoute')}; return clientPushRoute;`)();
  for (const r of rows) {
    n++;
    const e = edge(r.audience, r.tag);
    if (e !== r.url) { fail++; console.log(`✗ ${r.audience}/${r.tag}: 앱 url=${r.url} · 엣지=${e}`); }
  }
} catch (e) {
  fail++; n++;
  console.log(`✗ 앱 발송 표: ${e.message}`);
}

console.log(`${fail ? '✗' : '✓'} 푸시 탭 경로 표 동기화: ${n - fail}/${n} 일치`);
process.exit(fail ? 1 : 0);
