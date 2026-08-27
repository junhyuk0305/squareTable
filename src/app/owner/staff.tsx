import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePayrollStore, useWagesSettled } from '@/lib/store/usePayrollStore';
import { useScheduleStore, scheduledShiftsFor } from '@/lib/store/useScheduleStore';
import { monthDates } from '@/lib/utils/schedule';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Avatar } from '@/components/Avatar';
import { SectionLabel } from '@/components/SectionLabel';
import { InfoDot } from '@/components/InfoDot';
import { ProgressPill } from '@/components/blocks/ProgressPill';
import { ActionRow } from '@/components/blocks/ActionRow';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { fmtDuration, won, todayStr, liveMinutes } from '@/lib/utils/attendance';
import { computePay, shiftsToPayRecords } from '@/lib/utils/payroll';
import { gradableTasks, staffBehind, type StaffBehind } from '@/lib/utils/taskProgress';
import { useCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { track } from '@/lib/analytics/track';
import { showToast } from '@/lib/store/useToastStore';
import { rotateInviteCode } from '@/lib/db';

export default function OwnerStaffScreen() {
  const router = useRouter();
  const wages = usePayrollStore((s) => s.wages);
  const settings = usePayrollStore((s) => s.settings);
  const setWage = usePayrollStore((s) => s.setWage);
  const records = useAttendanceStore((s) => s.records);
  const staff = useStaffStore((s) => s.staff);
  const removeStaff = useStaffStore((s) => s.removeStaff);
  const pending = useStaffStore((s) => s.pending);
  const staffLoaded = useStaffStore((s) => s.loaded);
  const loadError = useStaffStore((s) => s.loadError);
  const approve = useStaffStore((s) => s.approve);
  const reject = useStaffStore((s) => s.reject);
  const roles = useStaffStore((s) => s.roles);
  const setRole = useStaffStore((s) => s.setRole);
  // ★게이트가 staffLoaded 하나였다 — 그래서 히어로 "이번 달 예상 인건비"가 **₩0을 먼저 확정 표시**하고,
  //   시급 입력칸이 DEFAULT_HOURLY_WAGE 를 보여주다 실제 시급으로 바뀌었다(입력칸이라 그 사이 사용자가 만질 수 있다).
  //   총액은 wages·records·settings 에서 나오고 진도줄은 work 에서 나온다 — 그 넷이 다 와야 참이다.
  //   훅은 `&&` 안에서 부르지 않는다(단락 평가로 훅 개수가 달라지면 크래시).
  const wagesSettled = useWagesSettled();
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const workLoaded = useWorkStore((s) => s.loaded);
  // ★급여 기준이 근무표로 바뀌었다(2026-08-26) — 근무표가 오기 전에 그리면 **금액이 0원부터 시작**한다.
  //   금액은 분쟁 대상이라 "아직 안 옴"과 "0원"을 섞으면 안 된다. 게이트에 같이 넣는다.
  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const shiftExceptions = useScheduleStore((s) => s.exceptions);
  const scheduleLoaded = useScheduleStore((s) => s.loaded);
  const ready = staffLoaded && wagesSettled && attendanceLoaded && workLoaded && scheduleLoaded;
  const INVITE_CODE = useSessionStore((s) => s.inviteCode) || '------';
  // 0093: 이 화면은 매니저도 쓴다(승인·시급·급여). 사장 전용 = 내보내기·코드 변경·매니저 지정.
  const isOwner = useSessionStore((s) => s.role) === 'owner';

  // 내보낼 직원 — 확인 모달용. 실수 방지 위해 빨강 모달로 한 번 더 확인한다.
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  // 거절 대상 — 확인 모달용(신청 거절도 되돌리기 번거로우니 한 번 확인).
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  // 화면 진입/복귀 시마다 명부·합류신청을 다시 당겨온다. owner 레이아웃 hydrate는 로그인 시 1회뿐이라,
  // 앱을 켜둔 채로 새 합류 신청이 들어와도(profiles 실시간 미구독) 이 화면을 열면 반드시 최신으로 보인다.
  useFocusEffect(useCallback(() => { useStaffStore.getState().hydrate(); }, []));

  // 근무 중 직원의 누적시간을 30초마다 갱신(구 근무·급여 화면에서 흡수).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // 직원별 이번 달 시간·급여·근무상태 — 구 attendance 화면의 집계를 직원 목록에 합친다.
  const today = todayStr();
  const ym = today.slice(0, 7);
  const perStaff = useMemo(() => {
    // pay=null = 시급 미설정(계산 불가). 0원과 구별해야 한다 — 0원은 '무급'이라는 사실 주장이다.
    const map: Record<string, { min: number; pay: number | null; status: 'out' | 'working' | 'done' }> = {};
    const dates = monthDates(ym);
    for (const s of staff) {
      const monthRecs = records.filter((r) => r.staff_id === s.id && r.date.startsWith(ym));
      // 근무시간 표시는 실제 출퇴근 그대로(확인용). 금액만 근무표 기준이다.
      const min = monthRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
      // ★급여의 기준은 **근무표**다(2026-08-26 확정). 출퇴근 기록은 확인용이라 금액에 직접 안 들어간다.
      //   교대로 넘어간 근무는 shiftsOn 을 거친 scheduledShiftsFor 가 이미 반영한다 —
      //   여기서 templates 를 직접 훑으면 대타 뛴 사람이 못 받는다.
      const shiftRecs = shiftsToPayRecords(
        scheduledShiftsFor(shiftTemplates, swaps, shiftExceptions, s.id, dates),
      );
      // ★시급 미설정을 최저시급으로 대신 계산하지 않는다(#38). 예전엔 `?? DEFAULT_HOURLY_WAGE` 라
      //   **그럴듯한 금액**이 떠서 사장이 "최저시급으로 정해 뒀다"고 읽고 그대로 지나갔다.
      //   같은 데이터인데 화면마다 규칙이 다르면 세 화면이 서로 다른 금액을 말한다 —
      //   `junior/attendance`·`junior/timesheet`·`owner/timesheet/[staffId]` 가 이미 쓰는 규칙에 맞춘다.
      const wageSet = Object.prototype.hasOwnProperty.call(wages, s.id);
      const todayRec = records.find((r) => r.staff_id === s.id && r.date === today);
      const status: 'out' | 'working' | 'done' = !todayRec ? 'out' : !todayRec.check_out ? 'working' : 'done';
      // 급여 규칙(주휴·휴게·야간·연장·추가수당) 반영 예상 인건비 — computePay SSOT(F1). min 은 근무시간 표시용.
      map[s.id] = { min, pay: wageSet ? computePay(shiftRecs, wages[s.id], settings).total : null, status };
    }
    return map;
  }, [records, wages, settings, staff, ym, today, shiftTemplates, swaps, shiftExceptions]);

  // 직원별 퀴즈 진도 — 판정 본체는 taskProgress(사장 홈과 같은 잣대). 여기서 다시 세지 않는다.
  // hydrate 는 owner/_layout 이 이미 돌린다.
  const templates = useWorkStore((s) => s.templates);
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  const understanding = useWorkStore((s) => s.understanding);
  const quizCounts = useWorkStore((s) => s.quizCounts);
  const gradable = useMemo(
    () => gradableTasks(templates, knowhowLinks, quizCounts),
    [templates, knowhowLinks, quizCounts],
  );
  // 밀린 직원만 담긴 맵 — 없으면 "다 봤어요"다. 단 gradable 이 0이면 잴 수 없는 것이라 아예 안 그린다.
  const behindOf = useMemo(() => {
    const map: Record<string, StaffBehind> = {};
    for (const r of staffBehind(staff, gradable, understanding, knowhowLinks)) map[r.staffId] = r;
    return map;
  }, [staff, gradable, understanding, knowhowLinks]);

  const totalPay = staff.reduce((a, s) => a + (perStaff[s.id]?.pay ?? 0), 0);
  const workingCount = staff.filter((s) => perStaff[s.id]?.status === 'working').length;
  const month = Number(ym.slice(5));

  const confirmRemove = () => {
    if (!removeTarget) return;
    removeStaff(removeTarget.id); // 낙관적 제거(실패 시 자동 복원·배너)
    setRemoveTarget(null);
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    reject(rejectTarget.id);
    setRejectTarget(null);
  };

  // 초대코드 재발급(남용 #31) — 새 6자리+7일 만료. 이전 코드는 즉시 무효(유출 차단).
  const confirmRotate = async () => {
    setRotating(true);
    const res = await rotateInviteCode();
    setRotating(false);
    setRotateOpen(false);
    // 실패(null) 시 예전엔 모달만 닫고 아무 신호가 없어, 사장이 코드가 바뀐 줄 착각했다(무음 실패).
    if (res) {
      useSessionStore.setState({ inviteCode: res.inviteCode });
      showToast('초대코드를 변경했어요', 'good');
    } else {
      showToast('코드 변경에 실패했어요. 잠시 후 다시 시도해 주세요.', 'warn');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '직원·급여' }} />
      {/* 전부 도착 전엔 무조건 로딩 — "직원 0명"·"₩0" 기본 화면이 먼저 떴다가 채워지는 부분 렌더 금지. */}
      {!ready ? (
        <ScreenLoading label="직원·급여를 불러오고 있어요…" />
      ) : (
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ① 급여 — 이번 달 인건비 총액 + 급여 설정 진입(상단). 구 '근무·급여'·'급여 설정' 카드를 흡수.
            이 화면의 히어로는 여기 하나다(2026-08-06) — 아래 초대코드가 같은 다크·30sp 규격이라 히어로가 둘이었다. */}
        <Appear delay={stagger(0)}>
        <View style={styles.payCard}>
          <Text style={styles.payLabel}>이번 달 예상 인건비</Text>
          <Text style={styles.payValue}>{won(totalPay)}</Text>
          {/* ★금액이 무엇으로 계산됐는지 말한다 — 출퇴근이 아니라 **근무표**다(2026-08-26).
              안 적으면 사장이 출퇴근 시간과 안 맞는 금액을 보고 계산이 틀렸다고 읽는다. */}
          <Text style={styles.payNote}>
            {month}월 · 세전 · 근무표 기준 · 직원 {staff.length}명{workingCount > 0 ? ` · 근무 중 ${workingCount}명` : ''}
          </Text>
          <Pressable
            onPress={() => router.push('/owner/payroll')}
            style={({ pressed }) => [styles.payrollBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="급여 설정 열기"
          >
            <Ionicons name="options-outline" size={16} color="#FFFFFF" />
            <Text style={styles.payrollBtnText}>급여 설정 (수당·정산 기준)</Text>
            <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
        </Appear>

        {/* ② 초대코드 — 카드가 아니라 상하 보더 한 줄(2026-08-06).
            같은 코드를 /owner/settings 에서도 상시 보고 복사할 수 있어, 여기서까지 히어로 규격을 쓸 이유가 없다.
            안내 문장은 ⓘ 로 옮겼다 — 접었을 뿐 도달은 그대로다. */}
        <Appear delay={stagger(1)}>
        <View style={styles.inviteRow}>
          <View style={styles.inviteCol}>
            <View style={styles.inviteLabelRow}>
              <Text style={styles.inviteLabel}>매장 초대코드</Text>
              <InfoDot
                size={14}
                title="초대코드로 어떻게 합류해요?"
                body={'직원이 코드를 입력해 신청하면 아래 ‘합류 신청’에서 승인해 주세요.\n승인 전에는 매장 정보에 접근할 수 없어요.'}
              />
            </View>
            <Text style={styles.inviteCode}>{INVITE_CODE}</Text>
          </View>
          {/* 복사 = "사장이 초대코드를 실제로 뿌렸다"의 유일한 관측점. 이게 없으면 직원 합류율이
              낮을 때 사장이 안 뿌린 건지, 뿌렸는데 직원이 안 들어온 건지 DB로 구분할 수 없다. */}
          <Pressable
            onPress={() => { track('invite_shared', { from: 'staff' }); copy(INVITE_CODE); }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="초대코드 복사"
            style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={InkColors.ink} />
            <Text style={styles.copyText}>{copied ? '복사됨' : '복사'}</Text>
          </Pressable>
          {/* 코드 변경 = 사장 전용(rotate_invite_code RPC 가 소유자만 통과) — 매니저에겐 비노출. */}
          {isOwner && (
            <Pressable
              onPress={() => setRotateOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="초대코드 변경"
              style={({ pressed }) => [styles.rotateBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.rotateText}>코드 변경</Text>
            </Pressable>
          )}
        </View>
        </Appear>

        {/* ③④ 바로 가기 — 퀴즈·근무표 진입 2칸. 블록 A2′ ActionRow `tile`(데모 §7-7 · 2026-08-27).
            맨바닥 행 2개(AR1, 폐기)를 타일 한 덩어리로 접었다 — 목적지가 /owner/training·/owner/schedule 로
            제각각이라 card(형제 액션)가 아니라 tile. 새 직원이 들어오기로 한 순간이 코스를 만들 순간(초대코드 바로 아래).
            근무표 칸은 허브 '현황'이 근무표로 착지하게 바뀐(2026-08-11 P2) 보상으로 둔 반대 방향 진입점.
            상태 한 줄 없음 — 이 화면은 퀴즈·근무표 건수를 읽지 않는다(새 쿼리 금지). */}
        <Appear delay={stagger(2)}>
        <View>
          <SectionLabel title="바로 가기" />
          <ActionRow
            variant="tile"
            items={[
              { key: 'quiz', icon: 'school-outline', label: '퀴즈', onPress: () => router.push('/owner/training') },
              { key: 'schedule', icon: 'calendar-outline', label: '근무표', onPress: () => router.push('/owner/schedule') },
            ]}
          />
        </View>
        </Appear>

        {/* 합류 신청(승인 대기) — 남용 #2. 코드로 신청한 사람을 사장이 승인해야 소속된다. */}
        {pending.length > 0 && (
          <Appear delay={stagger(3)}>
          <View style={styles.pendingWrap}>
            <SectionLabel title={`합류 신청 (${pending.length}명)`} hint="승인해야 합류돼요" />
            <View style={[styles.list, styles.pendingList]}>
              {pending.map((p, i) => (
                <Appear key={p.id} delay={stagger(i)} style={styles.staffRow}>
                  <Avatar name={p.name} size={40} fontSize={15} />
                  <View style={styles.nameCol}>
                    <Text style={styles.staffName} numberOfLines={1}>{p.name || '이름 미입력'}</Text>
                    <Text style={styles.staffMeta} numberOfLines={1}>{p.phone_last4 ? `••••-${p.phone_last4}` : '연락처 미입력'}</Text>
                  </View>
                  <Pressable onPress={() => setRejectTarget({ id: p.id, name: p.name || '신청자' })} hitSlop={6} style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.rejectText}>거절</Text>
                  </Pressable>
                  <Pressable onPress={() => approve(p.id)} hitSlop={6} style={({ pressed }) => [styles.approveBtn, pressed && { opacity: 0.85 }]}>
                    <Text style={styles.approveText}>승인</Text>
                  </Pressable>
                </Appear>
              ))}
            </View>
          </View>
          </Appear>
        )}

        {/* 직원 목록 — 시급 편집 + 이번 달 시간·급여·근무상태(구 근무·급여 화면 흡수) */}
        <Appear delay={stagger(4)}>
        <SectionLabel title={`합류한 직원 (${staff.length}명)`} hint="탭 → 출근기록" />
        </Appear>
        <Appear delay={stagger(5)}>
        {staff.length === 0 ? (
          loadError ? (
            // 로드 실패를 "직원 0명"으로 위장하지 않고 재시도를 띄운다(무음 실패 방지).
            <View style={styles.emptyBox}>
              <Ionicons name="cloud-offline-outline" size={22} color={InkColors.ink3} />
              <Text style={styles.emptyText}>직원 목록을 불러오지 못했어요.{'\n'}연결을 확인해 주세요.</Text>
              <Pressable
                onPress={() => useStaffStore.getState().hydrate()}
                style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="refresh" size={15} color="#FFFFFF" />
                <Text style={styles.retryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={22} color={InkColors.ink3} />
              <Text style={styles.emptyText}>아직 합류한 직원이 없어요.{'\n'}위 초대코드를 직원에게 알려주세요.</Text>
            </View>
          )
        ) : (
        <View style={styles.list}>
          {staff.map((s, i) => {
            const agg = perStaff[s.id];
            const isManager = roles[s.id] === 'manager';
            const behind = behindOf[s.id];
            return (
            <Appear key={s.id} delay={stagger(i)} style={styles.staffItem}>
            <View style={[styles.staffRow, styles.staffRowFlat]}>
              <Pressable onPress={() => router.push(`/owner/timesheet/${s.id}`)} style={({ pressed }) => [styles.staffTap, pressed && { opacity: 0.6 }]}>
                <Avatar name={s.name} size={40} fontSize={15} />
                <View style={styles.nameCol}>
                  <View style={styles.nameRow}>
                    <Text style={styles.staffName} numberOfLines={1}>{s.name}</Text>
                    <StatusChip status={agg?.status ?? 'out'} />
                  </View>
                  <View style={styles.metaRow}>
                    {/* 매니저 배지(0093) — 색이 아니라 말로(P9). 이름 줄에 두면 이름이 0폭으로
                        찌부러져(QA 실측) 둘째 줄에 둔다. 전 역할에게 보인다. */}
                    {isManager && (
                      <View style={[chip.wrap, { backgroundColor: InkColors.ink }]}>
                        <Text style={[chip.text, { color: '#FFFFFF' }]}>매니저</Text>
                      </View>
                    )}
                    <Text style={styles.staffMeta} numberOfLines={1}>
                      이번 달 {fmtDuration(agg?.min ?? 0)} · {agg?.pay === null || agg?.pay === undefined ? '시급 미설정' : won(agg.pay)}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <WageCell staffId={s.id} wages={wages} setWage={setWage} />
              {/* 내보내기 — 사장 전용(remove_staff RPC 소유자만). 오탭 방지로 빨강 모달 확인 후 실행 */}
              {isOwner && (
                <Pressable
                  onPress={() => setRemoveTarget({ id: s.id, name: s.name })}
                  hitSlop={8}
                  accessibilityLabel={`${s.name} 내보내기`}
                  style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="person-remove-outline" size={19} color={BrandColors.bad} />
                </Pressable>
              )}
            </View>
            {/* 퀴즈 진도 — 이름 줄(근무 상태 칩)·둘째 줄(시간·급여)이 이미 꽉 차서 셋째 줄로 뺀다.
                같은 줄에 밀어 넣으면 이름·금액·업무 이름이 전부 잘린다(폭 실측).
                ★ 점수(`0/7`) 대신 업무 이름으로 쓴다 — 숫자로 쓰면 직원 줄세우기다(감시원칙 D1~D5).
                잴 수 있는 업무(노하우+문항)가 하나도 없으면 아무것도 안 그린다: "판정 불가"는 "다 했음"이 아니다.
                staffTap(출근기록 진입)과 형제 — Pressable 중첩 금지(RNW). */}
            {gradable.length > 0 && (
              <View style={styles.progressRow}>
                <Text style={styles.progressText} numberOfLines={1}>
                  {behind ? `${behind.firstTask} 아직` : '다 봤어요'}
                </Text>
                <ProgressPill
                  text={behind ? `${behind.total}개` : '✓'}
                  tone={!behind ? 'done' : behind.total === 1 ? 'progress' : 'behind'}
                />
              </View>
            )}
            {/* 매니저 지정/해제(0093) — 사장 전용. 확인 모달 없이 즉시 실행(P7, 같은 버튼으로 되돌림).
                staffTap(출근기록 진입)과 형제로 분리 — Pressable 중첩 금지(RNW). */}
            {isOwner && (
              <Pressable
                onPress={() => setRole(s.id, isManager ? 'junior' : 'manager')}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={isManager ? `${s.name} 매니저 해제` : `${s.name} 매니저로 지정`}
                style={({ pressed }) => [styles.roleBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name={isManager ? 'remove-circle-outline' : 'ribbon-outline'} size={14} color={InkColors.ink3} />
                <Text style={styles.roleBtnText}>{isManager ? '매니저 해제' : '매니저로 지정'}</Text>
              </Pressable>
            )}
            </Appear>
            );
          })}
        </View>
        )}
        </Appear>
        <Appear delay={stagger(6)}>
        <Text style={styles.demoNote}>* 직원을 누르면 출근 기록을 보고 시간을 수정할 수 있어요. 시급을 바꾸면 인건비에 바로 반영돼요.</Text>
        </Appear>
        <View style={{ height: 12 }} />
      </ScrollView>
      )}
      <ConfirmModal
        visible={!!removeTarget}
        icon="person-remove-outline"
        destructive
        title="직원 내보내기"
        message={`'${removeTarget?.name ?? ''}' 님을 매장에서 내보내요.\n내보내면 이 직원은 더 이상 매장 노하우·근무에 접근할 수 없어요. 다시 함께하려면 초대코드로 재합류해야 해요.`}
        confirmLabel="내보내기"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
      <ConfirmModal
        visible={!!rejectTarget}
        icon="close-circle-outline"
        destructive
        title="합류 신청 거절"
        message={`'${rejectTarget?.name ?? ''}' 님의 합류 신청을 거절해요.\n거절해도 상대는 다시 신청할 수 있어요.`}
        confirmLabel="거절"
        onConfirm={confirmReject}
        onCancel={() => setRejectTarget(null)}
      />
      <ConfirmModal
        visible={rotateOpen}
        icon="refresh-outline"
        destructive
        title="초대코드 변경"
        message={'새 초대코드를 만들면 이전 코드는 즉시 못 쓰게 돼요.\n이미 코드를 받은 직원에게는 새 코드를 다시 알려주세요.'}
        confirmLabel={rotating ? '변경 중…' : '코드 변경'}
        onConfirm={confirmRotate}
        onCancel={() => setRotateOpen(false)}
      />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: 'out' | 'working' | 'done' }) {
  const map = {
    // '근무 중'은 정상 상태다 — accent(=bad 레드) 틴트라 정상이 경고로 읽혔다(2026-08-06). 색은 good, 판별은 라벨이 한다.
    working: { label: '근무 중', color: BrandColors.goodText, bg: BrandColors.goodSoft },
    done: { label: '퇴근', color: InkColors.ink3, bg: InkColors.bgSoft },
    out: { label: '미출근', color: InkColors.ink3, bg: InkColors.bgSoft },
  } as const;
  const m = map[status];
  return (
    <View style={[chip.wrap, { backgroundColor: m.bg }]}>
      <Text style={[chip.text, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

/**
 * 시급 입력 한 칸 — **입력 중에는 서버에 쓰지 않는다**(2026-08-25 감사 #39).
 *
 * 예전엔 `onChangeText` 가 곧바로 `setWage` 를 불러 **키 입력마다 DB 쓰기**가 나갔다.
 * 그래서 "12000"을 지우고 다시 치려고 칸을 비우는 순간 `Number('') || 0` 이 0 으로 평가돼
 * **hourly_wage=0 이 서버에 확정 저장**됐고, 직원 화면이 "시급 0원 · 예상급여 0원"이 됐다.
 * 0 저장은 정상 성공이라 실패 배너도 뜨지 않는다 — 완전한 무음 데이터 손상이었다.
 *
 * 규칙 두 가지:
 *  ① 타이핑은 로컬 state 만 바꾼다. 서버 반영은 **칸을 벗어날 때 1회**(onBlur).
 *  ② 빈칸·0 은 저장하지 않는다. "아직 안 정했다"와 "0원으로 정했다"는 다른 말이고,
 *     후자는 사장이 의도적으로 고를 일이 거의 없다 — 되돌리고 원래 값을 유지한다.
 */
function WageCell({
  staffId,
  wages,
  setWage,
}: {
  staffId: string;
  wages: Record<string, number>;
  setWage: (id: string, n: number) => void;
}) {
  const saved = Object.prototype.hasOwnProperty.call(wages, staffId) ? wages[staffId] : null;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (saved === null ? '' : String(saved));

  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(/[^0-9]/g, ''));
    setDraft(null);
    // 빈칸·0·값 그대로면 쓰지 않는다(무의미한 쓰기 + 0원 확정 저장 방지).
    if (!Number.isFinite(n) || n <= 0 || n === saved) return;
    setWage(staffId, Math.min(n, 1000000));
  };

  return (
    <View style={styles.wageBox}>
      <Text style={styles.wageLabel}>시급</Text>
      <View style={styles.wageInputRow}>
        <TextInput
          value={shown}
          onChangeText={(t) => setDraft(t.replace(/[^0-9]/g, '').slice(0, 7))}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          maxLength={7}
          placeholder="미설정"
          placeholderTextColor={InkColors.ink3}
          style={styles.wageInput}
        />
        <Text style={styles.wageWon}>원</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 12 },

  // 급여 요약 카드(구 근무·급여 totalCard + 급여 설정 진입)
  payCard: { backgroundColor: InkColors.ink, borderRadius: Radius.lg, padding: 20, gap: 4 },
  payLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  payValue: { fontSize: 30, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5 },
  payNote: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  payrollBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 11, paddingHorizontal: 14, borderRadius: Radius.md },
  payrollBtnText: { flex: 1, color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  // 초대코드 — 카드가 아닌 상하 보더 스트립. 히어로(인건비)와 형태를 갈라 '카드 나열'을 끊는 자리다.
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: InkColors.line },
  inviteCol: { flex: 1, minWidth: 0 },
  inviteLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  inviteLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  inviteCode: { fontSize: 22, lineHeight: 30, fontWeight: '900', color: InkColors.ink, letterSpacing: 3 },
  // 복사·코드 변경은 보조 액션 — 화면 Primary(급여 설정)와 경쟁하지 않게 중립 면/고스트로 둔다.
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 48, paddingHorizontal: Space.md, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  copyText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },
  rotateBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: Space.md, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line },
  rotateText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },


  pendingWrap: { gap: 8 },
  // 흰 카드가 세로로 이어지면 "승인해야 진행되는 항목"이 나열 속에 묻힌다 → 옐로 틴트로 떼어놓는다.
  pendingList: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.gold },
  rejectBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line },
  rejectText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  approveBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: Radius.sm, backgroundColor: BrandColors.brand },
  approveText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },

  list: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  // 직원 항목 컨테이너(0093) — 행 + (사장 전용) 매니저 지정 줄. 구분선은 여기 하나만.
  staffItem: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  staffRowFlat: { borderBottomWidth: 0 },
  roleBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, paddingBottom: 12, paddingHorizontal: 2 },
  // 퀴즈 진도 줄 — 항목 폭 전체를 쓴다(이름 칼럼은 시급 입력·내보내기와 폭을 다투는 자리라 여기 못 둔다).
  // 알약은 오른쪽 끝 고정 → 열지 않고 세로로 훑을 수 있다.
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 28, paddingBottom: Space.sm },
  progressText: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '600', color: InkColors.ink2 },
  roleBtnText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  staffTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  nameCol: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  staffName: { fontSize: 15, fontWeight: '700', color: InkColors.ink, flexShrink: 1 },
  staffMeta: { fontSize: 12, color: InkColors.ink3, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, minWidth: 0 },
  wageBox: { alignItems: 'flex-end', gap: 3 },
  wageLabel: { fontSize: 11, color: InkColors.ink3, fontWeight: '600' },
  wageInputRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // ★폭 고정: 웹 TextInput은 명시 폭이 없으면 기본 ~20ch로 늘어나 이름 칼럼을 찌부러뜨린다(QA 실측).
  //   maxLength 7("1000000")이 15px 폰트로 72px 안에 들어간다.
  wageInput: { width: 72, textAlign: 'right', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 5, fontSize: 15, color: InkColors.ink },
  wageWon: { fontSize: 13, color: InkColors.ink3 },
  removeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, backgroundColor: BrandColors.accentSoft },

  demoNote: { fontSize: 12, color: InkColors.ink3, marginTop: 6 },
  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 28, backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line },
  emptyText: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', lineHeight: 22 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: InkColors.ink, paddingVertical: 9, paddingHorizontal: 16, borderRadius: Radius.pill, marginTop: 2 },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});

const chip = StyleSheet.create({
  wrap: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: Radius.pill },
  text: { fontSize: 11, fontWeight: '800' },
});
