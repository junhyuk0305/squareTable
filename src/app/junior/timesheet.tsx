import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { Stack } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { TimesheetView } from '@/components/TimesheetView';

// 직원 본인 출퇴근 내역 전체. 점주 timesheet/[staffId]와 동일 UX, 본인 데이터만.
// 본인이 보정하면 '수정됨' 표시(사장 화면엔 '직원 수정' 배지로 노출).
export default function JuniorTimesheetScreen() {
  const userId = useSessionStore((s) => s.userId);

  return (
    <>
      <Stack.Screen options={{ title: '내 출퇴근 내역' }} />
      <ScreenTitleHeader title="내 출퇴근 내역" backFallback />
      <TimesheetView
        staffId={userId}
        editedBy="staff"
        badgeLabel="수정됨"
        addLabel="빠진 날 출근 기록 추가"
        role="junior"
        footerNote="* 시간이 틀리면 직접 수정하세요. 수정한 기록은 사장님에게 ‘직원 수정’으로 표시돼요."
      />
    </>
  );
}
