#!/usr/bin/env node
// qa-push-route.mjs — 푸시를 누르면 알림이 온 매장의 맞는 화면이 열린다(Q24 · Q25 · 보안 M8). 백엔드 없음.
//
// 무엇을 보나
//   [1] 앱 순수 함수 pushTapPlan(src/lib/push/pushTap.ts 를 임시 트랜스파일해 실제 함수로 검증 · 로직 복제 없음)
//       · "/" 로 시작하는 앱 안 경로 허용 목록만 따른다. "https://", "//", 모르는 경로는 무시한다.
//       · 다른 매장 알림이면 그 매장으로 들어간 뒤(enter) 이동한다. /stores · /billing 은 매장을 바꾸지 않는다.
//       · 같은 매장이면 역할에 맞춰(routeForRole) 바로 연다. route 가 있으면 url 보다 먼저 쓴다.
//   [2] 엣지 push/index.ts (함수를 잘라 가짜 admin 으로 실행)
//       · 앱이 부르는 발송은 클라이언트가 보낸 url · route · unitId 를 읽지 않는다(서버 표 clientPushRoute).
//       · Expo 메시지 data 에 서버가 정한 unitId(발송 매장)와 route 가 실린다.
//       · 받는 사람이 2곳 이상 소속이면 제목 앞에 매장 이름(그 사람이 붙인 별명 우선) · MAX_TITLE 에서 자른다.
//       · 사장 알림은 옛 빌드용 url '/billing' 을 두고 route 를 종류별로 싣는다.
//   [3] 동기 검사 scripts/check-push-route-sync.mjs (엣지 표 ↔ 앱 표)
//   [4] 소스 계약 — 탭 처리가 pushTapPlan 을 쓰고, 콜드 스타트를 한 번만 처리하고 알림 id 로 중복을 막는다.
//       매장 전환은 useStoreEntryStore.enter({ then }) 로 한다(전환 = switchUnit → tenantReset 이 데이터를 비운다).
// 실행: node scripts/qa-push-route.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { rm } from 'node:fs/promises';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'push-route');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── [1] 앱 순수 함수 ──────────────────────────────────────────────────────────
console.log('\n[1] pushTapPlan');
const tsc = (files) => {
  try {
    execFileSync('npx', ['tsc', ...files,
      '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
      '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
    ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
  } catch { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }
};
tsc(['src/lib/utils/roles.ts']);
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
const R = await import(pathToFileURL(join(OUT, 'roles.js')));
let plan = null;
if (existsSync(join(root, 'src/lib/push/pushTap.ts'))) {
  tsc(['src/lib/push/pushTap.ts']);
  const fp = join(OUT, 'pushTap.js');
  if (existsSync(fp)) {
    writeFileSync(fp, readFileSync(fp, 'utf8').split("'@/lib/utils/roles'").join("'./roles.js'"), 'utf8');
    const P = await import(pathToFileURL(fp));
    if (typeof P.pushTapPlan === 'function') plan = P.pushTapPlan;
  }
}
// 함수가 없으면(수정 전) **지금 탭 처리의 판정**으로 같은 케이스를 돌린다 — 함수가 없어서가 아니라 판정이 틀려서 RED 여야 한다.
//   지금 nativepush.ts = data.url 이 있으면 무엇이든 router.push(routeForRole(url, role)). 매장은 바꾸지 않는다.
const nativeSrc = read('src/lib/push/nativepush.ts');
if (!plan && nativeSrc.includes('router.push(routeForRole(to, useSessionStore.getState().role)')) {
  console.log('  (pushTapPlan 없음 → 지금 nativepush.ts 판정으로 실행)');
  plan = (data) => (data && typeof data.url === 'string' && data.url
    ? { kind: 'push', to: R.routeForRole(data.url, SESSION_ROLE) } : { kind: 'ignore' });
}
let SESSION_ROLE = 'owner';
const tap = (data, s) => { SESSION_ROLE = s.role; return plan ? plan(data, s) : null; };
const A = { unitId: 'store_a', role: 'owner' };
const show = (x) => JSON.stringify(x);

let r = tap({ url: '/junior/work', route: '/junior/work', unitId: 'store_a' }, { unitId: 'store_a', role: 'junior' });
check('1-1 같은 매장 앱 안 경로는 바로 연다', eq(r, { kind: 'push', to: '/junior/work' }), show(r));
r = tap({ url: 'https://evil.example/billing', route: 'https://evil.example/billing', unitId: 'store_a' }, A);
check('1-2 ★"https://" 주소는 무시한다', eq(r, { kind: 'ignore' }), show(r));
r = tap({ url: '//evil.example/billing', unitId: 'store_a' }, A);
check('1-3 ★"//" 주소는 무시한다', eq(r, { kind: 'ignore' }), show(r));
r = tap({ url: '/billing', route: '/owner/knowledge', unitId: 'store_b' }, A);
check('1-4 ★다른 매장 알림은 그 매장으로 들어간 뒤(enter) 이동한다', eq(r, { kind: 'enter', unitId: 'store_b', then: '/owner/knowledge' }), show(r));
r = tap({ url: '/owner/suggestions', unitId: 'store_a' }, { unitId: 'store_a', role: 'manager' });
check('1-5 매니저는 열 수 없는 사장 화면 대신 직원 홈(routeForRole)', eq(r, { kind: 'push', to: '/junior/home' }), show(r));
r = tap({ url: '/stores', unitId: 'store_b' }, A);
check('1-6 /stores 는 매장을 바꾸지 않는다', eq(r, { kind: 'push', to: '/stores' }), show(r));
r = tap({ url: '/billing', route: '/billing', unitId: 'store_b' }, A);
check('1-7 /billing 은 매장을 바꾸지 않는다', eq(r, { kind: 'push', to: '/billing' }), show(r));
r = tap({ url: '/evil', unitId: 'store_a' }, A);
check('1-8 ★모르는 경로는 무시한다', eq(r, { kind: 'ignore' }), show(r));
r = tap({ url: '/billing', route: '/owner/knowledge', unitId: 'store_a' }, A);
check('1-9 route 가 있으면 url 보다 먼저 쓴다(사장 알림 종류별 화면 · Q25)', eq(r, { kind: 'push', to: '/owner/knowledge' }), show(r));
r = tap({ url: '/\\evil.example' }, A);
check('1-10 역슬래시 주소는 무시한다', eq(r, { kind: 'ignore' }), show(r));
r = tap({ url: '/junior/work' }, { unitId: 'store_a', role: 'junior' });
check('1-11 옛 엣지(unitId·route 없음)는 지금처럼 그 경로를 연다', eq(r, { kind: 'push', to: '/junior/work' }), show(r));
r = tap(undefined, A);
check('1-12 data 가 없으면 무시', eq(r, { kind: 'ignore' }), show(r));
r = tap({ url: '/', unitId: 'store_a' }, A);
check('1-13 "/" 는 연다(앱 첫 화면)', eq(r, { kind: 'push', to: '/' }), show(r));

// ── [2] 엣지 ────────────────────────────────────────────────────────────────
console.log('\n[2] 엣지 push/index.ts');
const edgeSrc = read('supabase/functions/push/index.ts');
const extract = (name) => {
  const start = edgeSrc.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) return null;
  const end = edgeSrc.indexOf('\n}\n', start);
  return ts.transpileModule(edgeSrc.slice(start, end + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
};
const serveSrc = edgeSrc.slice(edgeSrc.indexOf('Deno.serve('));
const clientReads = [...serveSrc.matchAll(/payload\.(url|route|unitId)\b/g)].map((m) => m[0]);
check('2-1 ★앱이 부르는 발송은 클라이언트가 보낸 url · route · unitId 를 읽지 않는다', clientReads.length === 0, clientReads.join(',') || '없음');
const routeSrc = extract('clientPushRoute');
const clientPushRoute = routeSrc ? new Function(`${routeSrc}; return clientPushRoute;`)() : null;
check('2-2 서버 표: 언급 알림은 /junior/work · 모르는 tag 는 "/"',
  !!clientPushRoute && clientPushRoute('user', 'mention') === '/junior/work' && clientPushRoute('user', 'https://evil') === '/',
  clientPushRoute ? `${clientPushRoute('user', 'mention')} · ${clientPushRoute('user', 'https://evil')}` : 'clientPushRoute 없음');
check('2-3 서버 표: 질문 알림은 사장 /owner/inbox · 직원 /junior/chat',
  !!clientPushRoute && clientPushRoute('owners', 'question') === '/owner/inbox' && clientPushRoute('staff', 'question') === '/junior/chat');
check('2-4 serve 가 deliver 에 route 를 서버 표로 넘긴다', /clientPushRoute\(audience, tag\)/.test(serveSrc));

// deliver() 를 가짜 admin 으로 돌려 Expo 메시지를 본다.
const chain = (data) => {
  const o = { select: () => o, in: () => o, eq: () => o, delete: () => o, then: (res) => res({ data, error: null }) };
  return o;
};
const tables = {
  notification_prefs: [],
  unit_member_prefs: [{ user_id: 'u3', muted: false, quiet_enabled: false, quiet_start: null, quiet_end: null, nickname: '우리 가게' }],
  unit_members: [
    { user_id: 'u1', unit_id: 'store_a' }, { user_id: 'u1', unit_id: 'store_b' },
    { user_id: 'u2', unit_id: 'store_a' },
    { user_id: 'u3', unit_id: 'store_a' }, { user_id: 'u3', unit_id: 'store_c' },
  ],
  units: [{ id: 'store_a', store_name: '강남점' }],
};
const sent = [];
const adminFake = {
  from: (t) => chain(tables[t] ?? []),
  rpc: async (name, args) => ({
    data: name === 'push_device_targets'
      ? [{ id: 'd1', token: 'T1', user_id: 'u1' }, { id: 'd2', token: 'T2', user_id: 'u2' }, { id: 'd3', token: 'T3', user_id: 'u3' }]
        .filter((t) => args.p_user_ids.includes(t.user_id))
      : [],
    error: null,
  }),
};
const fetchFake = async (_u, init) => {
  const msgs = JSON.parse(init.body);
  sent.push(...msgs);
  return { ok: true, json: async () => ({ data: msgs.map(() => ({ status: 'ok' })) }) };
};
const parts = ['deliver', 'deliverExpoPush', 'inQuietWindow', 'kstNowHHMM'].map(extract);
let deliver = null;
if (parts.every(Boolean)) {
  // EXPO_ACCESS_TOKEN = 엣지 모듈 상수(985619b). 빈 값이면 Authorization 헤더 없이 보낸다.
  deliver = new Function('webpush', 'fetch', 'EXPO_PUSH_URL', 'EXPO_PUSH_CHUNK', 'MAX_TITLE', 'EXPO_ACCESS_TOKEN', `${parts.join('\n')}; return deliver;`)(
    { sendNotification: async () => {} }, fetchFake, 'https://exp', 100, 120, '');
}
if (deliver) {
  await deliver(adminFake, 'store_a', ['u1', 'u2', 'u3'], { title: '할 일을 배정했어요', body: 'b', url: '/junior/work', route: '/junior/work' });
}
const byTok = Object.fromEntries(sent.map((m) => [m.to, m]));
check('2-5 ★Expo data 에 발송 매장 unitId 가 실린다', sent.length === 3 && sent.every((m) => m.data?.unitId === 'store_a'),
  show(sent.map((m) => m.data)));
check('2-6 Expo data 에 서버 route 가 실린다(옛 빌드용 url 도 그대로)', sent.length === 3 && sent.every((m) => m.data?.route === '/junior/work' && m.data?.url === '/junior/work'));
check('2-7 ★2곳 소속이면 제목 앞에 매장 이름', byTok.T1?.title === '강남점 · 할 일을 배정했어요', byTok.T1?.title);
check('2-8 1곳 소속이면 제목 그대로', byTok.T2?.title === '할 일을 배정했어요', byTok.T2?.title);
check('2-9 그 사람이 붙인 매장 별명을 먼저 쓴다', byTok.T3?.title === '우리 가게 · 할 일을 배정했어요', byTok.T3?.title);
sent.length = 0;
tables.units = [{ id: 'store_a', store_name: '가'.repeat(130) }];
if (deliver) await deliver(adminFake, 'store_a', ['u1'], { title: '제목', body: 'b', url: '/' });
check('2-10 매장 이름을 붙인 제목은 MAX_TITLE(120)에서 자른다', sent.length === 1 && sent[0].title.length === 120, `len=${sent[0]?.title?.length}`);
check('2-11 route 가 없으면 url 을 route 로 싣는다', sent.length === 1 && sent[0].data?.route === '/', show(sent[0]?.data));

const ownerSrc = extract('sweepOwnerAlerts') ?? '';
check('2-12 사장 알림: 옛 빌드용 url /billing 을 두고 route 를 종류별로 싣는다',
  /url: '\/billing'/.test(ownerSrc) && /route: ownerAlertRouteEdge\(/.test(ownerSrc));

// ── [3] 동기 검사 ───────────────────────────────────────────────────────────
console.log('\n[3] 엣지 표 ↔ 앱 표');
const sync = spawnSync(process.execPath, ['scripts/check-push-route-sync.mjs'], { cwd: root, encoding: 'utf8' });
const syncLast = (sync.stdout || '').trim().split('\n').pop();
check('3-1 check-push-route-sync 통과', sync.status === 0, syncLast);

// ── [4] 소스 계약 ───────────────────────────────────────────────────────────
console.log('\n[4] 소스 계약');
const entrySrc = read('src/lib/store/useStoreEntryStore.ts');
check('4-1 탭 처리가 pushTapPlan 을 쓴다', /pushTapPlan\(/.test(nativeSrc));
check('4-2 콜드 스타트: getLastNotificationResponseAsync 를 한 번 처리하고 지운다',
  /getLastNotificationResponseAsync\(\)/.test(nativeSrc) && /clearLastNotificationResponseAsync\(\)/.test(nativeSrc));
check('4-3 알림 id(request.identifier)로 중복 처리를 막는다', /request\.identifier/.test(nativeSrc));
check('4-4 다른 매장 알림은 useStoreEntryStore.enter({ ..., then }) 로 들어간다',
  /useStoreEntryStore/.test(nativeSrc) && /then:\s*plan\.then/.test(nativeSrc));
check('4-5 enter 가 then 을 받아 전환 뒤 역할로 이동한다',
  /then\?:\s*string/.test(entrySrc) && /routeForRole\(then, useSessionStore\.getState\(\)\.role\)/.test(entrySrc));
check('4-6 enter 는 여전히 switchUnit 으로 바꾼다(tenantReset 이 데이터를 비운다)', /sess\.switchUnit\(uid\)/.test(entrySrc));

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail > 0 ? 1 : 0);
