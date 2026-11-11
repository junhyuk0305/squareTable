/**
 * 교육 링크 만들기(S10 · 공간 주인) — 노하우 고르기 · 기간 · 제목(선택) → 만들기 → 주소 복사.
 *
 * ★아직 들어오는 길이 없다(공간 입구가 꺼져 있다 · 의도). 들어올 때 공간 번호를 `?unit=` 으로 받는다.
 *   공간 노하우는 RLS(0371)가 "지금 들어가 있는 공간"(auth_space_id)일 때만 내준다.
 * 본문은 매장 교육 링크(M06)와 같이 쓰는 부품 `components/edu/LinkForm` 에 있다(2026-11-12 g7 · 동작 같음).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { EduLinkNewForm } from '@/components/edu/LinkForm';
import { fetchEduLinkPickEntries } from '@/lib/db';

export default function EduLinkNewScreen() {
  const router = useRouter();
  const { unit } = useLocalSearchParams<{ unit?: string }>();
  const unitId = typeof unit === 'string' ? unit : '';
  return (
    <EduLinkNewForm
      unitId={unitId}
      loadPick={fetchEduLinkPickEntries}
      onOpenDetail={(id) => router.replace({ pathname: '/space/link/[id]', params: { id, unit: unitId } })}
    />
  );
}
