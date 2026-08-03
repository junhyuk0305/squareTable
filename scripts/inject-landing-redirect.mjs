#!/usr/bin/env node
// inject-landing-redirect.mjs — 빌드 후 dist/index.html <head> 최상단에 랜딩 리다이렉트를 주입한다.
//
// 왜 빌드 후 주입인가: web.output='single' 모드에서 Expo는 +html.tsx를 무시하고 기본 index.html을
//   생성한다(head는 앱이 런타임 주입). 따라서 "번들이 그려지기 전에" 도는 인라인 스크립트를 넣으려면
//   export 산출물에 직접 주입해야 한다. 이게 없으면 미로그인 방문자가 앱 SPA(460 프레임)를 잠깐 본 뒤
//   index.tsx가 client-side로 튕겨 '좁은 폰 UI 로딩 플래시'가 생긴다.
//
// 동작 ①: 루트('/')에서 Supabase 세션 토큰(localStorage sb-*-auth-token)이 없으면 정적 마케팅
//   페이지(/welcome.html)로 즉시 replace. welcome.html은 정적 파일이라 이 스크립트가 없어 되돌이표 없음.
//   로그인 상태면 토큰이 있어 그대로 앱이 뜬다(→ /stores). 네이티브 빌드와는 무관(웹 export 전용).
// 동작 ②(안전망): 마케팅 경로(/features /pricing /faq /inquiry)로 SPA가 뜨면 **로그인 여부와 무관하게**
//   대응하는 정적 .html로 즉시 replace. 원래는 vercel.json rewrite가 정적 파일을 직접 서빙해 SPA가
//   로드될 일이 없지만, rewrite가 없는 환경(개발 서버·설정 누락)에서도 "웹=웹 레이아웃만" 원칙이
//   깨지지 않도록 이중으로 막는다. 앱 전환은 오직 로그인 이후 실무 화면에서만.
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
  `<script id="${MARK}">(function(){try{` +
  `var p=location.pathname.replace(/\\/+$/,'')||'/';` +
  `if(p==='/features'||p==='/pricing'||p==='/faq'||p==='/inquiry'){location.replace(p+'.html');return;}` +
  `if(p==='/'){` +
  `for(var i=0,s=0;i<localStorage.length;i++){var k=localStorage.key(i);` +
  `if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')!==-1){s=1;break;}}` +
  `if(!s){location.replace('/welcome.html');}}}catch(e){}})();</script>`;

html = html.replace('<head>', '<head>' + script);
writeFileSync(file, html);
console.log('inject-landing-redirect: dist/index.html <head>에 랜딩 리다이렉트 주입 완료');
