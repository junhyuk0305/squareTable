import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore, useWagesSettled } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { TimesheetView } from '@/components/TimesheetView';
import { RoleTabBar } from '@/components/RoleTabBar';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Avatar } from '@/components/Avatar';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { won } from '@/lib/utils/attendance';

// 근무·급여(또는 직원관리)에서 직원 행 탭 시 진입. 사장이 직원 출근기록을 보정.
// 직원이 직접 보정한 건은 '직원 수정' 배지로 구분.
export default function OwnerTimesheetScreen() {
  const router = useRouter();
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  const wages = usePayrollStore((s) => s.wages);
  const getStaff = useStaffStore((s) => s.getStaff);
  const isOwner = useSessionStore((s) => s.role) === 'owner';

  // ★게이트가 `if (!staff)` 보다 **먼저** 있어야 한다 — 직원 목록이 도착하기 전에는 getStaff가 항상 undefined라
  //   "직원을 찾을 수 없어요"라는 **사실과 반대되는 막다른 화면**이 먼저 그려진다(웹 새로고침·푸시 딥링크로 재현).
  //   훅은 `&&` 안에서 부르지 않는다 — 각각 받은 뒤 AND 한다(단락 평가로 훅 개수가 달라지면 크래시).
  const staffLoaded = useStaffStore((s) => s.loaded);
  const wagesSettled = useWagesSettled();
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const ready = staffLoaded && wagesSettled && attendanceLoaded;

  const staff = getStaff(staffId ?? '');
  // ★시급이 없으면 최저시급으로 대신 계산하지 않는다 — 사장이 "정해 뒀다"고 오해하고 그대로 지나간다.
  //   `junior/attendance`·`junior/timesheet` 와 같은 규칙(P7). 미설정은 아래에서 그대로 말한다.
  const wage = wages[staffId ?? ''] ?? null;

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        <ScreenLoading label="출근 기록을 불러오고 있어요…" />
        <RoleTabBar role="owner" />
      </SafeAreaView>
    );
  }

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        {/* 막다른 길 금지 — 빈/오류 상태에도 다음 행동 하나를 준다(복잡도 원칙 P6). */}
        <Text style={styles.empty}>직원을 찾을 수 없어요.{'\n'}내보냈거나 아직 합류하지 않은 직원이에요.</Text>
        {/* 직원 관리는 사장 전용 — 매니저에겐 이 버튼을 그리지 않는다. */}
        {isOwner ? (
        <Pressable
          onPress={() => router.replace('/owner/staff')}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Text style={styles.backBtnText}>직원 목록 보기</Text>
        </Pressable>
        ) : null}
        <RoleTabBar role="owner" />
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `${staff.name} 출근 기록` }} />
      <TimesheetView
        staffId={staffId!}
        wage={wage}
        editedBy="owner"
        badgeLabel="직원 수정"
        badgeTone="accent"
        addLabel="출근 기록 추가"
        role="owner"
        topHeader={
          <View style={styles.staffCard}>
            <Avatar name={staff.name} size={44} fontSize={17} />
            <View style={{ flex: 1 }}>
              <Text style={styles.staffName}>{staff.name}</Text>
              <Text style={styles.staffMeta}>
                {staff.shift ?? '시프트 미지정'} · {wage != null ? `시급 ${won(wage)}` : '시급 미설정'}
              </Text>
            </View>
          </View>
        }
        footerNote="* 출퇴근 기록은 확인용이에요. 급여는 근무표 기준으로 계산돼요."
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  empty: { fontSize: 15, color: InkColors.ink2, padding: 24, textAlign: 'center', lineHeight: 22 },
  backBtn: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.xl, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  backBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  staffCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 14 },
  staffName: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  staffMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
});
