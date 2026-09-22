import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { SHOW_CARD_BILLING } from '@/lib/config/store-policy';
import { TERMS_VERSION } from '@/lib/config/business';
import { formatKrw } from '@/lib/config/billing';
import { cardSubscribe, cardUpdateCard, cardErrorText } from '@/lib/payments/cardBilling';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 토스 카드 등록창에서 돌아오는 자리(웹 전용, 0208).
//   successUrl = /billing-card?mode=subscribe&plan=..&stores=..  (+ 토스가 붙이는 customerKey·authKey)
//   failUrl    = 같은 주소 + fail=1 (+ 토스가 붙이는 code·message)
// ★authKey 는 일회용이다. 이 화면은 받자마자 한 번만 서버에 넘기고, 결과만 보여준다.
//   새로고침으로 다시 넘어가도 서버 가드(card_subscription_exists·payment_in_progress)가 두 번 결제하지 않는다.
export default function BillingCardReturn() {
  const status = useSessionStore((s) => s.status);
  if (!SHOW_CARD_BILLING) return <Redirect href="/billing" />;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;
  return <ReturnBody />;
}

type Phase = 'working' | 'done' | 'pending' | 'error';

function ReturnBody() {
  const router = useRouter();
  const refreshMembership = useSessionStore((s) => s.refreshMembership);
  const p = useLocalSearchParams<{
    mode?: string; plan?: string; stores?: string; authKey?: string; customerKey?: string;
    fail?: string; code?: string; message?: string;
  }>();
  const [phase, setPhase] = useState<Phase>('working');
  const [title, setTitle] = useState('카드를 등록하고 있어요…');
  const [detail, setDetail] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      if (p.fail) {
        // 사용자가 창을 닫은 경우도 여기로 온다(PAY_PROCESS_CANCELED) — 실패라고 겁주지 않는다.
        const canceled = /CANCEL/i.test(p.code ?? '');
        setPhase('error');
        setTitle(canceled ? '카드 등록을 취소했어요' : '카드를 등록하지 못했어요');
        setDetail(canceled ? '결제된 금액은 없어요.' : `${p.message ?? ''} 결제된 금액은 없어요.`.trim());
        return;
      }
      if (!p.authKey || !p.customerKey) {
        setPhase('error');
        setTitle('카드 등록 정보가 없어요');
        setDetail('요금제 화면에서 다시 시도해 주세요.');
        return;
      }

      if (p.mode === 'update') {
        const r = await cardUpdateCard({ authKey: p.authKey, customerKey: p.customerKey });
        if (!r.ok) {
          setPhase('error');
          setTitle('카드를 바꾸지 못했어요');
          setDetail(cardErrorText(r.body.error, r.body.message));
          return;
        }
        await refreshMembership();
        setPhase('done');
        setTitle('카드를 바꿨어요');
        const charged = r.body.charged as { done?: number; failed?: number } | undefined;
        setDetail(
          r.body.retried
            ? charged?.done
              ? '밀린 결제도 새 카드로 완료했어요. 매장이 다시 열렸어요.'
              : '새 카드로 다시 결제했지만 승인되지 않았어요. 요금제 화면에서 사유를 확인해 주세요.'
            : '다음 결제부터 새 카드로 결제돼요.',
        );
        return;
      }

      setTitle('결제하고 있어요…');
      const plan = p.plan === 'multi' ? 'multi' : 'single';
      const r = await cardSubscribe({
        authKey: p.authKey,
        customerKey: p.customerKey,
        plan,
        storeCount: plan === 'multi' ? Math.min(Math.max(Number(p.stores) || 2, 1), 15) : 1,
        termsVersion: TERMS_VERSION,
      });
      if (r.status === 202) {
        setPhase('pending');
        setTitle('결제 결과를 확인하고 있어요');
        setDetail('카드사 응답이 늦어지고 있어요. 몇 분 뒤 요금제 화면에서 확인해 주세요. 두 번 결제되지 않아요.');
        return;
      }
      if (!r.ok) {
        setPhase('error');
        setTitle(r.body.error === 'charge_declined' ? '결제가 승인되지 않았어요' : '결제하지 못했어요');
        setDetail(cardErrorText(r.body.error, r.body.message));
        return;
      }
      await refreshMembership();
      setPhase('done');
      setTitle('결제가 완료됐어요');
      setDetail(`${formatKrw(Number(r.body.amount) || 0)}을 결제했어요. 매장이 바로 열렸고, 한 달마다 자동으로 결제돼요.`);
    })();
  }, [p, refreshMembership]);

  const icon = phase === 'done' ? 'checkmark-circle' : phase === 'error' ? 'alert-circle-outline' : 'time-outline';
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, title: '카드 결제' }} />
      <View style={styles.wrap}>
        <View style={styles.iconWrap}>
          {phase === 'working' ? (
            <ActivityIndicator color={InkColors.ink} />
          ) : (
            <Ionicons name={icon} size={28} color={phase === 'error' ? BrandColors.warn : InkColors.ink} />
          )}
        </View>
        <Text style={styles.title}>{title}</Text>
        {!!detail && <Text style={styles.body}>{detail}</Text>}
        {phase !== 'working' && (
          <Pressable
            onPress={() => router.replace('/billing')}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>요금제 화면으로</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.gutter, gap: Space.md },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FBF3E2', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  body: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, textAlign: 'center', maxWidth: 420 },
  primary: { marginTop: Space.lg, backgroundColor: BrandColors.brand, paddingVertical: 15, paddingHorizontal: 28, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
