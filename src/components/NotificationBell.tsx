// 상단 헤더 우측 알림 벨 — 안 읽은 공지 + 나에게 온 교대 요청 수를 배지로.
// 탭하면 알림 화면(/junior/notifications)으로. 매장명·내 이름은 그 화면 맨 위에서 보여준다.
import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { todayStr } from '@/lib/utils/attendance';
import { accountAckAt, juniorUnreadCount, manageUnreadCount } from '@/lib/utils/notifications';
import { useLegacyQuizOpen } from '@/lib/hooks/useLegacyQuizOpen';
import { useManageNotifArgs } from '@/lib/hooks/useManageNotifArgs';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { ButtonStyles, TouchSize, hitTrim } from '@/lib/theme/button';

const EMPTY_IDS: string[] = [];
const BELL_ICON = 23;

/** 알림 벨(프레젠테이셔널) — 헤더 우측 공용. 배지 카운트·탭 동작은 호출부가 주입(사장·직원 공유).
 *  edge=true(기본): 네이티브 헤더용 우측 끝 여백(HEADER_EDGE_GUTTER). false: 자체 패딩 가진 커스텀 헤더용. */
export function BellButton({ count, onPress, edge = true }: { count: number; onPress: () => void; edge?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `알림 ${count}건` : '알림'}
      style={({ pressed }) => [styles.btn, !edge && styles.btnFlush, pressed && { opacity: 0.6 }]}
    >
      {/* 보이는 종(32) — 배지는 이 안쪽 기준으로 종 오른쪽 위에 붙는다. 바깥 Pressable 이 누르는 상자 44. */}
      <View style={styles.face}>
        <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={BELL_ICON} color={InkColors.ink} />
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} maxFontSizeMultiplier={1.3}>{count > 99 ? '99+' : count}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** 직원 알림 벨 — 배지 = 안 읽은 공지 + 받은 교대 요청 → /junior/notifications. */
export function NotificationBell({ edge = true }: { edge?: boolean } = {}) {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const swaps = useScheduleStore((s) => s.swaps);
  const scheduleNotices = useScheduleStore((s) => s.notices);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  // 동료가 물었는데 아직 답이 없는 질문(D4)도 배지 축이다 — 큐는 사장 벨이 이미 쓰던 스토어를 그대로 읽는다.
  const queue = useUnknownQueueStore((s) => s.queue);
  const unitId = useSessionStore((s) => s.unitId);
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));
  const today = todayStr();

  // 안 푼 퀴즈(P1 역 ④)도 배지 축 — 목록(junior/notifications.tsx)과 같은 발송 원장. 합류 결과(0247)도 같은 목록의 축.
  const assignments = useWorkStore((s) => s.assignments);
  // 0332: 홈·카드와 같은 quizTodo 입력(서버 진행 state · 카드 순서).
  //   조회가 실패하면 스토어는 [] 를 넣는다 → "진행 없음"(undefined)으로 넘겨 완료 여부 폴백을 쓴다(안 푼 퀴즈가 조용히 사라지지 않게).
  const quizProgressRaw = useWorkStore((s) => s.quizProgress);
  const quizProgressError = useWorkStore((s) => s.quizProgressError);
  const quizProgress = quizProgressError ? undefined : quizProgressRaw;
  const courses = useWorkStore((s) => s.courses);
  // 열린 옛 퀴즈(발송 원장 없음) — 홈과 같은 판정(I7). 조회 중이면 빈 목록.
  const legacyQuizIds = useLegacyQuizOpen().ids ?? EMPTY_IDS;
  const joinNotices = useStaffStore((s) => s.joinNotices);
  // 합류 결과는 계정 단위 — 읽음 기준은 내 매장 ack 중 가장 늦은 시각(accountAckAt · 목록·허브와 같은 판정).
  const ackByUnit = useMemberPrefsStore((s) => s.ackByUnit);
  const joinAckAt = accountAckAt(ackByUnit);
  const count = useMemo(
    () => juniorUnreadCount(feed, swaps, userId, today, templates, done, ackAt, suggestions, queue, scheduleNotices, assignments, joinNotices, joinAckAt, quizProgress, courses, legacyQuizIds),
    [feed, swaps, userId, today, templates, done, ackAt, suggestions, queue, scheduleNotices, assignments, joinNotices, joinAckAt, quizProgress, courses, legacyQuizIds],
  );

  return <BellButton count={count} edge={edge} onPress={() => router.push('/junior/notifications')} />;
}

/** 사장·매니저 알림 벨 — 배지 = 합류 승인대기 + 답변대기 질문 + 검토대기 제안 + 승인대기 교대
 *  (+ 매니저는 나에게 온 것: 공지·배정·내 제안 결과) → /owner/notifications.
 *  배지와 목록(owner/notifications.tsx)이 **같은 축**을 봐야 하므로 역할 분기를 여기서도 그대로 한다. */
export function OwnerNotificationBell({ edge = true }: { edge?: boolean } = {}) {
  const router = useRouter();
  const role = useSessionStore((s) => s.role);
  // 입력은 목록(owner/notifications.tsx)·앱 배지와 같은 훅 하나(useManageNotifArgs) — 매니저 배지 = 목록의 안 읽음(F-2).
  const { ownerArgs, received } = useManageNotifArgs();
  //   역할 분기는 manageUnreadCount 하나 — 앱 아이콘 배지(appBadge)가 같은 함수를 쓴다.
  const count = useMemo(() => manageUnreadCount(role, ownerArgs, received), [role, ownerArgs, received]);

  return <BellButton count={count} onPress={() => router.push('/owner/notifications')} edge={edge} />;
}

const styles = StyleSheet.create({
  // 우측 끝에서 콘텐츠 거터(HEADER_EDGE_GUTTER)만큼 안쪽으로 — 좌측 back 화살표와 좌우 대칭.
  // 누르는 상자 = 높이 44 이상(2026-11-02 사용자 결정 · 상단바 작은 알약). RN-web 은 hitSlop 을 무시한다.
  btn: { ...ButtonStyles.inlineHit, paddingLeft: 14, paddingRight: HEADER_EDGE_GUTTER },
  // 상단바 안(edge=false) — 폭도 44 로 키우되 좌우 음수 여백으로 자리는 종 폭(23)만 차지한다(옆 아바타와의 간격 그대로).
  btnFlush: { paddingLeft: 0, paddingRight: 0, minWidth: TouchSize.inline, alignItems: 'center', marginHorizontal: hitTrim(BELL_ICON) },
  face: { minHeight: TouchSize.inlineFace, justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -1,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...Type.micro, fontWeight: '900', color: InkColors.bubbleText },
});
