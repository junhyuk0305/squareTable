import { type ReactElement } from 'react';
import { Redirect } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { HAS_SUPABASE } from '@/lib/supabase';

/**
 * 허브 층 화면(`/hub`·`/stores`)의 출입 게이트 — **네 단계가 한 곳에** 있다.
 *
 * 이 화면들은 루트 레벨이라 `owner/_layout`·`junior/_layout` 의 그룹 게이트를 타지 않는다.
 * 그래서 화면마다 같은 4단을 직접 들고 있었고, 한쪽만 고쳐지는 사고가 실제로 있었다
 * (다운그레이드 선택 게이트가 index 에만 있어 `/hub` 로 바로 들어오면 안 걸렸다).
 *
 * 반환 규약: **`undefined` = 통과**(화면을 그대로 그린다). 그 밖에는 반환값을 그대로 return 한다
 * — `null`(세션 확정 전 아무것도 안 그림)과 `<Redirect/>` 를 구분해야 해서 셋으로 나눈다.
 *
 *   const gate = useSessionGate();
 *   …다른 훅·계산…
 *   if (gate !== undefined) return gate;
 *
 * ⚠️ 훅이므로 조건부로 부르지 않는다. 이른 return 은 **다른 훅을 다 부른 뒤**에 둔다.
 */
export function useSessionGate(): ReactElement | null | undefined {
  const status = useSessionStore((s) => s.status);
  const phone = useSessionStore((s) => s.phone);
  const unitId = useSessionStore((s) => s.unitId);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const needsDowngradeChoice = useSessionStore((s) => s.needsDowngradeChoice);
  const brandId = useSessionStore((s) => s.brandId);

  if (!HAS_SUPABASE) return undefined;
  if (status === 'signed_out') return <Redirect href="/" />;
  if (status === 'loading') return null;
  // 소셜 로그인 결손 프로필(전화/생년월일 없음)은 매장을 만들거나 합류하기 전에 완성화면으로.
  if (needsProfileSetup({ status, phone, unitId, pendingUnitId, brandId })) return <Redirect href="/complete-profile" />;
  // 체험이 끝나 무료 한도를 넘긴 것이 있으면 무엇을 남길지 먼저 고른다(0142).
  if (needsDowngradeChoice) return <Redirect href="/downgrade" />;
  return undefined;
}
