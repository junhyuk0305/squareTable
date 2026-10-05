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

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
