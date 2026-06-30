// 충돌 방지 유일 id — 같은 ms에 여러 번 호출돼도 모듈 단일 카운터로 유일성을 보장한다.
// (Date.now() 단독은 같은 밀리초 내 두 번 호출 시 충돌. 스토어마다 흩어져 있던 _seq/_n
//  카운터를 하나로 모아, 카운터 없이 Date.now()만 쓰던 곳(useChatStore)의 잠재 버그도 제거.)
let _seq = 0;

export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${_seq++}`;
}
