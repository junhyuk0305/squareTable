// spaceTarget.ts — 공간에서 막 나온 순간을 공간 _layout 에 알린다(4번 덩이 · verify 고려 1).
// 나가기·공간 지우기·매장으로 돌아가기는 화면을 옮기고 앱의 공간 상태를 비운다. 그 사이 공간 _layout 이 한 번 더 그려지면
//   주소(?space= · /space/joined/<번호>)의 공간에 다시 들어가려 한다(서버 거절 → 경고 토스트). 몇 초 동안 그 공간은 건너뛴다.
let left: { id: string; at: number } | null = null;
const HOLD_MS = 3000;

/** 이 공간에서 막 나왔다. */
export function markSpaceLeft(id: string): void {
  left = id ? { id, at: Date.now() } : null;
}

/** 막 나온 공간이라 다시 들어가지 않는다. */
export function justLeftSpace(id: string): boolean {
  return !!left && left.id === id && Date.now() - left.at < HOLD_MS;
}

/**
 * 확인 중에 공간을 가리키는 주소로 왔다(알림·벨·딥링크). 확인 중 공간 _layout 이 null 을 그리는 동안 경로가 /space 로 바뀌어
 * ?space= 와 /space/joined/<번호> 가 사라진다(11-11 실측). 레이아웃이 경로마다 다시 마운트돼 ref 로는 값이 사라진다 → 모듈에 둔다.
 */
export type PendingSpace = { space: string; path: string; href: string };
let pending: PendingSpace | null = null;
export function rememberSpaceTarget(p: PendingSpace | null): void {
  pending = p;
}
export function pendingSpaceTarget(): PendingSpace | null {
  return pending;
}
