import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Wordmark } from '@/components/Wordmark';
import { NotificationBell } from '@/components/NotificationBell';
import { Appear } from '@/components/Appear';
import { FeatureCarousel, JUNIOR_FEATURES } from '@/components/FeatureCarousel';
import { JuniorWelcomeCoach } from '@/components/junior/JuniorWelcomeCoach';
import { InfoDot } from '@/components/InfoDot';
import { InkColors, CategoryColors } from '@/lib/theme/colors';
import type { Category } from '@/types';
import { fmtDuration, won, hhmm } from '@/lib/utils/attendance';
import { useJuniorHomeData } from '@/lib/hooks/useJuniorHomeData';
import { styles } from './homeStyles';

// 빈 상태에서도 '뭘 물어볼 수 있는지' 보여주는 추천(업종 일반).
const QUICK_ASKS = ['마감 청소 어디까지 해요?', '포스기 에러 났어요', '진상 손님 응대법'];

/**
 * 섹션 라벨 — 제목은 카드 '밖'(위)에, 내용은 카드 '안'에. (알바몬식 IA)
 * 우측 trailing 슬롯에 카운트/뱃지를 둔다.
 */
function SectionLabel({
  icon,
  title,
  trailing,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionLabel}>
      {icon ? <Ionicons name={icon} size={15} color={InkColors.ink2} /> : null}
      <Text style={styles.sectionLabelText}>{title}</Text>
      {trailing ? <View style={styles.sectionLabelTrailing}>{trailing}</View> : null}
    </View>
  );
}

/**
 * 직원 홈 — 사령탑(하루의 앵커).
 * 1) 출근 버튼(가장 자주 누름) 2) 안 읽은 공지 3) 오늘 할일 4) 노하우 검색 5) 이번 주 근무표.
 * 출근 → 할일 → 노하우 검색 → 근무표, 하루 흐름이 한 화면에서 끝난다.
 */
