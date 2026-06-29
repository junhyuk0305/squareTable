import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { TimesheetView } from '@/components/TimesheetView';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { won, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';

// 근무·급여(또는 직원관리)에서 직원 행 탭 시 진입. 사장이 직원 출근기록을 보정.
// 직원이 직접 보정한 건은 '직원 수정' 배지로 구분.
export default function OwnerTimesheetScreen() {
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  const wages = usePayrollStore((s) => s.wages);
  const getStaff = useStaffStore((s) => s.getStaff);

  const staff = getStaff(staffId ?? '');
  const wage = wages[staffId ?? ''] ?? DEFAULT_HOURLY_WAGE;

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        <Text style={styles.empty}>직원을 찾을 수 없어요.</Text>
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
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{staff.name.slice(0, 1)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.staffName}>{staff.name}</Text>
              <Text style={styles.staffMeta}>{staff.shift ?? '시프트 미지정'} · 시급 {won(wage)}</Text>
            </View>
          </View>
        }
        footerNote="* 보정한 시간은 근무·급여 화면 인건비에 바로 반영됩니다."
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  empty: { fontSize: 13, color: InkColors.ink3, padding: 24, textAlign: 'center' },
  staffCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  staffName: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  staffMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
});
