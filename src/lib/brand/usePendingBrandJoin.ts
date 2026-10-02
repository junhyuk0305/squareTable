// usePendingBrandJoin.ts — 담당자 초대 링크(`/hq/join?token=`)의 수락을 **로그인이 선 뒤** 한 번 실행한다.
//
// 가입·로그인 화면은 그대로다(구현계획 §4 "가입 RPC 재정의 금지"·착지는 index 하나). 링크로 온 사람은
// 토큰을 브라우저에 맡겨 두고 가입/로그인을 마치면, 어느 화면에 떨어지든 이 훅이 토큰을 집어
// `accept_brand_member_invite` 를 부르고 세션을 다시 읽어 `/hq` 로 보낸다.
// 웹 전용(본사 화면은 웹에만 있다) — AppShell.web 이 부른다. 네이티브에는 이 경로가 없다.
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { acceptBrandMemberInvite } from '@/lib/brand/brandDb';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { reportError } from '@/lib/analytics/track';

const KEY = 'st_brand_join_token';

/** 브라우저 저장소 — 네이티브(이 라우트가 번들에는 실린다)에선 null. 저장 불가 브라우저도 null. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
export function readPendingBrandJoin(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}
export function savePendingBrandJoin(token: string) {
  try {
    storage()?.setItem(KEY, token);
  } catch {
    /* 저장 불가 브라우저 — 로그인 상태면 join 화면이 바로 수락한다 */
  }
}
export function clearPendingBrandJoin() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** 토큰 하나를 수락하고 세션을 갱신한다. 성공하면 true. 실패 사유는 토스트로 말한다(무음 실패 금지). */
export async function acceptPendingBrandJoin(token: string): Promise<boolean> {
  const err = await acceptBrandMemberInvite(token);
  clearPendingBrandJoin(); // 성공이든 실패든 같은 토큰을 다시 시도하지 않는다(만료·사용됨은 재시도해도 같다)
  if (err) {
    reportError('brand.join.accept', err);
    const code = (err.message ?? '').split(/[\s:]/)[0];
    showToast(
      code === 'invite_expired'
        ? '초대 링크가 만료됐어요. 본사 담당자에게 새 링크를 받아 주세요.'
        : code === 'invite_invalid'
          ? '이미 쓰였거나 잘못된 초대 링크예요.'
          : '초대를 수락하지 못했어요. 잠시 뒤 다시 열어 주세요.',
      'warn',
    );
    return false;
  }
  await useSessionStore.getState().refreshMembership();
  return true;
}

export function usePendingBrandJoin() {
  const status = useSessionStore((s) => s.status);
  const brandId = useSessionStore((s) => s.brandId);
  const router = useRouter();
  useEffect(() => {
    if (status !== 'signed_in') return;
    const token = readPendingBrandJoin();
    if (!token) return;
    if (brandId) {
      // 이미 담당자 — 토큰은 버린다(세션 brandId 는 하나뿐이라 두 번째 브랜드는 화면이 없다).
      clearPendingBrandJoin();
      return;
    }
    void acceptPendingBrandJoin(token).then((ok) => {
      if (ok) router.replace('/hq');
    });
  }, [status, brandId, router]);
}
