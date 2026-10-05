#!/usr/bin/env node
// qa-boot-fault.mjs — 신호가 약할 때 앱을 켜도 로그인 화면으로 튕기지 않는다(Q26 · P5-6). 백엔드 없음.
//
// 무엇을 보나
//   [1] 순수 함수 sessionBootFault({ error, hasSession }) 진리표 — 부팅 실패를 오프라인/세션 없음/기타로 가른다
//       (src/lib/store/sessionBootFault.ts 를 임시 트랜스파일해 실제 함수로 검증 · 로직 복제 없음).
//       오류 표본은 손으로 흉내 내지 않고 실제 라이브러리에서 만든다:
//         auth-js AuthRetryableFetchError·AuthApiError·AuthSessionMissingError 클래스,
//         postgrest-js 가 닫힌 포트·RN 식 fetch 실패에서 돌려주는 실제 { error }.
//   [2] auth-js isAuthRetryableFetchError 와 판정이 같은가(인증 오류 표본 전부).
//   [3] 소스 계약 — useSessionStore 가 getSession 오류를 버리지 않고, 오프라인이면 신원은 비우되
//       sessionCheck:'offline' 을 남기며 기기 세션을 지우지 않는다. 첫 INITIAL_SESSION(null)이 그 표시를
//       덮지 않는다. index.tsx 는 /login·welcome 으로 보내기 전에 연결 안내와 두 버튼을 보여 준다.
// 수정 전에는 모듈이 없으므로 **지금 앱의 판정**(실패하면 무조건 signed_out → 로그인 화면)으로 같은 표를
//   돌린다 — 모듈이 없어서가 아니라 판정이 틀려서 RED 다.
// 실행: node scripts/qa-boot-fault.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'boot-fault');
const require = createRequire(join(root, 'package.json'));
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
  return import(pathToFileURL(fp) + `?t=${Date.now()}`);
};

// ── 실제 라이브러리 오류 표본 ───────────────────────────────────────────────
const auth = require('@supabase/auth-js');
const { PostgrestClient } = require('@supabase/postgrest-js');

// 닫힌 포트(연결 거부) — Node fetch 의 실제 실패.
const closedPort = await new PostgrestClient('http://127.0.0.1:9/rest/v1', { retry: false })
  .from('profiles').select('id').eq('id', 'x').maybeSingle();
// RN fetch 가 던지는 문구 그대로.
const rnFetch = async () => { throw new TypeError('Network request failed'); };
const rnOffline = await new PostgrestClient('http://x/rest/v1', { fetch: rnFetch, retry: false })
  .from('profiles').select('id').eq('id', 'x').maybeSingle();
// 서버가 응답한 실패 — 토큰 만료(PGRST301)·서버 오류.
const respond = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwtExpired = await new PostgrestClient('http://x/rest/v1', { fetch: respond(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null }), retry: false })
  .from('profiles').select('id').eq('id', 'x').maybeSingle();
const server500 = await new PostgrestClient('http://x/rest/v1', { fetch: respond(500, { code: 'XX000', message: 'internal', details: null, hint: null }), retry: false })
  .from('profiles').select('id').eq('id', 'x').maybeSingle();

console.log('  (표본) 닫힌 포트 →', JSON.stringify({ message: closedPort.error?.message, code: closedPort.error?.code }));
console.log('  (표본) RN 오프라인 →', JSON.stringify({ message: rnOffline.error?.message, code: rnOffline.error?.code }));

// ── [1] 진리표 ────────────────────────────────────────────────────────────
console.log('\n[1] sessionBootFault 진리표');
const M = await load('src/lib/store/sessionBootFault.ts', 'sessionBootFault.js');
let sessionBootFault = M && typeof M.sessionBootFault === 'function' ? M.sessionBootFault : null;
if (!sessionBootFault) {
  console.log('  (sessionBootFault 없음 → 지금 앱 판정으로 실행: 세션이 없으면 로그인 화면, 읽기가 실패하면 signed_out)');
  sessionBootFault = ({ hasSession }) => (hasSession ? 'other' : 'no_session');
}
const retryable0 = new auth.AuthRetryableFetchError('Network request failed', 0);
const retryable503 = new auth.AuthRetryableFetchError('Service Unavailable', 503);
const apiBadRefresh = new auth.AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found');
const missing = new auth.AuthSessionMissingError();

const rows = [
  // 오프라인 → 연결 안내(기기 세션 유지)
  ['getSession: 토큰 만료 + 오프라인(AuthRetryableFetchError status 0) → offline', { error: retryable0, hasSession: false }, 'offline'],
  ['getSession: 갱신 중 503(AuthRetryableFetchError) → offline', { error: retryable503, hasSession: false }, 'offline'],
  ['프로필 읽기: 닫힌 포트(PostgREST code "") → offline', { error: closedPort.error, hasSession: true }, 'offline'],
  ['프로필 읽기: RN "Network request failed"(PostgREST code "") → offline', { error: rnOffline.error, hasSession: true }, 'offline'],
  ['프로필 읽기가 던짐: RN TypeError → offline', { error: new TypeError('Network request failed'), hasSession: true }, 'offline'],
  ['프로필 읽기가 던짐: 웹 Chrome "Failed to fetch" → offline', { error: new TypeError('Failed to fetch'), hasSession: true }, 'offline'],
  ['프로필 읽기가 던짐: 웹 Safari "Load failed" → offline', { error: new TypeError('Load failed'), hasSession: true }, 'offline'],
  ['프로필 읽기가 던짐: 웹 Firefox NetworkError → offline', { error: new TypeError('NetworkError when attempting to fetch resource.'), hasSession: true }, 'offline'],
  // 세션 없음 → 로그인 화면
  ['저장된 세션 없음(오류 없음) → no_session', { error: null, hasSession: false }, 'no_session'],
  ['getSession: 리프레시 토큰 없음(AuthApiError 400) → no_session', { error: apiBadRefresh, hasSession: false }, 'no_session'],
  ['getSession: AuthSessionMissingError → no_session', { error: missing, hasSession: false }, 'no_session'],
  // 그 밖 → 지금처럼 signed_out(가짜 테넌트 금지)
  ['프로필 읽기: 401 JWT expired(PGRST301) → other', { error: jwtExpired.error, hasSession: true }, 'other'],
  ['프로필 읽기: 500(XX000) → other', { error: server500.error, hasSession: true }, 'other'],
  ['코드 버그 TypeError(Cannot read properties) → other(연결 안내로 숨기지 않는다)', { error: new TypeError("Cannot read properties of undefined (reading 'id')"), hasSession: true }, 'other'],
  ['문자열·undefined 오류 → other', { error: 'boom', hasSession: true }, 'other'],
];
for (const [name, input, want] of rows) {
  let got;
  try { got = sessionBootFault(input); } catch (e) { got = `throw ${e?.message}`; }
  check(name, got === want, got === want ? '' : `(got ${got})`);
}

