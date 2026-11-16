// 공간 노하우 카테고리(0780) — 공간 노하우 탭(목록·카테고리 편집)과 공간 쓰기 화면(저장 시트 선택지)이 같이 쓴다.
// 매장은 usePlaybookStore.customCategories 를 쓴다. 공간은 매장 스토어를 hydrate 하지 않으므로(space/_layout 머리말) 공간 번호로 따로 읽는다.
// ★못 읽었으면 customs = null 이고 저장을 막는다. 빈 목록으로 믿고 저장하면 목록을 통째로 덮어써 카테고리가 지워진다(매장 #21 과 같은 규칙).
import { useCallback, useEffect, useState } from 'react';

import { fetchKnowhowCategories, saveKnowhowCategories } from '@/lib/db';
import { resolveCustomCategories, sanitizeCustomCategories, type CustomCategory } from '@/lib/store/knowhowCategories';

export function useSpaceKnowhowCategories(spaceId: string) {
  const [state, setState] = useState<{ id: string; customs: CustomCategory[] | null }>({ id: '', customs: null });

  useEffect(() => {
    if (!spaceId) return;
    let alive = true;
    void fetchKnowhowCategories(spaceId).then(({ data, error }) => {
      if (!alive) return;
      // 못 읽으면 지난 값을 둔다(같은 공간이면). 처음 읽기가 실패하면 null 그대로 = 편집 막힘.
      setState((s) => (error ? (s.id === spaceId ? s : { id: spaceId, customs: null }) : { id: spaceId, customs: resolveCustomCategories(data) }));
    });
    return () => { alive = false; };
  }, [spaceId]);

  const save = useCallback(
    async (items: CustomCategory[]): Promise<boolean> => {
      if (!spaceId || state.id !== spaceId || state.customs === null) return false;
      const cleaned = sanitizeCustomCategories(items);
      const ok = await saveKnowhowCategories(cleaned, spaceId);
      if (ok) setState((s) => (s.id === spaceId ? { id: spaceId, customs: cleaned } : s));
      return ok;
    },
    [spaceId, state.id, state.customs],
  );

  return { customs: state.id === spaceId ? state.customs : null, save };
}
