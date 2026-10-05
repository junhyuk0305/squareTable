// useOwnerBrandStore.ts — 점주 쪽 본사 연결 상태: 나에게 온 연결 요청(my_brand_invites) + 내 매장의 연결(my_brand_view).
//
// 미연결 매장 diff 0(brand-boundary): 두 RPC 는 연결·초대가 없으면 0행이고, 0행이면 홈 카드·설정 줄이
// 아예 그려지지 않는다. 화면이 "연결 없음"을 따로 말하지 않는다 — 초대제라 점주가 먼저 찾을 이유가 없다.
// realtime 없음 — 초대·요청은 푸시(0213 owner_alerts)가 먼저 알리고, 화면 진입 시 재조회로 충분하다.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import { currentTenantEpoch, isStaleEpoch } from '@/lib/store/tenantEpoch';
import { fetchMyBrandInvites, myBrandView, myBrandHistory, type MyBrandInviteRow, type MyBrandViewRow, type MyBrandHistoryRow } from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

type State = {
  invites: MyBrandInviteRow[];
  links: MyBrandViewRow[];
  /** 0250 — 끝난 연결(180일 안). 연결이 없을 때 brand-link 가 "끝난 연결" 카드로 그린다(Q29). */
  history: MyBrandHistoryRow[];
  loaded: boolean;
  hydrate: () => Promise<void>;
};

export const useOwnerBrandStore = create<State>((set) => ({
  invites: [],
  links: [],
  history: [],
  loaded: false,
  hydrate: coalesce(async () => {
    const epoch = currentTenantEpoch();
    const [i, v, h] = await Promise.all([fetchMyBrandInvites(), myBrandView(), myBrandHistory()]);
    if (i.error) reportError('ownerBrand.invites', i.error);
    if (v.error) reportError('ownerBrand.view', v.error);
    if (h.error) reportError('ownerBrand.history', h.error);
    if (isStaleEpoch(epoch)) return; // 그 사이 계정이 바뀌었다 — 이전 계정의 연결·초대·끝난 연결을 쓰지 않는다
    // 실패는 db 계층이 표면화한다 — loaded 는 "기다리기가 끝났나"라 실패해도 세운다(useOwnerAlertStore 와 같은 규칙).
    // 실패한 축은 이전 값을 유지한다(빈 배열로 덮으면 연결이 사라진 것처럼 보인다).
    const patch: Partial<State> = { loaded: true };
    if (!i.error) patch.invites = i.data ?? [];
    if (!v.error) patch.links = v.data ?? [];
    if (!h.error) patch.history = h.data ?? [];
    set(patch);
  }),
}));
