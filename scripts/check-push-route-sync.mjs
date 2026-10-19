// check-push-route-sync.mjs — 푸시를 누르면 열리는 화면의 표가 엣지와 앱에서 같은지 잰다(Q25 · 보안 M8 · P1 레지스트리).
//   ① 사장 알림: 앱 알림함 = src/lib/utils/notifications.ts ownerAlertRoute(kind)
//               앱 기기 푸시 = supabase/functions/push/index.ts ownerAlertRouteEdge(kind)
//   ② 앱이 부르는 발송: 앱 = src/lib/notif/registry.ts NOTIF[kind].route(surface, id) (벨 항목·notify.ts 헬퍼가 같은 표를 읽는다)
//               엣지 = clientPushRoute(audience, tag, itemId) (새 엣지는 클라이언트 url 을 버리고 이 값을 싣는다)
//      pushTag 가 있는 kind 마다 audience 전부 × [id 있음, id 없음] 을 대조한다 — id 자리까지 같아야 벨과 푸시가 같은 항목을 연다.
//   ③ 레지스트리 규칙: pushTag 가 있는 kind 는 벨 빌더(notifications.ts)에 kind 이름이 있어야 한다(역 ④ · 푸시만 있는 사건 금지).
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

/** 레지스트리 모듈 전체를 CommonJS 로 바꿔 실행한다(타입 import 만 있어 의존이 없다). */
function loadRegistry() {
  const out = ts.transpileModule(read('src/lib/notif/registry.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', out)(exports, () => ({}));
  return exports;
}

let fail = 0;
let skip = 0;
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

// ② 레지스트리 NOTIF[kind].route(surface, id) ↔ 엣지 clientPushRoute(audience, tag, itemId)
try {
  const { NOTIF, surfaceOfAudience } = loadRegistry();
  const edge = new Function(`${extract('supabase/functions/push/index.ts', 'clientPushRoute')}; return clientPushRoute;`)();
  const pushKinds = Object.entries(NOTIF).filter(([, spec]) => spec.pushTag);
  if (pushKinds.length < 10) throw new Error(`레지스트리에서 pushTag 가 있는 kind 를 ${pushKinds.length}개만 읽었다`);
  const ID = 'tpl_abc-123';
  for (const [kind, spec] of pushKinds) {
    for (const audience of spec.audience ?? []) {
      for (const id of [ID, undefined]) {
        n++;
        const c = spec.route(surfaceOfAudience(audience), id);
        const e = edge(audience, spec.pushTag, id);
        if (c !== e) { fail++; console.log(`✗ ${kind} ${audience}/${spec.pushTag} id=${id ?? '없음'}: 앱=${c} · 엣지=${e}`); }
      }
    }
  }
  // 모르는 tag · 이상한 id 는 엣지가 목록 화면으로 물러나야 한다(주소 주입 방지).
  n++;
  if (edge('user', 'assign', 'https://evil') !== '/junior/work?view=todo') { fail++; console.log('✗ 엣지가 이상한 itemId 를 거르지 않는다'); }
  n++;
  if (edge('user', 'no-such-tag', ID) !== '/') { fail++; console.log('✗ 엣지가 모르는 tag 를 "/" 로 보내지 않는다'); }

  // ③ 역 ④: pushTag 가 있는 kind 는 벨 빌더에도 있어야 한다(kind 문자열이 notifications.ts 안에 보여야 한다).
  //   알려진 빈칸은 통과로 세지 않고 skip 으로 찍는다. role 은 0315/0316 에서 벨 행(roleNoticeRow)이 생겨 빠졌다.
  const KNOWN_GAPS = [];
  const bell = read('src/lib/utils/notifications.ts');
  for (const [kind] of pushKinds) {
    n++;
    if (KNOWN_GAPS.includes(kind)) { skip++; console.log(`⚠ 역 ④ 미구현(알려진 빈칸): ${kind} — 푸시만 있고 벨 항목이 없다`); continue; }
    if (!bell.includes(`NOTIF.${kind}.`)) { fail++; console.log(`✗ 역 ④ 위반: 푸시 tag 만 있고 벨 빌더에 kind 가 없다 — ${kind}`); }
  }

  // notify.ts 헬퍼는 전부 kind 를 말해야 한다(url·tag 를 손으로 적은 헬퍼 = 레지스트리 밖 사건).
  const notify = read('src/lib/push/notify.ts');
  const calls = [...notify.matchAll(/pushNotify\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  if (calls.length < 10) throw new Error(`notify.ts 헬퍼를 ${calls.length}개만 읽었다`);
  for (const b of calls) {
    n++;
    const kind = /kind:\s*'([\w_]+)'/.exec(b)?.[1];
    if (!kind || !NOTIF[kind]) { fail++; console.log(`✗ notify.ts 헬퍼에 레지스트리 kind 가 없다: ${b.trim().slice(0, 60)}`); }
    else if (/\burl:|\btag:/.test(b)) { fail++; console.log(`✗ notify.ts 헬퍼 ${kind} 가 url·tag 를 손으로 적었다`); }
  }
} catch (e) {
  fail++; n++;
  console.log(`✗ 앱 발송 표: ${e.message}`);
}

console.log(`${fail ? '✗' : '✓'} 푸시 탭 경로 표 동기화: ${n - fail - skip}/${n} 일치 · skip ${skip}`);
process.exit(fail ? 1 : 0);
