#!/usr/bin/env node
// qa-session-readfail.mjs — Finding B 회귀 가드: loadProfile 읽기실패 시 "보존 vs 리셋" 진리표 고정.
//
// 왜 있나: 읽기 실패(supabase-js {error})를 무시하면 빈 신원이 signed_in 으로 세팅돼 사장→직원 무음
//   강등·대기직원 pending 유실이 난다(§4.8·§4.10). 이 판정을 sessionReadFailAction 순수함수(SSOT)로
//   분리했고, 이 스크립트가 그 진리표를 못박아 누가 로직을 되돌리면 즉시 FAIL 한다.
//   (client-state 로직이라 실 백엔드 QA로는 못 잡는다 → 순수함수 단위 회귀로 커버.)
// 실행: node scripts/qa-session-readfail.mjs   (Node 24 type-strip 로 .ts 직접 import)
import { sessionReadFailAction } from '../src/lib/store/sessionReadFail.ts';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };

const UID = 'user_abc';

// ── 핵심 불변식: 이미 확립된 '같은 사용자' 세션은 일시적 읽기실패에 보존한다(무음 강등 차단) ──
check('signed_in + 같은 유저 → keep(보존)',
  sessionReadFailAction({ status: 'signed_in', userId: UID }, UID) === 'keep');

// ── 그 외는 전부 reset(가짜 테넌트 금지, 깨끗한 signed_out) ──
check('signed_in + 다른 유저 → reset',
  sessionReadFailAction({ status: 'signed_in', userId: 'someone_else' }, UID) === 'reset');
check('signed_out(콜드 로드) → reset',
  sessionReadFailAction({ status: 'signed_out', userId: '' }, UID) === 'reset');
check('loading(부팅 중) → reset',
  sessionReadFailAction({ status: 'loading', userId: '' }, UID) === 'reset');
check('signed_in 이지만 로딩 대상 userId 빈값 → reset(신원 미확정)',
  sessionReadFailAction({ status: 'signed_in', userId: '' }, '') === 'reset');
check('signed_in 인데 prior.userId 만 있고 대상 다름 → reset',
  sessionReadFailAction({ status: 'signed_in', userId: UID }, 'other') === 'reset');

// ══ 합류 거절 감지 진리표 (joinRejectDetect.ts, #미아 방지) ══════════════
// 서버 reject 는 pending 만 지워 신청자에게 신호가 없다 → 기기 마커 vs 서버 상태 대조 판정을 못박는다.
const { joinRejectAction } = await import('../src/lib/store/joinRejectDetect.ts');
const M = (over = {}) => ({ unitId: 'store_B', storeName: '나나카페', ...over });

check('마커 없음 + pending 없음 → none(감지 생략)',
  joinRejectAction(null, '', '', [], false).kind === 'none');
check('마커 없음 + pending 살아있음 → refresh(마커 생성 — 타기기 신청도 이 기기서 감지)', (() => {
  const a = joinRejectAction(null, 'store_B', '', [], false, '나나카페');
  return a.kind === 'refresh' && a.marker.unitId === 'store_B' && a.marker.storeName === '나나카페';
})());
check('신청 유지(pending=마커 매장) → none',
  joinRejectAction(M(), 'store_B', '', [], false).kind === 'none');
check('다른 매장 재신청 → refresh(마커 교체·이름 초기화)', (() => {
  const a = joinRejectAction(M(), 'store_C', '', [], false);
  return a.kind === 'refresh' && a.marker.unitId === 'store_C' && a.marker.storeName === '';
})());
check('거절 후 같은 매장 재신청 → refresh(거절 표시 철회·이름 보존)', (() => {
  const a = joinRejectAction(M({ rejected: true }), 'store_B', '', [], false);
  return a.kind === 'refresh' && a.marker.rejected !== true && a.marker.storeName === '나나카페';
})());
check('승인됨(주매장=마커 매장) → clear',
  joinRejectAction(M(), '', 'store_B', ['store_B'], false).kind === 'clear');
check('승인됨(2호점: 소속 목록에 포함) → clear',
  joinRejectAction(M(), '', 'store_A', ['store_A', 'store_B'], false).kind === 'clear');
check('거절(무소속·pending 소멸·소속 아님) → reject + 안내', (() => {
  const a = joinRejectAction(M(), '', '', [], false);
  return a.kind === 'reject' && a.marker.rejected === true && a.storeName === '나나카페';
})());
check('★2호점 신청 중(기존 직원, pending 살아있음) → none — 거짓 거절 금지(P0 회귀)',
  joinRejectAction(M(), 'store_B', 'store_A', ['store_A'], false).kind === 'none');
check('소속 목록 읽기 실패 → none(부정 판정 보류)',
  joinRejectAction(M(), '', 'store_A', [], true).kind === 'none');
check('이미 거절 확정 마커 → show(닫기 전까지 유지)', (() => {
  const a = joinRejectAction(M({ rejected: true }), '', '', [], false);
  return a.kind === 'show' && a.storeName === '나나카페';
})());

