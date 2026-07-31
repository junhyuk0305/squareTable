// joinRejectDetect.ts — 합류 거절 감지 판정(#미아 방지) SSOT
//
// 서버 reject_member 는 profiles.pending_unit_id 만 지울 뿐 신청자에게 아무 신호가 없다
// (푸시 엣지 audience='user' 는 비멤버 대상 전송을 거부해 거절 푸시도 불가). 그래서 신청 시점에
// 기기 로컬 마커를 남기고, 프로필 로드 때 "대기가 사라졌는데 그 매장 소속도 아니면 거절"로 판정한다.
// 판정만 여기 순수함수(SSOT)로 두고, 저장(localStorage)·상태 반영은 useSessionStore 가 한다.
//
// ★pendingServer 는 profiles.pending_unit_id 원시값이어야 한다 — 세션 pendingUnitId 는 소속 매장이
//   있으면 마스킹되므로, 그걸 쓰면 "기존 직원의 2호점 신청 중"을 대기 소멸로 오인해 거짓 거절이 뜬다.
//
// 순수함수(무의존)라 실행 러너 없이 node type-strip 으로 진리표를 회귀 테스트한다.
//   scripts/qa-session-readfail.mjs (npm run qa:session)

export type JoinMarker = { unitId: string; storeName: string; rejected?: boolean };

export type JoinRejectAction =
  | { kind: 'none' } // 마커 없음 / 신청 유지 / 판정 보류 — 아무것도 안 함
  | { kind: 'refresh'; marker: JoinMarker } // 재신청·다른 매장 신청 — 거절 표시 철회, 마커 교체
  | { kind: 'clear' } // 승인돼 소속이 생김 — 마커 제거
  | { kind: 'show'; storeName: string } // 이미 거절 확정된 마커 — 안내 유지(닫기 전까지)
  | { kind: 'reject'; marker: JoinMarker; storeName: string }; // 거절 확정 — 마커에 기록 + 안내

export function joinRejectAction(
  marker: JoinMarker | null,
  pendingServer: string, // profiles.pending_unit_id 원시값(위 ★ 참고)
  unitId: string, // 활성/주 매장 id('' = 무소속)
  memberUnitIds: string[], // my_units 로 확인된 소속 매장 id 목록
  storesReadFailed: boolean, // 소속 목록 읽기 실패 → "소속 없음"으로 위장 금지, 부정 판정 보류
  storeNameHint = '', // 대기 매장 이름 힌트(세션 pendingStoreName) — 마커 신규 생성 시 표시용
): JoinRejectAction {
  if (pendingServer) {
    // 신청이 살아 있음 — 마커가 없으면 지금 생성(다른 기기에서 신청해도, 대기 상태를 한 번이라도
    // 본 기기는 거절을 감지할 수 있게). 같은 매장이면 유지, 재신청/다른 매장이면 교체(거절 표시 철회).
    if (!marker) return { kind: 'refresh', marker: { unitId: pendingServer, storeName: storeNameHint } };
    if (marker.rejected || marker.unitId !== pendingServer) {
      return {
        kind: 'refresh',
        marker: { unitId: pendingServer, storeName: marker.unitId === pendingServer ? marker.storeName : storeNameHint },
      };
    }
    return { kind: 'none' };
  }
  if (!marker) return { kind: 'none' };
  if (marker.rejected) return { kind: 'show', storeName: marker.storeName };
  if (marker.unitId === unitId || memberUnitIds.includes(marker.unitId)) return { kind: 'clear' };
  if (storesReadFailed) return { kind: 'none' };
  return { kind: 'reject', marker: { ...marker, rejected: true }, storeName: marker.storeName };
}
