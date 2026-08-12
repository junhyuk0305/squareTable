import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { showToast } from '@/lib/store/useToastStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchDowngradeNeed, fetchMyFreeUnits, fetchStaffProfiles,
  rpcChooseKeptStore, rpcChooseKeptSeats, type DowngradeNeed,
} from '@/lib/db';
// 금액은 전부 tiers.ts 가 계산한다. 표시가는 **공급가액 + "부가세 별도"** — 제품 전체가 쓰는 규칙이고
// 실제 입금액(withVat)은 /billing 이 말한다. 여기서 두 번 말하면 숫자가 두 개로 읽힌다.
import { PLANS, planMonthlyPrice, VAT_NOTE_SENTENCE, type PlanId } from '@/lib/config/tiers';
import { formatKrw } from '@/lib/config/billing';
import { PAYMENT_SLA_SENTENCE } from '@/lib/config/business';
import { SHOW_BILLING } from '@/lib/config/store-policy';
import { StepProgress } from '@/components/blocks/StepProgress';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER } from '@/lib/theme/layout';

// ── 체험이 끝났을 때 무엇을 남길지 고르는 화면 (0142·0144) ────────────────────
// ★이 화면의 값어치는 **갈림길**에 있다. "무엇을 버릴지 고르기"와 "요금제로 전부 지키기"를
//   같은 무게로 놓는다(2026-08-12 D6) — 체험 종료 시점이 이 제품의 유일한 자연스러운
//   결제 요청 시점이기 때문이다. 고르기 마법사만 만들면 그 자리를 통째로 버리는 것이다.
//
// 층: 허브·매장과 **같은 루트 레벨**. owner/ 안에 두면 활성 매장이 잠긴 순간 진입이 막혀 계정이 갇힌다.
// 복잡도: C 몰입형(블록 ≤3 · 고르기 단계에 상단 n/m).
// 판정은 전부 서버가 갖는다(needs_downgrade_choice · my_free_units) — 화면은 결과만 그린다.
//
// ★Primary 를 두지 않는 화면이 하나 있다(갈림길). 세 갈래는 **동등한 선택지**라서 하나를 검은
//   버튼으로 올리면 그 순간 D6 이 깨진다. 고르기 단계에서는 Primary 가 1개다.

type Step = 'fork' | 'store' | 'seats';
type StaffRow = { id: string; name: string };

// 서버 named 에러 → 사장이 읽을 문장. 판정은 서버, 문구는 여기 한 곳(§② SSOT).
const CHOICE_ERROR_TEXT: Record<string, string> = {
  not_owner: '사장님 계정에서만 고를 수 있어요.',
  unit_not_free: '이미 요금제가 적용된 매장이에요. 고르지 않아도 그대로 열려 있어요.',
  too_many_seats: '무료 요금제는 직원 3명까지예요. 3명까지만 골라주세요.',
  no_seats_chosen: '함께할 직원을 한 명 이상 골라주세요.',
  not_a_member: '지금 이 매장에서 일하는 직원만 고를 수 있어요.',
  unknown: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
};
function choiceErrorText(message?: string): string {
  const m = message ?? '';
  for (const key of Object.keys(CHOICE_ERROR_TEXT)) {
    if (key !== 'unknown' && m.includes(key)) return CHOICE_ERROR_TEXT[key];
  }
  return CHOICE_ERROR_TEXT.unknown;
}

export default function DowngradeScreen() {
  const status = useSessionStore((s) => s.status);
  const phone = useSessionStore((s) => s.phone);
  const unitId = useSessionStore((s) => s.unitId);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);

  // 게이트(stores.tsx 와 동일 규칙) — 루트 레벨이라 owner/junior 그룹 게이트를 안 탄다.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }
  return <DowngradeBody />;
}

