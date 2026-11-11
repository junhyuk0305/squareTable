/**
 * 매장 교육 링크 만들기(M06 · 사장·매니저). 공간 S10 과 같은 부품(components/edu/LinkForm)이다.
 * 담을 목록 = fetchStoreEduLinkPickEntries(본사 노하우 빼기 · 서버 _edu_link_check_entries 와 같은 조건 · 0555).
 * 자리 = 지금 매장(세션 unitId). 스위치가 꺼진 계정은 서버가 feature_off 로 막는다(문구 = placeErrorMessage).
 */
import { useRouter } from 'expo-router';

import { EduLinkNewForm } from '@/components/edu/LinkForm';
import { useStorePickNote } from '@/components/edu/LinkFormStore';
import { fetchStoreEduLinkPickEntries } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';

export default function StoreEduLinkNewScreen() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId) ?? '';
  const pickNote = useStorePickNote(unitId);
  return (
    <EduLinkNewForm
      unitId={unitId}
      loadPick={fetchStoreEduLinkPickEntries}
      pickNote={pickNote}
      onOpenDetail={(id) => router.replace({ pathname: '/owner/edu-link/[id]', params: { id } })}
    />
  );
}
