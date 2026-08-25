import { Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { TimesheetView } from '@/components/TimesheetView';
import { InkColors } from '@/lib/theme/colors';
import { won } from '@/lib/utils/attendance';

// 직원 본인 출퇴근 내역 전체. 점주 timesheet/[staffId]와 동일 UX, 본인 데이터만.
// 본인이 보정하면 '수정됨' 표시(사장 화면엔 '직원 수정' 배지로 노출).
export default function JuniorTimesheetScreen() {
  const userId = useSessionStore((s) => s.userId);
  const wages = usePayrollStore((s) => s.wages);
  const wagesLoadError = usePayrollStore((s) => s.wagesLoadError);
  // ★금액은 "시급이 실제로 정해진 경우"에만 보여준다 — `junior/attendance` 와 같은 규칙(P7).
  //   예전엔 미설정이면 최저시급으로 계산해 **그럴듯한 금액**을 띄웠다. 같은 데이터인데 화면마다
  //   규칙이 다르면 직원은 두 화면에서 다른 말을 듣는다. 왜 안 보이는지는 아래 한 줄이 말한다 —
  //   "사장님께 말씀하세요"와 "연결을 확인하세요"는 할 행동이 전혀 다르다.
  const wageSet = Object.prototype.hasOwnProperty.call(wages, userId);
  const wage = wageSet ? wages[userId] : null;

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
        belowSummary={
          <Text style={styles.note}>
            {wage != null
              ? `시급 ${won(wage)} · 세전 예상`
              : wagesLoadError
                ? '시급을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 들어와 주세요.'
                : '아직 시급이 정해지지 않았어요. 사장님께 시급을 정해 달라고 말씀해 주세요.'}
          </Text>
        }
        footerNote="* 시간이 틀리면 직접 수정하세요. 수정한 기록은 사장님에게 ‘직원 수정’으로 표시돼요."
      />
    </>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 12, color: InkColors.ink3, marginTop: -4 },
});