function DowngradeBody() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const activeUnitId = useSessionStore((s) => s.unitId);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [need, setNeed] = useState<DowngradeNeed | null>(null);
  // ★진행 표시(n/m)의 기준은 **시작 시점**이다. 단계마다 서버 판정을 다시 읽는데 그때그때 세면,
  //   매장을 고른 직후 need_store 가 false 로 바뀌면서 "1 / 2" 가 "1 / 1" 로 되돌아간다
  //   (실브라우저 QA 가 잡은 것). 시작 스냅샷을 따로 붙잡아 둔다.
  const [firstNeed, setFirstNeed] = useState<DowngradeNeed | null>(null);
  const [freeUnitIds, setFreeUnitIds] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [step, setStep] = useState<Step>('fork');
  const [pickedStore, setPickedStore] = useState<string | null>(null);
  const [pickedSeats, setPickedSeats] = useState<string[]>([]);

  // 서버 판정 재조회 — 단계가 끝날 때마다 부른다(무엇이 남았는지 클라가 추측하지 않는다).
  const reload = useCallback(async () => {
    const [{ data: n }, { data: free }] = await Promise.all([fetchDowngradeNeed(), fetchMyFreeUnits()]);
    setNeed(n);
    setFirstNeed((prev) => prev ?? n);
    setFreeUnitIds(free ?? []);
    return n;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const n = await reload();
      const { staff: rows } = await fetchStaffProfiles();
      if (!alive) return;
      setStaff(rows.map((r) => ({ id: r.id, name: r.name || '이름 없음' })));
      // 매장이 이미 정해졌으면 직원 단계부터 — 없는 단계를 보여주지 않는다.
      if (n && !n.need_store && n.need_seats) setStep('seats');
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reload]);

  const exitToHub = useCallback(async () => {
    await refreshMembership();
    router.replace('/hub');
  }, [refreshMembership, router]);

  // 소유 매장 수 — 다점포 금액의 곱셈 인자(설계 §7-1: 사장의 실제 숫자로 말한다).
  const ownedCount = Math.max(stores.filter((s) => s.role === 'owner').length, 1);
  const staffCount = staff.length;
  const freeStores = stores.filter((s) => freeUnitIds.includes(s.unit_id));

  const goBilling = (plan: PlanId) => {
    // ★거기서 다시 고르게 하면 이 화면에서 한 결정이 버려진다 → 요금제·매장수를 실어 보낸다.
    if (!SHOW_BILLING) return showToast('요금제를 바꾸려면 관리자에게 문의해 주세요.');
    router.push(`/billing?plan=${plan}&stores=${plan === 'multi' ? ownedCount : 1}`);
  };

  const submitStore = async () => {
    if (!pickedStore || busy) return;
    setBusy(true);
    const { error } = await rpcChooseKeptStore(pickedStore);
    if (error) { setBusy(false); return showToast(choiceErrorText(error.message)); }
    const n = await reload();
    // 매장을 고르면 활성 매장이 그 매장으로 옮겨진다(서버) → 직원 목록을 다시 읽는다.
    const { staff: rows } = await fetchStaffProfiles();
    setStaff(rows.map((r) => ({ id: r.id, name: r.name || '이름 없음' })));
    setPickedSeats([]);
    setBusy(false);
    if (n?.need_seats) setStep('seats');
    else await exitToHub();
  };

  const submitSeats = async () => {
    if (pickedSeats.length === 0 || busy) return;
    setBusy(true);
    const { error } = await rpcChooseKeptSeats(pickedSeats);
    setBusy(false);
    if (error) return showToast(choiceErrorText(error.message));
    await exitToHub();
  };

  const toggleSeat = (id: string) => {
    setPickedSeats((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) { showToast('무료 요금제는 직원 3명까지예요.'); return prev; }
      return [...prev, id];
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}><ActivityIndicator color={InkColors.ink} /></View>
      </SafeAreaView>
    );
  }
  // 고를 것이 없으면 이 화면은 존재 이유가 없다 — 가로막지 않는다.
  if (!need || (!need.need_store && !need.need_seats)) return <Redirect href="/hub" />;

  // 매장 단계를 지나온 사람에게 직원 단계는 2번째다. 직원 단계만 있는 사람에겐 1번째다.
  // 마지막 단계에서는 n == m 이 되게 둔다 — 실제로 몇 단계였는지는 그때 확정된다.
  const storeStepPlanned = firstNeed?.need_store === true;
  const seatStepNo = storeStepPlanned ? 2 : 1;
  const storeStepTotal = firstNeed?.need_seats || need.need_seats ? 2 : 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {step === 'fork' ? (
          <ForkView
            need={need}
            ownedCount={ownedCount}
            staffCount={staffCount}
            onFree={() => setStep(need.need_store ? 'store' : 'seats')}
            onPlan={goBilling}
          />
        ) : step === 'store' ? (
          <>
            <Appear delay={0}>
              <StepProgress step={1} total={storeStepTotal} title="남길 매장" />
            </Appear>
            <Appear delay={60}>
              <View style={styles.head}>
                <Text style={styles.h1}>무료로 남길 매장을 골라주세요</Text>
                <Text style={styles.sub}>
                  고르지 않은 매장은 지금은 잠겨요. 매장과 그 안의 기록은 그대로 있고,
                  요금제를 적용하면 바로 다시 열려요.
                </Text>
              </View>
            </Appear>
            <Appear delay={120}>
              <View style={styles.list}>
                {freeStores.map((s) => (
                  <PickRow
                    key={s.unit_id}
                    icon="storefront-outline"
                    title={s.store_name || '내 매장'}
                    meta={s.unit_id === activeUnitId ? '지금 보고 있는 매장' : undefined}
                    selected={pickedStore === s.unit_id}
                    onPress={() => setPickedStore(s.unit_id)}
                  />
                ))}
              </View>
            </Appear>
            <FooterActions
              label="이 매장 남기기"
              disabled={!pickedStore || busy}
              busy={busy}
              onPress={submitStore}
              onPlan={() => setStep('fork')}
            />
          </>
        ) : (
          <>
            <Appear delay={0}>
              <StepProgress step={seatStepNo} total={seatStepNo} title="계속 함께할 직원" />
            </Appear>
            <Appear delay={60}>
              <View style={styles.head}>
                <Text style={styles.h1}>계속 함께할 직원을 골라주세요</Text>
                <Text style={styles.sub}>
                  무료 요금제는 직원 3명까지예요. 고르지 않은 직원은 앱을 잠시 못 쓰지만
                  기록은 그대로 남고, 요금제를 적용하면 바로 다시 열려요.
                </Text>
              </View>
            </Appear>
            <Appear delay={120}>
              <View style={styles.list}>
                {staff.map((p) => (
                  <PickRow
                    key={p.id}
                    icon="person-outline"
                    title={p.name}
                    selected={pickedSeats.includes(p.id)}
                    onPress={() => toggleSeat(p.id)}
                  />
                ))}
              </View>
            </Appear>
            <FooterActions
              // 아직 아무도 안 골랐을 때 "0명 남기기"는 할 수 없는 일을 적은 버튼이 된다.
              label={pickedSeats.length > 0 ? `${pickedSeats.length}명 남기기` : '남길 직원 고르기'}
              disabled={pickedSeats.length === 0 || busy}
              busy={busy}
              onPress={submitSeats}
              onPlan={() => setStep('fork')}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 갈림길 ───────────────────────────────────────────────────────────────────
// 사장의 **실제 숫자**로 "이 요금제가 무엇을 지켜주는가"를 말한다. 일반적인 가격표를 다시 그리지 않는다.
// 금액은 전부 tiers.ts 에서 계산한다 — 이 파일에 숫자를 적지 않는다(SSOT).
function ForkView({
  need, ownedCount, staffCount, onFree, onPlan,
}: {
  need: DowngradeNeed;
  ownedCount: number;
  staffCount: number;
  onFree: () => void;
  onPlan: (plan: PlanId) => void;
}) {
  const singlePrice = planMonthlyPrice('single', 1);
  const multiPrice = planMonthlyPrice('multi', ownedCount);
  const perStore = PLANS.multi.monthlyKrw;

  return (
    <>
      <Appear delay={0}>
        <View style={styles.head}>
          <Text style={styles.h1}>무료 기간이 끝났어요</Text>
          <Text style={styles.sub}>
            지금 매장 {ownedCount}곳 · 직원 {staffCount}명이에요.
            무료 요금제는 매장 {PLANS.free.maxStores}곳 · 직원 {PLANS.free.maxStaff}명까지예요.
          </Text>
        </View>
      </Appear>

      {/* 세 갈래는 동등한 선택지다 — 하나를 Primary 로 올리지 않는다(D6). */}
      <Appear delay={80}>
        <View style={styles.list}>
          <OptionRow
            title="무료로 계속하기"
            price="0원"
            body={`매장 ${PLANS.free.maxStores}곳 · 직원 ${PLANS.free.maxStaff}명 — 남길 것을 직접 고르세요`}
            onPress={onFree}
          />
          {SHOW_BILLING && (
            <>
              <OptionRow
                title={`${PLANS.single.name} 요금제`}
                price={formatKrw(singlePrice)}
                body={`매장 1곳 · 직원 ${staffCount}명 전원 그대로`}
                onPress={() => onPlan('single')}
              />
              <OptionRow
                title={`${PLANS.multi.name} 요금제`}
                price={formatKrw(multiPrice)}
                body={`매장 ${ownedCount}곳 · 직원 ${staffCount}명 전원 그대로 (${formatKrw(perStore)} × ${ownedCount})`}
                onPress={() => onPlan('multi')}
              />
            </>
          )}
        </View>
      </Appear>

      <Appear delay={160}>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{VAT_NOTE_SENTENCE}</Text>
          {SHOW_BILLING && <Text style={styles.noteText}>{PAYMENT_SLA_SENTENCE}</Text>}
          <Text style={styles.noteText}>
            {need.need_store
              ? '고르지 않은 매장은 지워지지 않고 잠겨요. 요금제를 적용하면 그대로 돌아와요.'
              : '고르지 않은 직원은 지워지지 않고 잠겨요. 요금제를 적용하면 그대로 돌아와요.'}
          </Text>
        </View>
      </Appear>
    </>
  );
}

function OptionRow({ title, price, body, onPress }: { title: string; price: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.optionCard, pressed && { opacity: 0.9 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: Space.xs }}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionPrice}>{price}</Text>
        </View>
        <Text style={styles.optionBody}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
    </Pressable>
  );
}

