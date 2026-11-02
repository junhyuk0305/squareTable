import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useStaffStore } from '@/lib/store/useStaffStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { goToTab } from '@/components/RoleTabBar';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Avatar } from '@/components/Avatar';
import { SectionLabel } from '@/components/SectionLabel';
import { Screen, Section } from '@/components/Screen';
import { TwoPane, Pane } from '@/components/shell/TwoPane';
import { InviteBlock } from '@/components/owner/InviteBlock';
import { ActionRow } from '@/components/blocks/ActionRow';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Layout, Space, screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize, hitTrim } from '@/lib/theme/button';
import { EmptyStyles } from '@/lib/theme/empty';
import { fmtDuration, todayStr, liveMinutes, staffWorkStatus } from '@/lib/utils/attendance';
import { showToast } from '@/lib/store/useToastStore';
import { rotateInviteCode } from '@/lib/db';
import { useOpenFromParam } from '@/lib/hooks/useOpenFromParam';

// 등장 애니메이션(Appear)이 가라앉은 뒤 재야 행 위치가 맞다(schedule.tsx 와 같은 값).
const FOCUS_SETTLE_MS = 520;

export default function OwnerStaffScreen() {
  const router = useRouter();
  // ?member=<신청자 id> — 합류 신청 알림(레지스트리 join_request route)에서 들어오면 그 신청 행을 강조한다(P1 역 ⑤).
  const { member: focusMemberId } = useLocalSearchParams<{ member?: string }>();
  // ★0346 즉시 합류 — 합류함 알림(member_joined)은 재직 직원 행으로 온다. 그 행도 강조하고 한 번 스크롤한다.
  //   행 위치는 스크롤 내용 기준으로 잰다(TodoScreen 과 같은 measureLayout · 두 단 배치에서도 맞다). 같은 id 로는 한 번만.
  const scrollRef = useRef<ScrollView>(null);
  const focusRowRef = useRef<View>(null);
  const [pendingFocus, focusDone] = useOpenFromParam(focusMemberId);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (focusTimer.current) clearTimeout(focusTimer.current); }, []);
  function scheduleFocusScroll() {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      const node = focusRowRef.current;
      const inner = scrollRef.current?.getInnerViewNode?.();
      if (!node || !inner) return focusDone();
      node.measureLayout(inner, (_x, y) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
        focusDone();
      }, focusDone);
    }, FOCUS_SETTLE_MS);
  }
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
  // ★게이트는 명부만 보면 안 된다 — 근무 시간·상태는 records 에서 나온다. 다 와야 참이다.
  //   (시급·근무표 대기는 2026-11-02 급여 제거로 뺐다.)
  //   훅은 `&&` 안에서 부르지 않는다(단락 평가로 훅 개수가 달라지면 크래시).
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const workLoaded = useWorkStore((s) => s.loaded);
  const ready = staffLoaded && attendanceLoaded && workLoaded;
  const INVITE_CODE = useSessionStore((s) => s.inviteCode) || '------';
  // 0201(2026-09-14): 이 화면은 **사장 전용**이다 — 승인·시급·급여를 서버가 사장으로 좁혔고,
  // roles.ts 허용목록에도 없어 매니저는 여기에 도착하지 못한다. 0093 의 '매니저도 쓴다'는 낡았다.
  const isOwner = useSessionStore((s) => s.role) === 'owner';

  // 내보낼 직원 — 확인 모달용. 실수 방지 위해 빨강 모달로 한 번 더 확인한다.
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  // 거절 대상 — 확인 모달용(신청 거절도 되돌리기 번거로우니 한 번 확인).
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  // 매니저로 지정할 직원 — 안내 모달용(무엇이 같고 무엇이 다른지 먼저 보여준다).
  const [managerTarget, setManagerTarget] = useState<{ id: string; name: string } | null>(null);
  const [rotating, setRotating] = useState(false);

  // 화면 진입/복귀 시마다 명부·합류신청을 다시 당겨온다. owner 레이아웃 hydrate는 로그인 시 1회뿐이라,
  // 앱을 켜둔 채로 새 합류 신청이 들어와도(profiles 실시간 미구독) 이 화면을 열면 반드시 최신으로 보인다.
  useFocusEffect(useCallback(() => { useStaffStore.getState().hydrate(); }, []));

  // 근무 중 직원의 누적시간을 30초마다 갱신(구 근무·급여 화면에서 흡수).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // 직원별 이번 달 시간·근무상태 — 구 attendance 화면의 집계를 직원 목록에 합친다.
  // 기간은 달력 월(1일~말일)이다(2026-11-02 급여 제거 · 사용자 결정).
  const today = todayStr();
  const ym = today.slice(0, 7);
  const perStaff = useMemo(() => {
    const map: Record<string, { min: number; status: 'out' | 'working' | 'done' | 'forgot' }> = {};
    for (const s of staff) {
      // 근무시간 표시는 실제 출퇴근 그대로(확인용).
      const min = records.filter((r) => r.staff_id === s.id && r.date.startsWith(ym)).reduce((sum, r) => sum + liveMinutes(r), 0);
      // ★근무 중 판정은 날짜와 상관없이 열린 기록으로 한다(Q4) — 오늘 기록만 보면 자정을 넘긴 야간 근무자가 '미출근'으로 보인다.
      //   16시간 넘게 열린 기록은 '퇴근 안 찍음'으로 따로 보인다(결함 8) — 오래된 기록 하나로 '근무 중'이라고 하지 않는다.
      const status = staffWorkStatus(records, s.id, today);
      map[s.id] = { min, status };
    }
    return map;
  }, [records, staff, ym, today]);

  // 직원별 퀴즈 진도 줄은 2026-09-13 실측 QA 로 **이 화면에서 뺐다**(사장 요청).
  //   이유: 이 화면은 '누구에게 얼마' 를 보는 자리고, 진도는 퀴즈 탭(응시 현황)이 이미 맡는다.
  //   같은 사실을 두 화면에서 말하면 둘 중 하나만 고쳐지는 순간 서로 다른 말을 한다.
  //   판정 본체(taskProgress)는 그대로 두고 여기서 부르지만 않는다 — 퀴즈 탭·사장 홈이 계속 쓴다.

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

  // 초대코드 재발급(남용 #31) — 새 6자리(만료 없음 · 0282 C6). 이전 코드는 즉시 무효(유출 차단).
  const confirmRotate = async () => {
    setRotating(true);
    const res = await rotateInviteCode();
    setRotating(false);
    setRotateOpen(false);
    // 실패(null) 시 예전엔 모달만 닫고 아무 신호가 없어, 사장이 코드가 바뀐 줄 착각했다(무음 실패).
    if (res) {
      useSessionStore.setState({ inviteCode: res.inviteCode, inviteExpiresAt: res.expiresAt });
      showToast('초대코드를 변경했어요', 'good');
    } else {
      showToast('코드 변경에 실패했어요. 잠시 후 다시 시도해 주세요.', 'warn');
    }
  };

  return (
    <>
    {/* 바탕·헤더·탭바 = Screen. 스크롤은 직접 둔다(scroll={false}) — 로딩 게이트가 스크롤 자리를 바꾸고 KeyboardShift 가 스크롤을 감싼다. */}
    <Screen header={<ScreenTitleHeader title="직원" backFallback />} tabBar="owner" scroll={false}>
      <Stack.Screen options={{ title: '직원' }} />
      {/* 전부 도착 전엔 무조건 로딩 — "직원 0명" 기본 화면이 먼저 떴다가 채워지는 부분 렌더 금지. */}
      {!ready ? (
        <ScreenLoading label="직원 목록을 불러오고 있어요…" />
      ) : (
      <KeyboardShift>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={screenScrollStyle} showsVerticalScrollIndicator={false}>
        {/* 넓은 웹에서만 두 단 — 왼쪽 직원 목록 / 오른쪽 초대·바로 가기.
            폰 폭에서는 아래 순서 그대로 한 줄씩이다(배치만 바뀐다 · 섹션 사이 = 스크롤 gap).
            맨 위 인건비 카드는 2026-11-02 급여 기능과 함께 뺐다. */}
        <TwoPane gap={Layout.sectionGap}>
        {/* ② 초대 — 코드 한 줄만 주던 자리를 공용 InviteBlock 으로 바꿨다(2026-09-08).
            안내·코드 복사·초대 링크가 한 벌이라, 사장이 자리마다 다른 설명을 읽지 않는다.
            '코드 변경'만 이 화면 고유라 action 슬롯으로 넘긴다. */}
        <Pane side="rail">
        <Appear delay={stagger(1)}>
        <InviteBlock
          code={INVITE_CODE}
          from="staff"
          action={
            // 코드 변경 = 사장 전용(rotate_invite_code RPC 가 소유자만 통과) — 매니저에겐 비노출.
            isOwner ? (
              <Pressable
                onPress={() => setRotateOpen(true)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="초대코드 변경"
                style={({ pressed }) => [styles.rotateBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.rotateText}>코드 변경</Text>
              </Pressable>
            ) : null
          }
        />
        </Appear>

        {/* ③④ 바로 가기 — 퀴즈·근무표 진입 2칸. ActionRow(2026-11-02 형태를 하나로 통일 — 옛 tile 폐기).
            새 직원이 들어오기로 한 순간이 코스를 만들 순간(초대코드 바로 아래).
            근무표 칸은 허브 '현황'이 근무표로 착지하게 바뀐(2026-08-11 P2) 보상으로 둔 반대 방향 진입점.
            상태 한 줄 없음 — 이 화면은 퀴즈·근무표 건수를 읽지 않는다(새 쿼리 금지). */}
        <Appear delay={stagger(2)}>
        <Section title="바로 가기">
          <ActionRow
            items={[
              { key: 'quiz', icon: 'school-outline', label: '퀴즈', onPress: () => goToTab('/owner/training') },
              { key: 'schedule', icon: 'calendar-outline', label: '근무표', onPress: () => router.push('/owner/schedule') },
            ]}
          />
        </Section>
        </Appear>

        </Pane>

        <Pane side="main">
        {/* 합류 신청(승인 대기) — 남용 #2. 코드로 신청한 사람을 사장이 승인해야 소속된다. */}
        {pending.length > 0 && (
          <Appear delay={stagger(3)}>
          <Section title={`합류 신청 (${pending.length}명)`}>
            <View style={[styles.list, styles.pendingList]}>
              {pending.map((p, i) => (
                <Appear key={p.id} delay={stagger(i)} style={[styles.staffRow, p.id === focusMemberId && styles.focusRow]}>
                  <Avatar name={p.name} size={40} fontSize={Type.body.fontSize} />
                  <View style={styles.nameCol}>
                    <Text style={styles.staffName} numberOfLines={1}>{p.name || '이름 미입력'}</Text>
                    <Text style={styles.staffMeta} numberOfLines={1}>{p.phone_last4 ? `••••-${p.phone_last4}` : '연락처 미입력'}</Text>
                  </View>
                  {/* 보이는 버튼 32 · 누르는 상자 44(바깥 Pressable) — RN-web 은 hitSlop 을 무시한다. */}
                  <Pressable onPress={() => setRejectTarget({ id: p.id, name: p.name || '신청자' })} style={({ pressed }) => [styles.rowHit, pressed && { opacity: 0.7 }]}>
                    <View style={styles.rejectBtn}>
                      <Text style={styles.rejectText}>거절</Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => approve(p.id)} style={({ pressed }) => [styles.rowHit, pressed && { opacity: 0.85 }]}>
                    <View style={styles.approveBtn}>
                      <Text style={styles.approveText}>승인</Text>
                    </View>
                  </Pressable>
                </Appear>
              ))}
            </View>
          </Section>
          </Appear>
        )}

        {/* 직원 목록 — 이번 달 시간·근무상태(구 근무·급여 화면 흡수). 제목과 목록이 따로 등장해 Section 대신 같은 간격(sm)을 직접 둔다. */}
        <View style={{ gap: Space.sm }}>
        <Appear delay={stagger(4)}>
        <SectionLabel title={`합류한 직원 (${staff.length}명)`} />
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
                <Ionicons name="refresh" size={15} color={InkColors.bubbleText} />
                <Text style={styles.retryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>아직 합류한 직원이 없어요.{'\n'}위 초대코드를 직원에게 알려주세요.</Text>
            </View>
          )
        ) : (
        <View style={styles.list}>
          {staff.map((s, i) => {
            const agg = perStaff[s.id];
            const isManager = roles[s.id] === 'manager';
            return (
            <Appear key={s.id} delay={stagger(i)} style={[styles.staffItem, s.id === focusMemberId && styles.focusRow]}>
            {/* ★0346 ?member= 로 온 직원 행 — 강조 테두리 안에서 내보내기 버튼을 그대로 바로 누를 수 있다. */}
            <View
              ref={s.id === focusMemberId ? focusRowRef : undefined}
              onLayout={s.id === pendingFocus ? scheduleFocusScroll : undefined}
              style={[styles.staffRow, styles.staffRowFlat]}
            >
              <Pressable onPress={() => router.push(`/owner/timesheet/${s.id}`)} style={({ pressed }) => [styles.staffTap, pressed && { opacity: 0.6 }]}>
                <Avatar name={s.name} size={40} fontSize={Type.body.fontSize} />
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
                        <Text style={[chip.text, { color: InkColors.bubbleText }]}>매니저</Text>
                      </View>
                    )}
                    <Text style={styles.staffMeta} numberOfLines={1}>이번 달 {fmtDuration(agg?.min ?? 0)}</Text>
                  </View>
                </View>
              </Pressable>
              {/* 내보내기 — 사장 전용(remove_staff RPC 소유자만). 오탭 방지로 빨강 모달 확인 후 실행 */}
              {isOwner && (
                <Pressable
                  onPress={() => setRemoveTarget({ id: s.id, name: s.name })}
                  accessibilityLabel={`${s.name} 내보내기`}
                  style={({ pressed }) => [styles.rowHit, styles.removeHit, pressed && { opacity: 0.6 }]}
                >
                  <View style={styles.removeBtn}>
                    <Ionicons name="person-remove-outline" size={19} color={BrandColors.bad} />
                  </View>
                </Pressable>
              )}
            </View>
            {/* 매니저 지정/해제(0093) — 사장 전용. staffTap(출근기록 진입)과 형제로 분리(Pressable 중첩 금지·RNW).
                ★지정은 **권한이 늘어나는 방향**이라 안내 모달을 먼저 띄운다(2026-09-13 사장 요청):
                  같은 버튼으로 되돌릴 수 있다는 것(P7)은 "무엇이 달라지는지 모른 채 눌렀다"를 못 막는다.
                해제는 권한이 줄어드는 쪽이라 그대로 즉시 실행한다 — 확인을 두 방향에 다 걸면 되돌리기가 무거워진다.
                지정 버튼은 노랑(권장 액션·검정 글자), 해제는 눌러서 되돌리는 회색 글자 그대로. */}
            {isOwner && (
              <Pressable
                onPress={() => (isManager ? setRole(s.id, 'junior') : setManagerTarget({ id: s.id, name: s.name }))}
                accessibilityRole="button"
                accessibilityLabel={isManager ? `${s.name} 매니저 해제` : `${s.name} 매니저로 지정`}
                style={({ pressed }) => [styles.roleHit, pressed && { opacity: 0.6 }]}
              >
                <View style={isManager ? styles.roleBtn : styles.roleBtnOn}>
                  <Ionicons
                    name={isManager ? 'remove-circle-outline' : 'ribbon-outline'}
                    size={14}
                    color={isManager ? InkColors.ink3 : InkColors.ink}
                  />
                  <Text style={isManager ? styles.roleBtnText : styles.roleBtnOnText}>
                    {isManager ? '매니저 해제' : '매니저로 지정'}
                  </Text>
                </View>
              </Pressable>
            )}
            </Appear>
            );
          })}
        </View>
        )}
        </Appear>
        </View>
        <Appear delay={stagger(6)}>
        <Text style={styles.demoNote}>* 직원을 누르면 출근 기록을 보고 시간을 수정할 수 있어요.</Text>
        </Appear>
        </Pane>
        </TwoPane>
      </ScrollView>
      </KeyboardShift>
      )}
    </Screen>
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
      {/* 매니저 안내(2026-10-19 · 0315) — 실제로 되는 것만 적는다.
          경계의 기준은 서버(auth_can_manage · 사장 전용 RPC)다. 앱 허용목록(lib/utils/roles.ts)은 서버가 허용한 범위를 연다. */}
      <ConfirmModal
        visible={!!managerTarget}
        icon="ribbon-outline"
        title="매니저로 지정할까요?"
        message={`'${managerTarget?.name ?? ''}' 님이 매장 관리를 도울 수 있어요.\n\n새로 할 수 있는 것 — 근무표 짜기·교대 승인·근무 시간 수정 승인, 할일 배정, 공지 쓰기, 출근 기록 수정, 업무방 관리, 노하우 고치기·제안 승인, 퀴즈.\n\n그대로인 것 — 초대코드, 직원 내보내기·매니저 지정, 노하우 보관, 업무방 삭제, 요금제는 사장님만 해요.`}
        accent="매니저도 직원 화면을 그대로 써요. 설정의 '매장 관리'·'노하우'·'퀴즈'로 들어가요."
        confirmLabel="매니저로 지정"
        onConfirm={() => {
          if (managerTarget) setRole(managerTarget.id, 'manager');
          setManagerTarget(null);
        }}
        onCancel={() => setManagerTarget(null)}
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
    </>
  );
}

