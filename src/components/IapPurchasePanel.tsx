// 스토어 인앱결제(IAP) 표면 — 앱 안에서 매장 이용권을 사는 자리.
// 노출 판정은 화면이 아니라 `store-policy.ts`의 showIapSurface 한 곳이다(빌드 축·서버 축·전면무료를 합친 값).
// 결제 구현은 `src/lib/iap/purchases`(네이티브)·`purchases.web`(no-op) 확장자 쌍.
//
// ★스토어 구독에는 수량 개념이 없다. "매장 더 추가하기"는 실제로는 상위 요금제로 갈아타는 것이고
//   남은 기간 정산은 스토어가 한다 — 사장에게 그 사정을 설명하지 않는다(우리 쪽 사정이다).
// ⛔ 가격을 여기 적지 않는다. 스토어가 내려주는 문자열(priceString)을 그대로 쓴다.
//    ★한도(직원 수·AI 건수)는 다르다 — 그건 채널과 무관한 플랜 정의라 tiers.ts 가 SSOT 다.
// ⛔ "웹에서 결제하세요" 같은 안내를 넣지 않는다 — 양 스토어 모두 위반이다. 앱 안에서 다른 결제 채널을 말하지 않는다.
//
// ★2026-09-13 구조 변경 — 애플 3.1.1 거절의 시정으로 세 가지를 더했다.
//   ① **자동갱신 구독 고지**(Guideline 3.1.2(a)): 기간·자동갱신·해지 방법 + 이용약관·개인정보처리방침
//      **기능하는 링크가 바이너리 안에** 있어야 한다. 링크는 앱 내 라우트(/terms · /privacy)다.
//   ② **무엇이 열리는가를 구매 버튼 누르기 전에** 말한다.
//   ③ **소유 매장 수를 이미 아는데 5개를 다 물었다** → 그 수를 기본으로 제시하고 나머지는 접는다.
//
// ★2026-09-13 2차(0196) — 결제 이후의 모든 경우(명세 `메가프롬프트_인앱결제_구독구조_2026-09-13.md` §3):
//   A2 다른 채널로 이용 기간이 남은 사장은 **못 산다**(두 번 내는 사고를 막는다 — 경고가 아니라 차단).
//   A3·A4 현재 구독 카드(N매장 · 다음 결제일 · 예정된 변경 · 해지 예약 · 결제 유예).
//   C1 늘리기 = 오늘 결제·오늘부터 적용·남은 기간은 애플이 돌려준다 → 버튼 위 한 줄 + "자세히" 펼침.
//   C2 줄이기 = 오늘 결제 없음·다음 결제일부터 → **닫을 매장을 사장이 고른다**(서버 choose_iap_release).
//   C4 해지·C3 줄이기 취소 = 애플 구독 관리 창(앱 위에 뜬다). 결과는 웹훅으로 온다.
//   B1 열리면 완료 카드 · B3 결제 응답이 20초 넘게 안 오면 스피너 대신 안내 · 구매 복원은 맨 아래 작은 링크.

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
import { UPGRADE_CREDIT } from '@/lib/config/store-policy';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { rpcChooseIapRelease, rpcClearIapRelease, type IapSubscriptionRow } from '@/lib/db';
import { releaseRule } from '@/lib/iap/release';
import {
  initPurchases,
  fetchOffers,
  purchaseOffer,
  restorePurchases,
  currentEntitlement,
  showManageSubscriptions,
  isUserCancelled,
  HAS_IAP,
  type IapOffer,
} from '@/lib/iap/purchases';

