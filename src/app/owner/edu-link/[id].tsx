/**
 * 매장 교육 링크 상세(M06 · 사장·매니저) — 넣기·빼기 · 기간 · 링크 닫기. 공간 S11 과 같은 부품(components/edu/LinkForm)이다.
 * 담을 목록은 본사 노하우를 뺀다(0555). 닫기는 스위치와 상관없이 늘 된다(서버 edu_link_close 판정 없음 · 가결정).
 */
import { useLocalSearchParams } from 'expo-router';

import { EduLinkDetailForm } from '@/components/edu/LinkForm';
import { useStorePickNote } from '@/components/edu/LinkFormStore';
import { fetchStoreEduLinkPickEntries } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';

export default function StoreEduLinkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const linkId = typeof id === 'string' ? id : '';
  const unitId = useSessionStore((s) => s.unitId) ?? '';
  const pickNote = useStorePickNote(unitId);
  return (
    <EduLinkDetailForm unitId={unitId} linkId={linkId} loadPick={fetchStoreEduLinkPickEntries} pickNote={pickNote} />
  );
}
