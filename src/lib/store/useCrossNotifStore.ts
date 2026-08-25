// 통합 알림(cross-store) 원시 데이터 스토어 — stores 허브 카드 뱃지·알림 화면 '전체 매장' 탭이 공유.
// 원시 묶음(UnitNotifData)만 보관하고 판정·목록은 화면이 crossStoreNotifs 유틸로 파생한다.
// RLS 는 활성 매장만 노출하므로 realtime 불가 — 허브/알림 화면 진입 시점 fetch 로 갱신(폴링 온 포커스).
import { create } from 'zustand';
import { fetchCrossStoreNotifData, updateFeed, type UnitNotifData } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { HAS_SUPABASE } from '@/lib/supabase';

// 연속 진입(허브→벨 등) 순간 이중 fetch 방지 — 이 간격 안의 재호출은 스킵(포커스 폴링 설계는 유지).
const HYDRATE_TTL_MS = 5_000;
let _lastHydrateAt = 0;

type State = {
  data: UnitNotifData[];
  /** true = 조회 **시도가 끝남**(성공·실패 무관). 실패 여부는 loadError 로 본다. */
  loaded: boolean;
  /** 마지막 hydrate 가 실패했는가 — 화면이 "알림 없음"과 "못 불러옴"을 구분해 재시도 UI를 띄운다. */
  loadError: boolean;
  /** 허브·알림 화면 진입 시 호출 — 읽기 실패는 db.ts(readFail)가 배너로 표면화, 기존 데이터는 유지. */
  hydrate: () => Promise<void>;
  /** 재시도 — TTL 을 무시하고 즉시 다시 당긴다(실패 화면의 '다시 시도' 버튼). */
  retry: () => Promise<void>;
  /** 공지·멘션 읽음처리(read_by) — 통합 목록/뱃지 즉시 반영(낙관적) + DB 기록.
   *  ⚠️ writeDb=true 는 그 매장이 "활성"일 때만 성공한다(wf_update RLS) — 크로스 행은 switchUnit 완료 후 호출.
   *  활성 매장 행은 기존 경로(workStore.markNoticeRead)가 DB 를 쓰므로 writeDb=false 로 로컬만 동기화. */
  markFeedRead: (unitId: string, feedId: string, me: string, writeDb?: boolean) => Promise<void>;
};

export const useCrossNotifStore = create<State>((set, get) => ({
  data: [],
  // 다른 스토어와 같은 관례 — 백엔드가 없으면(데모) 기다릴 것이 없으므로 처음부터 도착으로 친다.
  loaded: !HAS_SUPABASE,
  loadError: false,

  hydrate: async () => {
    const now = Date.now();
    if (now - _lastHydrateAt < HYDRATE_TTL_MS) return;
    _lastHydrateAt = now;
    const { data, error } = await fetchCrossStoreNotifData();
    if (error || !data) {
      _lastHydrateAt = 0; // 실패는 TTL 미적용 — 다음 진입에서 즉시 재시도
      // ★못 불러왔어도 '기다리기'는 끝났다. 여기서 loaded 를 안 세우면 이 플래그를 게이트에 넣은
      //   화면이 **영영 스피너에 갇힌다**(데모 모드는 error 없이 data=null 이라 항상 이 경로다).
      //   대신 실패는 loadError 로 말한다 — 안 그러면 장애가 "알림 없음"으로 위장된다.
      //   데모 모드(error 없이 data=null)는 실패가 아니므로 loadError 를 올리지 않는다.
      set({ loaded: true, loadError: !!error });
      return;
    }
    set({ data, loaded: true, loadError: false });
  },

  retry: async () => {
    _lastHydrateAt = 0;
    await get().hydrate();
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
    // 실패 = 롤백 + 배너 고지(guardWrite 관례 — markNoticeRead 등 기존 읽음처리 경로와 동일).
    if (writeDb) void guardWrite(updateFeed(updated), () => set({ data: prev }), '읽음 처리에 실패했어요.');
  },
}));