// ══ 세션 역할 진리표 (sessionRole.ts, 2026-10-04) ══════════════════════
// 역할 = 활성 매장 멤버십(my_units). profiles.role(계정 유형)은 입력에 아예 없다 — 넣을 자리가 없어야 다시 안 샌다.
const { deriveStoreRole } = await import('../src/lib/store/sessionRole.ts');
const R = (over = {}) => deriveStoreRole({
  userId: UID,
  unitId: 'u_b',
  rows: [{ unit_id: 'u_a', role: 'owner' }, { unit_id: 'u_b', role: 'junior' }],
  prior: { userId: UID, unitId: 'u_b', role: 'junior' },
  ...over,
});

check('★X 케이스: A매장 사장 + B매장 직원, 활성 B → junior', R() === 'junior');
check('X 케이스: 활성 A → owner', R({ unitId: 'u_a' }) === 'owner');
check('활성 매장 매니저 → manager',
  R({ rows: [{ unit_id: 'u_b', role: 'manager' }] }) === 'manager');
check('활성 매장 행 없음(본사 작업실·소속 해제 직후) → junior(fail-closed)',
  R({ rows: [{ unit_id: 'u_a', role: 'owner' }] }) === 'junior');
check('모르는 역할 값 → junior', R({ rows: [{ unit_id: 'u_b', role: 'superuser' }] }) === 'junior');
check('활성 매장 없음 → junior(사장 계정이어도 매장 권한은 없다)', R({ unitId: '' }) === 'junior');
check('목록 읽기 실패 + 같은 사용자·같은 매장 → 직전 역할 유지',
  R({ unitId: 'u_a', rows: null, prior: { userId: UID, unitId: 'u_a', role: 'owner' } }) === 'owner');
check('★목록 읽기 실패 + 매장이 바뀜 → junior(이전 매장 역할을 빌리지 않는다)',
  R({ unitId: 'u_b', rows: null, prior: { userId: UID, unitId: 'u_a', role: 'owner' } }) === 'junior');
check('★목록 읽기 실패 + 계정이 바뀜 → junior(이전 계정 역할을 빌리지 않는다)',
  R({ unitId: 'u_a', rows: null, prior: { userId: 'someone_else', unitId: 'u_a', role: 'owner' } }) === 'junior');
check('목록 읽기 실패 + 방금 만든 매장 → owner(create_store 가 owner 멤버십을 넣는다)',
  R({ unitId: 'u_new', rows: null, prior: { userId: '', unitId: '', role: 'junior' }, createdUnitId: 'u_new' }) === 'owner');
check('목록을 읽었으면 방금 만든 매장 표식보다 목록이 이긴다',
  R({ unitId: 'u_new', rows: [], createdUnitId: 'u_new' }) === 'junior');

// ══ G1(QA 2026-10-05): 로그아웃 중 돌던 loadProfile 이 끝나며 로그인 상태로 되살리지 않는다 ══════════
// signOut 은 푸시 해제(최대 4초+4초)를 기다린 뒤 세션을 지운다. 그 사이 30초 새로고침이 loadProfile 을 시작하면,
// 세션이 지워진 뒤에 끝나며 set({status:'signed_in', userId: 옛 id}) 로 덮었다. 로그아웃 세대 번호로 늦은 응답을 버린다.
// (스토어는 supabase 클라이언트를 물고 있어 노드에서 못 띄운다 → 배선을 소스에서 확인한다.)
{
  const { readFileSync } = await import('node:fs');
  const ss = readFileSync(new URL('../src/lib/store/useSessionStore.ts', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');
  const lp = (ss.match(/async function loadProfile\([\s\S]*?\n}\n/) || [''])[0];
  const gen = lp.match(/const (\w+) = _signOutGen;/);
  const genVar = gen ? gen[1] : '__none__';
  const firstAwait = lp.indexOf('await ');
  check('★G1 loadProfile 이 첫 await 전에 로그아웃 세대를 잡는다', !!gen && lp.indexOf(gen[0]) > 0 && lp.indexOf(gen[0]) < firstAwait);
  const finalSet = lp.indexOf('setUnitId(unitId || null);');
  const guard = new RegExp(`if \\(${genVar} !== _signOutGen\\) return;`, 'g');
  const guards = [...lp.matchAll(guard)].map((m) => m.index);
  check('★G1 마지막 set(signed_in) 직전에 세대가 바뀌었으면 버린다', finalSet > 0 && guards.some((i) => i < finalSet && finalSet - i < 200));
  check('G1 늦게 끝난 실패 경로도 새 로그인을 signed_out 으로 덮지 않는다', guards.length >= 3);
  const so = (ss.match(/signOut: async \(\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('★G1 signOut 이 SIGNED_OUT 을 쓰기 전에 세대를 올린다', /_signOutGen \+= 1;\s*setUnitId\(null\);\s*set\(SIGNED_OUT\);/.test(so));
  const da = (ss.match(/deleteAccount: async \(\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('G1 탈퇴도 SIGNED_OUT 을 쓰기 전에 세대를 올린다', /_signOutGen \+= 1;\s*setUnitId\(null\);\s*set\(SIGNED_OUT\);/.test(da));
  const auth = (ss.match(/onAuthStateChange\([\s\S]*?\n      \}\);/) || [''])[0];
  check('G1 다른 탭 로그아웃·토큰 만료(SIGNED_OUT 이벤트)도 세대를 올린다', /_signOutGen \+= 1;[\s\S]*?set\(SIGNED_OUT\);/.test(auth));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
