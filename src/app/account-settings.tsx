import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import Constants from 'expo-constants';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, type TextScale } from '@/lib/store/usePreferencesStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { FREE_MODE } from '@/lib/utils/subscription';
import { logout } from '@/lib/auth';
import { confirmAction, notifyAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';
import { SectionLabel } from '@/components/SectionLabel';
import { PricingTable } from '@/components/PricingTable';
import { TextScaleModal } from '@/components/settings/TextScaleModal';
import { ContactModal } from '@/components/ContactModal';
import { HeaderBackButton } from '@/components/HeaderBackButton';

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
  const deleteAccount = useSessionStore((s) => s.deleteAccount);
  const isOwner = role === 'owner';
  const prefs = usePreferencesStore();
  const [busy, setBusy] = useState(false);
  const [scaleModal, setScaleModal] = useState(false);
  const [contactModal, setContactModal] = useState(false);

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
        options={{ headerShown: true, title: '설정', headerLeft: () => <HeaderBackButton fallback="/stores" /> }}
      />
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

        <SettingsSection icon="notifications-outline" title="알림">
          <SettingsToggle
            first
            icon="notifications-outline"
            label="푸시 알림"
            hint={
              isOwner
                ? '알바가 모르는 질문을 남기면 바로 알려드려요 (방해 금지·매장별 알림은 각 매장 설정에서)'
                : '사장님이 답하거나 새 공지가 오면 알려드려요 (방해 금지·매장별 알림은 각 매장 설정에서)'
            }
            value={prefs.pushEnabled}
            onValueChange={savePush}
          />
        </SettingsSection>

        {/* 구독 및 결제(사장만) — 계정 단위 항목이라 F6에서 owner/settings → 여기로 이동.
            FREE_MODE(파일럿 전면 무료·출시 전 flag 숨김) 동안엔 단순 안내 행 유지. */}
        {isOwner &&
          (FREE_MODE ? (
            <SettingsSection icon="card-outline" title="구독 및 결제">
              <SettingsRow
                first
                icon="card-outline"
                label="요금제"
                value="파일럿 기간 무료"
                onPress={() =>
                  notifyAction('구독 및 결제', '지금은 파일럿 기간이라 무료로 쓰실 수 있어요. 월 구독 결제는 준비 중이에요.', '확인', {
                    icon: 'card-outline',
                  })
                }
              />
            </SettingsSection>
          ) : (
            <View style={styles.billingSection}>
              <SectionLabel icon="card-outline" title="구독 및 결제" />
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

        <SettingsSection icon="phone-portrait-outline" title="화면">
          <SettingsRow first icon="text-outline" label="글자 크기" value={SCALE_LABEL[prefs.textScale]} onPress={() => setScaleModal(true)} />
        </SettingsSection>

        <SettingsSection icon="document-text-outline" title="약관 및 정책">
          <SettingsRow first icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
          <SettingsRow icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
        </SettingsSection>

        <SettingsSection icon="help-buoy-outline" title="고객센터">
          <SettingsRow first icon="chatbubble-ellipses-outline" label="문의하기" onPress={() => setContactModal(true)} />
          <SettingsRow icon="information-circle-outline" label="버전 정보" value={`v${version}`} />
        </SettingsSection>

        <SettingsSection>
          {/* 무해한 액션(로그아웃) 먼저, 되돌리기 어려운 액션(탈퇴)은 아래로 — 오탭 방지. */}
          <SettingsRow first icon="log-out-outline" label="로그아웃" onPress={onLogout} />
          <SettingsRow icon="trash-outline" label="회원탈퇴" danger onPress={busy ? undefined : onDelete} />
        </SettingsSection>

        <Text style={styles.foot}>착착 · 팀 스퀘어테이블</Text>
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
