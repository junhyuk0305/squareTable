import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PLANS, planMonthlyPrice, supplyPrice, type PlanId } from '@/lib/config/tiers';
import { formatKrw } from '@/lib/config/billing';
import { showToast } from '@/lib/store/useToastStore';
import {
  fetchMyLastCardPayment,
  rpcCardCustomerKey,
  rpcCardCancel,
  rpcCardResume,
  type CardSubscriptionRow,
  type CardPaymentRow,
} from '@/lib/db';
import { cardPrecheck, cardChange, cardErrorText, cardRpcErrorCode, openCardRegistration } from '@/lib/payments/cardBilling';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 웹 카드 정기결제(토스페이먼츠 빌링, 0208) — /billing 안의 카드 결제 블록.
//   sub = null      → 새로 결제: 금액·이용 기간·다음 결제일 → 자동결제 동의 → 토스 카드 등록창
//   sub = 살아 있음 → 관리: 다음 결제일·카드·요금제 변경·해지/해지 취소·카드 바꾸기
// ★금액은 보여주기만 한다. 실제 청구액은 서버(payment_claim_amount 0192)가 다시 계산한다.
// ⛔웹 전용(store-policy SHOW_CARD_BILLING). 네이티브 빌드에서 그리면 스토어 규정 위반이다.

const MAX_TRIES = 3; // 서버 card_record_charge 와 같은 값(첫 시도 포함 3회)

/** "10월 14일" — 해를 넘기면 연도를 붙인다. */
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function planLabel(plan: 'single' | 'multi', count: number): string {
  return plan === 'multi' ? `${PLANS.multi.name} · 매장 ${count}개` : PLANS.single.name;
}

type Props = {
  /** 살아 있는 카드 구독(active·past_due·기간 남은 canceled). 없으면 null. */
  sub: CardSubscriptionRow | null;
  selectedPlan: PlanId;
  /** 다점포일 때 고른 매장 수(single 이면 무시). */
  storeCount: number;
  userName: string | null;
  /** 지금 열린 소유 매장(잠긴 이전 매장 제외) — 줄이기 때 "닫을 매장" 후보. */
  openStores?: { unit_id: string; store_name: string }[];
  /** 이미 골라 둔 닫을 매장(iap_release_choice) — 예고 문구용. */
  releaseChoice?: string[];
  /** 해지·변경 뒤 상위 화면이 구독을 다시 읽는다. */
  onChanged: () => void;
};