function StatusChip({ status }: { status: 'out' | 'working' | 'done' | 'forgot' }) {
  const map = {
    // '근무 중'은 정상 상태다 — accent(=bad 레드) 틴트라 정상이 경고로 읽혔다(2026-08-06). 색은 good, 판별은 라벨이 한다.
    working: { label: '근무 중', color: BrandColors.goodText, bg: BrandColors.goodSoft },
    done: { label: '퇴근', color: TextColor.secondary, bg: InkColors.bgSoft },
    out: { label: '미출근', color: TextColor.secondary, bg: InkColors.bgSoft },
    forgot: { label: '퇴근 안 찍음', color: BrandColors.warnText, bg: BrandColors.warnSoft },
  } as const;
  const m = map[status];
  return (
    <View style={[chip.wrap, { backgroundColor: m.bg }]}>
      <Text style={[chip.text, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // 코드 변경은 보조 액션 — 고스트로 둔다. 초대코드 줄(코드 · 복사 · 이 버튼)이 좁아 작은 버튼 규격(좌우 20 · 15)을 쓰지 않는다.
  rotateBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: Space.md, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line },
  rotateText: { fontSize: 13, fontWeight: '700', color: TextColor.secondary },

  // 흰 카드가 세로로 이어지면 "승인해야 진행되는 항목"이 나열 속에 묻힌다 → 옐로 틴트로 떼어놓는다.
  pendingList: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.gold },
  // 알림으로 들어온 신청 행 — 테두리만 강조.
  focusRow: { borderWidth: 2, borderColor: BrandColors.accentSolid, borderRadius: Radius.md, paddingHorizontal: 8 },
  // 줄 안 작은 버튼(2026-11-02 사용자 결정) — 보이는 높이 32 · 누르는 상자 44.
  //   상자는 위아래 음수 여백(hitTrim)으로 자리를 32 만큼만 차지한다 → 줄 높이(아바타 40 + 위아래 14)는 그대로.
  rowHit: { ...ButtonStyles.inlineHit, marginVertical: hitTrim(TouchSize.inlineFace) },
  rejectBtn: { minHeight: TouchSize.inlineFace, justifyContent: 'center', paddingHorizontal: 12, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line },
  rejectText: { fontSize: 13, fontWeight: '700', color: TextColor.secondary },
  approveBtn: { minHeight: TouchSize.inlineFace, justifyContent: 'center', paddingHorizontal: 14, borderRadius: Radius.sm, backgroundColor: BrandColors.brand },
  approveText: { fontSize: 13, fontWeight: '800', color: InkColors.bubbleText },

  list: CardStyles.rows,
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  // 직원 항목 컨테이너(0093) — 행 + (사장 전용) 매니저 지정 줄. 구분선은 여기 하나만.
  staffItem: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  staffRowFlat: { borderBottomWidth: 0 },
  // 매니저 지정/해제 누르는 상자 44 — 보이는 32 의 위끝은 행 바로 아래, 아래끝은 항목 끝에서 12(옛 자리 그대로).
  roleHit: {
    ...ButtonStyles.inlineHit, alignSelf: 'flex-end',
    marginTop: hitTrim(TouchSize.inlineFace), marginBottom: Space.md + hitTrim(TouchSize.inlineFace),
  },
  roleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TouchSize.inlineFace, paddingHorizontal: 2 },
  roleBtnText: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
  // 지정(권장 액션) — 노랑 알약 + 검정 글자. 해제(roleBtn)와 무게를 일부러 다르게 둔다.
  roleBtnOn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    minHeight: TouchSize.inlineFace, paddingHorizontal: 12,
    borderRadius: Radius.pill, backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep,
  },
  roleBtnOnText: { ...Type.tag, fontWeight: '800', color: InkColors.ink },
  staffTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  nameCol: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  staffName: { ...Type.body, fontWeight: '700', flexShrink: 1 },
  staffMeta: { ...Type.tag, color: TextColor.secondary, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, minWidth: 0 },
  // 내보내기 = 보이는 32 · 누르는 44×44. 오른쪽 음수 여백으로 보이는 네모를 줄 오른쪽 끝(매니저 버튼과 같은 선)에 붙인다.
  removeHit: { minWidth: TouchSize.inline, alignItems: 'center', marginRight: hitTrim(TouchSize.inlineFace) },
  removeBtn: { width: TouchSize.inlineFace, height: TouchSize.inlineFace, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, backgroundColor: BrandColors.accentSoft },

  // 안내 한 줄 = 설명(13/19 secondary). 위 간격은 스크롤 gap(20)이 정한다.
  demoNote: Type.desc,
  emptyBox: EmptyStyles.box,
  emptyText: EmptyStyles.text,
  // 빈 카드 가운데 작은 버튼(44 알약) — 카드가 가운데 정렬이라 alignSelf 만 되돌린다.
  retryBtn: { ...ButtonStyles.small, alignSelf: 'center', flexDirection: 'row', gap: 6, backgroundColor: InkColors.ink, marginTop: 2 },
  retryText: { ...ButtonTextStyles.small, color: InkColors.bubbleText },
});

const chip = StyleSheet.create({
  wrap: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: Radius.pill },
  text: { ...Type.micro, fontWeight: '800' },
});
