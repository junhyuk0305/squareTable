import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { storeColor } from '@/lib/utils/storeColor';
import { notifyAction } from '@/lib/utils/confirm';
import { useCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';
import { QuietHoursModal } from '@/components/settings/QuietHoursModal';
import { PersonalizeSheet } from '@/components/settings/PersonalizeSheet';
import { RoleTabBar } from '@/components/RoleTabBar';

/**
 * 매장 설정(사장) — 사장 5탭의 설정 탭. "이 매장" 단위 설정만 담는다(2레이어 IA — F6 대칭 분리).
 * 초대코드·직원·급여·매장 닉네임·색·이 매장 알림(음소거·방해금지).
 * 계정 전역(프로필·푸시 수신 동의·요금제·글자 크기·약관·로그아웃·탈퇴)은 '전체 계정 설정'
 * (account-settings — 직원과 동일 화면)으로 이동했다. 직원 매장 설정(junior/settings)과 대칭.
 */
export default function OwnerSettings() {
  const router = useRouter();
  const storeName = useSessionStore((s) => s.storeName);
  const unitId = useSessionStore((s) => s.unitId);
  const inviteCode = useSessionStore((s) => s.inviteCode) || '------';
  const { copied, copy } = useCopyToClipboard();

  // 매장별 개인 설정(unit_member_prefs) — 닉네임·색·이 매장 음소거·방해금지(직원 매장 설정과 동일 레이어).
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const savePrefStore = useMemberPrefsStore((s) => s.save);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  useEffect(() => {
    void hydratePrefs();
  }, [hydratePrefs]);
  const pref = prefFor(unitId ?? '');
  const color = storeColor(unitId ?? '', pref.color);

  const [quietModal, setQuietModal] = useState(false);
  // 개인화 시트 draft — 부모 소유(제어형, junior/settings 와 동일 패턴).
  const [personalize, setPersonalize] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const openPersonalize = () => {
    setDraftName(pref.nickname ?? '');
    setDraftColor(pref.color);
    setPersonalize(true);
  };
  const savePref = async (patch: Parameters<typeof savePrefStore>[1]) => {
    if (!unitId) return;
    const { error } = await savePrefStore(unitId, patch);
    if (error) {
      await notifyAction('저장 실패', '설정을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.', '확인', {
        icon: 'alert-circle-outline',
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '매장 설정' }} />
      {/* 설정탭은 의도적으로 등장 애니메이션을 쓰지 않는다 — 자주 드나드는 관리 화면이라
          매번 카드가 떠오르면 번잡함. 카드 등장 모션은 홈·물어보기·출퇴근·업무 등 콘텐츠 탭에만(Appear). */}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 매장 헤더 — 색 점 + 매장명 + (있으면) 내 별칭. 탭하면 개인화 시트(직원 매장 설정과 동일). */}
        <Pressable
          onPress={openPersonalize}
          style={({ pressed }) => [styles.storeHead, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="매장 닉네임·색 설정"
        >
          <View style={[styles.colorDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.storeName}>{pref.nickname || storeName || '내 매장'}</Text>
            <Text style={styles.storeSub}>{pref.nickname ? storeName : '탭해서 닉네임·색을 바꿔요'}</Text>
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
          <Text style={styles.codeManageText}>직원 관리 · 합류 승인</Text>
          <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
        </Pressable>

        <SettingsSection icon="storefront-outline" title="매장 관리">
          <SettingsRow first icon="people-outline" label="직원·초대코드 관리" onPress={() => router.push('/owner/staff')} />
          <SettingsRow icon="cash-outline" label="급여 설정" onPress={() => router.push('/owner/payroll')} />
          {/* 매장 닉네임·색(unit_member_prefs) — 허브 카드·통합 알림 매장칩에 반영(나만 보임). */}
          <SettingsRow icon="pricetag-outline" label="매장 닉네임" value={pref.nickname || '설정 안 함'} onPress={openPersonalize} />
          <SettingsRow icon="color-palette-outline" label="매장 색" valueNode={<View style={[styles.colorDotSm, { backgroundColor: color }]} />} onPress={openPersonalize} />
        </SettingsSection>

        {/* 이 매장 알림 — 매장별(unit_member_prefs). 계정 전역 푸시 on/off 는 전체 계정 설정에. */}
        <SettingsSection icon="notifications-outline" title="이 매장 알림">
          <SettingsToggle
            first
            icon="notifications-off-outline"
            label="이 매장 알림 음소거"
            hint="이 매장의 핸드폰 알림을 끕니다 (알림함엔 그대로 쌓여요)"
            value={pref.muted}
            onValueChange={(v) => savePref({ muted: v })}
          />
          <SettingsToggle
            icon="moon-outline"
            label="방해 금지 시간"
            hint={`${pref.quiet_start}~${pref.quiet_end}에는 이 매장 핸드폰 알림만 꺼요`}
            value={pref.quiet_enabled}
            onValueChange={(v) => savePref({ quiet_enabled: v })}
          />
          {pref.quiet_enabled ? (
            <SettingsRow
              icon="time-outline"
              label="시간대 설정"
              value={`${pref.quiet_start} ~ ${pref.quiet_end}`}
              onPress={() => setQuietModal(true)}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            first
            icon="settings-outline"
            label="전체 계정 설정"
            hint="프로필·푸시 수신·요금제·글자 크기·약관·로그아웃"
            onPress={() => router.push('/account-settings')}
          />
        </SettingsSection>

        <Text style={styles.foot}>착착 · 팀 스퀘어테이블</Text>
        <View style={{ height: 16 }} />
      </ScrollView>
      <QuietHoursModal
        visible={quietModal}
        start={pref.quiet_start}
        end={pref.quiet_end}
        onClose={() => setQuietModal(false)}
        onSave={(s, e) => savePref({ quiet_start: s, quiet_end: e })}
      />
      <PersonalizeSheet
        visible={personalize}
        name={draftName}
        setName={setDraftName}
        sel={draftColor}
        setSel={setDraftColor}
        autoColor={storeColor(unitId ?? '')}
        storeName={storeName || '내 매장'}
        onClose={() => setPersonalize(false)}
        onSave={() => {
          setPersonalize(false);
          void savePref({ nickname: draftName.trim() ? draftName.trim() : null, color: draftColor });
        }}
      />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, paddingTop: 16 },

  // 매장 헤더 — 직원 매장 설정(junior/settings)과 동일 규격
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, marginBottom: 20 },
  colorDot: { width: 20, height: 20, borderRadius: 10 },
  colorDotSm: { width: 18, height: 18, borderRadius: 9 },
  storeName: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  storeSub: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },

  codeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.gold },
  codeLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  codeValue: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: 4, marginTop: 2 },
  codeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: InkColors.line },
  codeBtnText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },
  codeManage: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 4, marginBottom: 14, marginTop: 6 },
  codeManageText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  foot: { fontSize: 11, color: InkColors.ink3, textAlign: 'center', marginTop: 6 },
});
