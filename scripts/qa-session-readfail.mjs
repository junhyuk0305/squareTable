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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
