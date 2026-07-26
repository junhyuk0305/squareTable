// 허브 → 매장 화면 이동 공통 훅 — "다른 매장이면 활성 전환 완료 후 이동" 규칙(useCrossNotifRows.openRow 와 동일).
// 전환 실패 시 이동하지 않는다(이전 매장을 그 매장인 줄 알고 보는 무음 오류 방지 — 07-24 switchUnit 수정 계보).
import { useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';

export function useStoreNav() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const [switching, setSwitching] = useState<string | null>(null);

  /** mode='push': 허브로 뒤로가기 유지(서브화면 진입). 'replace': 매장 앱 완전 진입(stores 카드와 동일). */
  const goStore = async (uid: string, path: Href, mode: 'push' | 'replace' = 'push') => {
    if (switching) return;
    if (uid !== unitId) {
      setSwitching(uid);
      const { error } = await switchUnit(uid);
      setSwitching(null);
      if (error) {
        showToast(error, 'warn');
        return;
      }
    }
    if (mode === 'replace') router.replace(path);
    else router.push(path);
  };

  return { goStore, switching };
}
