#!/usr/bin/env node
// inject-landing-redirect.mjs — 빌드 후 dist/index.html <head> 최상단에 랜딩 리다이렉트를 주입한다.
//
// 왜 빌드 후 주입인가: web.output='single' 모드에서 Expo는 +html.tsx를 무시하고 기본 index.html을
//   생성한다(head는 앱이 런타임 주입). 따라서 "번들이 그려지기 전에" 도는 인라인 스크립트를 넣으려면
//   export 산출물에 직접 주입해야 한다. 이게 없으면 미로그인 방문자가 앱 SPA(460 프레임)를 잠깐 본 뒤
//   index.tsx가 client-side로 튕겨 '좁은 폰 UI 로딩 플래시'가 생긴다.
//
// 동작: 루트('/')에서 Supabase 세션 토큰(localStorage sb-*-auth-token)이 없으면 정적 마케팅
//   페이지(/welcome.html)로 즉시 replace. welcome.html은 정적 파일이라 이 스크립트가 없어 되돌이표 없음.
//   로그인 상태면 토큰이 있어 그대로 앱이 뜬다(→ /stores). 네이티브 빌드와는 무관(웹 export 전용).
//
// vercel buildCommand 체인: `npx expo export -p web && node scripts/inject-landing-redirect.mjs`
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'dist', 'index.html');
const MARK = 'sqt-landing-redirect';

if (!existsSync(file)) {
  console.error('inject-landing-redirect: dist/index.html 없음 — expo export -p web 먼저 실행'); process.exit(1);
}
let html = readFileSync(file, 'utf8');
if (html.includes(MARK)) { console.log('inject-landing-redirect: 이미 주입됨(skip)'); process.exit(0); }
if (!html.includes('<head>')) { console.error('inject-landing-redirect: <head> 없음 — 템플릿 변경 확인'); process.exit(1); }

const script =
  `<script id="${MARK}">(function(){try{if(location.pathname==='/'){` +
  `for(var i=0,s=0;i<localStorage.length;i++){var k=localStorage.key(i);` +
  `if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')!==-1){s=1;break;}}` +
  `if(!s){location.replace('/welcome.html');}}}catch(e){}})();</script>`;

html = html.replace('<head>', '<head>' + script);
writeFileSync(file, html);
console.log('inject-landing-redirect: dist/index.html <head>에 랜딩 리다이렉트 주입 완료');
