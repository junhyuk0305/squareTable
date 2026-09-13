import { useEffect, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { fetchMyPreviousUnits } from '@/lib/db';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import Constants from 'expo-constants';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, type TextScale } from '@/lib/store/usePreferencesStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { FREE_PROMO } from '@/lib/config/tiers';
import { logout } from '@/lib/auth';
import { confirmAction, notifyAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';
import { SectionLabel } from '@/components/SectionLabel';
import { PricingTable } from '@/components/PricingTable';
import { SHOW_BILLING, showIapSurface, showPaymentSurface } from '@/lib/config/store-policy';
import { TextScaleModal } from '@/components/settings/TextScaleModal';
import { ContactModal } from '@/components/ContactModal';

const SCALE_LABEL: Record<TextScale, string> = { small: '작게', normal: '보통', large: '크게' };

/**
 * 전체 계정 설정 — 매장과 무관한 "계정 단위" 설정. 사장·직원 공용, 허브(내 매장) 우상단 프로필에서 진입.
 * 프로필·푸시 수신 동의·(사장) 구독 및 결제·글자 크기·약관·고객센터·로그아웃·회원탈퇴.
 * (매장별로 갈리는 것 — 닉네임·색·방해금지·음소거·매장 나가기 — 은 각 매장 안의 '매장 설정' 탭에 있다.
 *  사장 전역 항목은 F6 대칭 분리로 owner/settings 에서 여기로 일원화됐다.)
 */
export default function AccountSettings() {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const userName = useSessionStore((s) => s.userName);
  const email = useSessionStore((s) => s.email);
  const bio = useSessionStore((s) => s.bio);
  const role = useSessionStore((s) => s.role);
  const plan = useSessionStore((s) => s.plan);
  const freeMode = useSessionStore((s) => s.freeMode);
  const iapEnabled = useSessionStore((s) => s.iapEnabled);
  const storeName = useSessionStore((s) => s.storeName);
  const stores = useSessionStore((s) => s.stores);
  // 요금제는 매장 단위 — 다점포 사장은 지금 보는 플랜이 어느 매장 것인지 알아야 한다(1곳이면 소음이라 생략).
  const multiOwner = stores.filter((st) => st.role === 'owner').length > 1;
  const deleteAccount = useSessionStore((s) => s.deleteAccount);
  const isOwner = role === 'owner';
  const prefs = usePreferencesStore();
  const [busy, setBusy] = useState(false);
  const [scaleModal, setScaleModal] = useState(false);
  const [contactModal, setContactModal] = useState(false);
  // 이전 매장(0196) — 유료가 끝나 닫힌 소유 매장 수. 0이면 행 자체를 안 그린다(없는 것을 말하지 않는다).
  const [prevCount, setPrevCount] = useState(0);
  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    void fetchMyPreviousUnits().then(({ data }) => { if (alive && data) setPrevCount(data.length); });
    return () => { alive = false; };
  }, [isOwner]);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  const onLogout = async () => {
    if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃', { icon: 'log-out-outline' })) await logout();
  };

  const onDelete = async () => {
    const ok = await confirmAction(
      '회원탈퇴',
      isOwner
        ? '계정과 매장 데이터(노하우·직원·근무 기록)가 모두 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?'
        : '계정과 내 기록(질문·출퇴근)이 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?',
      '탈퇴하기',
      { destructive: true, icon: 'trash-outline' },
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await deleteAccount();
    setBusy(false);
    if (error) return void notifyAction('탈퇴 실패', error, '확인', { icon: 'alert-circle-outline' });
    router.replace('/');
  };

  // 푸시 수신 동의는 계정 전역(DB SSOT) — 실패 시 스토어가 롤백해 토글이 원위치되고 여기서 고지.
  const savePush = async (v: boolean) => {
    const { error } = await prefs.saveNotify({ pushEnabled: v });
    if (error) {
      await notifyAction('저장 실패', '알림 설정을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.', '확인', {
        icon: 'alert-circle-outline',
      });
    }
  };

  // 게이트(stores.tsx 와 동일 규칙): 루트 레벨 라우트라 owner/junior 그룹 게이트 밖 —
  // 미로그인 URL 직진입 시 빈 세션 화면이 그려지지 않게 여기서 직접 지킨다(2레이어 감사 F2).
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{ headerShown: false, title: '설정' }}
      />
      <ScreenTitleHeader title="설정" backFallback />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 프로필 카드 = '내 계정' 진입점 — 누르면 프로필 편집·비밀번호 변경 화면으로. */}
        <Pressable
          onPress={() => router.push('/account-edit')}
          style={({ pressed }) => [styles.profile, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="내 계정 — 프로필 편집·비밀번호 변경"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(userName || '나')[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pName}>{userName || '나'}님</Text>
            <Text style={styles.pMeta}>{bio || email || '데모 계정'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink3} />
        </Pressable>

        {/* 앱 설정 = 알림 + 글자 크기. 둘 다 "내가 이 앱을 어떻게 쓸지"라 한 덩어리로 묶는다(2026-08-06). */}
        <SettingsSection icon="options-outline" title="앱 설정">
          <SettingsToggle
            first
            icon="notifications-outline"
            label="푸시 알림"
            hint={
              isOwner
                ? '직원이 모르는 질문을 남기면 바로 알려드려요 (방해 금지·매장별 알림은 각 매장 설정에서)'
                : '사장님이 답하거나 새 공지가 오면 알려드려요 (방해 금지·매장별 알림은 각 매장 설정에서)'
            }
            value={prefs.pushEnabled}
            onValueChange={savePush}
          />
          <SettingsRow icon="text-outline" label="글자 크기" value={SCALE_LABEL[prefs.textScale]} onPress={() => setScaleModal(true)} />
        </SettingsSection>

        {/* 스토어 인앱결제 축(iOS) — 웹 PG 축과 채널이 다르므로 표면도 다르다.
            ⛔ PricingTable(웹 가격 정본)을 여기에 그리지 않는다 — 앱 가격은 스토어가 내려주고 숫자가 다르다.
            행 하나로 `/billing` 에 착지시키고, 가격·구매는 그 화면의 IapPurchasePanel 이 맡는다. */}
        {!SHOW_BILLING && isOwner && showIapSurface(iapEnabled, freeMode) && (
          <SettingsSection icon="card-outline" title="구독 및 결제">
            <SettingsRow first icon="card-outline" label="이용권" onPress={() => router.push('/billing' as never)} />
          </SettingsSection>
        )}

        {/* 구독 및 결제(사장만) — 계정 단위 항목이라 F6에서 owner/settings → 여기로 이동.
            전면 무료 모드(freeMode·서버 스위치) 동안엔 단순 안내 행 유지.
            iOS 네이티브에서는 이 블록을 렌더하지 않는다 — 가격표(PricingTable)·요금제 CTA 모두
            웹 PG 채널의 표면이다. 판정은 store-policy.ts 하나에만 둔다. */}
        {SHOW_BILLING && isOwner &&
          (!showPaymentSurface(freeMode) ? (
            <SettingsSection icon="card-outline" title="구독 및 결제">
              <SettingsRow
                first
                icon="card-outline"
                label="요금제"
                value={FREE_PROMO.headline}
                onPress={() =>
                  notifyAction(
                    '구독 및 결제',
                    `${FREE_PROMO.until}까지는 모든 기능을 무료로 쓰실 수 있어요. 매장 수·직원 수 제한도 없어요.`,
                    '확인',
                    { icon: 'card-outline' },
                  )
                }
              />
            </SettingsSection>
          ) : (
            <View style={styles.billingSection}>
              <SectionLabel
                icon="card-outline"
                title="구독 및 결제"
                hint={multiOwner && storeName ? `${storeName} 기준` : undefined}
              />
              <PricingTable currentPlan={plan} footNote={null} />
              <Pressable
                onPress={() => router.push('/billing' as never)}
                style={({ pressed }) => [styles.billingCta, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel="요금제 보기·바꾸기"
              >
                <Text style={styles.billingCtaText}>요금제 보기 · 바꾸기</Text>
                <Ionicons name="chevron-forward" size={16} color={InkColors.bubbleText} />
              </Pressable>
            </View>
          ))}

        {/* 이전 매장(0196) — 구독 및 결제 바로 아래. 닫힌 매장이 있을 때만(대다수 사장에겐 안 보인다). */}
        {isOwner && prevCount > 0 && (
          <SettingsSection icon="archive-outline" title="이전 매장">
            <SettingsRow first icon="storefront-outline" label="이전 매장" value={`${prevCount}곳`} onPress={() => router.push('/owner/previous-stores' as never)} />
          </SettingsSection>
        )}

        {/* ★2026-08-06: 섹션 6개 → 4개. SettingsSection은 '제목 + 흰 카드'라, 여섯 개가 이어지면
            화면 전체가 같은 형태의 나열이 된다(카드 6장 · 연속 4 — 배치규칙① 위반, 실브라우저 실측).
            성격이 같은 것끼리만 합쳤다: 알림+글자크기 = 내가 앱을 어떻게 쓸지(앱 설정) ·
            약관+고객센터 = 회사·문서 쪽 참조(약관·고객센터). 행은 하나도 없애지 않았다. */}
        <SettingsSection icon="document-text-outline" title="약관·고객센터">
          <SettingsRow first icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
          <SettingsRow icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
          {/* AI 이용정책·처리위탁 계약은 웹 정적 페이지가 유일한 정본(legal-content.mjs)이라 앱 요약 화면이 없다.
              약관·처리방침 본문이 참조하는 문서이므로 앱에서도 도달 경로가 있어야 죽은 참조가 안 된다. */}
          <SettingsRow icon="document-text-outline" label="AI 이용정책" onPress={() => void Linking.openURL('https://dochackchack.com/ai-policy').catch(() => {})} />
          {/* FAQ·사업자 정보도 AI 이용정책과 같은 이유로 웹 정적 페이지가 정본이다(legal-content.mjs) —
              빌드 없이 문서를 고칠 수 있도록 앱에는 요약 화면을 두지 않고 바로 연다. */}
          <SettingsRow icon="help-circle-outline" label="자주 묻는 질문" onPress={() => void Linking.openURL('https://dochackchack.com/faq').catch(() => {})} />
          <SettingsRow icon="business-outline" label="사업자 정보" onPress={() => void Linking.openURL('https://dochackchack.com/business-info').catch(() => {})} />
          <SettingsRow icon="chatbubble-ellipses-outline" label="문의하기" onPress={() => setContactModal(true)} />
          <SettingsRow icon="information-circle-outline" label="버전 정보" value={`v${version}`} />
        </SettingsSection>

        <SettingsSection>
          {/* 무해한 액션(로그아웃) 먼저, 되돌리기 어려운 액션(탈퇴)은 아래로 — 오탭 방지. */}
          <SettingsRow first icon="log-out-outline" label="로그아웃" onPress={onLogout} />
          <SettingsRow icon="trash-outline" label="회원탈퇴" danger onPress={busy ? undefined : onDelete} />
        </SettingsSection>

        <Text style={styles.foot}>매장의 정석 · 스퀘어테이블</Text>
        <View style={{ height: 16 }} />
      </ScrollView>
      <TextScaleModal visible={scaleModal} onClose={() => setScaleModal(false)} />
      <ContactModal visible={contactModal} onClose={() => setContactModal(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, paddingTop: 16 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, marginBottom: 20 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: BrandColors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '900', color: BrandColors.brand },
  pName: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  pMeta: { fontSize: 13, color: InkColors.ink3, marginTop: 1 },
  foot: { fontSize: 11, color: InkColors.ink3, textAlign: 'center', marginTop: 6 },

  // 구독 및 결제 — SectionLabel(카드 밖) + 요금제 표 + CTA. SettingsSection 간격(marginBottom:18)과 통일.
  billingSection: { gap: 8, marginBottom: 18 },
  billingCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: InkColors.ink,
    borderRadius: Radius.md,
    paddingVertical: 13,
  },
  billingCtaText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
