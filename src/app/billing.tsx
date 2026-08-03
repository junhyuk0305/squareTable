import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { logout } from '@/lib/auth';
import { showToast } from '@/lib/store/useToastStore';
import { deriveSubscription } from '@/lib/utils/subscription';
import { canManage } from '@/lib/utils/roles';
import { BILLING_INFO, formatKrw } from '@/lib/config/billing';
import { PLANS, PLAN_ORDER, planMonthlyPrice, withVat, VAT_NOTE_SENTENCE, type PlanId } from '@/lib/config/tiers';
import { SHOW_BILLING } from '@/lib/config/store-policy';
import { usePaymentClaimStore, CLAIM_ERROR_TEXT } from '@/lib/store/usePaymentClaimStore';
import { redeemPromoCode } from '@/lib/db';
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
  const subStatus = useSessionStore((s) => s.subStatus);
  const trialEndsAt = useSessionStore((s) => s.trialEndsAt);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const plan = useSessionStore((s) => s.plan);
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
  // 무료 이용 코드(0092) — 기본 접힘(화면 요소 예산). 검증·기록·활성화는 전부 서버 RPC.
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  // 선택 요금제 — 초기값은 현재 요금제. 다점포 금액 = 소유 매장수 × 매장당 가격(tiers.ts).
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(plan);
  // 세션 plan이 마운트 뒤에 로드/변경되면(웹 새로고침 직진입, 30초 폴링 중 활성화 반영) 선택을
  // 재동기화한다. 단 사용자가 직접 고른 뒤에는 덮어쓰지 않는다(선택 유지).
  const planTouched = useRef(false);
  useEffect(() => {
    if (!planTouched.current) setSelectedPlan(plan);
  }, [plan]);
  const ownedCount = Math.max(1, stores.filter((st) => st.role === 'owner').length);
  const monthlyTotal = planMonthlyPrice(selectedPlan, ownedCount); // 공급가액(표시가)
  const monthlyBilled = withVat(monthlyTotal); // 실제 입금 요청액 — 서버 payment_claim_amount(0106)와 같은 값

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
    setClaiming(true);
    const res = await submitPaymentClaim({ plan: selectedPlan, amountKrw: monthlyBilled, depositorName: name });
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
    const subject = `착착 입금 완료 알림${storeName ? ` — ${storeName}` : ''}`;
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

  // 상태 문구 — 제품 모델은 freemium(무료 영구 + 유료 single/multi)라 '무료체험' 개념이 없다.
  // (신규 매장 구독행이 legacy 로 status='trialing'+3일로 생기지만, plan='free' 가 deriveSubscription
  //  에서 영구 active 로 우선 처리해 표면화되지 않는다 — 여기서도 trial 문구를 쓰지 않는다.)
  const headline =
    view.state === 'expired'
      ? isOwner
        ? '이용 기간이 만료됐어요'
        : '잠시 이용이 중단됐어요'
      : plan === 'free'
        ? '무료 요금제로 이용 중이에요'
        : '이용 중이에요';

  // ── iOS 네이티브: 결제 표면 전면 차단 (App Review 3.1.3(f)) ────────────────────────
  // 계좌·금액·요금제 선택·입금 버튼을 모두 제거한다. "웹에서 결제하세요" 같은 안내도
  // call to action 에 해당하므로 넣지 않는다(3.1.1(a) — 한국 스토어프론트는 아웃링크도 금지).
  // 만료 시 owner/junior 레이아웃이 이 라우트로 강제 이동시키므로 라우트 자체는 살려두고,
  // 사실 고지 + 상태 새로고침 + 로그아웃만 남긴다.
  if (!SHOW_BILLING) {
    const expired = view.state === 'expired';
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
            <Text style={styles.title}>{expired ? '지금은 이용할 수 없어요' : '이용 중이에요'}</Text>
            {!!storeName && <Text style={styles.store}>{storeName}</Text>}
          </View>
          </Appear>
          <Appear delay={60}>
          <View style={styles.card}>
            <Text style={styles.body}>
              {expired
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
              name={view.state === 'expired' ? 'lock-closed-outline' : 'sparkles-outline'}
              size={26}
              color={view.state === 'expired' ? BrandColors.warn : InkColors.ink}
            />
          </View>
          <Text style={styles.title}>{headline}</Text>
          {!!storeName && <Text style={styles.store}>{storeName}</Text>}
        </View>
        </Appear>

        {/* 직원: 계좌 정보 대신 사장 결제 안내만 */}
        {!isOwner ? (
          <Appear delay={60}>
          <View style={styles.card}>
            <Text style={styles.body}>
              {view.state === 'expired'
                ? '매장의 이용 기간이 끝났어요. 사장님이 이용을 연장하면 바로 다시 쓸 수 있어요.'
                : '이용에 문제가 없어요.'}
            </Text>
          </View>
          </Appear>
        ) : (
          <>
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
                {/* 안내 문구 */}
                <Appear delay={120}>
                <View style={styles.card}>
                  <Text style={styles.body}>
                    {view.state === 'expired'
                      ? '아래 계좌로 이용료를 입금하시면, 확인 후 이용이 다시 열려요.'
                      : '계속 이용하려면 아래 계좌로 이용료를 입금해 주세요. 확인 후 반영돼요.'}
                  </Text>
                </View>
                </Appear>

                {/* 계좌 정보 */}
                <Appear delay={120}>
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>입금 계좌</Text>
                  <View style={styles.card}>
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
                      <Text style={styles.hint}>
                        매장 {ownedCount}개 × {formatKrw(PLANS.multi.monthlyKrw)} 기준이에요. 매장을 추가하면 매장수만큼 계산돼요.
                      </Text>
                    )}
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
                      {'\n'}확인되면 따로 누르지 않아도 바로 열려요.
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

                {/* 입금자명 — 계좌이체 대사의 유일한 키. 지금까지 안 받아서 운영자가 맞출 방법이 없었다. */}
                <Appear delay={120}>
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>입금자명</Text>
                  <View style={styles.card}>
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
                    placeholder="CHACHAK7"
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
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FBF3E2', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  store: { fontSize: 14, color: InkColors.ink2, fontWeight: '600' },

  section: { gap: Space.md },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginLeft: 2 },

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
