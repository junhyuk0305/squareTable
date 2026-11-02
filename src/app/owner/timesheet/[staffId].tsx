import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { TimesheetView } from '@/components/TimesheetView';
import { Screen } from '@/components/Screen';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Avatar } from '@/components/Avatar';
import { InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { EmptyStyles } from '@/lib/theme/empty';

// 직원 관리에서 직원 행 탭 시 진입. 사장이 직원 출근기록을 보정.
// 직원이 직접 보정한 건은 '직원 수정' 배지로 구분.
export default function OwnerTimesheetScreen() {
  const router = useRouter();
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  const isOwner = useSessionStore((s) => s.role) === 'owner';

  // ★게이트가 `if (!staff)` 보다 **먼저** 있어야 한다 — 직원 목록이 도착하기 전에는 getStaff가 항상 undefined라
  //   "직원을 찾을 수 없어요"라는 **사실과 반대되는 막다른 화면**이 먼저 그려진다(웹 새로고침·푸시 딥링크로 재현).
  //   훅은 `&&` 안에서 부르지 않는다 — 각각 받은 뒤 AND 한다(단락 평가로 훅 개수가 달라지면 크래시).
  const staffLoaded = useStaffStore((s) => s.loaded);
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const ready = staffLoaded && attendanceLoaded;

  // ★구독으로 찾는다 — getStaff 일회 조회는 loaded 가 이미 true 인 뒤에 명부가 다시 채워져도 화면이 안 따라온다.
  //   명부는 활성 매장 멤버십(unit_members)으로만 채워지므로 다른 매장 직원은 여기 없다.
  const staff = useStaffStore((s) => s.staff.find((m) => m.id === staffId));
  const staffLoadError = useStaffStore((s) => s.loadError);

  // 게이트 화면 3개의 바탕·헤더·탭바 = Screen. 기록 화면 본체는 TimesheetView 가 자기 틀을 든다.
  const header = <ScreenTitleHeader title="출근 기록" backFallback />;

  if (!ready) {
    return (
      <Screen header={header} tabBar="owner" scroll={false}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        <ScreenLoading label="출근 기록을 불러오고 있어요…" />
      </Screen>
    );
  }

  // 명부를 못 읽었으면(활성 매장 어긋남 포함) 빈 명부다 — "없는 직원"이 아니라 "못 불러왔다"로 말한다.
  if (!staff && staffLoadError) {
    return (
      <Screen header={header} tabBar="owner" scroll={false}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        <LoadErrorState title="직원 정보를 불러오지 못했어요" onRetry={() => void useStaffStore.getState().hydrate()} />
      </Screen>
    );
  }

  if (!staff) {
    return (
      <Screen header={header} tabBar="owner">
        <Stack.Screen options={{ title: '출근 기록' }} />
        {/* 막다른 길 금지 — 빈/오류 상태에도 다음 행동 하나를 준다(복잡도 원칙 P6). */}
        <View style={EmptyStyles.box}>
          <Text style={EmptyStyles.text}>직원을 찾을 수 없어요.{'\n'}내보냈거나 아직 합류하지 않은 직원이에요.</Text>
        </View>
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
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `${staff.name} 출근 기록` }} />
      <ScreenTitleHeader title={`${staff.name} 출근 기록`} backFallback />
      <TimesheetView
        staffId={staffId!}
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
              <Text style={styles.staffMeta}>{staff.shift ?? '시프트 미지정'}</Text>
            </View>
          </View>
        }
        footerNote="* 출퇴근 기록은 확인용이에요. 기준은 근무표예요."
      />
    </>
  );
}

const styles = StyleSheet.create({
  // 보조 버튼 = 작은 버튼(48 알약 · 내용 폭). 빈 카드 아래 가운데.
  backBtn: { ...ButtonStyles.small, alignSelf: 'center', borderWidth: 1, borderColor: InkColors.line, backgroundColor: Surface.card },
  backBtnText: { ...ButtonTextStyles.small, color: InkColors.ink },
  staffCard: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: 12 },
  staffName: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  staffMeta: { ...Type.tag, color: TextColor.secondary, marginTop: 2 },
});
