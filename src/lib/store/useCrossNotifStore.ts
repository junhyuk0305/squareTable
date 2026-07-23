// 통합 알림(cross-store) 원시 데이터 스토어 — stores 허브 카드 뱃지·알림 화면 '전체 매장' 탭이 공유.
// 원시 묶음(UnitNotifData)만 보관하고 판정·목록은 화면이 crossStoreNotifs 유틸로 파생한다.
// RLS 는 활성 매장만 노출하므로 realtime 불가 — 허브/알림 화면 진입 시점 fetch 로 갱신(폴링 온 포커스).
import { create } from 'zustand';
import { fetchCrossStoreNotifData, updateFeed, type UnitNotifData } from '@/lib/db';

type State = {
  data: UnitNotifData[];
  loaded: boolean;
  /** 허브·알림 화면 진입 시 호출 — 실패 시 조용히 기존 데이터 유지(뱃지는 보조 지표, fetchOwnerOverview 와 동일 취급). */
  hydrate: () => Promise<void>;
  /** 공지·멘션 읽음처리(read_by) — 통합 목록/뱃지 즉시 반영(낙관적) + DB 기록.
   *  ⚠️ writeDb=true 는 그 매장이 "활성"일 때만 성공한다(wf_update RLS) — 크로스 행은 switchUnit 완료 후 호출.
   *  활성 매장 행은 기존 경로(workStore.markNoticeRead)가 DB 를 쓰므로 writeDb=false 로 로컬만 동기화. */
  markFeedRead: (unitId: string, feedId: string, me: string, writeDb?: boolean) => Promise<void>;
};

export const useCrossNotifStore = create<State>((set, get) => ({
  data: [],
  loaded: false,

  hydrate: async () => {
    const { data, error } = await fetchCrossStoreNotifData();
    if (error || !data) return;
    set({ data, loaded: true });
  },

  markFeedRead: async (unitId, feedId, me, writeDb = true) => {
    const prev = get().data;
    const d = prev.find((x) => x.unitId === unitId);
    const item = d?.feed.find((f) => f.id === feedId);
    if (!d || !item || (item.read_by ?? []).includes(me)) return;
    const updated = { ...item, read_by: [...(item.read_by ?? []), me] };
    set({
      data: prev.map((x) =>
        x.unitId === unitId ? { ...x, feed: x.feed.map((f) => (f.id === feedId ? updated : f)) } : x,
      ),
    });
    if (writeDb && !(await updateFeed(updated))) set({ data: prev }); // 무음 유실 방지 — 실패 시 롤백
  },
}));
