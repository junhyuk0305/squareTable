#!/usr/bin/env node
// qa-iap-release.mjs — 이용권 줄이기 판정(src/lib/iap/release.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-09-14 결함: 닫을 매장 수를 **구독 매장 수** 기준으로 셌다. 서버 sync_iap_slots(0196)는
//   IAP 로 연 매장을 새 매장 수까지만 연장하고 나머지를 닫는다 — 매장이 새 매장 수 이하이면 닫히는 매장이 없다.
//   그래서 1곳 사장이 3곳을 사고 1~2곳으로 줄이면 "닫을 매장 2곳"을 요구하는데 후보가 1곳뿐이라 버튼이 영원히 안 눌렸다.
// 실행: node scripts/qa-iap-release.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { releaseRule } from '../src/lib/iap/release.ts';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (r) => JSON.stringify(r);

console.log('\n■ 줄이기 — 닫을 매장 수 = 열린 매장 − 새 매장 수 (서버 0196 과 같은 규칙)');
{
  const r = releaseRule({ subscribed: 3, openStores: 1, target: 2, chosen: 0 });
  check('★1곳 사장이 3곳 구독 → 2곳: 닫을 매장 0 · 바로 누를 수 있다', r.isDown && r.needRelease === 0 && r.ready, show(r));
}
{
  const r = releaseRule({ subscribed: 3, openStores: 1, target: 1, chosen: 0 });
  check('★1곳 사장이 3곳 구독 → 1곳: 닫을 매장 0 · 바로 누를 수 있다', r.isDown && r.needRelease === 0 && r.ready, show(r));
}
{
  const r = releaseRule({ subscribed: 2, openStores: 1, target: 1, chosen: 0 });
  check('★하나뿐인 매장을 "닫힘"으로 고르지 않아도 된다(2곳 구독 · 1곳 보유 → 1곳)', r.needRelease === 0 && r.ready, show(r));
}
{
  const r = releaseRule({ subscribed: 3, openStores: 3, target: 1, chosen: 1 });
  check('3곳 보유 → 1곳: 2곳 골라야 한다 — 1곳만 고르면 안 눌린다', r.needRelease === 2 && !r.ready, show(r));
  const r2 = releaseRule({ subscribed: 3, openStores: 3, target: 1, chosen: 2 });
  check('3곳 보유 → 1곳: 2곳 고르면 눌린다', r2.ready, show(r2));
}
{
  const r = releaseRule({ subscribed: 3, openStores: 2, target: 1, chosen: 1 });
  check('2곳 보유 · 3곳 구독 → 1곳: 1곳 고르면 눌린다', r.needRelease === 1 && r.ready, show(r));
}

console.log('\n■ 줄이기가 아닌 경우');
{
  const r = releaseRule({ subscribed: 0, openStores: 2, target: 2, chosen: 0 });
  check('구독 없음 = 줄이기 아님', !r.isDown && r.needRelease === 0 && r.ready, show(r));
  const r2 = releaseRule({ subscribed: 2, openStores: 2, target: 3, chosen: 0 });
  check('늘리기 = 줄이기 아님', !r2.isDown && r2.ready, show(r2));
  const r3 = releaseRule({ subscribed: 2, openStores: 2, target: 2, chosen: 0 });
  check('같은 수 = 줄이기 아님', !r3.isDown, show(r3));
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
