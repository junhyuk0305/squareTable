/**
 * 매장 교육 링크 만들기(M06 · 사장·매니저). 공간 S10 과 같은 부품(components/edu/LinkForm)이다.
 * 담을 목록 = fetchStoreEduLinkPickEntries(본사 노하우 빼기 · 서버 _edu_link_check_entries 와 같은 조건 · 0555).
 * 자리 = 지금 매장(세션 unitId). 스위치가 꺼진 계정은 서버가 feature_off 로 막는다(문구 = placeErrorMessage).
 * 주소로 바로 와도 스위치가 꺼졌으면 목록으로 돌려보낸다(목록과 같은 판정 useStoreEduLinksOn · 1112 fix 7).
 *   상세([id])는 막지 않는다. 링크 닫기는 스위치와 상관없이 늘 된다.
 */
import { Redirect, useRouter } from 'expo-router';

import { EduLinkNewForm } from '@/components/edu/LinkForm';
import { useStoreEduLinksOn, useStorePickNote } from '@/components/edu/LinkFormStore';
import { fetchStoreEduLinkPickEntries } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';

export default function StoreEduLinkNewScreen() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId) ?? '';
  const pickNote = useStorePickNote(unitId);
  const on = useStoreEduLinksOn();
  if (on === false) return <Redirect href="/owner/edu-link" />;
  return (
    <EduLinkNewForm
      unitId={unitId}
      loadPick={fetchStoreEduLinkPickEntries}
      pickNote={pickNote}
      onOpenDetail={(id) => router.replace({ pathname: '/owner/edu-link/[id]', params: { id } })}
    />
  );
}
