import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar, goToTab } from '@/components/RoleTabBar';
import { StoreToggle } from '@/components/StoreToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { Appear } from '@/components/Appear';
import { FeatureCarousel, JUNIOR_FEATURES } from '@/components/FeatureCarousel';
import { JuniorWelcomeCoach } from '@/components/junior/JuniorWelcomeCoach';
import { InfoDot } from '@/components/InfoDot';
import { SectionLabel } from '@/components/SectionLabel';
import { MiniStats } from '@/components/blocks/MiniStats';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { fmtDuration, won, hhmm } from '@/lib/utils/attendance';
import { useJuniorHomeData } from '@/lib/hooks/useJuniorHomeData';
import { styles } from '@/styles/juniorHomeStyles';

// 빈 상태에서도 '뭘 물어볼 수 있는지' 보여주는 추천(업종 일반).
const QUICK_ASKS = ['마감 청소 어디까지 해요?', '포스기 에러 났어요', '진상 손님 응대법'];

/** 홈 목록은 3건 + "전체보기 ›" — 전 화면 공통 배치 규칙(2026-08-05 블록 어휘). */
const HOME_LIST_LIMIT = 3;

/**
 * 직원 홈 — 사령탑(하루의 앵커).
 *
 * ★Primary = **오늘 할 일**(2026-08-05 블록 어휘 개편에서 교체).
 *   직전까지는 '노하우 물어보기'가 Primary였다(IA 결정 2 = 안 B, 2026-07-29 — 질문→노하우 루프가
 *   전략 정본의 북극성이라 1등석을 줬다). 그러나 직원은 배우러 앱을 열지 않는다 —
 *   "오늘 뭘 해야 하나"를 보러 연다. 물어보기는 그 아래 2번 자리로 내리되 카드는 그대로 남긴다
 *   (진입점을 없애는 게 아니라 순서만 바꾼 것 — 북극성 루프는 채팅 탭에서 그대로 살아 있다).
 *
 * 블록 5개(A형 예산): 1) 오늘 할 일 2) 노하우 물어보기 3) 출퇴근 4) 오늘 한눈에 5) 기능 안내.
 * 카드 밖 라벨은 공용 <SectionLabel>을 쓴다 — 로컬 재구현본은 폐기했다(ui.md 재구현 금지).
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
    taskRemain,
    todayTasks,
    unreadCount,
    latestNotice,
    daypartStatus,
    unreadMentionCount,
    latestMention,
    myShiftCount,
    incomingSwaps,
  } = useJuniorHomeData();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* 헤더는 다른 화면들과 동일한 네이티브 헤더 크롬을 사용한다(상단 여백·타이포 통일).
          왼쪽=매장의 정석 로고, 오른쪽=알림 벨. 매장명·내 이름은 벨 → 알림 화면 맨 위에서 보여준다. */}
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitleAlign: 'left',
          // 홈은 탭 루트 — 하단 탭바로만 진입하므로 뒤로가기 화살표를 무조건 끈다.
          // (탭 전환은 replace라 보통 history가 없지만, 온보딩/합류/딥링크 경로로 홈이 스택 위에
          //  얹히면 react-navigation 기본 back 화살표가 새어나온다 → 막다른 컨트롤. owner dashboard와 동일 처리.)
          headerLeft: () => null,
          headerBackVisible: false,
          // 네이티브 타이틀 컨테이너가 좌측 ~17px에 앵커 → paddingLeft로 콘텐츠 거터(20)에 맞춰
          // 우측 벨(20)과 좌우 대칭을 만든다.
          headerTitle: () => (
            <View style={{ paddingLeft: 3 }}>
              <StoreToggle />
            </View>
          ),
          headerRight: () => <NotificationBell />,
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>{userName}님, 오늘도 화이팅이에요</Text>

        {/* 1) 오늘 할 일 = 이 화면의 Primary (2026-08-05).
            데이파트 칩(오픈·미들·마감별 진행)을 같은 블록에 묶어, '오늘'에 관한 것은 한 덩어리로 읽히게 한다. */}
        <Appear style={styles.section}>
          <SectionLabel
            icon="checkbox-outline"
            title="오늘 할 일"
            trailing={
              taskTotal > 0 ? (
                <Pressable
                  onPress={() => goToTab('/junior/work?view=todo')}
                  accessibilityRole="button"
                  accessibilityLabel="오늘 할 일 전체보기"
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  <Text style={styles.moreLink}>전체보기 ›</Text>
                </Pressable>
              ) : undefined
            }
          />
          <View style={styles.todoCard}>
            {taskTotal === 0 ? (
              <>
                <Text style={styles.todoEmpty}>오늘 할 일이 없어요</Text>
                <Pressable
                  onPress={() => goToTab('/junior/work?view=todo')}
                  style={({ pressed }) => [styles.todoEmptyBtn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel="업무 보러 가기"
                >
                  <Text style={styles.todoEmptyBtnText}>업무 보러 가기</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.todoLead}>
                  {taskRemain === 0 ? '오늘 할 일을 다 마쳤어요' : `${taskRemain}개 남았어요`}
                </Text>

                {/* 데이파트별 진행 — 할일이 있는 시간대만 나온다. */}
                {daypartStatus.length > 0 && (
                  <View style={styles.briefDayparts}>
                    {daypartStatus.map((d) => {
                      const complete = d.done >= d.total;
                      return (
                        <Pressable
                          key={d.id}
                          onPress={() => goToTab('/junior/work?view=todo')}
                          style={({ pressed }) => [styles.dpChip, complete && styles.dpChipDone, pressed && { opacity: 0.7 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${d.label} ${d.done}/${d.total}${complete ? ' 완료' : ''}`}
                        >
                          {complete && <Ionicons name="checkmark" size={12} color={BrandColors.good} />}
                          <Text style={[styles.dpChipText, complete && styles.dpChipTextDone]}>
                            {d.label} {d.done}/{d.total}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {todayTasks.slice(0, HOME_LIST_LIMIT).map((t, i) => (
                  <View key={t.id} style={[styles.todoRow, i > 0 && styles.todoRowDivider]}>
                    <Ionicons
                      name={t.done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={t.done ? BrandColors.good : InkColors.ink3}
                    />
                    <Text style={[styles.todoText, t.done && styles.todoTextDone]} numberOfLines={1}>
                      {t.text}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </Appear>

        {/* 2) 노하우 물어보기 — Primary 자리는 내줬지만 카드는 그대로. 북극성 루프의 홈 진입점이다. */}
        <Appear style={styles.section}>
          <SectionLabel icon="search-outline" title="노하우 물어보기" />
          <View style={styles.askCard}>
            <Text style={styles.askSub}>매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.</Text>
            <Pressable onPress={() => goToTab('/junior/chat')} style={({ pressed }) => [styles.askBar, pressed && { opacity: 0.85 }]}>
              <Text style={styles.askBarText}>궁금한 걸 물어보세요</Text>
              <View style={styles.askSend}>
                <Ionicons name="arrow-up" size={16} color={InkColors.ink} />
              </View>
            </Pressable>
            <View style={styles.askChips}>
              {QUICK_ASKS.map((q) => (
                <Pressable key={q} onPress={() => goToTab('/junior/chat')} style={({ pressed }) => [styles.askChip, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.askChipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Appear>

        {/* 3) 출퇴근 퀵액션 — 제목은 카드 밖, 내용은 카드 안 */}
        <Appear style={styles.section}>
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
                  '오늘 일한 시간 × 시급으로 계산한 ‘세전 예상액’이에요.\n근무시간은 30분 단위로 정산하고, 사장님이 정한 시급을 기준으로 해요.\n세금·4대보험·수당에 따라 실제 받는 금액과 다를 수 있어요.'
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

          <Pressable onPress={() => goToTab('/junior/attendance')} hitSlop={6} style={({ pressed }) => [styles.clockMore, pressed && { opacity: 0.6 }]}>
            <Text style={styles.clockMoreText}>출퇴근 내역</Text>
            <Ionicons name="chevron-forward" size={13} color={InkColors.ink3} />
          </Pressable>
        </View>
        </Appear>

        {/* 4) 오늘 한눈에 — 공지·근무·멘션을 미니 통계 한 줄로(블록 I3). 각 칸이 해당 화면으로 진입.
             데이파트·할일 카운트는 위 '오늘 할 일' 블록으로 이관했다(같은 주제를 두 번 그리지 않는다). */}
        <Appear style={styles.section}>
          <SectionLabel icon="today-outline" title="오늘 한눈에" />
          <MiniStats
            items={[
              {
                key: 'notice',
                value: unreadCount > 99 ? '99+' : unreadCount,
                label: '안 읽은 공지',
                onPress: () => goToTab('/junior/work?view=notice'),
              },
              {
                key: 'shift',
                value: `${myShiftCount}회`,
                label: incomingSwaps > 0 ? '이번 주 근무 · 교대 요청' : '이번 주 근무',
                onPress: () => router.push('/junior/schedule'),
              },
              {
                key: 'mention',
                value: unreadMentionCount > 99 ? '99+' : unreadMentionCount,
                label: '나를 언급',
                onPress: () => goToTab('/junior/work'),
              },
            ]}
          />
          {/* 가장 최근 것 한 줄만 미리보기 — 카운트만 두면 "무슨 일인지"를 알 수 없다.
              공지와 멘션 **둘 다** 준다. 한쪽만 주면 "누가 나를 언급했는지"가 카운트 뒤로 사라진다. */}
          {unreadCount > 0 && latestNotice && (
            <Pressable
              onPress={() => goToTab('/junior/work?view=notice')}
              style={({ pressed }) => [styles.noticeStrip, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`안 읽은 공지 ${unreadCount}건. 확인하러 가기`}
            >
              <Ionicons name="megaphone" size={15} color={BrandColors.yellowDeep} />
              <Text style={styles.noticeStripText} numberOfLines={1}>
                {latestNotice.pinned ? '고정 · ' : ''}
                {latestNotice.text}
              </Text>
              <Text style={styles.noticeStripMore}>{unreadCount > 1 ? `+${unreadCount - 1} ` : ''}›</Text>
            </Pressable>
          )}
          {unreadMentionCount > 0 && latestMention && (
            <Pressable
              onPress={() => goToTab('/junior/work')}
              style={({ pressed }) => [styles.noticeStrip, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`나를 언급한 글 ${unreadMentionCount}건. 확인하러 가기`}
            >
              <Ionicons name="at" size={15} color={BrandColors.mention} />
              <Text style={styles.noticeStripText} numberOfLines={1}>
                {latestMention.authorName}님이 나를 언급했어요
              </Text>
              <Text style={styles.noticeStripMore}>{unreadMentionCount > 1 ? `+${unreadMentionCount - 1} ` : ''}›</Text>
            </Pressable>
          )}
        </Appear>

        {/* 5) 핵심 기능 안내 배너 — 최하단. 스와이프로 핵심 기능을 소개하고 탭하면 바로 그 화면으로 */}
        <Appear style={styles.section}>
          <SectionLabel icon="compass-outline" title="이런 것도 할 수 있어요" />
          <FeatureCarousel cards={JUNIOR_FEATURES} />
        </Appear>
      </ScrollView>

      <RoleTabBar role="junior" />
      {/* 합류 직후 1회 — 물어보기/노하우 등록 인지 코치마크 */}
      <JuniorWelcomeCoach />
    </SafeAreaView>
  );
}
