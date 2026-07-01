import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { showToast } from '@/lib/store/useToastStore';
import { deriveSubscription } from '@/lib/utils/subscription';
import { BILLING_INFO, formatKrw } from '@/lib/config/billing';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 구독 만료/계좌이체 안내 화면. 만료된 매장은 각 역할 레이아웃이 여기로 강제 라우팅한다.
// 사장 = 계좌이체 안내 + 입금 알림. 직원 = "사장님이 결제하면 다시 열려요" 고지.
// 결제는 수동(계좌이체) — 입금 확인 후 운영자가 admin_activate_store 로 active 전환하면
// 새로고침(refreshMembership) 시 게이트가 풀린다.
export default function BillingScreen() {
  const router = useRouter();
  const role = useSessionStore((s) => s.role);
  const storeName = useSessionStore((s) => s.storeName);
  const subStatus = useSessionStore((s) => s.subStatus);
  const trialEndsAt = useSessionStore((s) => s.trialEndsAt);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);

  const view = deriveSubscription({ subStatus, trialEndsAt, paidUntil });
  const isOwner = role === 'owner';
  const [busy, setBusy] = useState(false);

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
    });
    if (v.entitled) router.replace(isOwner ? '/owner/dashboard' : '/junior/home');
    else showToast('아직 활성화 전이에요. 입금 확인 후 반영돼요.');
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

  const notifyPaid = () => {
    // 백엔드 알림 파이프라인은 미구현 — 사용자가 아래 연락처로 직접 알리도록 안내한다.
    showToast('입금 확인 후 이용이 자동 활성화돼요.');
  };

  const headline =
    view.state === 'expired'
      ? isOwner
        ? '이용 기간이 만료됐어요'
        : '잠시 이용이 중단됐어요'
      : view.state === 'trialing'
        ? `무료체험 ${view.daysLeft}일 남았어요`
        : '이용 중이에요';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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

        {/* 직원: 계좌 정보 대신 사장 결제 안내만 */}
        {!isOwner ? (
          <View style={styles.card}>
            <Text style={styles.body}>
              {view.state === 'expired'
                ? '가게의 이용 기간이 끝났어요. 사장님이 이용을 연장하면 바로 다시 쓸 수 있어요.'
                : '이용에 문제가 없어요.'}
            </Text>
          </View>
        ) : (
          <>
            {/* 안내 문구 */}
            <View style={styles.card}>
              <Text style={styles.body}>
                {view.state === 'expired'
                  ? '아래 계좌로 이용료를 입금하시면, 확인 후 이용이 다시 열려요.'
                  : '계속 이용하려면 아래 계좌로 이용료를 입금해 주세요. 확인 후 반영돼요.'}
              </Text>
            </View>

            {/* 계좌 정보 */}
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
                <Row label="금액" value={`${formatKrw(BILLING_INFO.monthlyPriceKrw)} / 월`} strong />
              </View>
            </View>

            {/* 입금 알림 연락처 */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>입금 후 알려주세요</Text>
              <View style={styles.card}>
                <Row label={BILLING_INFO.contactLabel} value={BILLING_INFO.contactValue} />
                <Text style={styles.hint}>입금 사실을 알려주시면 더 빠르게 활성화해 드려요.</Text>
              </View>
            </View>

            <Pressable onPress={notifyPaid} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}>
              <Text style={styles.primaryText}>입금 완료했어요</Text>
            </Pressable>
          </>
        )}

        <Pressable disabled={busy} onPress={recheck} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={InkColors.ink2} /> : <Text style={styles.ghostText}>이용 상태 새로고침</Text>}
        </Pressable>

        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
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
  body: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  hint: { fontSize: 12, color: InkColors.ink3, lineHeight: 18 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  rowLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowValue: { fontSize: 14, color: InkColors.ink, fontWeight: '700' },
  rowValueStrong: { fontSize: 15, fontWeight: '900' },
  copyBtn: { padding: 2 },

  primary: { backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  ghost: { paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center', backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  logoutRow: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
});
