import { Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { TimesheetView } from '@/components/TimesheetView';
import { InkColors } from '@/lib/theme/colors';
import { won, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';

// 직원 본인 출퇴근 내역 전체. 점주 timesheet/[staffId]와 동일 UX, 본인 데이터만.
// 본인이 보정하면 '수정됨' 표시(사장 화면엔 '직원 수정' 배지로 노출).
export default function JuniorTimesheetScreen() {
  const userId = useSessionStore((s) => s.userId);
  const wages = usePayrollStore((s) => s.wages);
  const wage = wages[userId] ?? DEFAULT_HOURLY_WAGE;

  return (
    <>
      <Stack.Screen options={{ title: '내 출퇴근 내역' }} />
      <TimesheetView
        staffId={userId}
        wage={wage}
        editedBy="staff"
        badgeLabel="수정됨"
        addLabel="빠진 날 출근 기록 추가"
        role="junior"
        belowSummary={<Text style={styles.note}>시급 {won(wage)} · 세전 예상</Text>}
        footerNote="* 시간이 틀리면 직접 보정하세요. 보정한 기록은 사장님에게 ‘직원 수정’으로 표시됩니다."
      />
    </>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 12, color: InkColors.ink3, marginTop: -4 },
});
