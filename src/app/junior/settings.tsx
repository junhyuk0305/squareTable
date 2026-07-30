import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { notifyAction } from '@/lib/utils/confirm';
import { won } from '@/lib/utils/attendance';
import { storeColor } from '@/lib/utils/storeColor';
import { InkColors } from '@/lib/theme/colors';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';
import { QuietHoursModal } from '@/components/settings/QuietHoursModal';
import { PersonalizeSheet } from '@/components/settings/PersonalizeSheet';
import { ConfirmModal } from '@/components/ConfirmModal';
import { RoleTabBar } from '@/components/RoleTabBar';

/**
 * 매장 설정 — 직원 5탭의 설정 탭. "이 매장에서만" 갈리는 개인 설정을 담는다(직원×매장 레이어).
 * 매장 닉네임·색·내 시급(읽기)·이 매장 방해금지·이 매장 음소거·매장 나가기.
 * (프로필·푸시 동의·글자 크기·약관·로그아웃·탈퇴 같은 계정 전역 설정은 '전체 계정 설정'으로 이동.)
 */
export default function StoreSettings() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName) || '내 매장';
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const leaveStore = useSessionStore((s) => s.leaveStore);
  const wages = usePayrollStore((s) => s.wages);

  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const savePref = useMemberPrefsStore((s) => s.save);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);

  const [busy, setBusy] = useState(false);
  const [quietModal, setQuietModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  // 개인화 시트 draft — 부모가 소유(시트 안에서 effect로 seed하면 lint set-state-in-effect). 열 때 현재값 주입.
  const [personalize, setPersonalize] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<string | null>(null);

  // 이 매장 개인 설정을 당긴다(내 전 매장 한 번에). 이미 로드됐으면 중복 fetch는 값만 갱신.
  useEffect(() => {
    void hydratePrefs();
  }, [hydratePrefs]);

  const pref = prefFor(unitId ?? '');
  const wage = userId ? wages[userId] : undefined;
  const color = storeColor(unitId ?? '', pref.color);

  const openPersonalize = () => {
    setDraftName(pref.nickname ?? '');
    setDraftColor(pref.color);
    setPersonalize(true);
  };

  const save = async (patch: Parameters<typeof savePref>[1]) => {
    if (!unitId) return;
    const { error } = await savePref(unitId, patch);
    if (error) {
      await notifyAction('저장 실패', '설정을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.', '확인', {
        icon: 'alert-circle-outline',
      });
    }
  };

  const onLeaveConfirm = async () => {
    setBusy(true);
    const { error } = await leaveStore();
    setBusy(false);
    setLeaveModal(false);
    if (error) return void notifyAction('실패', error, '확인', { icon: 'alert-circle-outline' });
    router.replace('/junior/hub');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '매장 설정' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 매장 헤더 — 색 점 + 매장명 + (있으면) 내 별칭. 탭하면 개인화 시트. */}
        <Pressable
          onPress={openPersonalize}
          style={({ pressed }) => [styles.storeHead, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="내가 보는 매장 이름·색 설정"
        >
          <View style={[styles.colorDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.storeName}>{pref.nickname || storeName}</Text>
            <Text style={styles.storeSub}>{pref.nickname ? storeName : '탭해서 내가 보는 매장 이름·색을 바꿔요 (나만 보여요)'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink3} />
        </Pressable>

        <SettingsSection icon="storefront-outline" title="이 매장">
          {/* 내 이름 = 매장에서 다른 사람에게 보이는 이름(프로필 이름, 전역) — 수정은 프로필 편집에서. */}
          <SettingsRow first icon="person-outline" label="내 이름" value={userName || ''} onPress={() => router.push('/account-edit')} />
          {/* 내 시급 = 읽기 표시만(사장이 정하는 값). */}
          <SettingsRow icon="cash-outline" label="내 시급" value={wage ? `${won(wage)}/시간` : '사장님이 정해요'} />
        </SettingsSection>

        <SettingsSection icon="notifications-outline" title="이 매장 알림">
          <SettingsToggle
            first
            icon="notifications-off-outline"
            label="이 매장 알림 음소거"
            hint="이 매장의 핸드폰 알림을 끕니다 (알림함엔 그대로 쌓여요)"
            value={pref.muted}
            onValueChange={(v) => save({ muted: v })}
          />
          <SettingsToggle
            icon="moon-outline"
            label="방해 금지 시간"
            hint={`${pref.quiet_start}~${pref.quiet_end}에는 이 매장 핸드폰 알림만 꺼요`}
            value={pref.quiet_enabled}
            onValueChange={(v) => save({ quiet_enabled: v })}
          />
          {pref.quiet_enabled ? (
            <SettingsRow icon="time-outline" label="시간대 설정" value={`${pref.quiet_start} ~ ${pref.quiet_end}`} onPress={() => setQuietModal(true)} />
          ) : null}
        </SettingsSection>

        <SettingsSection>
          <SettingsRow first icon="settings-outline" label="전체 계정 설정" hint="프로필·글자 크기·약관·로그아웃" onPress={() => router.push('/account-settings')} />
          <SettingsRow icon="exit-outline" label="매장 나가기" onPress={busy ? undefined : () => setLeaveModal(true)} />
        </SettingsSection>

        <View style={{ height: 16 }} />
      </ScrollView>

      <PersonalizeSheet
        visible={personalize}
        name={draftName}
        setName={setDraftName}
        sel={draftColor}
        setSel={setDraftColor}
        autoColor={storeColor(unitId ?? '')}
        storeName={storeName}
        onClose={() => setPersonalize(false)}
        onSave={() => {
          setPersonalize(false);
          void save({ nickname: draftName.trim() ? draftName.trim() : null, color: draftColor });
        }}
      />
      <QuietHoursModal
        visible={quietModal}
        start={pref.quiet_start}
        end={pref.quiet_end}
        onClose={() => setQuietModal(false)}
        onSave={(s, e) => save({ quiet_start: s, quiet_end: e })}
      />
      <ConfirmModal
        visible={leaveModal}
        icon="exit-outline"
        destructive
        title="매장 나가기"
        message={`'${storeName}'에서 나가시겠어요? 다시 합류하려면 사장님의 초대코드가 필요해요.`}
        confirmLabel="나가기"
        busy={busy}
        onConfirm={onLeaveConfirm}
        onCancel={() => setLeaveModal(false)}
      />
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, paddingTop: 16 },

  storeHead: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, marginBottom: 20 },
  colorDot: { width: 20, height: 20, borderRadius: 10 },
  storeName: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  storeSub: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },
});
