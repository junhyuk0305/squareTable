import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { TimesheetView } from '@/components/TimesheetView';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Avatar } from '@/components/Avatar';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { won, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';

// 근무·급여(또는 직원관리)에서 직원 행 탭 시 진입. 사장이 직원 출근기록을 보정.
// 직원이 직접 보정한 건은 '직원 수정' 배지로 구분.
export default function OwnerTimesheetScreen() {
  const router = useRouter();
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  const wages = usePayrollStore((s) => s.wages);
  const getStaff = useStaffStore((s) => s.getStaff);

  const staff = getStaff(staffId ?? '');
  const wage = wages[staffId ?? ''] ?? DEFAULT_HOURLY_WAGE;

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        {/* 막다른 길 금지 — 빈/오류 상태에도 다음 행동 하나를 준다(복잡도 원칙 P6). */}
        <Text style={styles.empty}>직원을 찾을 수 없어요.{'\n'}내보냈거나 아직 합류하지 않은 직원이에요.</Text>
        <Pressable
          onPress={() => router.replace('/owner/staff')}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Text style={styles.backBtnText}>직원 목록 보기</Text>
        </Pressable>
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
              <Text style={styles.staffMeta}>{staff.shift ?? '시프트 미지정'} · 시급 {won(wage)}</Text>
            </View>
          </View>
        }
        footerNote="* 수정한 시간은 근무·급여 화면 인건비에 바로 반영돼요."
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  empty: { fontSize: 15, color: InkColors.ink3, padding: 24, textAlign: 'center', lineHeight: 22 },
  backBtn: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.xl, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  backBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  staffCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 14 },
  staffName: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  staffMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
});
