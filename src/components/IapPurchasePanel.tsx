// 스토어 인앱결제(IAP) 표면 — 앱 안에서 매장 이용권을 사는 자리.
// 노출 판정은 화면이 아니라 `store-policy.ts`의 showIapSurface 한 곳이다(빌드 축·서버 축·전면무료를 합친 값).
// 결제 구현은 `src/lib/iap/purchases`(네이티브)·`purchases.web`(no-op) 확장자 쌍.
//
// ★스토어 구독에는 수량 개념이 없다. "매장 더 추가하기"는 실제로는 상위 요금제로 갈아타는 것이고
//   남은 기간 정산은 스토어가 한다 — 사장에게 그 사정을 설명하지 않는다(우리 쪽 사정이다).
// ⛔ 가격을 여기 적지 않는다. 스토어가 내려주는 문자열(priceString)을 그대로 쓴다.
//    ★한도(직원 수·AI 건수)는 다르다 — 그건 채널과 무관한 플랜 정의라 tiers.ts 가 SSOT 다.
//    갈리는 것은 **금액**뿐이다(2026-09-13 결정: 웹 25,000 ↔ 앱 33,000 — 앱 = 웹 × 1.3 천원 반올림).
// ⛔ "웹에서 결제하세요" 같은 안내를 넣지 않는다 — 양 스토어 모두 위반이다.
//
// ★2026-09-13 구조 변경 — 애플 3.1.1 거절의 시정으로 세 가지를 더했다.
//   ① **자동갱신 구독 고지**(Guideline 3.1.2(a)): 기간·자동갱신·해지 방법 + 이용약관·개인정보처리방침
//      **기능하는 링크가 바이너리 안에** 있어야 한다. 없으면 3.1.1 을 고쳐도 여기서 다시 걸린다.
//      링크는 앱 내 라우트(/terms · /privacy)다 — 외부 브라우저로 내보내지 않는다.
//   ② **무엇이 열리는가를 구매 버튼 누르기 전에** 말한다. 전에는 상품 5개만 평면으로 나열해서
//      "무엇이 달라지는지"가 화면에 없었다(살 이유가 화면에 없는 결제 화면이었다).
//   ③ **소유 매장 수를 이미 아는데 5개를 다 물었다** → 그 수를 기본으로 제시하고 나머지는 접는다.

import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { Appear, stagger } from '@/components/Appear';
import { Collapse } from '@/components/Collapse';
import { ScreenLoading } from '@/components/ScreenLoading';
import { PLANS } from '@/lib/config/tiers';
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

/**
 * 이미 남아 있는 유료 기간을 알리는 문구(없으면 null).
 *
 * ★0187 의 이중청구 가드는 **한 방향**뿐이다 — 앱 구독 중이면 계좌이체 신고를 막지만,
 *   이미 계좌이체로 유료인 사장이 앱에서 또 사는 것은 서버가 막지 않는다(`sync_iap_slots` 는
 *   기간을 줄이지 않으므로 두 채널이 겹친 채 둘 다 청구된다). 막을 수 없으면 **알려는 준다.**
 * ⛔ 채널(계좌이체·웹)을 말하지 않는다 — 앱 안에서 외부 결제를 언급하면 스토어 위반이다.
 * ★해를 넘기는 날짜엔 연도를 붙인다 — 계좌이체는 몇 달치를 한 번에 내기도 해서 "7월 30일"만 보면
 *   지난 날짜로 읽힌다(결제 화면에서 가장 위험한 종류의 오해다).
 * ※ 컴포넌트 밖에 둔다 — 렌더 중 `Date.now()` 직접 호출은 순수성 규칙 위반이다(`deriveSubscription` 과 같은 형태).
 */
function overlapNote(plan: string, paidUntil: string | null | undefined, now: number = Date.now()): string | null {
  if (plan === 'free' || !paidUntil) return null;
  const end = new Date(paidUntil);
  const ms = end.getTime();
  if (Number.isNaN(ms) || ms <= now) return null;
  const year = end.getFullYear() !== new Date(now).getFullYear() ? `${end.getFullYear()}년 ` : '';
  return `이 매장은 ${year}${end.getMonth() + 1}월 ${end.getDate()}일까지 이미 이용 기간이 남아 있어요. 지금 사시면 기간이 겹쳐요.`;
}

