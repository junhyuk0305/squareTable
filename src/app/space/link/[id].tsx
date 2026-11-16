/**
 * 교육 링크 상세(S11 · 공간 주인) — 상태 · 주소 복사 · 노하우 넣기·빼기 · 기간 늘리기 · 링크 닫기.
 *
 * 들어오는 길 = 교육 탭의 링크 줄 · 만들기 뒤 바로(2026-11-16 R-4). 공간 번호는 `?unit=` 으로 받는다.
 * 본문은 매장 교육 링크(M06)와 같이 쓰는 부품 `components/edu/LinkForm` 에 있다(2026-11-12 g7 · 동작 같음).
 */
import { useLocalSearchParams } from 'expo-router';

import { EduLinkDetailForm } from '@/components/edu/LinkForm';
import { fetchEduLinkPickEntries } from '@/lib/db';

export default function EduLinkDetailScreen() {
  const { id, unit } = useLocalSearchParams<{ id: string; unit?: string }>();
  const linkId = typeof id === 'string' ? id : '';
  const unitId = typeof unit === 'string' ? unit : '';
  return <EduLinkDetailForm unitId={unitId} linkId={linkId} loadPick={fetchEduLinkPickEntries} />;
}
