import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, type TextScale } from '@/lib/store/usePreferencesStore';
import { logout } from '@/lib/auth';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';

const SUPPORT_EMAIL = 'contact@team-roundtable.com';
const SCALE_LABEL: Record<TextScale, string> = { small: '작게', normal: '보통', large: '크게' };

export default function OwnerSettings() {
  const router = useRouter();
  const { userName, email, storeName } = useSessionStore();
  const deleteAccount = useSessionStore((s) => s.deleteAccount);
  const prefs = usePreferencesStore();
  const [busy, setBusy] = useState(false);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  const cycleScale = () => {
    const order: TextScale[] = ['small', 'normal', 'large'];
    const next = order[(order.indexOf(prefs.textScale) + 1) % order.length];
    prefs.set('textScale', next);
  };

  const onLogout = async () => {
    if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃')) await logout();
  };

  const onDelete = async () => {
    const ok = await confirmAction(
      '회원탈퇴',
      '계정과 매장 데이터(노하우·직원·근무 기록)가 모두 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?',
      '탈퇴하기',
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await deleteAccount();
    setBusy(false);
    if (error) {
      await confirmAction('탈퇴 실패', error, '확인');
      return;
    }
    router.replace('/');
  };

  const contact = () => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[스퀘어테이블] 문의')}`);
  const billing = () =>
    confirmAction('구독 및 결제', '지금은 파일럿 기간으로 무료 이용 중이에요. 정기결제(월 구독)는 곧 열릴 예정이에요.', '확인');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '설정' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 프로필 요약 */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(userName || '사')[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pName}>{userName || '사장님'} 사장님</Text>
            <Text style={styles.pMeta}>{email || '데모 계정'}</Text>
            <Text style={styles.pMeta}>{storeName || '매장 미연결'}</Text>
          </View>
        </View>

        <SettingsSection title="내 계정">
          <SettingsRow first icon="person-outline" label="프로필 편집" onPress={() => router.push('/account-edit')} />
          <SettingsRow icon="lock-closed-outline" label="비밀번호 변경" onPress={() => router.push('/account-edit')} />
        </SettingsSection>

        <SettingsSection title="매장 관리">
          <SettingsRow first icon="people-outline" label="직원·초대코드 관리" onPress={() => router.push('/owner/staff')} />
          <SettingsRow icon="cash-outline" label="급여 설정" onPress={() => router.push('/owner/payroll')} />
          <SettingsRow icon="bulb-outline" label="내 노하우" onPress={() => router.push('/owner/knowledge')} />
        </SettingsSection>

        <SettingsSection title="구독 및 결제">
          <SettingsRow first icon="card-outline" label="구독 / 결제 내역" value="파일럿 무료" onPress={billing} />
        </SettingsSection>

        <SettingsSection title="알림">
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
            hint="밤 10시~아침 8시에는 알림을 보내지 않아요"
            value={prefs.quietHours}
            onValueChange={() => prefs.toggle('quietHours')}
          />
        </SettingsSection>

        <SettingsSection title="화면">
          <SettingsRow first icon="text-outline" label="글자 크기" value={SCALE_LABEL[prefs.textScale]} onPress={cycleScale} />
        </SettingsSection>

        <SettingsSection title="약관 및 정책">
          <SettingsRow first icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
          <SettingsRow icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
          <SettingsRow icon="business-outline" label="사업자 정보" onPress={() => router.push('/business-info')} />
        </SettingsSection>

        <SettingsSection title="고객센터">
          <SettingsRow first icon="chatbubble-ellipses-outline" label="문의하기" onPress={contact} />
          <SettingsRow icon="information-circle-outline" label="버전 정보" value={`v${version}`} />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow first icon="log-out-outline" label="로그아웃" onPress={onLogout} />
          <SettingsRow icon="trash-outline" label={busy ? '처리 중…' : '회원탈퇴'} danger onPress={busy ? undefined : onDelete} />
        </SettingsSection>

        <Text style={styles.foot}>스퀘어테이블 · 팀 스퀘어테이블</Text>
        <View style={{ height: 16 }} />
      </ScrollView>
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
});