/** 결제 후 매장이 열리기까지 기다리는 시간. 이 뒤에도 안 열리면 문구가 '오래 걸리는 중'으로 바뀐다. */
const WAIT_TICK_MS = 5000;
const WAIT_TICKS = 6; // 30초

export function IapPurchasePanel({
  onChanged,
  ownedStoreCount,
}: {
  onChanged: () => void | Promise<void>;
  /** 사장이 실제로 가진 매장 수 — 기본 선택을 여기에 맞춘다(5개를 다 묻지 않기 위해). */
  ownedStoreCount: number;
}) {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  // ★"매장이 열렸다"의 판정은 세션의 plan 이다(서버가 SSOT). 결제 성공 토스트로 갈음하지 않는다 —
  //   결제와 매장 열림 사이에 웹훅이 있고, 그게 늦거나 실패할 수 있다.
  const plan = useSessionStore((s) => s.plan);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const [offers, setOffers] = useState<IapOffer[]>([]);
  const [owned, setOwned] = useState<number>(0); // 지금 구독 중인 요금제의 매장 수(0 = 없음)
  const [picked, setPicked] = useState<number>(0); // 고른 매장 수(0 = 아직 목록이 없음)
  const [moreOpen, setMoreOpen] = useState(false);
  // ★소스를 AND 한 ready 하나로 묶어 화면이 통째로 등장하게 한다(부분 렌더 금지).
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // 결제는 끝났는데 매장이 아직 안 열린 상태. null = 해당 없음.
  const [waiting, setWaiting] = useState<'soon' | 'slow' | null>(null);
  const waitTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await initPurchases(userId);
        const [list, ent] = await Promise.all([fetchOffers(), currentEntitlement()]);
        if (!alive) return;
        setOffers(list);
        const now = ent.active
          ? (list.find((o) => o.pkg.product.identifier === ent.productId)?.storeCount ?? 1)
          : 0;
        setOwned(now);
        // 기본 제시 = 이미 구독 중이면 한 칸 위, 아니면 가진 매장 수. 목록에 없는 수는 가장 가까운 것으로.
        const want = now > 0 ? now + 1 : Math.max(1, ownedStoreCount);
        const hit = list.find((o) => o.storeCount === want) ?? list.find((o) => o.storeCount > now) ?? list[0];
        setPicked(hit?.storeCount ?? 0);
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
  }, [userId, ownedStoreCount]);

  // 결제 뒤 반영 대기 — 웹훅(sync_iap_slots)이 도착해야 매장이 열린다. 몇 초 걸리는 것이 정상이고,
  // 실패하면 영영 안 열린다(설계 §11-5 #4). 그 사이 화면이 침묵하면 사장은 돈만 낸 상태로 남는다.
  useEffect(() => {
    if (waiting === null) return;
    let ticks = 0;
    waitTimer.current = setInterval(() => {
      ticks += 1;
      void onChanged();
      if (ticks >= WAIT_TICKS) {
        setWaiting('slow');
        if (waitTimer.current) clearInterval(waitTimer.current);
      }
    }, WAIT_TICK_MS);
    return () => {
      if (waitTimer.current) clearInterval(waitTimer.current);
    };
    // waiting 이 'soon' → 'slow' 로 바뀔 때 다시 걸지 않도록 시작 신호만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting === null]);

  // 매장이 열리면(=plan 이 유료로 바뀌면) 대기 안내를 걷는다.
  // ★상태를 지우는 이펙트를 두지 않는다 — 파생으로 충분하고, 이펙트 안의 setState 는 연쇄 렌더가 된다.
  const showWait = waiting !== null && plan === 'free';

  const selected = offers.find((o) => o.storeCount === picked) ?? null;

  const buy = async (offer: IapOffer) => {
    if (busy) return;
    setBusy(true);
    try {
      await purchaseOffer(offer);
      setOwned(offer.storeCount);
      setWaiting('soon');
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
      const now = ent.active
        ? (offers.find((o) => o.pkg.product.identifier === ent.productId)?.storeCount ?? 1)
        : 0;
      setOwned(now);
      if (now > 0) setWaiting('soon');
      showToast(now > 0 ? '이용권을 되살렸어요.' : '이 계정으로 산 이용권이 없어요.');
      await onChanged();
    } catch {
      showToast('이용권을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <ScreenLoading label="이용권을 불러오고 있어요…" />;

  const free = PLANS.free;
  const paidAi = PLANS.single.aiMonthly;
  // 이미 유료 기간이 남아 있는가(채널 무관). 스토어 구독으로 산 것이면 owned>0 이라 그쪽 문구가 맡는다.
  const paidNote = owned === 0 ? overlapNote(plan, paidUntil) : null;

  return (
    <>
      {/* ① 결제 후 반영 대기 — 돈은 냈는데 매장이 아직 안 열린 자리. 조용히 두지 않는다. */}
      {showWait && (
        <Appear delay={stagger(0)}>
          <View style={[styles.card, styles.waitCard]}>
            <View style={styles.waitHead}>
              <Ionicons name="time-outline" size={18} color={BrandColors.warn} />
              <Text style={styles.waitTitle}>
                {waiting === 'soon' ? '결제가 끝났어요' : '매장이 열리는 데 오래 걸리고 있어요'}
              </Text>
            </View>
            <Text style={styles.body}>
              {waiting === 'soon'
                ? '매장이 열리기까지 잠시 걸려요. 이 화면에 그대로 계시면 자동으로 반영돼요.'
                : '결제는 정상으로 끝났어요. 매장이 아직 안 열렸다면 설정의 문의하기로 알려 주세요. 다시 결제하지 않으셔도 돼요.'}
            </Text>
          </View>
        </Appear>
      )}

      {/* ② 무엇이 열리는가 — 구매 버튼을 누르기 전에 읽혀야 한다. */}
      <Appear delay={stagger(1)}>
        <View style={styles.card}>
          <Text style={styles.heading}>{owned > 0 ? '매장 더 추가하기' : '매장 이용권'}</Text>
          {/* ★라벨이 "지금" 이면 안 된다 — 계좌이체로 이미 유료인 사장에게 "지금 직원 3명"은 거짓말이다.
              두 줄 다 **요금제 정의**로 두면 누가 보든 항상 참이다. */}
          <View style={styles.diffRow}>
            <Text style={styles.diffLabel}>무료</Text>
            <Text style={styles.diffText}>
              직원 {free.maxStaff}명 · AI 답변 월 {free.aiMonthly}건
            </Text>
          </View>
          <View style={styles.diffRow}>
            <Text style={[styles.diffLabel, styles.diffLabelOn]}>이용권</Text>
            <Text style={[styles.diffText, styles.diffTextOn]}>
              직원 수 제한 없음 · AI 답변 월 {paidAi?.toLocaleString()}건
            </Text>
          </View>
          {offers.length === 0 && (
            <Text style={styles.note}>
              {HAS_IAP
                ? '지금은 이용권을 불러올 수 없어요. 잠시 후 다시 열어 주세요.'
                : '이 버전에서는 이용권을 살 수 없어요.'}
            </Text>
          )}
        </View>
      </Appear>

      {/* ③ 매장 수 — 가진 수를 기본으로 제시하고 나머지는 접는다(5개를 다 묻지 않는다). */}
      {!!selected && (
        <Appear delay={stagger(2)}>
          <View style={styles.card}>
            <View style={styles.pickRow}>
              <Text style={styles.pickTitle}>매장 {selected.storeCount}개</Text>
              <Text style={styles.pickPrice}>{selected.priceString} / 월</Text>
            </View>

            {offers.length > 1 && (
              <Pressable
                onPress={() => setMoreOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: moreOpen }}
                style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.moreText}>매장 수 바꾸기</Text>
                <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={16} color={InkColors.ink3} />
              </Pressable>
            )}
            {moreOpen && (
              <Collapse style={styles.moreList}>
                {offers.map((o) => {
                  const on = o.storeCount === picked;
                  const current = o.storeCount === owned;
                  return (
                    <Pressable
                      key={o.pkg.identifier}
                      onPress={() => {
                        setPicked(o.storeCount);
                        setMoreOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [styles.offer, on && styles.offerOn, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.offerLeft}>
                        <Ionicons
                          name={on ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={on ? InkColors.ink : InkColors.ink3}
                        />
                        <Text style={styles.offerTitle}>매장 {o.storeCount}개</Text>
                        {current && <Text style={styles.offerTag}>이용 중</Text>}
                      </View>
                      <Text style={styles.offerPrice}>{o.priceString}</Text>
                    </Pressable>
                  );
                })}
              </Collapse>
            )}

            {/* Primary 는 화면당 1개 — 위 목록은 '고르기'고 결제는 여기 하나다. */}
            <Pressable
              disabled={busy || selected.storeCount === owned}
              onPress={() => void buy(selected)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                (busy || selected.storeCount === owned) && { opacity: 0.5 },
                pressed && { opacity: 0.88 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {selected.storeCount === owned ? '이용 중인 요금제예요' : owned > 0 ? '요금제 바꾸기' : '이용권 사기'}
                </Text>
              )}
            </Pressable>

            {/* ★이중 결제 예방 — 0187 의 가드는 **한 방향**뿐이다(앱 구독 중이면 계좌이체 신고를 막는다).
                반대 방향(이미 계좌이체로 유료인 사장이 앱에서 또 산다)은 서버가 막지 않는다 —
                `sync_iap_slots` 가 기간을 줄이지 않으므로 두 채널의 기간이 겹친 채 둘 다 청구된다.
                앱 안에서 계좌이체를 언급할 수 없으므로(스토어 위반) **채널을 말하지 않고 사실만** 알린다. */}
            {paidNote !== null && <Text style={styles.warnNote}>{paidNote}</Text>}

            {/* ★자동갱신 고지(Guideline 3.1.2(a)) — 기간·자동갱신·해지 방법을 구매 지점에 둔다. */}
            <Text style={styles.legal}>
              매달 자동으로 갱신돼요. 해지하시기 전까지 계속돼요. 해지는 기기 설정의 구독 목록에서 하실 수 있어요.
            </Text>
            {/* ★약관·방침은 **앱 안 라우트**로 연다 — 외부 브라우저로 내보내지 않는다. */}
            <View style={styles.legalLinks}>
              <Pressable onPress={() => router.push('/terms')} style={styles.legalHit} accessibilityRole="link">
                <Text style={styles.legalLink}>이용약관</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable onPress={() => router.push('/privacy')} style={styles.legalHit} accessibilityRole="link">
                <Text style={styles.legalLink}>개인정보처리방침</Text>
              </Pressable>
            </View>
          </View>
        </Appear>
      )}

      {/* ④ 구매 복원 — 스토어 필수 요건. 기기를 바꾸거나 앱을 지웠다 깔면 여기로 되살린다. */}
      <Appear delay={stagger(3)}>
        <Pressable
          disabled={busy}
          onPress={() => void restore()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}
        >
          <Text style={styles.ghostText}>구매 복원</Text>
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
  heading: { fontSize: 17, fontWeight: '700', color: InkColors.ink, marginBottom: Space.md },
  body: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  note: { fontSize: 14, lineHeight: 20, color: InkColors.ink3, marginTop: Space.sm },

  // 결제 후 반영 대기
  waitCard: { borderColor: BrandColors.warn },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 6 },
  waitTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink },

  // 무료 ↔ 이용권 대비
  diffRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, marginBottom: Space.sm },
  diffLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: InkColors.ink3,
    minWidth: 52,
    paddingVertical: 2,
  },
  diffLabelOn: { color: InkColors.ink },
  diffText: { flex: 1, fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  diffTextOn: { color: InkColors.ink, fontWeight: '600' },

  // 매장 수 고르기
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Space.md },
  pickTitle: { fontSize: 17, fontWeight: '700', color: InkColors.ink },
  pickPrice: { fontSize: 17, fontWeight: '900', color: InkColors.ink },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    marginBottom: Space.sm,
  },
  moreText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  moreList: { gap: Space.sm, marginBottom: Space.lg },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.md,
    minHeight: 48,
  },
  offerOn: { borderColor: InkColors.ink, borderWidth: 2 },
  offerLeft: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flex: 1 },
  offerTitle: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  offerTag: { fontSize: 12, color: InkColors.ink3 },
  offerPrice: { fontSize: 15, fontWeight: '700', color: InkColors.ink },

  primary: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: InkColors.ink,
  },
  primaryText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },

  warnNote: { fontSize: 13, lineHeight: 20, color: BrandColors.warnText, marginTop: Space.md, fontWeight: '600' },
  legal: { fontSize: 12, lineHeight: 18, color: InkColors.ink3, marginTop: Space.md },
  legalLinks: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: 2 },
  legalHit: { minHeight: 48, justifyContent: 'center' },
  legalLink: { fontSize: 12, color: InkColors.ink2, fontWeight: '700', textDecorationLine: 'underline' },
  legalDot: { fontSize: 12, color: InkColors.ink3 },

  ghost: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
});
