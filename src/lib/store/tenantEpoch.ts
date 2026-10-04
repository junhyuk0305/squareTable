// tenantEpoch.ts — 매장·계정이 바뀐 뒤 도착한 응답을 버리는 세대 번호(2026-10-04).
//
// 문제: tenantReset 이 스토어를 비워도, 비우기 **전에** 출발한 hydrate 가 비운 **뒤에** 도착하면
// 이전 매장 행을 loaded=true 로 써 넣는다. 새 hydrate 응답이 올 때까지 다른 매장 데이터가 보인다.
// 해결: tenantReset 이 비울 때마다 번호를 올린다. hydrate 는 첫 await 전에 번호를 잡고,
// await 뒤 번호가 바뀌었으면 set 하지 않고 끝낸다. 비운 뒤 새로 부른 hydrate 는 새 번호를 잡으므로 막히지 않는다.
//
// ⚠️ 이 모듈은 스토어를 import 하지 않는다. tenantReset 이 스토어를 import 하므로
//    스토어가 tenantReset 을 import 하면 순환이 생긴다. 스토어는 여기만 본다.
let _epoch = 0;

/** tenantReset 전용 — 매장·계정 데이터를 비울 때 부른다. */
export function bumpTenantEpoch(): void {
  _epoch += 1;
}

/** 지금 세대 번호. hydrate 의 첫 await **전에** 잡는다. */
export function currentTenantEpoch(): number {
  return _epoch;
}

/** 잡아 둔 번호 뒤로 매장·계정이 바뀌었나. true 면 그 응답은 이전 매장 것이라 쓰지 않는다. */
export function isStaleEpoch(epoch: number): boolean {
  return epoch !== _epoch;
}
