import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { storeColor } from '@/lib/utils/storeColor';
import { notifyAction } from '@/lib/utils/confirm';
import { useCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { track } from '@/lib/analytics/track';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { SettingsSection, SettingsRow, SettingsToggle } from '@/components/settings/SettingsKit';
import { QuietHoursModal } from '@/components/settings/QuietHoursModal';
import { ShellTaskCleanupSheet } from '@/components/owner/quiz/ShellTaskCleanupSheet';
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

  /**
   * 옛 퀴즈 구조(0110)가 만들어 낸 껍데기 업무 — 판별은 두 조건의 교집합이다:
   *   ① 코스에 담겨 있었다(레거시 training_items) ② 할일로 체크된 적이 한 번도 없다(work_done)
   * ②를 넣는 이유: 사장이 실제로 쓰던 업무를 코스에도 넣어 뒀을 수 있고, 그건 껍데기가 아니다.
   */
  const templates = useWorkStore((s) => s.templates);
  const training = useWorkStore((s) => s.training);
  const done = useWorkStore((s) => s.done);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const shellTasks = useMemo(() => {
    const everDone = new Set<string>();
    for (const day of Object.values(done)) for (const id of Object.keys(day)) everDone.add(id);
    const inCourse = new Set(training.map((f) => f.templateId));
    return templates
      .filter((t) => inCourse.has(t.id) && !everDone.has(t.id))
      .map((t) => ({ id: t.id, text: t.text, hidden: !!t.hidden }));
  }, [templates, training, done]);
  const shellLeft = useMemo(() => shellTasks.filter((t) => !t.hidden).length, [shellTasks]);

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
          accessibilityLabel="내가 보는 매장 이름·색 설정"
        >
          <View style={[styles.colorDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.storeName}>{pref.nickname || storeName || '내 매장'}</Text>
            <Text style={styles.storeSub}>{pref.nickname ? storeName : '탭해서 내가 보는 매장 이름·색을 바꿔요 (나만 보여요)'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink3} />
        </Pressable>

        {/* 가게 초대코드 — 직원 합류용. 상시 확인·복사 */}
        <View style={styles.codeCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.codeLabel}>직원 합류용 초대코드</Text>
            <Text style={styles.codeValue}>{inviteCode}</Text>
          </View>
          {/* 복사 = "사장이 초대코드를 실제로 뿌렸다"의 관측점 — staff.tsx 와 같은 이벤트를 쓴다. */}
          <Pressable
            onPress={() => { track('invite_shared', { from: 'settings' }); copy(inviteCode); }}
            style={({ pressed }) => [styles.codeBtn, pressed && { opacity: 0.85 }]}
          >
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
          {/* 옛 퀴즈 구조(0110)가 만들어 둔 껍데기 할일 치우기. 한 번 쓰고 마는 도구라
              매일 보는 퀴즈 홈이 아니라 여기에 둔다(2026-08-11 결정). 치울 게 없으면 줄 자체가 없다. */}
          {shellLeft > 0 && (
            <SettingsRow
              icon="file-tray-outline"
              label="퀴즈 때문에 생긴 할일 정리"
              value={`${shellLeft}개`}
              onPress={() => setCleanupOpen(true)}
            />
          )}
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

        <Text style={styles.foot}>매장의 정석 · 스퀘어테이블</Text>
        <View style={{ height: 16 }} />
      </ScrollView>
      {cleanupOpen && <ShellTaskCleanupSheet tasks={shellTasks} onClose={() => setCleanupOpen(false)} />}
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