export default function JuniorHomeScreen() {
  const router = useRouter();
  const {
    userName,
    checkIn,
    checkOut,
    userId,
    todayRecs,
    openRec,
    working,
    todayMin,
    todayPay,
    taskTotal,
    taskDone,
    taskRemain,
    tasksAllDone,
    unreadCount,
    latestNotice,
    myShiftCount,
    incomingSwaps,
    popularKnowhow,
    submitChat,
  } = useJuniorHomeData();

  // 탭하면 그 노하우를 질문으로 띄워 물어보기 탭에서 바로 답을 본다(전역 챗 스토어 → 화면 이동).
  function openKnowhow(title: string) {
    void submitChat(title, { anonymous: false });
    router.push('/junior/chat');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* 헤더는 다른 화면들과 동일한 네이티브 헤더 크롬을 사용한다(상단 여백·타이포 통일).
          왼쪽=착착 로고, 오른쪽=알림 벨. 매장명·내 이름은 벨 → 알림 화면 맨 위에서 보여준다. */}
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitleAlign: 'left',
          // 네이티브 타이틀 컨테이너가 좌측 ~17px에 앵커 → paddingLeft로 콘텐츠 거터(20)에 맞춰
          // 우측 벨(20)과 좌우 대칭을 만든다.
          headerTitle: () => (
            <View style={{ paddingLeft: 3 }}>
              <Wordmark size="sm" />
            </View>
          ),
          headerRight: () => <NotificationBell />,
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>{userName}님, 오늘도 화이팅이에요</Text>

        {/* 1) 출퇴근 퀵액션 — 제목은 카드 밖, 내용은 카드 안 */}
        <Appear delay={0} style={styles.section}>
        <SectionLabel icon="time-outline" title="출퇴근" />
        <View style={styles.clockCard}>
          {working && <Text style={styles.workingTag}>● 근무 중</Text>}
          {/* 출근 전엔 '0분' 큰 숫자 대신 가벼운 인사 — 군더더기 제거 후 버튼에 집중 */}
          {todayRecs.length > 0 ? (
            <Text style={styles.clockTime}>{fmtDuration(todayMin)}</Text>
          ) : (
            <Text style={styles.clockReady}>오늘도 좋은 하루 보내요</Text>
          )}
          <Text style={styles.clockSub}>
            {working
              ? `${hhmm(openRec!.check_in!)} 출근 · 근무 중`
              : todayRecs.length > 0
                ? `오늘 ${todayRecs.length}회 근무`
                : '아직 출근 전이에요'}
          </Text>

          {/* 오늘 번 돈 — 페이백을 크게 노출(P4). 출근 전이면 숨김 */}
          {todayPay > 0 && (
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>오늘 번 돈</Text>
              <InfoDot
                title="오늘 번 돈은 어떻게 계산돼요?"
                body={
                  '오늘 일한 시간 × 시급으로 계산한 금액이에요.\n근무시간은 30분 단위로 정산하고, 사장님이 정한 시급을 기준으로 해요.'
                }
              />
              <Text style={styles.payValue}>{won(todayPay)}</Text>
            </View>
          )}

          {working ? (
            <Pressable onPress={() => checkOut(userId)} style={({ pressed }) => [styles.clockBtn, styles.clockBtnOut, pressed && { opacity: 0.85 }]}>
              <Text style={styles.clockBtnText}>퇴근하기</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => checkIn(userId)}
              style={({ pressed }) => [
                styles.clockBtn,
                styles.clockBtnIn,
                todayRecs.length === 0 && styles.clockBtnBig,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.clockBtnText, styles.clockBtnTextIn, todayRecs.length === 0 && styles.clockBtnTextBig]}>
                {todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}
              </Text>
            </Pressable>
          )}

          <Pressable onPress={() => router.push('/junior/attendance')} hitSlop={6} style={({ pressed }) => [styles.clockMore, pressed && { opacity: 0.6 }]}>
            <Text style={styles.clockMoreText}>출퇴근 내역</Text>
            <Ionicons name="chevron-forward" size={13} color={InkColors.ink3} />
          </Pressable>
        </View>
        </Appear>

        {/* 2) 안 읽은 공지 — 있을 때만. 업무 탭(공지)로 진입해 읽음 처리. */}
        {unreadCount > 0 && (
          <Appear delay={60} style={styles.section}>
          <SectionLabel
            icon="megaphone"
            title="안 읽은 공지"
            trailing={
              <View style={styles.noticeBadge}>
                <Text style={styles.noticeBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            }
          />
          <Pressable
            onPress={() => router.push('/junior/work?view=notice')}
            style={({ pressed }) => [styles.noticeCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`안 읽은 공지 ${unreadCount}건. 확인하러 가기`}
          >
            {latestNotice && (
              <Text style={styles.noticeBody} numberOfLines={2}>
                {latestNotice.pinned ? '📌 ' : ''}
                {latestNotice.text}
              </Text>
            )}
            <View style={styles.cardFootRow}>
              <Text style={styles.noticeSub}>
                {unreadCount > 1 ? `외 ${unreadCount - 1}건 더 · 확인하면 읽음 처리` : '확인하면 읽음으로 표시돼요'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </View>
          </Pressable>
          </Appear>
        )}

        {/* 3) 오늘 할일 · 이번 주 근무표 — 요약형이라 2열로 묶음 */}
        <Appear delay={120} style={styles.row}>
          <View style={styles.col}>
            <SectionLabel
              icon="checkbox-outline"
              title="오늘 할일"
              trailing={
                <Text style={[styles.countPill, tasksAllDone && styles.countPillDone]}>
                  {taskDone}/{taskTotal}
                </Text>
              }
            />
            <Pressable
              onPress={() => router.push('/junior/work?view=todo')}
              style={({ pressed }) => [styles.taskCard, styles.cardFill, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${taskTotal ? (taskDone / taskTotal) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.taskSub}>
                {taskTotal === 0
                  ? '오늘 할일이 없어요'
                  : taskDone >= taskTotal
                    ? '오늘 할일을 다 끝냈어요 👏'
                    : `${taskRemain}개 남았어요`}
              </Text>
            </Pressable>
          </View>

          <View style={styles.col}>
            <SectionLabel
              icon="calendar-outline"
              title="이번 주 근무표"
              trailing={
                incomingSwaps > 0 ? (
                  <View style={styles.schedBadge}>
                    <Text style={styles.schedBadgeText}>교대 {incomingSwaps}</Text>
                  </View>
                ) : undefined
              }
            />
            <Pressable
              onPress={() => router.push('/junior/schedule')}
              style={({ pressed }) => [styles.schedCard, styles.cardFill, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.schedSub}>
                {myShiftCount > 0 ? `이번 주 ${myShiftCount}회 근무 예정` : '아직 근무가 없어요'}
              </Text>
              <Text style={styles.schedHint}>
                {incomingSwaps > 0 ? '동료가 대타를 찾고 있어요' : '대타·맞교환을 신청할 수 있어요'}
              </Text>
            </Pressable>
          </View>
        </Appear>

        {/* 4) 노하우 검색 — 노하우 탭(물어보기)로 진입하는 큰 입력 유도 카드 */}
        <Appear delay={150} style={styles.section}>
          <SectionLabel icon="search-outline" title="노하우 검색" />
          <View style={styles.askCard}>
            <Text style={styles.askSub}>매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.</Text>
            <Pressable onPress={() => router.push('/junior/chat')} style={({ pressed }) => [styles.askBar, pressed && { opacity: 0.8 }]}>
              <View style={styles.askIconBadge}>
                <Ionicons name="search" size={15} color={InkColors.ink} />
              </View>
              <Text style={styles.askBarText}>궁금한 걸 물어보세요</Text>
            </Pressable>
            <View style={styles.askChips}>
              {QUICK_ASKS.map((q) => (
                <Pressable key={q} onPress={() => router.push('/junior/chat')} style={({ pressed }) => [styles.askChip, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.askChipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Appear>

        {/* 5) 많이 물어본 노하우 — 동료들이 자주 묻는 것 미리보기(발견성). 있을 때만. */}
        {popularKnowhow.length > 0 && (
          <Appear delay={165} style={styles.section}>
            <SectionLabel icon="trending-up" title="많이 물어본 노하우" />
            <View style={styles.popularCard}>
              {popularKnowhow.map((e, i) => (
                <Pressable
                  key={e.id}
                  onPress={() => openKnowhow(e.title)}
                  style={({ pressed }) => [styles.popularRow, i > 0 && styles.popularRowBorder, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}, ${e.stats?.query_hits_30d}번 물어봄`}
                >
                  <Text style={styles.popularRank}>{i + 1}</Text>
                  <View style={[styles.popularDot, { backgroundColor: CategoryColors[e.category as Category] }]} />
                  <Text style={styles.popularTitle} numberOfLines={1}>{e.title}</Text>
                  <Text style={styles.popularHits}>{e.stats?.query_hits_30d}번</Text>
                </Pressable>
              ))}
            </View>
          </Appear>
        )}

        {/* 6) 핵심 기능 안내 배너 — 최하단. 스와이프로 핵심 기능을 소개하고 탭하면 바로 그 화면으로 */}
        <Appear delay={180} style={styles.section}>
          <SectionLabel icon="sparkles-outline" title="이런 것도 할 수 있어요" />
          <FeatureCarousel cards={JUNIOR_FEATURES} />
        </Appear>
      </ScrollView>

      <RoleTabBar role="junior" />
      {/* 합류 직후 1회 — 물어보기/노하우 등록 인지 코치마크 */}
      <JuniorWelcomeCoach />
    </SafeAreaView>
  );
}
