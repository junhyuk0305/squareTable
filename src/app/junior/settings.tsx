import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore, DEFAULT_MEMBER_PREF } from '@/lib/store/useMemberPrefsStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { notifyAction } from '@/lib/utils/confirm';
import { won } from '@/lib/utils/attendance';
import { storeColor } from '@/lib/utils/storeColor';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
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

  /**
   * ★ byUnit 을 직접 구독한다 — `prefFor` 를 구독하면 안 된다.
   * `prefFor` 는 스토어 생성 시 한 번 만들어진 함수라 참조가 영원히 안 바뀐다. 그 함수만 구독하면
   * save 의 낙관적 반영(byUnit 교체)에 이 화면이 리렌더되지 않아, 토글을 눌러도 스위치가 그대로 있고
   * 방해금지 시간대 줄도 안 나타난다(2026-08-19 수정 — 사장 매장 설정과 동일 함정).
   */
  const pref = useMemberPrefsStore((s) => s.byUnit[unitId ?? ''] ?? DEFAULT_MEMBER_PREF);
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
        {/* 매장 헤더 + '이 매장' 두 행을 한 카드로 합쳤다 — 원래 헤더 카드와 '이 매장' 카드가 따로였고
            그래서 흰 카드 면이 4연속이었다(배치규칙① 위반, 2026-08-06). 매장명이 곧 이 묶음의 제목이라
            '이 매장' 라벨은 없애도 방향을 잃지 않는다. 카드는 SettingsSection(=SettingsKit) 것을 그대로 쓴다. */}
        <SettingsSection>
          {/* 색 점 + 매장명 + (있으면) 내 별칭. 탭하면 개인화 시트.
              카드 안 첫 행이므로 카드 크롬(배경·보더·라운드)은 SettingsSection이 이고 여기는 여백만 갖는다. */}
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
          {/* 내 이름 = 매장에서 다른 사람에게 보이는 이름(프로필 이름, 전역) — 수정은 프로필 편집에서. */}
          <SettingsRow icon="person-outline" label="내 이름" value={userName || ''} onPress={() => router.push('/account-edit')} />
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

        {/* 카드 밖 행 — 위 두 카드와 형태를 갈라 흰 카드 연속을 끊는다(배치규칙①).
            둘 다 '이 매장' 설정이 아니라 화면을 떠나는 동작이라, 카드에서 내려도 위계가 맞다. */}
        <Pressable
          onPress={() => router.push('/account-settings')}
          style={({ pressed }) => [styles.outRow, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="전체 계정 설정"
        >
          <Ionicons name="settings-outline" size={19} color={InkColors.ink2} style={styles.outIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.outLabel}>전체 계정 설정</Text>
            <Text style={styles.outHint}>프로필·글자 크기·약관·로그아웃</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={InkColors.ink3} />
        </Pressable>
        {/* 되돌리기 어려운 동작이라 위 행과 붙지 않게 한 칸 띄운다(오탭 방지). */}
        <Pressable
          onPress={() => setLeaveModal(true)}
          disabled={busy}
          style={({ pressed }) => [styles.outRow, styles.outRowGap, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="매장 나가기"
        >
          <Ionicons name="exit-outline" size={19} color={BrandColors.accent} style={styles.outIcon} />
          <Text style={[styles.outLabel, { color: BrandColors.accentText }]}>매장 나가기</Text>
        </Pressable>

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

  // 카드 크롬은 SettingsSection이 갖는다 — 여기는 카드 안 첫 행의 여백만(토큰).
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  colorDot: { width: 20, height: 20, borderRadius: 10 },
  storeName: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  storeSub: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },

  // 카드 밖 행 — 좌우 4는 SectionLabel과 같은 들여쓰기(카드 안 16이 아니다). 최소 높이는 터치 타깃 48dp.
  outRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.xs, paddingVertical: Space.md, minHeight: 48 },
  outRowGap: { marginTop: Space.sm },
  outIcon: { width: 22, textAlign: 'center' },
  outLabel: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  outHint: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
});
