import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { logout } from '@/lib/auth';
import { showToast } from '@/lib/store/useToastStore';
import { deriveSubscription, isPlanLapsed } from '@/lib/utils/subscription';
import { canManage } from '@/lib/utils/roles';
import { BILLING_INFO, formatKrw } from '@/lib/config/billing';
import { TERMS_VERSION, PAYMENT_SLA_SENTENCE } from '@/lib/config/business';
import { PLANS, PLAN_ORDER, planMonthlyPrice, withVat, VAT_NOTE_SENTENCE, FREE_PROMO, SIGNUP_PROMO, type PlanId } from '@/lib/config/tiers';
import { SHOW_BILLING, showPaymentSurface } from '@/lib/config/store-policy';
import { usePaymentClaimStore, CLAIM_ERROR_TEXT } from '@/lib/store/usePaymentClaimStore';
import { redeemPromoCode, fetchUnitSeatStatus, type SeatStatus } from '@/lib/db';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 무료 이용 코드(0092) — RPC named 에러 → 화면 문구 판정은 여기 한 곳(§② SSOT).
const PROMO_ERROR_TEXT: Record<string, string> = {
  code_not_found: '등록되지 않은 코드예요. 다시 확인해 주세요.',
  code_inactive: '지금은 쓸 수 없는 코드예요.',
  code_expired: '기간이 지난 코드예요.',
  code_exhausted: '준비된 수량이 모두 사용된 코드예요.',
  already_paid: '이미 유료 이용 중인 매장에는 쓸 수 없어요.',
  already_redeemed: '이 매장에서 이미 사용한 코드예요.',
  not_owner: '사장님 계정에서만 코드를 쓸 수 있어요.',
  unknown: '코드 적용에 실패했어요. 잠시 후 다시 시도해 주세요.',
};
function promoErrorText(message?: string): string {
  const m = message ?? '';
  for (const key of Object.keys(PROMO_ERROR_TEXT)) {
    if (key !== 'unknown' && m.includes(key)) return PROMO_ERROR_TEXT[key];
  }
  return PROMO_ERROR_TEXT.unknown;
}

// 구독 만료/계좌이체 안내 + 요금제 선택 화면(과금층 0062).
// 만료된 매장은 각 역할 레이아웃이 여기로 강제 라우팅한다.
// 사장 = 3티어(무료/단일/다점포) 선택 → 금액 계산(SSOT=tiers.ts) → 계좌이체 안내 + 입금 알림.
// 직원 = "사장님이 결제하면 다시 열려요" 고지.
// 결제는 수동(계좌이체) — 입금 확인 후 운영자가 admin_activate_store(plan 포함) 로 전환하면
// 새로고침(refreshMembership) 시 게이트가 풀린다.
export default function BillingScreen() {
  const status = useSessionStore((s) => s.status);
  // 게이트(stores.tsx 와 동일 규칙): top-level 라우트(만료 강제 라우팅 목적지)라 그룹 게이트 밖 —
  // 미로그인 URL 직진입 시 빈 세션값(무료 기본)으로 그려지던 기존 갭을 닫는다(2레이어 감사 후속).
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;
  return <BillingBody />;
}

