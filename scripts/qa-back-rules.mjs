#!/usr/bin/env node
// qa-back-rules.mjs — 안드로이드 뒤로가기를 상식대로(J13 · P5-5). 백엔드 없음.
//
// 무엇을 보나
//   [1] 순수 함수 backAction(path, ctx) — 설계 05 §4 "뒤로가기 지도"를 표 한 줄씩 단정한다
//       (src/lib/nav/backRules.ts 를 임시 트랜스파일해 실제 함수로 검증 · 로직 복제 없음).
//       ctx = { entering(매장 진입 커버 중), canDismiss(가까운 스택에 이전 화면), role(세션 역할), origin(들어오기 전 허브 탭) }
//       결과 = 'default'(OS 기본 · 앱 종료) | 'consume'(무시) | 'pop'(이전 화면) | '/경로'(그 화면으로 replace)
//   [2] 화면 안 가로채기 스택(src/lib/nav/backIntercept.ts) — 나중에 연 패널이 먼저 닫힌다(LIFO).
//   [3] 소스 계약 — 루트 _layout 이 안드에서만 BackHandler 를 걸고, 가로채기 → 규칙표 순서로 처리한다.
//       업무 채팅 패널(WorkBoard)과 매뉴얼 올리기 2단계(handover)가 가로채기 훅을 쓴다.
//       app.json predictiveBackGestureEnabled 줄은 그대로 있다. iOS·웹은 바꾸지 않는다.
// 수정 전에는 모듈이 없으므로 **지금 앱의 동작**(BackHandler 없음 = react-navigation 기본:
//   이전 화면이 있으면 pop, 없으면 앱 종료)으로 같은 표를 돌린다 — 모듈이 없어서가 아니라 판정이 틀려서 RED 다.
// 실행: node scripts/qa-back-rules.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { rm } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'back-rules');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n') : '');
const tsc = (files) => {
  try {
    execFileSync('npx', ['tsc', ...files,
      '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
      '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
    ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
  } catch { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }
};
const load = async (src, name) => {
  if (!existsSync(join(root, src))) return null;
  tsc([src]);
  const fp = join(OUT, name);
  if (!existsSync(fp)) return null;
  writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
  return import(pathToFileURL(fp));
};

// src 전체에서 BackHandler 를 쓰는 곳 — 지금은 0건(설계 05 §4 근거).
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const usesBackHandler = walk(join(root, 'src')).some((p) => /BackHandler\s*\.\s*addEventListener/.test(readFileSync(p, 'utf8')));

// ── [1] 규칙표 ────────────────────────────────────────────────────────────
console.log('\n[1] backAction 규칙표');
const B = await load('src/lib/nav/backRules.ts', 'backRules.js');
let backAction = B && typeof B.backAction === 'function' ? B.backAction : null;
if (!backAction && !usesBackHandler) {
  console.log('  (backAction 없음 → 지금 앱 판정으로 실행: react-navigation 기본 = 이전 화면이 있으면 pop, 없으면 앱 종료)');
  backAction = (_path, ctx) => (ctx.canDismiss ? 'pop' : 'default');
}
const ctx = (o = {}) => ({ entering: false, canDismiss: false, role: 'owner', origin: null, ...o });
const rows = [
  // 매장 진입 커버 중 → 무시
  ['커버 중 허브 매장 탭 → 무시', '/stores', ctx({ entering: true, role: 'junior' }), 'consume'],
  ['커버 중 매장 화면 위(이전 화면 있음)도 → 무시', '/owner/knowledge', ctx({ entering: true, canDismiss: true }), 'consume'],
  // 서브화면(push) → 이전 화면
  ['사장 서브화면(노하우 목록) → 이전 화면', '/owner/knowledge', ctx({ canDismiss: true }), 'pop'],
  ['직원 서브화면(근무표) → 이전 화면', '/junior/schedule', ctx({ canDismiss: true, role: 'junior' }), 'pop'],
  ['허브에서 연 알림 화면 → 이전 화면', '/notifications', ctx({ canDismiss: true, role: 'junior' }), 'pop'],
  // 매니저가 설정에서 연 사장 화면 → 이전 화면
  ['매니저가 연 근무표(/owner/schedule) → 이전 화면', '/owner/schedule', ctx({ canDismiss: true, role: 'manager' }), 'pop'],
  // 푸시로 들어온 화면(enter 가 홈 replace 뒤 push) → 그 매장 홈(이전 화면)
  ['푸시로 연 화면(홈 위에 push) → 이전 화면', '/owner/inbox', ctx({ canDismiss: true }), 'pop'],
  // 매장 탭(홈 말고) → 그 역할의 매장 홈 탭
  ['사장 노하우 탭 → 사장 홈', '/owner/categories', ctx(), '/owner/dashboard'],
  ['사장 퀴즈 탭 → 사장 홈', '/owner/training', ctx(), '/owner/dashboard'],
  ['사장 업무 채팅 탭 → 사장 홈', '/owner/work', ctx(), '/owner/dashboard'],
  ['사장 설정 탭 → 사장 홈', '/owner/settings', ctx(), '/owner/dashboard'],
  ['직원 물어보기 탭 → 직원 홈', '/junior/chat', ctx({ role: 'junior' }), '/junior/home'],
  ['직원 업무 채팅 탭 → 직원 홈', '/junior/work', ctx({ role: 'junior' }), '/junior/home'],
  ['직원 출퇴근 탭 → 직원 홈', '/junior/attendance', ctx({ role: 'junior' }), '/junior/home'],
  ['직원 설정 탭 → 직원 홈', '/junior/settings', ctx({ role: 'junior' }), '/junior/home'],
  ['매니저 물어보기 탭 → 직원 홈', '/junior/chat', ctx({ role: 'manager' }), '/junior/home'],
  ['매니저 업무 채팅(/owner/work) → 직원 홈(사장 홈 아님)', '/owner/work', ctx({ role: 'manager' }), '/junior/home'],
  ['매니저 설정 탭 → 직원 홈', '/junior/settings', ctx({ role: 'manager' }), '/junior/home'],
  // 매장 홈 → 들어온 허브 탭. 기록이 없으면 /stores
  ['사장 홈(허브 현황에서 들어옴) → /hub', '/owner/dashboard', ctx({ origin: '/hub' }), '/hub'],
  ['사장 홈(허브 노하우에서 들어옴) → /hub-growth', '/owner/dashboard', ctx({ origin: '/hub-growth' }), '/hub-growth'],
  ['사장 홈(매장 탭에서 들어옴) → /stores', '/owner/dashboard', ctx({ origin: '/stores' }), '/stores'],
  ['사장 홈(기록 없음 · 푸시 콜드 스타트) → /stores', '/owner/dashboard', ctx(), '/stores'],
  ['직원 홈(허브 오늘에서 들어옴) → /hub', '/junior/home', ctx({ role: 'junior', origin: '/hub' }), '/hub'],
  ['직원 홈(기록 없음) → /stores', '/junior/home', ctx({ role: 'junior' }), '/stores'],
  ['매니저 홈(매장 탭에서 들어옴) → /stores', '/junior/home', ctx({ role: 'manager', origin: '/stores' }), '/stores'],
  ['홈 origin 이 허브 탭이 아니면(/owner/work) → /stores', '/owner/dashboard', ctx({ origin: '/owner/work' }), '/stores'],
  // 허브 탭 → /hub
  ['허브 노하우(/hub-growth) → /hub', '/hub-growth', ctx(), '/hub'],
  ['허브 매장(/stores) → /hub', '/stores', ctx({ role: 'junior' }), '/hub'],
  // 앱 종료(OS 기본)
  ['허브 홈 /hub → 앱 종료', '/hub', ctx(), 'default'],
  ['매장 없는 직원 /junior/hub → 앱 종료', '/junior/hub', ctx({ role: 'junior' }), 'default'],
  ['로그인 → 앱 종료', '/login', ctx({ role: '' }), 'default'],
  ['앱의 본사 안내 /hq → 앱 종료', '/hq', ctx(), 'default'],
  // 강제 화면 → 앱 종료(우회 금지) · 이전 화면이 있어도 넘기지 않는다
  ['/complete-profile → 앱 종료', '/complete-profile', ctx({ role: 'junior' }), 'default'],
  ['/downgrade → 앱 종료', '/downgrade', ctx(), 'default'],
  ['/downgrade 위로 이전 화면이 있어도 → 앱 종료(우회 금지)', '/downgrade', ctx({ canDismiss: true }), 'default'],
];
for (const [name, path, c, want] of rows) {
  const got = backAction ? backAction(path, c) : '(함수 없음)';
  check(name, got === want, got === want ? '' : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// 허브 탭 판정(origin 기록용)
const hubTabOf = B && typeof B.hubTabOf === 'function' ? B.hubTabOf : null;
check('hubTabOf: 허브 탭 3개만 origin 으로 기록', !!hubTabOf
  && hubTabOf('/hub') === '/hub' && hubTabOf('/hub-growth') === '/hub-growth' && hubTabOf('/stores') === '/stores'
  && hubTabOf('/owner/dashboard') === null && hubTabOf('/junior/hub') === null && hubTabOf('/notifications') === null);

// ── [2] 가로채기 스택(LIFO) ─────────────────────────────────────────────────
console.log('\n[2] 화면 안 가로채기 스택');
const I = await load('src/lib/nav/backIntercept.ts', 'backIntercept.js');
if (!I) {
  check('가로채기 스택 모듈이 있다(업무 채팅 패널·매뉴얼 2단계에서 뒤로 = 앞 단계)', false, '지금은 뒤로가 패널을 건너뛰고 화면을 떠난다');
} else {
  const log = [];
  const offA = I.pushBackIntercept(() => log.push('A'));
  const offB = I.pushBackIntercept(() => log.push('B'));
  check('나중에 연 것이 먼저 받는다', I.runBackIntercept() === true && log.join() === 'B');
  offB();
  check('닫히면 다음 것이 받는다', I.runBackIntercept() === true && log.join() === 'B,A');
  offA();
  check('비면 false(규칙표로 넘어간다)', I.runBackIntercept() === false && log.join() === 'B,A');
  const offC = I.pushBackIntercept(() => log.push('C'));
  const offD = I.pushBackIntercept(() => log.push('D'));
  offC(); // 아래 것이 먼저 빠져도 위 것은 남는다
  check('중간 것이 빠져도 위 것은 그대로', I.runBackIntercept() === true && log.at(-1) === 'D');
  offD(); offD(); // 두 번 빼도 안전
  check('두 번 빼도 다른 것을 지우지 않는다', I.runBackIntercept() === false);
}

// ── [3] 소스 계약 ────────────────────────────────────────────────────────
console.log('\n[3] 소스 계약');
const app = read('app.json');
check('app.json predictiveBackGestureEnabled 줄이 그대로 있다', /"predictiveBackGestureEnabled":\s*false/.test(app));
check('app.json allowBackup 줄이 그대로 있다', /"allowBackup":\s*false/.test(app));
const layout = read('src/app/_layout.tsx');
check('루트 _layout 이 BackRulesBinder 를 그린다', /<BackRulesBinder\s*\/>/.test(layout));
const binder = read('src/components/BackRulesBinder.tsx');
check('바인더가 hardwareBackPress 를 건다', /BackHandler\.addEventListener\(\s*'hardwareBackPress'/.test(binder));
check('바인더는 안드에서만 동작한다(iOS·웹 그대로)', /Platform\.OS\s*!==\s*'android'/.test(binder));
const iRun = binder.indexOf('runBackIntercept()');
const iAct = binder.indexOf('backAction(');
check('처리 순서: 가로채기 → 규칙표', iRun > 0 && iAct > iRun);
check('규칙표에 진입 커버·canDismiss·역할·origin 을 넘긴다',
  /entering/.test(binder) && /router\.canDismiss\(\)/.test(binder) && /useSessionStore/.test(binder) && /hubTabOf\(/.test(binder));
check('pathname 이 바뀔 때마다 다시 걸어 react-navigation 보다 먼저 받는다', /\[[^\]]*pathname[^\]]*\]\s*\)/.test(binder));
const hook = read('src/lib/hooks/useBackIntercept.ts');
check('useBackIntercept 는 화면이 포커스일 때만 건다(가려진 화면의 패널이 받지 않게)', /useFocusEffect/.test(hook) && /pushBackIntercept/.test(hook));
const wb = read('src/components/WorkBoard.tsx');
check('업무 채팅 패널(할일·공지·설정·방 서랍)이 뒤로를 가로챈다', /useBackIntercept\(\s*view !== 'chat'/.test(wb));
const ho = read('src/app/owner/handover.tsx');
check('매뉴얼 올리기 2단계가 뒤로를 가로채 1단계로 간다', /useBackIntercept\(\s*phase === 'review',\s*reset\s*\)/.test(ho));

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail > 0 ? 1 : 0);
