#!/usr/bin/env node
// qa-landing.mjs — 로그인한 사람의 첫 화면(Q27 · P5-9). 백엔드 없음 · 계정을 만들지 않는다.
//
// 무엇을 보나
//   [1] 순수 함수(src/lib/nav/landing.ts 를 그대로 import · 로직 복제 없음)
//       · landingFor({ brandId, hqConsole, hasStore }) — 앱(본사 화면 없음)에서 본사 담당자가 자기 매장도 있으면 /hub.
//         매장이 없는 본사 담당자는 지금처럼 /hq(앱에서는 안내 한 장). 웹은 지금처럼 본사 담당자면 /hq.
//   [2] index.tsx — 프로필 완성 · 다운그레이드 다음에 landingFor 로 고른다. 매장 유무는 stores(my_units)로 센다.
//       unitId 는 보지 않는다(본사 편집기가 작업실을 활성 매장으로 세운다 · 0215).
//   [3] hq/_layout.tsx — 앱 안내에 매장이 있으면 [내 매장으로](/hub)를 로그아웃과 함께 보인다.
//       웹 동작(무자격 안내 · /stores)과 SHOW_OWNER_WEB_SHELL 은 그대로다.
// 수정 전에는 landing.ts 가 없으므로 **지금 앱의 판정**(brandId 가 있으면 무조건 /hq)으로 같은 표를 돌린다.
//   모듈이 없어서가 아니라 판정이 틀려서 RED 다.
// 실행: node scripts/qa-landing.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const read = (p) => {
  const u = new URL(`../${p}`, import.meta.url);
  return existsSync(u) ? readFileSync(u, 'utf8').replace(/\r\n/g, '\n') : '';
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const load = async (p) => {
  try { return await import(p); } catch (e) { console.log('  (모듈 없음)', p, String(e && e.code ? e.code : e)); return null; }
};

const M = await load('../src/lib/nav/landing.ts');

// ── 지금 앱의 판정(수정 전 폴백) ─────────────────────────────────────────
// 지금 index.tsx 는 플랫폼 · 매장 유무와 상관없이 brandId 가 있으면 /hq, 아니면 /hub 다.
const idx0 = strip(read('src/app/index.tsx'));
const legacyLanding = /if \(brandId\) return <Redirect href="\/hq" \/>;\n\s+return <Redirect href="\/hub" \/>;/.test(idx0)
  ? ({ brandId }) => (brandId ? '/hq' : '/hub')
  : null;
const landingFor = M && typeof M.landingFor === 'function'
  ? M.landingFor
  : (console.log('  (landingFor 없음 → 지금 앱 판정으로 실행)'), legacyLanding);

// ── [1] 순수 함수 ─────────────────────────────────────────────────────
console.log('\n[1] landingFor');
const L = (a) => (landingFor ? landingFor(a) : undefined);
const APP = false; // 스토어 앱 = SHOW_HQ_CONSOLE false
const WEB = true;
check('★1-1 앱 · 본사 담당자 겸 직영 사장 = /hub', L({ brandId: 'b1', hqConsole: APP, hasStore: true }) === '/hub', show(L({ brandId: 'b1', hqConsole: APP, hasStore: true })));
check('1-2 앱 · 매장 없는 본사 담당자 = /hq(안내 한 장 · 지금과 같다)', L({ brandId: 'b1', hqConsole: APP, hasStore: false }) === '/hq', show(L({ brandId: 'b1', hqConsole: APP, hasStore: false })));
check('1-3 웹 · 본사 담당자 겸 사장 = /hq(웹은 바꾸지 않는다)', L({ brandId: 'b1', hqConsole: WEB, hasStore: true }) === '/hq');
check('1-4 웹 · 본사 담당자 = /hq', L({ brandId: 'b1', hqConsole: WEB, hasStore: false }) === '/hq');
check('1-5 앱 · 매장 사장 · 직원 = /hub', L({ brandId: '', hqConsole: APP, hasStore: true }) === '/hub' && L({ brandId: null, hqConsole: APP, hasStore: true }) === '/hub');
check('1-6 앱 · 매장이 아직 없는 계정(합류 대기 등) = /hub(지금과 같다)', L({ brandId: '', hqConsole: APP, hasStore: false }) === '/hub');
check('1-7 웹 · 본사 아님 = /hub', L({ brandId: '', hqConsole: WEB, hasStore: true }) === '/hub' && L({ brandId: '', hqConsole: WEB, hasStore: false }) === '/hub');
check('1-8 [내 매장으로] 문구는 계획 그대로', M?.HQ_TO_STORE_LABEL === '내 매장으로', show(M?.HQ_TO_STORE_LABEL));
const lt = read('src/lib/nav/landing.ts');
check('1-9 landing.ts 는 순수 함수다(react-native · 세션 store 를 import 하지 않는다)', lt.length > 0 && !/from 'react-native'|useSessionStore/.test(lt));