function BillingBody() {
  const router = useRouter();
  const role = useSessionStore((s) => s.role);
  const storeName = useSessionStore((s) => s.storeName);
  const userName = useSessionStore((s) => s.userName);
  const seatLocked = useSessionStore((s) => s.seatLocked);
  const subStatus = useSessionStore((s) => s.subStatus);
  const trialEndsAt = useSessionStore((s) => s.trialEndsAt);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const plan = useSessionStore((s) => s.plan);
  // 전면 무료 스위치(app_config.billing_free_mode) — 켜져 있으면 결제 표면을 감춘다([P8-#5]).
  const freeMode = useSessionStore((s) => s.freeMode);
  const stores = useSessionStore((s) => s.stores);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);
  // 입금 신고(0083) — 신고 등록·상태 표시의 단일 축. 데이터 접근은 스토어 → db.ts 로만(계층 경계).
  const hydrateClaims = usePaymentClaimStore((s) => s.hydrate);
  const submitPaymentClaim = usePaymentClaimStore((s) => s.submit);
  const claims = usePaymentClaimStore((s) => s.claims);
  const latestClaim = claims[0] ?? null;

  const view = deriveSubscription({ subStatus, trialEndsAt, paidUntil, plan });
  const isOwner = role === 'owner';
  // 0093: 라우팅 목적지만 매니저 포함(사장 화면 세트) — 결제 액션·신고(claims)는 isOwner 유지.
  const manages = canManage(role);
  // 이 화면은 두 모드다: ①만료 페이월(강제 라우팅 — 뒤로 갈 곳이 없다) ②자발 방문(설정·매장 추가에서
  // 업그레이드하러 옴 — 뒤로가기가 있어야 한다). 진입 시점 entitled 로 모드를 고정한다 — 승인으로
  // 도중에 entitled 가 돼도 모드가 바뀌며 헤더가 출렁이지 않게. (useState 초기값 = 마운트 1회 고정)
  const [entitledAtMount] = useState(view.entitled);
  const [busy, setBusy] = useState(false);
  // 입금자명 — 계좌이체는 이게 유일한 대사 키다(운영자가 은행 내역과 맞추는 값). 이름 기본값으로 시작.
  const [depositor, setDepositor] = useState(userName ?? '');
  const [claiming, setClaiming] = useState(false);
  // 주문 시점 동의(0116) — 체크 없이는 서버가 consent_required 로 거부한다. 이게 계약서를 대신한다.
  const [agreed, setAgreed] = useState(false);
  // 세금계산서 정보 — 요청하는 사장만. 기본 접힘(화면 블록 예산).
  const [bizOpen, setBizOpen] = useState(false);
  const [bizNo, setBizNo] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  // 좌석 현황(0115) — 무료 강등으로 잠긴 직원이 있으면 사장에게 알린다.
  const [seat, setSeat] = useState<SeatStatus | null>(null);
  // 무료 이용 코드(0092) — 기본 접힘(화면 요소 예산). 검증·기록·활성화는 전부 서버 RPC.
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  // ★진입 파라미터(0142 /downgrade → 여기) — 앞 화면에서 이미 고른 요금제·매장수를 실어 온다.
  //   여기서 다시 고르게 하면 그 화면에서 한 결정이 버려진다. 값 검증은 여기서 하고(위조 URL),
  //   금액 재계산은 서버(payment_claim_amount)가 하므로 파라미터로 금액이 바뀌지는 않는다.
  const params = useLocalSearchParams<{ plan?: string; stores?: string }>();
  const paramPlan: PlanId | null = params.plan === 'single' || params.plan === 'multi' ? params.plan : null;
  const paramStores = Math.min(Math.max(Number(params.stores) || 0, 0), 15);

  // 선택 요금제 — 초기값은 파라미터가 있으면 그것, 없으면 현재 요금제.
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(paramPlan ?? plan);
  // 세션 plan이 마운트 뒤에 로드/변경되면(웹 새로고침 직진입, 30초 폴링 중 활성화 반영) 선택을
  // 재동기화한다. 단 사용자가 직접 고른 뒤에는 덮어쓰지 않는다(선택 유지).
  // 파라미터로 온 선택도 '이미 고른 것'이라 덮어쓰지 않는다.
  const planTouched = useRef(paramPlan !== null);
  useEffect(() => {
    if (!planTouched.current) setSelectedPlan(plan);
  }, [plan]);
  // ★0130: 금액은 '소유 매장 수'가 아니라 **살 매장 수**로 곱한다. 예전엔 소유 수를 세서
  //   곱했기 때문에 "이 결제가 몇 개분인지"가 시스템에 없었고, 매장을 하나 추가할 때마다
  //   전 매장 요금이 한꺼번에 청구됐다. 이제 개수가 결제의 입력이다(payment_claims.store_count).
  const ownedCount = stores.filter((st) => st.role === 'owner').length;
  const [storeCount, setStoreCount] = useState(paramStores >= 1 ? paramStores : 1);
  const buyCount = selectedPlan === 'multi' ? storeCount : 1;
  const monthlyTotal = planMonthlyPrice(selectedPlan, buyCount); // 공급가액(표시가)
  const monthlyBilled = withVat(monthlyTotal); // 실제 입금 요청액 — 서버 payment_claim_amount(0130)와 같은 값

  // 자동 재확인: /billing 은 top-level 라우트라 owner/junior 레이아웃의 refreshMembership 폴이 여기선 안 돈다.
  //   → 이 화면 자체에서 30초마다 상태를 당겨, 계좌이체 활성화가 반영되면 새로고침 탭 없이 자동으로 앱에 진입.
  //   ("입금했는데 아무 반응 없다"는 전환화면 이탈 방지.)
  useEffect(() => {
    const id = setInterval(async () => {
      await refreshMembership();
      // 신고 상태(확인 중 → 승인/반려)도 같은 주기로 당긴다. 반려는 구독이 안 열리므로 이 폴이
      //   유일한 도달 경로다(승인은 아래 라우팅으로 앱에 들어가면서 자연히 확인된다).
      // iOS 네이티브는 신고 UI 자체가 없다(SHOW_BILLING) — 보여줄 데 없는 조회를 돌리지 않는다.
      if (isOwner && SHOW_BILLING) void hydrateClaims();
      // 자동 진입은 페이월 모드에서만 — 자발 방문(entitled 로 진입, 무료 사장 업그레이드 등)은 처음부터
      // entitled 라 이 판정이 30초 만에 무조건 참이 되어, 입금자명 입력 중에 화면을 뺏는다.
      if (entitledAtMount) return;
      const s = useSessionStore.getState();
      if (!s.unitId) return;
      if (deriveSubscription({ subStatus: s.subStatus, trialEndsAt: s.trialEndsAt, paidUntil: s.paidUntil, plan: s.plan }).entitled) {
        router.replace(manages ? '/owner/dashboard' : '/junior/home');
      }
    }, 30000);
    return () => clearInterval(id);
  }, [refreshMembership, router, isOwner, manages, hydrateClaims]);

  // 진입 즉시 1회 — 이전에 낸 신고가 '확인 중'인지 '반려'인지 바로 보여준다(30초 기다리게 하지 않는다).
  // 훅은 조기 return 위에 있어야 하므로(훅 규칙) 조건은 이펙트 안에 둔다.
  useEffect(() => {
    if (isOwner && SHOW_BILLING) void hydrateClaims();
  }, [isOwner, hydrateClaims]);

  // 좌석 현황 — 사장에게 "몇 명이 잠겼는지"를 보여주는 자리. 판정은 서버(unit_seat_status)가 SSOT.
  useEffect(() => {
    if (!manages) return;
    void fetchUnitSeatStatus().then(({ data }) => setSeat(data));
  }, [manages, plan]);

  const recheck = async () => {
    setBusy(true);
    await refreshMembership();
    setBusy(false);
    // 활성화됐으면 게이트가 자동으로 화면을 넘긴다. 아니면 그대로 안내가 유지된다.
    if (!useSessionStore.getState().unitId) return;
    const v = deriveSubscription({
      subStatus: useSessionStore.getState().subStatus,
      trialEndsAt: useSessionStore.getState().trialEndsAt,
      paidUntil: useSessionStore.getState().paidUntil,
      plan: useSessionStore.getState().plan,
    });
    if (!v.entitled) return showToast('아직 활성화 전이에요. 입금 확인 후 반영돼요.');
    // 페이월 모드에서만 앱으로 진입시킨다. 자발 방문자는 화면에 남아 현재 요금제를 확인한다(뒤로가기로 나감).
    if (!entitledAtMount) return router.replace(manages ? '/owner/dashboard' : '/junior/home');
    showToast(`현재 ${PLANS[useSessionStore.getState().plan].name} 요금제예요.`);
  };

  const copy = (label: string, value: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(value);
        showToast(`${label} 복사됨`);
      }
    } catch {
      /* 복사 미지원 환경 — 무시 */
    }
  };

  // ── 입금 신고(0083) — 주경로. 예전엔 mailto 초안이 유일해서 메일이 묻히면 DB에 흔적조차 없었다.
  //    이제 submit_payment_claim 이 pending 행을 남기고, 운영자 콘솔(/payments)이 그 목록을 본다.
  const submitClaim = async () => {
    const name = depositor.trim();
    if (!name) {
      showToast('입금자명을 입력해 주세요');
      return;
    }
    if (selectedPlan === 'free') return; // 무료는 입금 자체가 없다(서버도 bad_plan 으로 거부)
    // 주문 시점 동의(0116) — 서버도 consent_required 로 막지만, 여기서 무엇이 빠졌는지 먼저 알린다.
    if (!agreed) {
      showToast('유료 이용 조건에 동의해 주세요');
      return;
    }
    const biz = bizNo.replace(/\D/g, '');
    if (biz && biz.length !== 10) {
      showToast('사업자등록번호는 숫자 10자리예요');
      return;
    }
    setClaiming(true);
    const res = await submitPaymentClaim({
      plan: selectedPlan,
      amountKrw: monthlyBilled,
      depositorName: name,
      termsVersion: TERMS_VERSION,
      bizNo: biz || null,
      bizEmail: bizEmail.trim() || null,
      storeCount: buyCount,
    });
    setClaiming(false);
    if (!res.ok) {
      showToast(CLAIM_ERROR_TEXT[res.reason]);
      return;
    }
    showToast('입금 확인 중이에요. 확인되면 바로 열려요.', 'good');
  };

  // ── 무료 이용 코드 사용(0092) — 성공하면 서버가 이미 활성화까지 끝낸 상태다.
  const redeemCode = async () => {
    const code = promoCode.trim();
    if (!code) {
      showToast('코드를 입력해 주세요');
      return;
    }
    setRedeeming(true);
    const { data, error } = await redeemPromoCode(code);
    setRedeeming(false);
    if (error || !data) {
      showToast(promoErrorText(error?.message));
      return;
    }
    showToast(`코드가 적용됐어요. ${data.days}일 동안 이용할 수 있어요.`, 'good');
    setPromoCode('');
    setPromoOpen(false);
    await refreshMembership();
    // 페이월 모드였다면 즉시 앱으로(recheck 와 동일 규칙). 자발 방문은 화면에 남아 상태를 확인한다.
    if (!entitledAtMount) router.replace(manages ? '/owner/dashboard' : '/junior/home');
  };

  const notifyPaid = async () => {
    // 보조 경로(설계문서 B-1) — 신고는 이미 DB에 남았고, 이건 "빨리 봐달라"는 추가 통지일 뿐이다.
    const subject = `매장의 정석 입금 완료 알림${storeName ? ` — ${storeName}` : ''}`;
    const body = [
      '입금을 완료했어요. 확인 후 활성화 부탁드려요.',
      storeName ? `매장: ${storeName}` : '',
      `요금제: ${PLANS[selectedPlan].name}`,
      `금액: ${formatKrw(monthlyBilled)} / 월 (부가세 포함)`,
      depositor.trim() ? `입금자명: ${depositor.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const url = `mailto:${BILLING_INFO.contactValue}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      // 메일 앱이 없는 환경 — 무엇을 해야 하는지(어디로 알릴지)를 명확히 남긴다(무음 실패 방지).
      showToast(`${BILLING_INFO.contactValue} 로 입금 사실을 알려주세요`);
    }
  };

  // 상태 문구.
  // ★2026-08-06: 유료 기간이 끝나도 앱이 잠기지 않는다(무료 강등). '만료' 문구를 쓰지 않고,
  //   처음부터 무료인 매장과 구분해 "무료로 바뀌었다"고 말한다(isPlanLapsed).
  // ★2026-08-11(0134): 가입하면 N일 요금제를 얹는 기간제 체험이 **생겼다**. 남은 날짜를 반드시
  //   말해준다 — 체험이 끝나는 시점이 곧 결제를 요청하는 시점이라, 그날 처음 알게 하면 안 된다.
  const lapsed = isPlanLapsed({ plan, subStatus, paidUntil, trialEndsAt });
  const headline = lapsed
    ? '무료 요금제로 바뀌었어요'
    : plan === 'free'
      ? '무료 요금제로 이용 중이에요'
      : view.state === 'trialing' && view.daysLeft > 0
        ? `무료로 쓰는 기간이 ${view.daysLeft}일 남았어요`
        : '이용 중이에요';

  // ── iOS 네이티브: 결제 표면 전면 차단 (App Review 3.1.3(f)) ────────────────────────
  // 계좌·금액·요금제 선택·입금 버튼을 모두 제거한다. "웹에서 결제하세요" 같은 안내도
  // call to action 에 해당하므로 넣지 않는다(3.1.1(a) — 한국 스토어프론트는 아웃링크도 금지).
  // 만료 시 owner/junior 레이아웃이 이 라우트로 강제 이동시키므로 라우트 자체는 살려두고,
  // 사실 고지 + 상태 새로고침 + 로그아웃만 남긴다.
  // ★2026-08-11 [P8-#5]: 전면 무료 모드(서버 스위치)일 때도 같은 자리를 쓴다.
  //   예전엔 설정 화면만 "전면 무료"로 바뀌고 이 화면은 요금제 카드·계좌번호·입금 버튼을 그대로 띄웠다 —
  //   무료라고 공지해 놓고 같은 앱에서 입금을 받는 상태였다. 판정은 store-policy 한 곳(showPaymentSurface).
  if (!showPaymentSurface(freeMode)) {
    const expired = view.state === 'expired';
    // 무료 모드는 "결제를 감춘 것"이지 "이용을 막은 것"이 아니다 — 만료 문구를 그대로 쓰면 겁을 준다.
    const freeNow = SHOW_BILLING && freeMode;
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Appear delay={0}>
          <View style={styles.hero}>
            <View style={styles.iconWrap}>
              <Ionicons
                name={expired ? 'lock-closed-outline' : 'checkmark-circle-outline'}
                size={26}
                color={expired ? BrandColors.warn : InkColors.ink}
              />
            </View>
            <Text style={styles.title}>
              {freeNow ? FREE_PROMO.headline : expired ? '지금은 이용할 수 없어요' : '이용 중이에요'}
            </Text>
            {!!storeName && <Text style={styles.store}>{storeName}</Text>}
          </View>
          </Appear>
          <Appear delay={60}>
          <View style={styles.card}>
            <Text style={styles.body}>
              {freeNow
                ? `${FREE_PROMO.until}까지는 모든 기능을 무료로 쓰실 수 있어요. 매장 수·직원 수 제한도 없어요.\n지금은 결제하실 것이 없어요.`
                : expired
                  ? isOwner
                    ? '이 매장의 이용 기간이 끝났어요. 이용 재개는 관리자에게 문의해 주세요.'
                    : '매장의 이용 기간이 끝났어요. 사장님께 문의해 주세요.'
                  : '이 매장은 정상적으로 이용 중이에요.'}
            </Text>
          </View>
          </Appear>
          <Appear delay={120}>
          <Pressable
            disabled={busy}
            onPress={recheck}
            style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}
          >
            {busy ? <ActivityIndicator color={InkColors.ink2} /> : <Text style={styles.ghostText}>이용 상태 새로고침</Text>}
          </Pressable>
          </Appear>
          <Appear delay={120}>
          <Pressable onPress={() => void logout()} style={styles.logoutRow}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </Pressable>
          </Appear>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={entitledAtMount ? ['bottom'] : ['top', 'bottom']}>
      {/* 자발 방문(업그레이드하러 옴)엔 뒤로가기 헤더 — 없으면 로그아웃 말곤 나갈 길이 없다.
          페이월 모드(만료 강제 라우팅)는 헤더 없음 유지 — 뒤로 갈 유효한 화면이 없다. */}
      <Stack.Screen
        options={
          entitledAtMount
            ? { headerShown: true, title: '요금제', headerLeft: () => <HeaderBackButton fallback="/stores" /> }
            : { headerShown: false }
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Appear delay={0}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons
              name={view.state === 'expired' ? 'lock-closed-outline' : 'card-outline'}
              size={26}
              color={view.state === 'expired' ? BrandColors.warn : InkColors.ink}
            />
          </View>
          <Text style={styles.title}>{headline}</Text>
          {!!storeName && <Text style={styles.store}>{storeName}</Text>}
        </View>
        </Appear>

        {/* 가입 체험(0134) 안내 — 체험 중인 사장에게만. 웹사이트 팝업(public/promo.js)이 이미
            "다점포까지 — 가입 후 말씀만 주세요"를 약속하는데 앱 요금제 화면만 그 말을 안 해서,
            체험 중인 사장이 여기서 '다점포 = 유료'만 보고 있었다(말과 말이 갈라진 자리).
            ★남은 일수는 세션(trial_ends_at)에서 온다 — 기간 숫자를 이 파일에 복제하지 않는다. */}
        {isOwner && view.state === 'trialing' && view.daysLeft > 0 && (
          <Appear delay={40}>
          <View style={styles.promoCard}>
            {SIGNUP_PROMO.perks.map((p) => (
              <View key={p} style={styles.promoRow}>
                <Ionicons name="checkmark-circle" size={16} color={BrandColors.goodText} />
                <Text style={styles.promoText}>{p}</Text>
              </View>
            ))}
            <Text style={styles.promoNote}>{SIGNUP_PROMO.afterNote}</Text>
          </View>
          </Appear>
        )}

        {/* 직원: 계좌 정보 대신 사장 결제 안내만 */}
        {!isOwner ? (
          <Appear delay={60}>
          <View style={styles.card}>
            {/* 좌석 잠금(0115) — 직원에게는 금액·계좌를 보여주지 않는다. 무슨 일이 있었는지와
                누구에게 말하면 되는지만 남긴다(사용자 탓 금지·다음 행동 명시). */}
            <Text style={styles.body}>
              {seatLocked
                ? '매장이 무료 요금제로 바뀌면서 지금은 이용할 수 없어요. 사장님께 문의해 주세요.'
                : '이용에 문제가 없어요.'}
            </Text>
          </View>
          </Appear>
        ) : (
          <>
            {/* 좌석 잠금 알림(0115) — 잠긴 직원이 있을 때만. 0명이면 렌더하지 않는다(AlertRow 규칙). */}
            {!!seat && seat.locked > 0 && (
              <Appear delay={60}>
                <View style={[styles.card, styles.claimRejected]}>
                  <View style={styles.claimHead}>
                    <Ionicons name="lock-closed-outline" size={18} color={BrandColors.warn} />
                    <Text style={styles.claimTitle}>직원 {seat.locked}명의 자리가 잠겼어요</Text>
                  </View>
                  <Text style={styles.body}>
                    무료 요금제는 직원 {seat.cap}명까지예요. 지금 {seat.total}명이라 나중에 합류한 {seat.locked}명이
                    앱을 쓸 수 없어요.
                  </Text>
                  <Text style={styles.hint}>단일 매장 요금제로 바꾸면 인원 제한 없이 다시 열려요.</Text>
                </View>
              </Appear>
            )}

            {/* 요금제 선택(3티어, SSOT=tiers.ts). 선택에 따라 아래 금액이 계산된다. */}
            <Appear delay={60}>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>요금제</Text>
              <View style={styles.planList}>
                {PLAN_ORDER.map((pid) => {
                  const def = PLANS[pid];
                  const selected = pid === selectedPlan;
                  const current = pid === plan;
                  return (
                    <Pressable
                      key={pid}
                      onPress={() => { planTouched.current = true; setSelectedPlan(pid); }}
                      style={[styles.planCard, selected && styles.planCardSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${def.name} 요금제${current ? ' (현재 요금제)' : ''} 선택`}
                    >
                      <View style={styles.planHead}>
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={selected ? InkColors.ink : InkColors.ink3}
                        />
                        <Text style={styles.planName}>{def.name}</Text>
                        {current && (
                          <View style={styles.planBadge}>
                            <Text style={styles.planBadgeText}>현재</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }} />
                        {/* 파일럿 할인 중이면 정가를 취소선으로 병기(tiers.regularKrw SSOT) */}
                        {def.regularKrw ? (
                          <Text style={styles.planPriceRegular}>{formatKrw(def.regularKrw)}</Text>
                        ) : null}
                        <Text style={styles.planPrice}>
                          {def.monthlyKrw === 0
                            ? '0원'
                            : `${def.perStore ? '매장당 ' : ''}월 ${formatKrw(def.monthlyKrw)}`}
                        </Text>
                      </View>
                      <Text style={styles.planTagline}>{def.tagline}</Text>
                      <Text style={styles.planFeatures}>{def.features.join(' · ')}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.hint, { marginLeft: 2 }]}>{VAT_NOTE_SENTENCE}</Text>
            </View>
            </Appear>

            {selectedPlan === 'free' ? (
              /* 무료 선택 — 입금 절차 없음 */
              <Appear delay={120}>
              <View style={styles.card}>
                <Text style={styles.body}>무료 요금제는 입금 없이 쓸 수 있어요. 직원 {PLANS.free.maxStaff}명, AI 답변 월 {PLANS.free.aiMonthly}건까지 제공돼요.</Text>
              </View>
              </Appear>
            ) : (
              <>
                {/* ★2026-08-06: 안내 문구 · 입금 계좌 · 입금자명이 각각 카드라 **카드 3연속**이었다
                    (배치규칙① 위반 · 실브라우저 실측 카드런 3). 셋은 "입금하기" 한 동작이라
                    — 계좌를 보고 이체한 뒤 그 이름을 적는다 — 한 카드로 합친다. 행은 하나도 안 없앴다. */}
                <Appear delay={120}>
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>입금하기</Text>
                  <View style={styles.card}>
                    <Text style={styles.body}>
                      {lapsed
                        ? '아래 계좌로 이용료를 입금하시면, 확인 후 다시 열려요.'
                        : '아래 계좌로 이용료를 입금해 주세요. 확인 후 반영돼요.'}
                    </Text>
                    {/* 계좌이체는 사람이 통장을 보고 승인한다 — 언제까지 기다리면 되는지 반드시 말한다. */}
                    <Text style={styles.hint}>{PAYMENT_SLA_SENTENCE}</Text>

                    <View style={styles.payDivider} />

                    <Row label="은행" value={BILLING_INFO.bankName} />
                    <Row
                      label="계좌번호"
                      value={BILLING_INFO.account}
                      onCopy={() => copy('계좌번호', BILLING_INFO.account)}
                    />
                    <Row label="예금주" value={BILLING_INFO.holder} />
                    <Row label="금액" value={`${formatKrw(monthlyBilled)} / 월`} strong />
                    <Text style={styles.hint}>
                      {formatKrw(monthlyTotal)} + 부가세 {formatKrw(monthlyBilled - monthlyTotal)}이에요.
                    </Text>
                    {selectedPlan === 'multi' && (
                      <>
                        <Text style={styles.hint}>
                          매장 {buyCount}개 × {formatKrw(PLANS.multi.monthlyKrw)} 기준이에요.
                        </Text>

                        <View style={styles.payDivider} />

                        {/* 몇 개분을 살지 — 이게 결제의 입력이다(0130 store_count).
                            한 번에 여러 개를 사도 되고, 나중에 하나씩 더 사도 된다. */}
                        <Text style={styles.payFieldLabel}>매장 개수</Text>
                        <View style={styles.stepper}>
                          <Pressable
                            onPress={() => setStoreCount((n) => Math.max(1, n - 1))}
                            disabled={storeCount <= 1}
                            style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }, storeCount <= 1 && { opacity: 0.4 }]}
                            accessibilityRole="button"
                            accessibilityLabel="매장 개수 줄이기"
                          >
                            <Ionicons name="remove" size={20} color={InkColors.ink} />
                          </Pressable>
                          <Text style={styles.stepValue}>{storeCount}개</Text>
                          <Pressable
                            onPress={() => setStoreCount((n) => Math.min(15, n + 1))}
                            disabled={storeCount >= 15}
                            style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }, storeCount >= 15 && { opacity: 0.4 }]}
                            accessibilityRole="button"
                            accessibilityLabel="매장 개수 늘리기"
                          >
                            <Ionicons name="add" size={20} color={InkColors.ink} />
                          </Pressable>
                        </View>
                        <Text style={styles.hint}>
                          입금이 확인되면 {storeCount}개만큼 열려요. 아직 무료인 내 매장이 먼저 열리고, 남는 건 새 매장을 만들 때 쓰여요.
                          {ownedCount > 0 ? ` 지금 매장 ${ownedCount}개를 갖고 계세요.` : ''}
                        </Text>
                      </>
                    )}

                    <View style={styles.payDivider} />

                    {/* 입금자명 — 계좌이체 대사의 유일한 키. 지금까지 안 받아서 운영자가 맞출 방법이 없었다.
                        계좌를 본 직후가 이 값을 적는 자리라, 카드를 나누는 것보다 이어 붙는 게 자연스럽다. */}
                    <Text style={styles.payFieldLabel}>입금자명</Text>
                    <TextInput
                      value={depositor}
                      onChangeText={setDepositor}
                      placeholder="통장에 찍히는 이름"
                      placeholderTextColor={InkColors.ink3}
                      style={styles.input}
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={40}
                      returnKeyType="done"
                      onSubmitEditing={() => void submitClaim()}
                      accessibilityLabel="입금자명 입력"
                    />
                    <Text style={styles.hint}>
                      보내는 분 이름이 매장명·사장님 성함과 다르면 확인이 늦어져요. 실제로 이체한 이름을 적어주세요.
                    </Text>
                  </View>
                </View>
                </Appear>

                {/* 직전 신고 상태 — '냈는데 아무 반응 없다'를 없애는 자리. 승인은 폴링이 앱으로 넘긴다. */}
                {latestClaim?.status === 'pending' && (
                  <View style={[styles.card, styles.claimPending]}>
                    <View style={styles.claimHead}>
                      <Ionicons name="time-outline" size={18} color={InkColors.ink2} />
                      <Text style={styles.claimTitle}>입금을 확인하고 있어요</Text>
                    </View>
                    <Text style={styles.hint}>
                      {`입금자명 ${latestClaim.depositor_name} · ${formatKrw(latestClaim.amount_krw)}로 알려주셨어요.`}
                      {'\n'}
                      {PAYMENT_SLA_SENTENCE} 확인되면 따로 누르지 않아도 바로 열려요.
                    </Text>
                  </View>
                )}
                {latestClaim?.status === 'rejected' && (
                  <View style={[styles.card, styles.claimRejected]}>
                    <View style={styles.claimHead}>
                      <Ionicons name="alert-circle-outline" size={18} color={BrandColors.warn} />
                      <Text style={styles.claimTitle}>입금 확인이 어려웠어요</Text>
                    </View>
                    {/* 사유를 안 보여주면 사장은 무엇을 고쳐 다시 내야 할지 모른다(무음 구간 재발). */}
                    <Text style={styles.body}>{latestClaim.reject_reason ?? '입금 내역을 확인하지 못했어요.'}</Text>
                    <Text style={styles.hint}>내용을 확인하고 아래에서 다시 알려주세요.</Text>
                  </View>
                )}

                {/* 세금계산서 — 필요한 사장만 편다. 기본 접힘(무료·개인 사장에게 불필요한 입력을 강요하지 않는다). */}
                {!bizOpen ? (
                  <Pressable onPress={() => setBizOpen(true)} style={({ pressed }) => [styles.promoToggle, pressed && { opacity: 0.6 }]}>
                    <Text style={styles.promoToggleText}>세금계산서가 필요하신가요?</Text>
                  </Pressable>
                ) : (
                  <Appear delay={0}>
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>세금계산서</Text>
                    <View style={styles.card}>
                      <TextInput
                        value={bizNo}
                        onChangeText={setBizNo}
                        placeholder="466-03-04380"
                        placeholderTextColor={InkColors.ink3}
                        style={styles.input}
                        keyboardType="number-pad"
                        maxLength={12}
                        accessibilityLabel="사업자등록번호 입력"
                      />
                      <TextInput
                        value={bizEmail}
                        onChangeText={setBizEmail}
                        placeholder="계산서 받을 이메일"
                        placeholderTextColor={InkColors.ink3}
                        style={styles.input}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={120}
                        accessibilityLabel="계산서 받을 이메일 입력"
                      />
                      <Text style={styles.hint}>입금 확인 후 적어주신 주소로 보내드려요.</Text>
                    </View>
                  </View>
                  </Appear>
                )}

                {/* 주문 시점 동의(0116) — 이 기록이 계약서를 대신한다. 서버도 없으면 거부한다. */}
                <Appear delay={120}>
                <Pressable
                  onPress={() => setAgreed((v) => !v)}
                  style={({ pressed }) => [styles.consentRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  accessibilityLabel="유료 이용 조건 동의"
                >
                  <Ionicons
                    name={agreed ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={agreed ? InkColors.ink : InkColors.ink3}
                  />
                  <Text style={styles.consentText}>
                    한 달치 선불이고 자동으로 결제되지 않는다는 점, 환불 규정을 확인했어요.
                  </Text>
                </Pressable>
                </Appear>

                <Appear delay={120}>
                <Pressable
                  disabled={claiming}
                  onPress={() => void submitClaim()}
                  style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, claiming && { opacity: 0.6 }]}
                >
                  {claiming ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryText}>{latestClaim?.status === 'pending' ? '입금 정보 다시 보내기' : '입금 완료했어요'}</Text>
                  )}
                </Pressable>
                </Appear>

                {/* 보조 경로 — 신고는 이미 저장됐고, 급할 때 사람을 직접 부르는 창구(설계문서 B-1). */}
                <Appear delay={120}>
                <Pressable onPress={() => void notifyPaid()} style={({ pressed }) => [styles.mailRow, pressed && { opacity: 0.6 }]}>
                  <Text style={styles.mailText}>메일로도 알리기 ({BILLING_INFO.contactValue})</Text>
                </Pressable>
                </Appear>
              </>
            )}
            {/* 도입 문의(0105) — 표준 3티어에 안 담기는 도입(다점포 대량·프랜차이즈 본사)의 상담 창구. */}
            <Pressable
              onPress={() => router.push('/inquiry')}
              style={({ pressed }) => [styles.promoToggle, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.promoToggleText}>여러 매장·프랜차이즈 본사는 도입 문의</Text>
            </Pressable>

            {/* 무료 이용 코드(0092) — 캠페인으로 받은 코드. 기본 접힘, 펼침은 아래로(레이아웃 규칙). */}
            {!promoOpen ? (
              <Pressable onPress={() => setPromoOpen(true)} style={({ pressed }) => [styles.promoToggle, pressed && { opacity: 0.6 }]}>
                <Text style={styles.promoToggleText}>무료 이용 코드가 있으신가요?</Text>
              </Pressable>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>무료 이용 코드</Text>
                <View style={styles.card}>
                  <TextInput
                    value={promoCode}
                    onChangeText={(t) => setPromoCode(t.toUpperCase())}
                    placeholder="STORE7"
                    placeholderTextColor={InkColors.ink3}
                    style={styles.input}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={24}
                    returnKeyType="done"
                    onSubmitEditing={() => void redeemCode()}
                    accessibilityLabel="무료 이용 코드 입력"
                  />
                  <Pressable
                    disabled={redeeming}
                    onPress={() => void redeemCode()}
                    style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, redeeming && { opacity: 0.6 }]}
                  >
                    {redeeming ? <ActivityIndicator color={InkColors.ink2} /> : <Text style={styles.ghostText}>코드 사용</Text>}
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}

        <Appear delay={180}>
        <Pressable disabled={busy} onPress={recheck} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={InkColors.ink2} /> : <Text style={styles.ghostText}>이용 상태 새로고침</Text>}
        </Pressable>
        </Appear>

        <Appear delay={180}>
        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
        </Appear>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, strong, onCopy }: { label: string; value: string; strong?: boolean; onCopy?: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
        {onCopy && (
          <Pressable onPress={onCopy} hitSlop={8} style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="copy-outline" size={16} color={InkColors.ink3} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.xl, paddingBottom: 40, flexGrow: 1 },

  hero: { alignItems: 'center', gap: Space.sm, marginTop: Space.lg },

  // 가입 체험 안내 카드 — 요금제 카드보다 앞서므로 형태를 다르게 둔다(같은 카드면 목록으로 읽힌다).
  promoCard: {
    gap: Space.sm,
    backgroundColor: BrandColors.goodSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    padding: Space.lg,
  },
  promoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  promoText: { flex: 1, fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  promoNote: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FBF3E2', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  store: { fontSize: 14, color: InkColors.ink2, fontWeight: '600' },

  section: { gap: Space.md },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginLeft: 2 },
  // '입금하기' 한 카드 안에서 안내 / 계좌 / 입금자명을 가르는 선. 카드를 셋으로 나누는 대신
  // 한 카드 안 구분선으로 리듬을 만든다(2026-08-06).
  payDivider: { height: 1, backgroundColor: InkColors.line, marginVertical: Space.md },
  payFieldLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginBottom: Space.xs },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  body: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  hint: { fontSize: 12, color: InkColors.ink3, lineHeight: 18 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  rowLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowValue: { fontSize: 14, color: InkColors.ink, fontWeight: '700' },
  rowValueStrong: { fontSize: 15, fontWeight: '900' },
  copyBtn: { padding: 2 },

  // 요금제 선택 카드(라디오 리스트) — 선택 시 잉크 보더로 강조.
  planList: { gap: Space.sm },
  planCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.xs,
    ...Elevation.e1,
  },
  planCardSelected: { borderColor: InkColors.ink, borderWidth: 1.5 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  planName: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  planBadge: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: InkColors.line },
  planBadgeText: { fontSize: 10.5, fontWeight: '800', color: InkColors.ink2 },
  planPrice: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  planPriceRegular: { fontSize: 12, fontWeight: '600', color: InkColors.ink3, textDecorationLine: 'line-through', marginRight: Space.xs },
  planTagline: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink2, marginTop: 2 },
  planFeatures: { fontSize: 11.5, fontWeight: '600', color: InkColors.ink3, lineHeight: 17 },

  // 입금 신고 상태 카드 — 확인 중(중립) / 반려(경고 보더). 배경은 카드 기본 흰색 유지.
  claimPending: { borderColor: InkColors.ink3 },
  claimRejected: { borderColor: BrandColors.warn },
  claimHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  claimTitle: { fontSize: 14, fontWeight: '900', color: InkColors.ink },

  // 입금자명 입력 — 고정 height 대신 minHeight(글자 크기 배율에서 잘림 방지).
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    fontSize: 15,
    fontWeight: '700',
    color: InkColors.ink,
    backgroundColor: InkColors.bgSoft,
  },

  // 매장 개수 스테퍼(0130) — 버튼 48dp, 값은 가운데.
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontSize: 16, fontWeight: '900', color: InkColors.ink, minWidth: 56, textAlign: 'center' },

  // 주문 시점 동의 체크 — 48dp 터치 타깃(체크박스 단독이 아니라 행 전체가 눌린다).
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingHorizontal: 2 },
  consentText: { flex: 1, fontSize: 15, lineHeight: 22, color: InkColors.ink2, fontWeight: '600' },

  mailRow: { alignItems: 'center', paddingVertical: Space.sm },
  mailText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 },

  // 무료 이용 코드 — 접힘 상태 토글(보조 링크 톤, mailRow 계열).
  promoToggle: { alignItems: 'center', paddingVertical: Space.sm },
  promoToggleText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, textDecorationLine: 'underline' },

  primary: { backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  ghost: { paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center', backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  logoutRow: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
});
