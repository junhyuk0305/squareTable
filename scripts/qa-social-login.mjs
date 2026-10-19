#!/usr/bin/env node
// qa-social-login.mjs — 구글 로그인 버튼 노출 판정과 앱 구글 로그인 배선 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 Q1: 안드 앱에서 "Google로 계속하기"를 누르면 무한 로딩이었다.
//   signInWithGoogle 이 앱에 없는 window.location 을 읽다 던졌고, onGoogle 에 finally 가 없어 busy 가 풀리지 않았다.
// ★2026-10-05 근본 수정(Supabase 공식 Expo 방식): 앱은 squaretable://auth/callback 으로 돌아오게 하고
//   WebBrowser.openAuthSessionAsync 로 구글 창을 연 뒤, 돌아온 주소의 code 를 세션으로 바꾼다.
//   그래서 안드 앱에 버튼을 다시 보인다. iOS 는 Guideline 4.8(Apple 로그인) 때문에 계속 숨긴다.
// 실행: node scripts/qa-social-login.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const fn = (f) => typeof f === 'function';
const read = (p) => { try { return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'); } catch { check(`${p} 를 읽는다`, false); return ''; } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const load = async (p) => { try { return await import(p); } catch (e) { console.log('  FAIL 모듈을 읽지 못했다', p, String(e && e.code ? e.code : e)); fail++; return {}; } };
const { socialLoginVisible } = await load('../src/lib/config/social-login.ts');
const { googleRedirectTo, callbackCode } = await load('../src/lib/auth/googleRedirect.ts');

console.log('\n■ 구글 로그인 버튼 — 웹·안드 앱에서 보인다, iOS 앱은 숨긴다');
const vis = (os) => (fn(socialLoginVisible) ? socialLoginVisible(os) : undefined);
check("★socialLoginVisible('android') === true (앱 구글 로그인 복구)", vis('android') === true, `→ ${vis('android')}`);
check("socialLoginVisible('ios') === false (Guideline 4.8)", vis('ios') === false, `→ ${vis('ios')}`);
check("socialLoginVisible('web') === true (웹은 그대로)", vis('web') === true, `→ ${vis('web')}`);

console.log('\n■ 돌아올 주소 — window.location 이 없어도 던지지 않는다');
{
  const noLocation = () => { throw new TypeError("Cannot read property 'origin' of undefined"); };
  const nativeUrl = () => 'squaretable://auth/callback';
  let r, threw = null;
  try { r = fn(googleRedirectTo) ? googleRedirectTo('android', { origin: noLocation, nativeUrl }) : undefined; } catch (e) { threw = e; }
  check('★안드: location 없이도 예외 없이 앱 주소를 준다', !threw && r === 'squaretable://auth/callback', `→ ${threw ? threw.message : r}`);
  threw = null;
  try { r = fn(googleRedirectTo) ? googleRedirectTo('web', { origin: noLocation, nativeUrl }) : undefined; } catch (e) { threw = e; }
  check('웹인데 location 이 없으면 예외 대신 null', !threw && r === null, `→ ${threw ? threw.message : r}`);
  r = fn(googleRedirectTo) ? googleRedirectTo('web', { origin: () => 'https://dochackchack.com', nativeUrl }) : undefined;
  check('웹은 지금처럼 현재 오리진', r === 'https://dochackchack.com', `→ ${r}`);
}

console.log('\n■ 돌아온 주소에서 code 읽기');
{
  const c = (u) => (fn(callbackCode) ? callbackCode(u) : undefined);
  check('?code= 를 읽는다', c('squaretable://auth/callback?code=abc-123') === 'abc-123', `→ ${c('squaretable://auth/callback?code=abc-123')}`);
  check('다른 값 사이의 code 도 읽는다', c('squaretable://auth/callback?state=x&code=q%2Bz#') === 'q+z');
  check('code 가 없으면 null', c('squaretable://auth/callback?error=access_denied') === null);
}

console.log('\n■ 소스 계약');
{
  const app = JSON.parse(read('app.json') || '{}');
  check("app.json scheme = 'squaretable'", app?.expo?.scheme === 'squaretable', `→ ${app?.expo?.scheme}`);
  const g = strip(read('src/lib/auth/googleNative.ts'));
  check('파일 상단에서 WebBrowser.maybeCompleteAuthSession()', /^[\s\S]{0,600}WebBrowser\.maybeCompleteAuthSession\(\);/.test(g));
  check("redirectTo = Linking.createURL('auth/callback')", /Linking\.createURL\('auth\/callback'\)/.test(g));
  check('skipBrowserRedirect: true 로 주소만 받는다', /signInWithOAuth\(\{[\s\S]*provider:\s*'google'[\s\S]*skipBrowserRedirect:\s*true/.test(g));
  check('openAuthSessionAsync(data.url, redirectTo)', /openAuthSessionAsync\(data\.url,\s*redirectTo\)/.test(g));
  check('success 일 때만 exchangeCodeForSession(code)', /type === 'success'/.test(g) && /exchangeCodeForSession\(code\)/.test(g));
  const ss = strip(read('src/lib/store/useSessionStore.ts'));
  const sg = (ss.match(/signInWithGoogle: async[\s\S]*?\n  \},/) || [''])[0];
  check('★store: 앱은 window.location 을 읽지 않고 네이티브 경로로 간다', /googleNativeSignIn\(/.test(sg) && /googleRedirectTo\(/.test(sg) && !/window\.location\.origin\s*:/.test(sg));
  check('store: 앱 로그인 뒤 기존 성공 경로(loadProfile)', /loadProfile\(/.test(sg));
  const btn = strip(read('src/components/SocialAuthButtons.tsx'));
  check('버튼: try/finally 로 로딩을 푼다', /try \{[\s\S]*\} finally \{/.test(btn));
  check('버튼: 앱에서 로그인되면 루트로 간다', /router\.replace\('\/'\)/.test(btn));
  const pkg = JSON.parse(read('package.json') || '{}');
  check('expo-web-browser 가 의존성에 있다', !!pkg?.dependencies?.['expo-web-browser']);
}

// ★2026-10-20: 구글 로그인이 끊겨 세션 없이 /?code= 로 돌아오면 소개 페이지(welcome.html)로 말없이 튕겼다.
//   (실사례: 앱에서 시작 → Redirect URLs 에 앱 주소가 없어 웹으로 떨어짐 → 가입을 처음부터 다시 함.)
//   이제 로그인 화면(/login?oauth=lost)으로 보내 구글을 한 번 더 누르게 한다. 정상 복귀는 그대로다.
console.log('\n■ 끊긴 구글 복귀 — 소개 페이지 대신 로그인 화면으로');
{
  const { isLostOAuthReturn, OAUTH_LOST_HREF } = await load('../src/lib/auth/googleRedirect.ts');
  check('isLostOAuthReturn: ?code= 를 잡는다', isLostOAuthReturn?.('?code=abc', '') === true);
  check('isLostOAuthReturn: ?error= 를 잡는다(구글 창 취소)', isLostOAuthReturn?.('?error=access_denied&error_description=x', '') === true);
  check('isLostOAuthReturn: #error= 도 잡는다', isLostOAuthReturn?.('', '#error=server_error') === true);
  check('isLostOAuthReturn: 흔적 없으면 false', isLostOAuthReturn?.('', '') === false && isLostOAuthReturn?.('?utm_source=ig', '') === false);
  check('OAUTH_LOST_HREF = /login?oauth=lost', OAUTH_LOST_HREF === '/login?oauth=lost');

  // 빌드 후 주입되는 인라인 스크립트를 실제로 만들어 돌린다(임시 폴더 · 저장소 dist 는 건드리지 않는다).
  // ★rmSync({recursive}) 는 한글 사용자 경로(Windows · Node 24)에서 프로세스를 말없이 죽인다(exit 127) → 하나씩 지운다.
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync, rmdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const vm = await import('node:vm');
  const t = mkdtempSync(join(tmpdir(), 'sqt-inject-'));
  let inline = '';
  try {
    mkdirSync(join(t, 'scripts')); mkdirSync(join(t, 'src', 'data'), { recursive: true }); mkdirSync(join(t, 'dist'));
    copyFileSync(new URL('./inject-landing-redirect.mjs', import.meta.url), join(t, 'scripts', 'inject-landing-redirect.mjs'));
    copyFileSync(new URL('../src/data/marketing-paths.json', import.meta.url), join(t, 'src', 'data', 'marketing-paths.json'));
    writeFileSync(join(t, 'dist', 'index.html'), '<html><head></head><body></body></html>');
    execFileSync(process.execPath, [join(t, 'scripts', 'inject-landing-redirect.mjs')], { stdio: 'ignore' });
    inline = (readFileSync(join(t, 'dist', 'index.html'), 'utf8').match(/<script id="sqt-landing-redirect">([\s\S]*?)<\/script>/) || ['', ''])[1];
  } finally {
    for (const f of ['scripts/inject-landing-redirect.mjs', 'src/data/marketing-paths.json', 'dist/index.html']) { try { unlinkSync(join(t, f)); } catch {} }
    for (const d of ['scripts', 'src/data', 'src', 'dist', '']) { try { rmdirSync(join(t, d)); } catch {} }
  }
  check('인라인 스크립트가 주입된다', inline.length > 0);
  const runInline = (path, search, keys) => {
    let to = null;
    const store = keys.map((k) => [k, 'x']);
    const ctx = {
      location: { pathname: path, search, hash: '', replace: (u) => { to = u; } },
      localStorage: { length: store.length, key: (i) => (store[i] ? store[i][0] : null) },
    };
    vm.runInNewContext(inline, ctx);
    return to;
  };
  const SESSION = 'sb-ref-auth-token', VERIFIER = 'sb-ref-auth-token-code-verifier';
  check('★세션·짝 값 없이 /?code= → /login?oauth=lost', runInline('/', '?code=abc', []) === '/login?oauth=lost', `→ ${runInline('/', '?code=abc', [])}`);
  check('★세션 없이 /?error= → /login?oauth=lost', runInline('/', '?error=access_denied', []) === '/login?oauth=lost');
  check('흔적 없는 미로그인 / → /welcome.html (그대로)', runInline('/', '', []) === '/welcome.html');
  check('★웹에서 시작한 정상 복귀(짝 값 있음) → 이동 없음(앱이 code 를 교환)', runInline('/', '?code=abc', [VERIFIER]) === null);
  check('로그인된 / → 이동 없음', runInline('/', '', [SESSION]) === null);

  const idx = strip(read('src/app/index.tsx'));
  check('index: 첫 주소는 모듈 로드 때 잡는다(교환 뒤 주소가 지워져도 판정 유지)', /let bootOAuthLost =[\s\S]*?isLostOAuthReturn\(window\.location\.search, window\.location\.hash\)/.test(idx));
  check('★index: 로그인되면 지운다(정상 로그인 → 로그아웃 뒤 잘못된 안내 금지)', /status === 'signed_in'\) \{\s*bootOAuthLost = false;/.test(idx));
  check('index: 웹 미로그인 분기가 끊긴 복귀면 로그인 화면으로', /window\.location\.replace\(bootOAuthLost \? OAUTH_LOST_HREF : '\/welcome\.html'\)/.test(idx));
  const lg = strip(read('src/app/login.tsx'));
  check('login: ?oauth=lost 면 안내 문구로 시작한다', /\.oauth === 'lost'/.test(lg) && /useState<string \| null>\(oauthLost \? OAUTH_LOST_TEXT : null\)/.test(lg));
  check('login: 끊긴 복귀를 계측한다(oauth_return_lost)', /track\('oauth_return_lost'\)/.test(lg));
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