// ── [2] auth-js 판정과 같다 ─────────────────────────────────────────────────
console.log('\n[2] auth-js isAuthRetryableFetchError 와 같은 판정');
for (const [label, err] of [['status 0', retryable0], ['503', retryable503], ['AuthApiError 400', apiBadRefresh], ['SessionMissing', missing]]) {
  const lib = auth.isAuthRetryableFetchError(err);
  const ours = sessionBootFault({ error: err, hasSession: false }) === 'offline';
  check(`${label}: 라이브러리 ${lib} = 우리 ${ours}`, lib === ours);
}

// ── [3] 소스 계약 ──────────────────────────────────────────────────────────
console.log('\n[3] 소스 계약');
const store = read('src/lib/store/useSessionStore.ts');
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return j < 0 ? s.slice(i) : s.slice(i, j); };
const signedOut = between(store, 'const SIGNED_OUT', '};');
const loadProfileSrc = between(store, 'async function loadProfile(', '\n}\n');
const readFailBlock = between(loadProfileSrc, 'if (profileErr) {', '\n    }\n');
const catchBlock = between(loadProfileSrc, '} catch (e) {', '\n  }\n');
const initSrc = between(store, 'init: async () => {', 'signInWithPassword: async');

check('스토어가 sessionBootFault 를 쓴다', /import \{ sessionBootFault \} from '\.\/sessionBootFault'/.test(store));
check('SIGNED_OUT 은 sessionCheck 를 ok 로 되돌린다(로그아웃하면 안내가 사라진다)', /sessionCheck:\s*'ok'/.test(signedOut));
check('SIGNED_OUT 은 여전히 신원·매장을 비운다(격리)', /userId:\s*''/.test(signedOut) && /unitId:\s*''/.test(signedOut) && /role:\s*'junior'/.test(signedOut));
check('프로필 읽기 실패(리셋 경로)가 오프라인을 가른다', /sessionBootFault\(\{\s*error:\s*profileErr/.test(readFailBlock) && /sessionCheck:\s*'offline'/.test(readFailBlock));
check('프로필 읽기 실패: 같은 사용자 보존(keep) 판정이 먼저다', readFailBlock.indexOf("=== 'keep'") > -1 && readFailBlock.indexOf("=== 'keep'") < readFailBlock.indexOf('sessionBootFault('));
check('프로필 읽기가 던질 때(catch)도 오프라인을 가른다', /sessionBootFault\(\{\s*error:\s*e\b/.test(catchBlock) && /sessionCheck:\s*'offline'/.test(catchBlock));
check('오프라인 경로는 기기 세션을 지우지 않는다(signOut 없음)', !/auth\.signOut/.test(readFailBlock) && !/auth\.signOut/.test(catchBlock));
check('init 이 getSession 오류를 버리지 않는다', /const \{ data(?:: \w+)?, error(?:: \w+)? \} = await supabase\.auth\.getSession\(\)/.test(initSrc) && /sessionBootFault\(/.test(initSrc));
check('첫 INITIAL_SESSION(null)이 init 판정을 덮지 않는다', /'INITIAL_SESSION'/.test(initSrc));
check('상태 타입에 sessionCheck 가 있다', /sessionCheck:\s*'ok'\s*\|\s*'offline'/.test(store));

const index = read('src/app/index.tsx');
const OFFLINE_TEXT = '인터넷 연결이 불안정해요. 연결되면 바로 다시 들어가요.';
check('안내 문구(계획 글자 그대로)', index.includes(OFFLINE_TEXT));
check('[다시 시도] 버튼', index.includes('>다시 시도<'));
check('[다른 계정으로 로그인] 버튼 → signOut', index.includes('>다른 계정으로 로그인<') && /signOut\(\)/.test(index));
const offlineAt = index.search(/status === 'signed_out' && sessionCheck === 'offline'/);
check('signed_out + offline 분기가 있다', offlineAt > -1);
check('오프라인 분기가 웹 welcome 이동보다 먼저다', offlineAt > -1 && offlineAt < index.indexOf("window.location.replace('/welcome.html')"));
check('오프라인 분기가 네이티브 /login 이동보다 먼저다', offlineAt > -1 && offlineAt < index.indexOf('<Redirect href="/login" />'));
check('앱이 다시 켜지면(AppState active) 다시 시도한다', /AppState\.addEventListener\('change'/.test(index) && /'active'/.test(index));
check('자동 재시도 간격 5초 → 30초', /5000/.test(index) && /30000/.test(index));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
