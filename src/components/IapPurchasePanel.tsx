// 스토어 인앱결제(IAP) 표면 — 앱 안에서 매장 이용권을 사는 자리.
// 노출 판정은 화면이 아니라 `store-policy.ts`의 SHOW_IAP 한 곳이다(스토어 관문 통과 전엔 false).
// 결제 구현은 `src/lib/iap/purchases`(네이티브)·`purchases.web`(no-op) 확장자 쌍.
//
// ★스토어 구독에는 수량 개념이 없다. "매장 더 추가하기"는 실제로는 상위 요금제로 갈아타는 것이고
//   남은 기간 정산은 스토어가 한다 — 사장에게 그 사정을 설명하지 않는다(우리 쪽 사정이다).
// ⛔ 가격을 여기 적지 않는다. 스토어가 내려주는 문자열(priceString)을 그대로 쓴다.
// ⛔ "웹에서 결제하세요" 같은 안내를 넣지 않는다 — 양 스토어 모두 위반이다.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import {
  initPurchases,
  fetchOffers,
  purchaseOffer,
  restorePurchases,
  currentEntitlement,
  isUserCancelled,
  HAS_IAP,
  type IapOffer,
} from '@/lib/iap/purchases';

export function IapPurchasePanel({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const userId = useSessionStore((s) => s.userId);
  const [offers, setOffers] = useState<IapOffer[]>([]);
  const [owned, setOwned] = useState<number>(0); // 지금 구독 중인 요금제의 매장 수(0 = 없음)
  // ★소스를 AND 한 ready 하나로 묶어 화면이 통째로 등장하게 한다(부분 렌더 금지).
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await initPurchases(userId);
        const [list, ent] = await Promise.all([fetchOffers(), currentEntitlement()]);
        if (!alive) return;
        setOffers(list);
        setOwned(ent.active ? (list.find((o) => o.pkg.product.identifier === ent.productId)?.storeCount ?? 1) : 0);
      } catch {
        // 스토어 조회 실패(네트워크·미승인 상품)는 빈 목록으로 둔다 — 아래에서 사유를 문구로 낸다.
        if (alive) setOffers([]);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const buy = async (offer: IapOffer) => {
    if (busy) return;
    setBusy(true);
    try {
      await purchaseOffer(offer);
      // 매장이 실제로 열리는 것은 웹훅(sync_iap_slots) 처리 뒤다 — 몇 초 걸릴 수 있다.
      showToast('결제가 끝났어요. 매장이 열리기까지 잠시 걸릴 수 있어요.');
      setOwned(offer.storeCount);
      await onChanged();
    } catch (e) {
      if (!isUserCancelled(e)) showToast('결제를 마치지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await restorePurchases();
      const ent = await currentEntitlement();
      setOwned(ent.active ? (offers.find((o) => o.pkg.product.identifier === ent.productId)?.storeCount ?? 1) : 0);
      showToast(ent.active ? '이용권을 되살렸어요.' : '되살릴 이용권이 없어요.');
      await onChanged();
    } catch {
      showToast('이용권을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <ScreenLoading label="이용권을 불러오고 있어요…" />;

  return (
    <>
      <Appear delay={stagger(1)}>
        <View style={styles.card}>
          <Text style={styles.heading}>{owned > 0 ? '매장 더 추가하기' : '매장 이용권'}</Text>
          <Text style={styles.body}>
            {owned > 0
              ? `지금 ${owned}개 매장을 쓰고 계세요. 더 필요하시면 아래에서 골라 주세요.`
              : '쓰실 매장 수를 골라 주세요. 매달 자동으로 갱신돼요.'}
          </Text>
          {offers.length === 0 && (
            <Text style={styles.note}>
              {HAS_IAP
                ? '지금은 이용권을 불러올 수 없어요. 잠시 후 다시 열어 주세요.'
                : '이 버전에서는 이용권을 살 수 없어요.'}
            </Text>
          )}
        </View>
      </Appear>

      {offers.map((offer, i) => {
        const current = offer.storeCount === owned;
        const lower = offer.storeCount < owned;
        return (
          <Appear key={offer.pkg.identifier} delay={stagger(2 + i)}>
            <Pressable
              disabled={busy || current || lower}
              onPress={() => void buy(offer)}
              style={({ pressed }) => [
                styles.offer,
                current && styles.offerCurrent,
                (busy || lower) && { opacity: 0.5 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={styles.offerLeft}>
                <Text style={styles.offerTitle}>매장 {offer.storeCount}개</Text>
                {current && <Text style={styles.offerTag}>이용 중</Text>}
              </View>
              <Text style={styles.offerPrice}>{offer.priceString}</Text>
            </Pressable>
          </Appear>
        );
      })}

      {/* 구매 복원 — 스토어 필수 요건. 기기를 바꾸거나 앱을 지웠다 깔면 여기로 되살린다. */}
      <Appear delay={stagger(2 + offers.length)}>
        <Pressable
          disabled={busy}
          onPress={() => void restore()}
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}
        >
          {busy ? <ActivityIndicator color={InkColors.ink2} /> : <Text style={styles.ghostText}>구매 복원</Text>}
        </Pressable>
      </Appear>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    marginBottom: Space.md,
  },
  heading: { fontSize: 17, fontWeight: '700', color: InkColors.ink, marginBottom: 6 },
  body: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  note: { fontSize: 14, lineHeight: 20, color: InkColors.ink3, marginTop: 8 },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    marginBottom: Space.sm,
  },
  offerCurrent: { borderColor: BrandColors.brand, borderWidth: 2 },
  offerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offerTitle: { fontSize: 16, fontWeight: '600', color: InkColors.ink },
  offerTag: { fontSize: 13, color: InkColors.ink3 },
  offerPrice: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  ghost: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    marginTop: Space.sm,
  },
  ghostText: { fontSize: 15, color: InkColors.ink2 },
});