export function CardBillingPanel({ sub, selectedPlan, storeCount, userName, openStores = [], releaseChoice = [], onChanged }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [lastPay, setLastPay] = useState<CardPaymentRow | null>(null);
  // 줄이기 — 닫을 매장으로 체크한 것. 고른 요금제·매장 수(key)가 바뀌면 선택은 무효(이펙트로 비우지 않고 파생으로 버린다).
  const [pick, setPick] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });

  useEffect(() => {
    if (!sub) return;
    let alive = true;
    void fetchMyLastCardPayment().then(({ data }) => {
      if (alive) setLastPay(data ?? null);
    });
    return () => {
      alive = false;
    };
  }, [sub]);

  const paidPlan = selectedPlan === 'free' ? null : selectedPlan;
  const count = selectedPlan === 'multi' ? storeCount : 1;
  const monthly = paidPlan ? planMonthlyPrice(paidPlan, count) : 0;

  // 카드 등록창 열기 — 테스트 키 기간엔 서버가 허용한 계정만 연다(precheck). 창을 띄운 뒤에 막히면 카드만 입력하고 헛걸음한다.
  const openRegistration = async (successPath: string) => {
    const pre = await cardPrecheck();
    if (!pre.ok || !pre.body.open) {
      showToast(cardErrorText(pre.body.reason ?? pre.body.error));
      return;
    }
    const { data: customerKey, error } = await rpcCardCustomerKey();
    if (error || !customerKey) {
      showToast(cardErrorText(cardRpcErrorCode(error?.message)));
      return;
    }
    const r = await openCardRegistration({ customerKey, successPath, customerName: userName });
    if (r === 'error') showToast('카드 등록창을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
  };

  // ── 관리 ────────────────────────────────────────────────────────────────
  if (sub) {
    const active = sub.status === 'active';
    const pastDue = sub.status === 'past_due';
    const canceled = sub.status === 'canceled';
    const differs = !!paidPlan && (paidPlan !== sub.plan || count !== sub.store_count);
    const increase = differs && monthly > sub.amount_krw;
    const triesLeft = Math.max(0, MAX_TRIES - sub.fail_count);
    // ★닫을 수 = 열린 매장 수 − 새 매장 수(서버 card_begin_change 와 같은 규칙). 구독 매장 수로 세면
    //   매장을 덜 만든 사장의 줄이기 버튼이 영영 안 켜진다(iOS A-1 결함).
    const pickKey = `${paidPlan}:${count}`;
    const need = differs && !increase ? Math.max(0, openStores.length - count) : 0;
    const release = pick.key === pickKey ? pick.ids.filter((id) => openStores.some((s) => s.unit_id === id)) : [];
    const releaseReady = release.length === need;
    const toggleRelease = (id: string) =>
      setPick({ key: pickKey, ids: release.includes(id) ? release.filter((x) => x !== id) : [...release, id] });
    const closingNames = releaseChoice
      .map((id) => openStores.find((s) => s.unit_id === id)?.store_name)
      .filter((n): n is string => !!n);

    const change = async () => {
      if (!paidPlan || !releaseReady) return;
      setBusy(true);
      const r = await cardChange({ plan: paidPlan, storeCount: count, ...(need > 0 ? { releaseUnits: release } : {}) });
      setBusy(false);
      if (!r.ok) return showToast(cardErrorText(r.body.error, r.body.message));
      if (r.body.mode === 'charged') showToast(`차액 ${formatKrw(Number(r.body.amount) || 0)}을 결제했어요. 바로 적용됐어요.`, 'good');
      else if (r.body.mode === 'scheduled') showToast(`${fmtDay(r.body.effective_at)}부터 바뀌어요.`, 'good');
      else if (r.body.mode === 'pending') showToast('결제를 확인하고 있어요. 잠시 후 새로고침해 주세요.');
      else showToast('변경 예약을 취소했어요.');
      onChanged();
    };
    // 줄이기 예고 취소 = 지금 요금제를 다시 고름(서버 mode 'none' — 닫을 매장 명단도 같이 비운다).
    const cancelSchedule = async () => {
      setBusy(true);
      const r = await cardChange({ plan: sub.plan, storeCount: sub.store_count });
      setBusy(false);
      if (!r.ok) return showToast(cardErrorText(r.body.error, r.body.message));
      showToast('변경 예약을 취소했어요.', 'good');
      onChanged();
    };
    const cancel = async () => {
      setBusy(true);
      const { error } = await rpcCardCancel();
      setBusy(false);
      setConfirmCancel(false);
      if (error) return showToast(cardErrorText(cardRpcErrorCode(error.message)));
      showToast(pastDue ? '자동결제를 멈췄어요.' : `자동결제를 해지했어요. ${fmtDay(sub.current_period_end)}까지 이용할 수 있어요.`, 'good');
      onChanged();
    };
    const resume = async () => {
      setBusy(true);
      const { error } = await rpcCardResume();
      setBusy(false);
      if (error) return showToast(cardErrorText(cardRpcErrorCode(error.message)));
      showToast('해지를 취소했어요. 자동결제가 계속돼요.', 'good');
      onChanged();
    };
    const updateCard = async () => {
      setBusy(true);
      await openRegistration('/billing-card?mode=update');
      setBusy(false);
    };

    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>카드 자동결제</Text>

        {pastDue && (
          <View style={[styles.card, styles.warnCard]}>
            <View style={styles.head}>
              <Ionicons name="alert-circle-outline" size={18} color={BrandColors.warn} />
              <Text style={styles.headTitle}>카드 결제가 승인되지 않았어요</Text>
            </View>
            {!!sub.last_fail_message && <Text style={styles.body}>{sub.last_fail_message}</Text>}
            <Text style={styles.hint}>
              {triesLeft > 0
                ? `카드를 바꾸면 바로 다시 결제해요. 그대로 두면 ${fmtDay(sub.next_charge_at)}에 다시 시도하고, ${triesLeft}번 더 승인되지 않으면 자동결제가 멈춰요.`
                : '카드를 바꾸면 바로 다시 결제해요.'}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Row label="요금제" value={planLabel(sub.plan, sub.store_count)} />
          <Row label="월 결제 금액" value={formatKrw(sub.amount_krw)} strong />
          <Row label="이용 기간" value={`${fmtDay(sub.current_period_start)} ~ ${fmtDay(sub.current_period_end)}`} />
          {active && <Row label="다음 결제" value={fmtDay(sub.next_charge_at ?? sub.current_period_end)} />}
          {!!sub.card_number && <Row label="카드" value={`${sub.card_company ?? ''} ${sub.card_number}`.trim()} />}
          {active && sub.pending_plan && (
            <Text style={styles.hint}>
              {fmtDay(sub.current_period_end)}부터 {planLabel(sub.pending_plan, sub.pending_store_count ?? 1)}(월{' '}
              {formatKrw(planMonthlyPrice(sub.pending_plan, sub.pending_store_count ?? 1))})로 바뀌어요.
              {closingNames.length > 0 ? ` 그날 ${closingNames.join(' · ')}이 닫혀요.` : ''}
            </Text>
          )}
          {canceled && (
            <Text style={styles.body}>
              자동결제를 해지했어요. {fmtDay(sub.current_period_end)}까지 이용할 수 있고, 그 뒤로는 결제되지 않아요.
            </Text>
          )}
          {!sub.livemode && <Text style={styles.hint}>테스트 결제 환경이에요. 실제로 청구되지 않아요.</Text>}
          {!!lastPay?.receipt_url && (
            // ios-preflight: ok 웹 전용 패널(SHOW_CARD_BILLING) — 목적지는 토스 매출전표, 결제 페이지가 아니다
            <Pressable onPress={() => void Linking.openURL(lastPay.receipt_url as string)} accessibilityRole="link">
              <Text style={styles.link}>최근 결제 영수증 보기 ({formatKrw(lastPay.amount_krw)})</Text>
            </Pressable>
          )}
        </View>

        {active && differs && need > 0 && (
          /* 줄이기 — 다음 결제일에 닫을 매장을 사장이 고른다(서버가 오래된 순으로 대신 고르지 않는다). */
          <View style={styles.card}>
            <Text style={styles.body}>
              {fmtDay(sub.current_period_end)}에 닫을 매장 {need}곳을 골라 주세요.
            </Text>
            {openStores.map((s) => {
              const on = release.includes(s.unit_id);
              const full = !on && release.length >= need;
              return (
                <Pressable
                  key={s.unit_id}
                  disabled={full || busy}
                  onPress={() => toggleRelease(s.unit_id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: full }}
                  accessibilityLabel={`${s.store_name} 닫기`}
                  style={({ pressed }) => [styles.storeRow, on && styles.storeRowOn, full && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? InkColors.ink : InkColors.ink3} />
                  <Text style={styles.storeName} numberOfLines={1}>{s.store_name}</Text>
                  {on && <Text style={styles.hint}>닫힘 예정</Text>}
                </Pressable>
              );
            })}
            <Text style={styles.hint}>닫힌 매장은 설정의 이전 매장에 보관돼요. 노하우·퀴즈·채팅은 남아요.</Text>
          </View>
        )}

        {active && !differs && !!sub.pending_plan && (
          <Pressable
            disabled={busy}
            onPress={() => void cancelSchedule()}
            style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>변경 예약 취소</Text>
          </Pressable>
        )}

        {active && differs && (
          <>
            <Pressable
              disabled={busy || !releaseReady}
              onPress={() => void change()}
              style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, (busy || !releaseReady) && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {increase ? '지금 바로 변경하기' : '다음 결제일부터 변경하기'} · {planLabel(paidPlan as 'single' | 'multi', count)}
                </Text>
              )}
            </Pressable>
            <Text style={styles.hint}>
              {increase
                ? `남은 이용 기간만큼의 차액이 등록된 카드로 바로 결제되고, 다음 결제일부터 월 ${formatKrw(monthly)}이 결제돼요.`
                : `${fmtDay(sub.current_period_end)}까지는 지금 요금제를 그대로 쓰고, 그 뒤로 월 ${formatKrw(monthly)}이 결제돼요.`}
            </Text>
          </>
        )}
        {active && selectedPlan === 'free' && (
          <Text style={styles.hint}>무료로 바꾸려면 아래에서 자동결제를 해지하세요. 이용 기간이 끝나면 무료 요금제로 바뀌어요.</Text>
        )}

        {canceled && (
          <Pressable
            disabled={busy}
            onPress={() => void resume()}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>해지 취소하기</Text>}
          </Pressable>
        )}

        {(active || pastDue) && (
          <Pressable
            disabled={busy}
            onPress={() => void updateCard()}
            style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>카드 바꾸기</Text>
          </Pressable>
        )}

        {(active || pastDue) &&
          (!confirmCancel ? (
            <Pressable onPress={() => setConfirmCancel(true)} style={styles.linkRow} accessibilityRole="button">
              <Text style={styles.linkMuted}>자동결제 해지</Text>
            </Pressable>
          ) : (
            <View style={styles.card}>
              <Text style={styles.body}>
                {pastDue
                  ? '해지하면 다시 결제하지 않고 무료 요금제로 바뀌어요.'
                  : `해지하면 ${fmtDay(sub.current_period_end)} 이후로 결제되지 않아요. 그날까지는 지금처럼 쓸 수 있어요.`}
              </Text>
              <View style={styles.confirmRow}>
                <Pressable onPress={() => setConfirmCancel(false)} style={[styles.ghost, styles.flex1]} accessibilityRole="button">
                  <Text style={styles.ghostText}>계속 이용</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void cancel()}
                  style={[styles.danger, styles.flex1, busy && { opacity: 0.6 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.dangerText}>해지하기</Text>
                </Pressable>
              </View>
            </View>
          ))}
      </View>
    );
  }

  // ── 새로 결제 ────────────────────────────────────────────────────────────
  if (!paidPlan) return null;
  const supply = supplyPrice(monthly);
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  next.setDate(next.getDate() - 1);

  const start = async () => {
    if (!agreed) {
      showToast('자동결제 조건에 동의해 주세요');
      return;
    }
    setBusy(true);
    await openRegistration(`/billing-card?mode=subscribe&plan=${paidPlan}&stores=${count}`);
    setBusy(false);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>카드 자동결제</Text>
      <View style={styles.card}>
        <Row label="오늘 결제" value={formatKrw(monthly)} strong />
        <Text style={styles.hint}>
          공급가액 {formatKrw(supply)} + 부가세 {formatKrw(monthly - supply)}이에요.
          {selectedPlan === 'multi' ? ` 매장 ${count}개 × ${formatKrw(PLANS.multi.monthlyKrw)} 기준이에요.` : ''}
        </Text>
        <Row label="이용 기간" value="결제일부터 1개월" />
        <Row label="다음 결제" value={`${fmtDay(next.toISOString())} · ${formatKrw(monthly)}`} />
        <Text style={styles.hint}>
          결제하면 바로 열려요. 이후 이용 기간이 끝나기 전날 같은 금액이 자동으로 결제되고, 약정 없이 이 화면에서 언제든 해지할 수 있어요.
          카드 정보는 토스페이먼츠가 보관해요.
        </Text>
      </View>

      <Pressable
        onPress={() => setAgreed((v) => !v)}
        style={({ pressed }) => [styles.consentRow, pressed && { opacity: 0.7 }]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        accessibilityLabel="카드 자동결제 조건 동의"
      >
        <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? InkColors.ink : InkColors.ink3} />
        <Text style={styles.consentText}>
          매월 {formatKrw(monthly)}이 자동 결제되는 조건(결제 주기·해지 방법)과 환불 규정(이용약관 제13조)을 확인했어요.
        </Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={() => void start()}
        style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>카드 등록하고 결제하기</Text>}
      </Pressable>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  warnCard: { borderColor: BrandColors.warn },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  headTitle: { fontSize: 14, fontWeight: '900', color: InkColors.ink },
  body: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  hint: { fontSize: 12, color: InkColors.ink3, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  rowLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  rowValue: { flexShrink: 1, textAlign: 'right', fontSize: 14, color: InkColors.ink, fontWeight: '700' },
  rowValueStrong: { fontSize: 15, fontWeight: '900' },
  link: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, textDecorationLine: 'underline' },
  linkRow: { alignItems: 'center', paddingVertical: Space.sm },
  linkMuted: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, textDecorationLine: 'underline' },
  storeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48,
    paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
  },
  storeRowOn: { borderColor: InkColors.ink, borderWidth: 2 },
  storeName: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingHorizontal: 2 },
  consentText: { flex: 1, fontSize: 15, lineHeight: 22, color: InkColors.ink2, fontWeight: '600' },
  primary: { backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  ghost: { paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center', backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  danger: { paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BrandColors.warn },
  dangerText: { fontSize: 14, fontWeight: '800', color: BrandColors.warn },
  confirmRow: { flexDirection: 'row', gap: Space.sm },
  flex1: { flex: 1 },
});
