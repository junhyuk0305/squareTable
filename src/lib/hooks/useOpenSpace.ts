// 공간으로 가는 길 하나(2026-11-16 · R-1) — 매장 탭 [공간] 칸(SpaceTabPanel)과 상단 전환 칩(StoreToggle)이 같이 쓴다.
//   · 내 공간(주인) = 들어가기(enter_space) → /space/home. 실패하면 문구 토스트.
//   · 참여 중인 공간(멤버) = /space/joined/<번호>(S17 · 공간 _layout 이 그 번호로 들어간다).
import { useState } from 'react';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import type { MySpace } from '@/lib/db';

export function useOpenSpace() {
  const router = useRouter();
  const enterSpace = useSessionStore((s) => s.enterSpace);
  /** 들어가는 중인 공간 번호('' = 없음). 두 번 누르기를 막는다. */
  const [busy, setBusy] = useState('');

  const open = async (s: MySpace) => {
    if (busy) return;
    if (s.role !== 'space_owner') {
      router.push({ pathname: '/space/joined/[id]', params: { id: s.id } });
      return;
    }
    setBusy(s.id);
    const { error } = await enterSpace(s.id);
    setBusy('');
    if (error) return showToast(error, 'warn');
    router.replace('/space/home');
  };

  return { open, busy };
}