// 고르기 행 — 선택 상태를 색만으로 말하지 않는다(체크 아이콘 + '선택함' 라벨 병기).
function PickRow({
  icon, title, meta, selected, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  meta?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.pickRow, selected && styles.pickRowOn, pressed && { opacity: 0.9 }]}
    >
      <View style={[styles.pickIcon, selected && styles.pickIconOn]}>
        <Ionicons name={selected ? 'checkmark' : icon} size={20} color={selected ? InkColors.bubbleText : InkColors.ink2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.pickTitle} numberOfLines={1}>{title}</Text>
        {!!meta && <Text style={styles.pickMeta} numberOfLines={1}>{meta}</Text>}
      </View>
      {selected && <Text style={styles.pickBadge}>선택함</Text>}
    </Pressable>
  );
}

function FooterActions({
  label, disabled, busy, onPress, onPlan,
}: { label: string; disabled: boolean; busy: boolean; onPress: () => void; onPlan: () => void }) {
  return (
    <Appear delay={180}>
      <View style={styles.footer}>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          style={({ pressed }) => [styles.primary, disabled && styles.primaryOff, pressed && !disabled && { opacity: 0.88 }]}
        >
          {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>{label}</Text>}
        </Pressable>
        {/* 고르다가 "이럴 바엔 요금제"가 실제 전환 지점이다 — 두 단계 모두에서 되돌아갈 수 있어야 한다. */}
        <Pressable onPress={onPlan} hitSlop={8} style={styles.link}>
          <Text style={styles.linkText}>요금제로 전부 지키기</Text>
        </Pressable>
      </View>
    </Appear>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: SCREEN_GUTTER, gap: Space.xl, paddingBottom: 40 },

  head: { gap: Space.sm },
  h1: { fontSize: 24, lineHeight: 33, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, lineHeight: 23, color: InkColors.ink2 },

  list: { gap: Space.md },

  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    minHeight: 56,
    ...Elevation.e2,
  },
  // 금액은 오른쪽 끝에 세운다 — 세 줄의 숫자가 같은 축에 서야 비교가 된다(이 화면의 목적).
  optionTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Space.sm },
  optionTitle: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 23, fontWeight: '900', color: InkColors.ink },
  optionPrice: { fontSize: 16, lineHeight: 23, fontWeight: '900', color: InkColors.ink },
  optionBody: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },

  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    minHeight: 56,
  },
  pickRowOn: { borderColor: InkColors.ink, ...Elevation.e1 },
  pickIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center',
  },
  pickIconOn: { backgroundColor: InkColors.ink },
  pickTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  pickMeta: { fontSize: 12, lineHeight: 17, color: InkColors.ink3, marginTop: 2 },
  pickBadge: {
    fontSize: 11, fontWeight: '900', color: InkColors.ink,
    backgroundColor: BrandColors.yellowSoft, borderWidth: 1, borderColor: BrandColors.gold,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.pill, overflow: 'hidden',
  },

  noteBox: { gap: Space.sm, backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.lg },
  noteText: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },

  footer: { gap: Space.md },
  primary: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BrandColors.brand, borderRadius: Radius.md,
    paddingVertical: 16, minHeight: 56,
  },
  primaryOff: { opacity: 0.35 },
  primaryText: { color: InkColors.bubbleText, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  link: { alignItems: 'center', paddingVertical: Space.sm, minHeight: 48, justifyContent: 'center' },
  linkText: { fontSize: 15, lineHeight: 22, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },
});
