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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