// ── [2] index.tsx ─────────────────────────────────────────────────────
console.log('\n[2] index.tsx');
const idx = strip(read('src/app/index.tsx'));
check('★2-1 첫 화면을 landingFor 로 고른다(brandId 면 무조건 /hq 가 아니다)',
  /landingFor\(\{[^}]*brandId[^}]*\}\)/.test(idx) && !/if \(brandId\) return <Redirect href="\/hq" \/>/.test(idx));
check('★2-2 hqConsole 은 SHOW_HQ_CONSOLE 상수에서 읽는다(Platform.OS 직접 판정 아님)', /hqConsole: SHOW_HQ_CONSOLE/.test(idx));
check('★2-3 매장 유무는 stores(my_units)로 센다 · unitId 는 안 본다(작업실 제외 · 0215)', /hasStore: stores\.length > 0/.test(idx));
const pIdx = idx.indexOf('needsProfileSetup({'), dIdx = idx.indexOf('if (needsDowngradeChoice)'), lIdx = idx.indexOf('landingFor({');
check('2-4 순서 = 프로필 완성 → 다운그레이드 → landingFor', pIdx > 0 && dIdx > pIdx && lIdx > dIdx, show([pIdx, dIdx, lIdx]));
check('2-5 미로그인 웹 → /welcome.html, 앱 → /login 은 그대로', /window\.location\.replace\('\/welcome\.html'\)/.test(idx) && /<Redirect href="\/login" \/>/.test(idx));

// ── [3] hq/_layout.tsx ───────────────────────────────────────────────
console.log('\n[3] hq/_layout.tsx');
const hq = strip(read('src/app/hq/_layout.tsx'));
const nativeBranch = (hq.match(/if \(!SHOW_HQ_CONSOLE\) \{[\s\S]*?\n {2}\}/) || [''])[0];
check('★3-1 앱 안내에 매장이 있으면 [내 매장으로] → /hub', /HQ_TO_STORE_LABEL/.test(nativeBranch) && /href: '\/hub'/.test(nativeBranch) && /stores\.length > 0/.test(nativeBranch), show(nativeBranch.slice(0, 200)));
check('3-2 앱 안내의 로그아웃은 그대로 있다', /label: '로그아웃'/.test(nativeBranch) && /logout\(\)/.test(nativeBranch));
check('3-3 앱 안내는 unitId 로 매장을 세지 않는다(작업실 제외)', nativeBranch.length > 0 && !/unitId/.test(nativeBranch));
check('3-4 웹 무자격 안내([내 매장으로] → /stores · [로그인 화면으로])는 그대로', /label: '내 매장으로', href: '\/stores'/.test(hq) && /label: '로그인 화면으로', href: '\/login'/.test(hq));
check('3-5 안내 제목 · 본문 문구는 그대로', /title="본사 기능은 웹에서 써요"/.test(hq) && /body="본사 대시보드는 넓은 화면 전용이에요\. 컴퓨터 브라우저로 로그인해 주세요\."/.test(hq));

// ── [4] 바꾸지 않는 것 ─────────────────────────────────────────────────
console.log('\n[4] 그대로 둘 것');
const sp = read('src/lib/config/store-policy.ts');
check('4-1 SHOW_OWNER_WEB_SHELL = false · SHOW_HQ_CONSOLE = !IS_NATIVE', /export const SHOW_OWNER_WEB_SHELL = false;/.test(sp) && /export const SHOW_HQ_CONSOLE = !IS_NATIVE;/.test(sp));
const shell = read('src/components/shell/AppShell.web.tsx');
check('4-2 웹 셸 분기(본사 셸 · 사장 웹 셸)는 그대로', /if \(SHOW_HQ_CONSOLE && \(pathname === '\/hq' \|\| pathname\.startsWith\('\/hq\/'\)\)\)/.test(shell) && /if \(SHOW_OWNER_WEB_SHELL && status === 'signed_in' && canManage\(role\)\)/.test(shell));

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
