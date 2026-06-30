import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, type TextScale } from '@/lib/store/usePreferencesStore';
import { logout } from '@/lib/auth';
import { confirmAction, notifyAction } from '@/lib/utils/confirm';
import { useCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';
import { QuietHoursModal } from '@/components/settings/QuietHoursModal';
import { ContactModal } from '@/components/ContactModal';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Avatar } from '@/components/Avatar';
import { HeaderLogoutButton } from '@/components/HeaderLogoutButton';

const SCALE_LABEL: Record<TextScale, string> = { small: '작게', normal: '보통', large: '크게' };

export default function OwnerSettings() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const email = useSessionStore((s) => s.email);
  const storeName = useSessionStore((s) => s.storeName);
  const inviteCode = useSessionStore((s) => s.inviteCode) || '------';
  const deleteAccount = useSessionStore((s) => s.deleteAccount);
  const prefs = usePreferencesStore();
  const [busy, setBusy] = useState(false);
  const [quietModal, setQuietModal] = useState(false);
  const [contactModal, setContactModal] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const version = Constants.expoConfig?.version ?? '1.0.0';

  const cycleScale = () => {
    const order: TextScale[] = ['small', 'normal', 'large'];
    const next = order[(order.indexOf(prefs.textScale) + 1) % order.length];
    prefs.set('textScale', next);
  };

  const onLogout = async () => {
    if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃', { icon: 'log-out-outline' })) await logout();
  };

  const onDelete = async () => {
    const ok = await confirmAction(
      '회원탈퇴',
      '계정과 매장 데이터(노하우·직원·근무 기록)가 모두 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?',
      '탈퇴하기',
      { destructive: true, icon: 'trash-outline' },
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await deleteAccount();
    setBusy(false);
    if (error) {
      await notifyAction('탈퇴 실패', error, '확인', { icon: 'alert-circle-outline' });
      return;
    }
    router.replace('/');
  };

  const billing = () =>
    notifyAction('구독 및 결제', '지금은 파일럿 기간으로 무료 이용 중이에요. 정기결제(월 구독)는 곧 열릴 예정이에요.', '확인', {
      icon: 'card-outline',
    });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '설정', headerRight: () => <HeaderLogoutButton /> }} />
      {/* 설정탭은 의도적으로 등장 애니메이션을 쓰지 않는다 — 자주 드나드는 관리 화면이라
          매번 카드가 떠오르면 번잡함. 카드 등장 모션은 홈·물어보기·출퇴근·업무 등 콘텐츠 탭에만(Appear). */}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 프로필 카드 자체가 '내 계정' 진입점 — 누르면 프로필 편집·비밀번호 변경 화면으로. (직원 설정과 동일) */}
        <Pressable
          onPress={() => router.push('/account-edit')}
          style={({ pressed }) => [styles.profile, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="내 계정 — 프로필 편집·비밀번호 변경"
        >
          <Avatar name={userName || '사'} size={52} fontSize={22} tone="brand" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pName}>{userName || '사장님'} 사장님</Text>
            <Text style={styles.pMeta}>{email || '데모 계정'}</Text>
            <Text style={styles.pMeta}>{storeName || '매장 미연결'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink3} />
        </Pressable>

        {/* 가게 초대코드 — 직원 합류용. 상시 확인·복사 */}
        <View style={styles.codeCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.codeLabel}>직원 합류용 초대코드</Text>
            <Text style={styles.codeValue}>{inviteCode}</Text>
          </View>
          <Pressable onPress={() => copy(inviteCode)} style={({ pressed }) => [styles.codeBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={InkColors.ink} />
            <Text style={styles.codeBtnText}>{copied ? '복사됨' : '복사'}</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/owner/staff')} style={({ pressed }) => [styles.codeManage, pressed && { opacity: 0.6 }]}>
          <Text style={styles.codeManageText}>직원 관리 · 초대 보내기</Text>
          <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
        </Pressable>

        <SettingsSection icon="storefront-outline" title="매장 관리">
          <SettingsRow first icon="people-outline" label="직원·초대코드 관리" onPress={() => router.push('/owner/staff')} />
          <SettingsRow icon="cash-outline" label="급여 설정" onPress={() => router.push('/owner/payroll')} />
          <SettingsRow icon="bulb-outline" label="내 노하우" onPress={() => router.push('/owner/knowledge')} />
        </SettingsSection>

        <SettingsSection icon="card-outline" title="구독 및 결제">
          <SettingsRow first icon="card-outline" label="구독 / 결제 내역" value="파일럿 무료" onPress={billing} />
        </SettingsSection>

        <SettingsSection icon="notifications-outline" title="알림">
          <SettingsToggle
            first
            icon="notifications-outline"
            label="푸시 알림"
            hint="알바가 모르는 질문을 남기면 바로 알려드려요"
            value={prefs.pushEnabled}
            onValueChange={() => prefs.toggle('pushEnabled')}
          />
          <SettingsToggle
            icon="mail-outline"
            label="이메일 알림"
            value={prefs.emailEnabled}
            onValueChange={() => prefs.toggle('emailEnabled')}
          />
          <SettingsToggle
            icon="moon-outline"
            label="방해 금지 시간"
            hint={`${prefs.quietStart}~${prefs.quietEnd}에는 알림을 보내지 않아요`}
            value={prefs.quietHours}
            onValueChange={() => prefs.toggle('quietHours')}
          />
          {prefs.quietHours ? (
            <SettingsRow
              icon="time-outline"
              label="시간대 설정"
              value={`${prefs.quietStart} ~ ${prefs.quietEnd}`}
              onPress={() => setQuietModal(true)}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection icon="phone-portrait-outline" title="화면">
          <SettingsRow first icon="text-outline" label="글자 크기" value={SCALE_LABEL[prefs.textScale]} onPress={cycleScale} />
        </SettingsSection>

        <SettingsSection icon="document-text-outline" title="약관 및 정책">
          <SettingsRow first icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
          <SettingsRow icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
          {/* 사업자 정보 — 무료 파일럿 단계라 전자상거래법 §10 고지 의무 미발생. 결제(구독) 도입 전 복구할 것. */}
          {/* <SettingsRow icon="business-outline" label="사업자 정보" onPress={() => router.push('/business-info')} /> */}
        </SettingsSection>

        <SettingsSection icon="help-buoy-outline" title="고객센터">
          <SettingsRow first icon="chatbubble-ellipses-outline" label="문의하기" onPress={() => setContactModal(true)} />
          <SettingsRow icon="information-circle-outline" label="버전 정보" value={`v${version}`} />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow first icon="log-out-outline" label="로그아웃" onPress={onLogout} />
          <SettingsRow icon="trash-outline" label={busy ? '처리 중…' : '회원탈퇴'} danger onPress={busy ? undefined : onDelete} />
        </SettingsSection>

        <Text style={styles.foot}>착착 · 팀 스퀘어테이블</Text>
        <View style={{ height: 16 }} />
      </ScrollView>
      <QuietHoursModal
        visible={quietModal}
        start={prefs.quietStart}
        end={prefs.quietEnd}
        onClose={() => setQuietModal(false)}
        onSave={(s, e) => {
          prefs.set('quietStart', s);
          prefs.set('quietEnd', e);
        }}
      />
      <ContactModal visible={contactModal} onClose={() => setContactModal(false)} />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, paddingTop: 16 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, marginBottom: 20 },
  pName: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  pMeta: { fontSize: 13, color: InkColors.ink3, marginTop: 1 },
  codeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.gold },
  codeLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  codeValue: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: 4, marginTop: 2 },
  codeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: InkColors.line },
  codeBtnText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },
  codeManage: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 4, marginBottom: 14, marginTop: 6 },
  codeManageText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  foot: { fontSize: 11, color: InkColors.ink3, textAlign: 'center', marginTop: 6 },
});
