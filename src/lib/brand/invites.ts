// invites.ts — 본사 매장 초대 목록의 화면용 거르기(대시보드 '확인 필요' 숫자 · 초대 대기 화면이 같이 쓴다).
//
// 만료 행은 지워지지 않고 취소도 안 된다(0214 는 pending 만 닫는다). 그래서 만료를 전부 세면 칸이 영원히 켜진다.
// → 같은 번호로 나중에 다시 보낸 초대가 있으면 그 만료는 처리된 것으로 본다. 두 화면의 숫자가 어긋나지 않게 여기 한 곳에 둔다.
import type { BrandInviteRow } from '@/lib/brand/brandDb';

/** 아직 대기 중인 매장 초대. */
export function pendingStoreInvites(invites: BrandInviteRow[]): BrandInviteRow[] {
  return invites.filter((i) => i.kind === 'store' && i.status === 'pending');
}

/**
 * 만료됐고 같은 번호로 다시 보내지 않은 매장 초대.
 * 나중 초대의 결과는 묻지 않는다 — 수락(연결됨)·거절(점주가 답함)·취소(본사가 거둠) 모두 그 번호의 일은 이미 처리됐다.
 * phone 은 서버가 정규화한 값이다(0210 phone_norm). 글자 비교로 충분하다.
 */
export function openExpiredStoreInvites(invites: BrandInviteRow[]): BrandInviteRow[] {
  const store = invites.filter((i) => i.kind === 'store');
  return store.filter(
    (i) => i.status === 'expired' && !store.some((j) => j.id !== i.id && j.phone === i.phone && j.created_at > i.created_at),
  );
}