/** "9월 13일" — 해를 넘기면 연도를 붙인다(결제 화면에서 지난 날짜로 읽히는 오해가 제일 위험하다). */
function fmtDay(isoLike: string | null | undefined, now: number = Date.now()): string {
  if (!isoLike) return '';
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * A2 — 다른 경로로 산 이용 기간이 남아 있으면 앱에서 또 살 수 없다(없으면 null).
 * ★0187 의 이중청구 가드는 **한 방향**뿐이다(앱 구독 중이면 다른 신고를 막는다). 반대 방향은 서버가 안 막고
 *   `sync_iap_slots` 도 기간을 줄이지 않으므로 두 기간이 겹친 채 둘 다 청구된다 → 화면에서 **막는다**.
 * ⛔ 채널을 말하지 않는다 — 앱 안에서 외부 결제를 언급하면 스토어 위반이다.
 * ※ 컴포넌트 밖에 둔다 — 렌더 중 `Date.now()` 직접 호출은 순수성 규칙 위반이다.
 */
function otherPaidNote(plan: string, paidUntil: string | null | undefined, now: number = Date.now()): string | null {
  if (plan === 'free' || !paidUntil) return null;
  const ms = new Date(paidUntil).getTime();
  if (Number.isNaN(ms) || ms <= now) return null;
  return `${fmtDay(paidUntil, now)}까지 이용 기간이 남아 있어요. 그 뒤에 여기서 이어가실 수 있어요.`;
}

/** 결제 후 매장이 열리기까지 기다리는 시간. 이 뒤에도 안 열리면 문구가 '오래 걸리는 중'으로 바뀐다. */
const WAIT_TICK_MS = 5000;
const WAIT_TICKS = 6; // 30초
/** B3 — 구매 호출 뒤 이 시간 안에 응답이 없으면 스피너를 걷고 안내한다(결제는 끝났을 수 있다). */
const PURCHASE_SLOW_MS = 20000;

export function IapPurchasePanel({
  onChanged,
  ownedStores,
  subscription,
  releaseChoice,
  wantMore = false,
}: {
  onChanged: () => void | Promise<void>;
  /** 사장이 실제로 가진(열린) 매장 — 기본 선택과 "닫을 매장 고르기"의 후보. */
  ownedStores: { unit_id: string; store_name: string }[];
  /** 서버가 아는 지금 구독(null = 앱 구독 없음). 데이터 접근은 db.ts(fetchMyIapSubscription) — 화면이 SDK 로 판정하지 않는다. */
  subscription: IapSubscriptionRow | null;
  /** 이미 골라 둔 "닫을 매장"(예고 카드 문구용). */
  releaseChoice: string[];
  /** '매장 추가'에서 들어왔다 — 기본 제시를 가진 매장 수 + 1 로(가진 수만 사면 새 매장이 여전히 막힌다). */
  wantMore?: boolean;
}) {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  // ★"매장이 열렸다"의 판정은 서버 구독 행(subscription.store_count)이다. 결제 성공 토스트로 갈음하지 않는다 —
  //   결제와 매장 열림 사이에 웹훅이 있고, 그게 늦거나 실패할 수 있다. plan 은 A2(다른 경로 유료 기간) 판정에만 쓴다.
  const plan = useSessionStore((s) => s.plan);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const [offers, setOffers] = useState<IapOffer[]>([]);
  const [picked, setPicked] = useState<number>(0); // 고른 매장 수(0 = 아직 목록이 없음)
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  // 줄이기 — 닫을 매장으로 체크한 것.
  const [release, setRelease] = useState<string[]>([]);
  // ★소스를 AND 한 ready 하나로 묶어 화면이 통째로 등장하게 한다(부분 렌더 금지).
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // B3 — 결제 응답이 늦다. 스피너 대신 안내를 띄우고 버튼을 돌려준다.
  const [slow, setSlow] = useState(false);
  // 결제는 끝났는데 매장이 아직 안 열린 상태. null = 해당 없음. bought = 이번에 산 매장 수(완료 카드 문구).
  const [waiting, setWaiting] = useState<'soon' | 'slow' | null>(null);
  const [bought, setBought] = useState(0);
  const [doneDismissed, setDoneDismissed] = useState(false);
  const waitTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 지금 구독 중인 매장 수(서버 SSOT). 0 = 앱 구독 없음.
  const sub = subscription;
  const owned = sub?.store_count ?? 0;
  const pendingCount = sub?.pending_store_count ?? null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await initPurchases(userId);
        // 목록은 스토어에서, 구독 상태는 서버에서 — SDK 의 entitlement 는 목록 정합 확인용으로만 읽는다.
        const [list] = await Promise.all([fetchOffers(), currentEntitlement()]);
        if (!alive) return;
        setOffers(list);
        // 기본 제시 = 구독 중이면 한 칸 위, 아니면 가진 매장 수(매장 추가에서 왔으면 +1). 목록에 없는 수는 가장 가까운 것으로.
        const want = owned > 0 ? owned + 1 : Math.max(1, ownedStores.length + (wantMore ? 1 : 0));
        const hit = list.find((o) => o.storeCount === want) ?? list.find((o) => o.storeCount > owned) ?? list[list.length - 1];
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
    // 목록·기본값은 처음 한 번만. owned 가 뒤에 바뀌면(결제 반영) 사용자가 고른 값을 덮지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 결제 뒤 반영 대기 — 웹훅이 도착해야 매장이 열린다. 몇 초 걸리는 것이 정상이고,
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

  // 열렸는가 = 서버 구독 행이 이번에 산 매장 수를 알게 됐다(최초구매·늘리기·복원 공통).
  // ★plan 으로 판정하지 않는다 — 늘리기는 이미 유료라 plan 이 결제 전부터 참이어서 서버 반영 전에 완료 카드가 떴다(2026-09-14).
  // ★상태를 지우는 이펙트를 두지 않는다 — 파생으로 충분하고, 이펙트 안의 setState 는 연쇄 렌더가 된다.
  const opened = waiting !== null && bought > 0 && owned >= bought;
  const showWait = waiting !== null && !opened;
  const showDone = opened && !doneDismissed;

  const selected = offers.find((o) => o.storeCount === picked) ?? null;
  const isUp = !!selected && owned > 0 && selected.storeCount > owned;
  // 줄이기 — 닫을 매장 수는 **열린 매장** 기준(서버 0196 과 같은 규칙). 판정 = lib/iap/release.ts.
  const { isDown, needRelease, ready: releaseReady } = releaseRule({
    subscribed: owned,
    openStores: ownedStores.length,
    target: selected?.storeCount ?? owned,
    chosen: release.length,
  });

  const buy = async (offer: IapOffer) => {
    if (busy) return;
    setBusy(true);
    setSlow(false);
    // C2 줄이기 — 닫을 매장을 먼저 서버에 적어 둔다(결제일 확정 때 서버가 그 매장을 연장에서 뺀다).
    // 닫을 매장이 없는 줄이기(열린 매장 ≤ 새 매장 수)는 옛 명단을 비운다 — 빈 명단은 서버가 units_required 로 거부한다.
    if (isDown) {
      const { error } = needRelease > 0 ? await rpcChooseIapRelease(release) : await rpcClearIapRelease();
      if (error) {
        setBusy(false);
        return showToast('닫을 매장을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    }
    const slowTimer = setTimeout(() => setSlow(true), PURCHASE_SLOW_MS);
    try {
      // ★isDown 을 넘긴다 — Play 는 "갈아타기"라고 말해 주지 않으면 구독을 하나 더 만든다(두 번 청구).
      await purchaseOffer(offer, { downgrade: isDown });
      if (isDown) {
        // 오늘 결제 없음 — 다음 결제일에 반영된다. 예고는 웹훅(PRODUCT_CHANGE)이 적어 주고 카드가 그린다.
        showToast(`다음 결제일부터 매장 ${offer.storeCount}개 요금이에요.`);
      } else {
        setBought(offer.storeCount);
        setDoneDismissed(false);
        setWaiting('soon');
      }
      await onChanged();
    } catch (e) {
      if (isDown) void rpcClearIapRelease();
      if (!isUserCancelled(e)) showToast('결제를 마치지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setBusy(false);
    }
  };

  const restore = async () => {
    // B3 안내("구매 복원을 눌러 주세요")가 떠 있으면 결제 응답을 기다리는 중이어도 누를 수 있어야 한다 —
    //   예전엔 busy 로 링크가 막혀 안내가 가리키는 버튼이 안 눌렸다(2026-09-14). 그때는 결제 쪽 busy 를 건드리지 않는다.
    if (busy && !slow) return;
    const lock = !busy;
    if (lock) setBusy(true);
    try {
      await restorePurchases();
      const ent = await currentEntitlement();
      // ★목록과 id 를 맞춰 보지 않는다 — Play 의 구독 id(st_multi)는 목록의 id(st_multi:multi-3-monthly)와
      //   달라 매번 "산 이용권이 없어요"가 됐다. 매장 수 판정은 purchases 모듈 한 곳이다.
      const n = ent.active ? ent.storeCount : 0;
      if (n > 0) {
        setBought(n);
        setDoneDismissed(false);
        setWaiting('soon');
      }
      showToast(n > 0 ? `이용권을 되살렸어요 · 매장 ${n}개` : '이 계정으로 산 이용권이 없어요.');
      await onChanged();
    } catch {
      showToast('이용권을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (lock) setBusy(false);
    }
  };

  const manage = async () => {
    try {
      await showManageSubscriptions();
      await onChanged();
    } catch {
      showToast('구독 관리 창을 열지 못했어요. 기기 설정의 구독 목록에서 하실 수 있어요.');
    }
  };

  if (!ready) return <ScreenLoading label="이용권을 불러오고 있어요…" />;

  const free = PLANS.free;
  const paidAi = PLANS.single.aiMonthly;
  // A2 — 앱 구독이 없는데 유료 기간이 남아 있다 = 다른 경로로 산 것. 겹쳐 사지 못하게 막는다.
  const blockedNote = owned === 0 ? otherPaidNote(plan, paidUntil) : null;
  const releaseNames = releaseChoice
    .map((id) => ownedStores.find((s) => s.unit_id === id)?.store_name)
    .filter((n): n is string => !!n);
  const one = offers.find((o) => o.storeCount === 1);
  const two = offers.find((o) => o.storeCount === 2);

  return (
    <>
      {/* ① 결제 후 반영 대기 — 돈은 냈는데 매장이 아직 안 열린 자리. 조용히 두지 않는다. */}
      {showWait && (
        <Appear delay={stagger(0)}>
          <View style={[styles.card, styles.waitCard]}>
            <View style={styles.waitHead}>
              <Ionicons name="time-outline" size={18} color={BrandColors.warn} />
              <Text style={styles.waitTitle}>
                {waiting === 'soon' ? '매장이 열리고 있어요' : '매장이 열리는 데 오래 걸리고 있어요'}
              </Text>
            </View>
            <Text style={styles.body}>
              {waiting === 'soon'
                ? '결제가 끝났어요. 매장이 열리기까지 잠시 걸려요. 이 화면에 그대로 계시면 자동으로 반영돼요.'
                : '결제는 정상으로 끝났어요. 매장이 아직 안 열렸다면 설정의 문의하기로 알려 주세요. 다시 결제하지 마세요.'}
            </Text>
          </View>
        </Appear>
      )}

      {/* B1 — 열렸다. 대기 카드가 있던 자리에 완료를 말로 남긴다(닫을 수 있다). */}
      {showDone && (
        <Appear delay={stagger(0)}>
          <View style={[styles.card, styles.doneCard]}>
            <View style={styles.waitHead}>
              <Ionicons name="checkmark-circle" size={18} color={BrandColors.goodText} />
              <Text style={styles.waitTitle}>매장이 열렸어요</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setDoneDismissed(true)} accessibilityRole="button" accessibilityLabel="닫기" style={styles.closeHit}>
                <Ionicons name="close" size={18} color={InkColors.ink3} />
              </Pressable>
            </View>
            <Text style={styles.body}>이제 매장 {Math.max(bought, owned)}개까지 쓸 수 있어요.</Text>
          </View>
        </Appear>
      )}

      {/* A3·A4 — 현재 구독 카드. 사장이 결제일을 기억할 필요가 없게 여기서 말한다. */}
      {!!sub && (
        <Appear delay={stagger(1)}>
          <View style={[styles.card, sub.status === 'grace' && styles.waitCard]}>
            <Text style={styles.heading}>지금 이용권</Text>
            {sub.status === 'grace' ? (
              <>
                <Text style={styles.curTitle}>결제 수단을 확인해 주세요</Text>
                <Text style={styles.body}>
                  매장 {sub.store_count}개 · {fmtDay(sub.current_period_end)}까지 이용 가능해요. 그 안에 결제되면 그대로 이어져요.
                </Text>
              </>
            ) : sub.status === 'canceled' ? (
              <>
                <Text style={styles.curTitle}>매장 {sub.store_count}개 · {fmtDay(sub.current_period_end)}까지 쓸 수 있어요</Text>
                <Text style={styles.body}>그 뒤엔 무료 요금제로 바뀌어요. 2호점부터는 이전 매장으로 옮겨져요.</Text>
              </>
            ) : (
              <>
                <Text style={styles.curTitle}>매장 {sub.store_count}개 이용 중 · 다음 결제일 {fmtDay(sub.current_period_end)}</Text>
                {pendingCount !== null && (
                  <Text style={styles.pendingNote}>
                    {fmtDay(sub.pending_at)}에 {releaseNames.length > 0 ? `${releaseNames.join(' · ')}이 닫히고 ` : ''}매장 {pendingCount}개 요금이 돼요. 그날까지는 지금처럼 쓸 수 있어요.
                  </Text>
                )}
              </>
            )}
            {/* 해지·줄이기 취소·다시 이어가기 = 전부 스토어 관리 창. 앱은 구독을 직접 못 끊는다. */}
            <Pressable onPress={() => void manage()} accessibilityRole="button" style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}>
              <Text style={styles.ghostText}>
                {sub.status === 'canceled' ? '다시 이어가기' : sub.status === 'grace' ? '결제 수단 바꾸기' : pendingCount !== null ? '줄이기 취소' : '구독 해지'}
              </Text>
            </Pressable>
          </View>
        </Appear>
      )}

      {/* ② 무엇이 열리는가 — 구매 버튼을 누르기 전에 읽혀야 한다. */}
      <Appear delay={stagger(2)}>
        <View style={styles.card}>
          <Text style={styles.heading}>{owned > 0 ? '매장 수 바꾸기' : '매장 이용권'}</Text>
          {/* ★라벨이 "지금" 이면 안 된다 — 다른 경로로 이미 유료인 사장에게 "지금 직원 3명"은 거짓말이다.
              두 줄 다 **요금제 정의**로 두면 누가 보든 항상 참이다. */}
          <View style={styles.diffRow}>
            <Text style={styles.diffLabel}>무료</Text>
            <Text style={styles.diffText}>
              직원 {free.maxStaff}명 · AI 사용량 월 {free.aiMonthly}
            </Text>
          </View>
          <View style={styles.diffRow}>
            <Text style={[styles.diffLabel, styles.diffLabelOn]}>이용권</Text>
            <Text style={[styles.diffText, styles.diffTextOn]}>
              직원 수 제한 없음 · AI 사용량 월 {paidAi?.toLocaleString()}
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
        <Appear delay={stagger(3)}>
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
                        setRelease([]);
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

            {/* C1 늘리기 — 오늘 결제·오늘부터 적용. 무엇이 어떻게 되는지 버튼 위에서 말한다. */}
            {isUp && (
              <>
                <Text style={styles.note}>
                  오늘부터 매장 {selected.storeCount}개예요.{' '}
                  {UPGRADE_CREDIT === 'refund'
                    ? `남은 매장 ${owned}개 기간의 요금은 애플이 돌려드려요. 다음 결제일은 오늘부터 한 달 뒤예요.`
                    : '오늘은 남은 기간에 해당하는 차액만 결제돼요. 다음 결제일은 그대로예요.'}
                </Text>
                <Pressable
                  onPress={() => setDetailOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: detailOpen }}
                  style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.moreText}>자세히</Text>
                  <Ionicons name={detailOpen ? 'chevron-up' : 'chevron-down'} size={16} color={InkColors.ink3} />
                </Pressable>
                {detailOpen && (
                  <Collapse style={styles.detailBox}>
                    <Text style={styles.detailTitle}>매장을 늘리면 요금은 이렇게 돼요</Text>
                    <Text style={styles.detailBody}>
                      예를 들어 9월 13일에 매장 1개{one ? `(${one.priceString})` : ''}로 시작했다가 9월 23일에 매장 2개로 늘리면,
                    </Text>
                    {UPGRADE_CREDIT === 'refund' ? (
                      <>
                        <Text style={styles.detailBody}>
                          · 그 자리에서 매장 2개 요금{two ? `(${two.priceString})` : ''}을 결제하고, 오늘부터 매장 2개를 쓸 수 있어요.
                        </Text>
                        <Text style={styles.detailBody}>
                          · 매장 1개 요금 중 아직 안 쓴 20일치는 애플이 며칠 안에 결제 수단으로 돌려드려요.
                        </Text>
                        <Text style={styles.detailBody}>· 다음 결제일은 10월 23일이 돼요. 그 뒤로는 매달 이날 결제돼요.</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.detailBody}>
                          · 오늘은 매장 2개 요금{two ? `(${two.priceString})` : ''} 전액이 아니라, 남은 20일치의 차액만 결제돼요.
                        </Text>
                        <Text style={styles.detailBody}>· 오늘부터 매장 2개를 쓸 수 있어요.</Text>
                        <Text style={styles.detailBody}>
                          · 다음 결제일은 10월 13일 그대로예요. 그날부터 매장 2개 요금이 결제돼요.
                        </Text>
                      </>
                    )}
                    <Text style={styles.detailBody}>
                      결국 9월 13일부터 23일까지 열흘은 매장 1개 값만 내신 거예요. 손해 보는 금액은 없어요.
                    </Text>
                    <Text style={styles.detailBody}>매장을 줄일 때는 오늘 결제가 없고, 다음 결제일부터 줄어든 요금이 적용돼요.</Text>
                  </Collapse>
                )}
              </>
            )}

            {/* C2 줄이기 — 오늘 결제 없음. 다음 결제일에 닫힐 매장을 사장이 고른다(N−M곳). */}
            {isDown && (
              <Collapse style={styles.releaseBox}>
                <Text style={styles.note}>
                  오늘 결제는 없어요. 다음 결제일 {fmtDay(sub?.current_period_end)}부터 매장 {selected.storeCount}개 요금이에요.{' '}
                  {needRelease > 0 ? `그날 닫을 매장 ${needRelease}곳을 골라 주세요.` : '닫히는 매장은 없어요.'}
                </Text>
                {needRelease > 0 && ownedStores.map((s) => {
                  const on = release.includes(s.unit_id);
                  const full = !on && release.length >= needRelease;
                  return (
                    <Pressable
                      key={s.unit_id}
                      disabled={full}
                      onPress={() => setRelease((cur) => (on ? cur.filter((x) => x !== s.unit_id) : [...cur, s.unit_id]))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: full }}
                      style={({ pressed }) => [styles.offer, on && styles.offerOn, full && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.offerLeft}>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? InkColors.ink : InkColors.ink3} />
                        <Text style={styles.offerTitle} numberOfLines={1}>{s.store_name}</Text>
                      </View>
                      {on && <Text style={styles.offerTag}>닫힘 예정</Text>}
                    </Pressable>
                  );
                })}
                {needRelease > 0 && <Text style={styles.hint}>닫힌 매장은 설정의 이전 매장에 보관돼요. 노하우·퀴즈·채팅은 남아요.</Text>}
              </Collapse>
            )}

            {/* Primary 는 화면당 1개 — 위 목록은 '고르기'고 결제는 여기 하나다. */}
            <Pressable
              disabled={busy || selected.storeCount === owned || blockedNote !== null || !releaseReady}
              onPress={() => void buy(selected)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                (busy || selected.storeCount === owned || blockedNote !== null || !releaseReady) && { opacity: 0.5 },
                pressed && { opacity: 0.88 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {selected.storeCount === owned
                    ? '이용 중인 요금제예요'
                    : isUp
                      ? `매장 ${selected.storeCount}개로 늘리기`
                      : isDown
                        ? `매장 ${selected.storeCount}개로 줄이기`
                        : '이용권 사기'}
                </Text>
              )}
            </Pressable>

            {/* B3 — 결제 응답이 늦다. 스피너만 돌리지 않는다: 이미 결제됐을 수 있고, 두 번 결제되지 않는다. */}
            {slow && (
              <Text style={styles.warnNote}>
                {"결제 확인이 늦어지고 있어요. 결제가 끝났다면 앱을 껐다 켜거나 아래 '구매 복원'을 눌러 주세요. 두 번 결제되지 않아요."}
              </Text>
            )}

            {/* A2 — 다른 경로로 산 기간이 남아 있으면 못 산다(겹쳐 두 번 내는 사고 차단). 채널은 말하지 않는다. */}
            {blockedNote !== null && <Text style={styles.warnNote}>{blockedNote}</Text>}

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

      {/* ④ 구매 복원 — 스토어 필수 요건(삭제 불가). 기기를 바꾸거나 앱을 지웠다 깔면 여기로 되살린다.
          카드 밖 맨 아래 작은 링크 — 주 동작이 아니다. */}
      <Appear delay={stagger(4)}>
        <Pressable
          disabled={busy && !slow}
          onPress={() => void restore()}
          accessibilityRole="link"
          style={({ pressed }) => [styles.restoreHit, pressed && { opacity: 0.7 }, busy && !slow && { opacity: 0.6 }]}
        >
          <Text style={styles.restoreText}>구매 복원</Text>
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
  hint: { fontSize: 13, lineHeight: 19, color: InkColors.ink3, marginTop: Space.xs },

  // 결제 후 반영 대기 · 완료
  waitCard: { borderColor: BrandColors.warn },
  doneCard: { borderColor: BrandColors.good },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 6 },
  waitTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  closeHit: { minWidth: 48, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center', marginRight: -Space.sm, marginVertical: -Space.md },

  // 현재 구독
  curTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 23, marginBottom: Space.xs },
  pendingNote: { fontSize: 14, lineHeight: 20, color: BrandColors.warnText, fontWeight: '600', marginTop: Space.xs },

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
  offerTitle: { fontSize: 15, fontWeight: '600', color: InkColors.ink, flexShrink: 1 },
  offerTag: { fontSize: 12, color: InkColors.ink3 },
  offerPrice: { fontSize: 15, fontWeight: '700', color: InkColors.ink },

  // 늘리기 자세히 · 줄이기 닫을 매장
  detailBox: { gap: Space.sm, marginBottom: Space.lg, padding: Space.md, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft },
  detailTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  detailBody: { fontSize: 14, lineHeight: 21, color: InkColors.ink2 },
  releaseBox: { gap: Space.sm, marginBottom: Space.lg },

  primary: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: InkColors.ink,
  },
  primaryText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },

  warnNote: { fontSize: 14, lineHeight: 20, color: BrandColors.warnText, marginTop: Space.md, fontWeight: '600' },
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
    marginTop: Space.md,
  },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },

  restoreHit: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 13, color: InkColors.ink3, fontWeight: '700', textDecorationLine: 'underline' },
});
