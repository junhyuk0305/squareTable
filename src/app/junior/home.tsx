import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar, goToTab } from '@/components/RoleTabBar';
import { AppTopBar } from '@/components/AppTopBar';
import { Appear } from '@/components/Appear';
import { JuniorWelcomeCoach } from '@/components/junior/JuniorWelcomeCoach';
import { SectionLabel } from '@/components/SectionLabel';
import { HeroSubNav } from '@/components/blocks/HeroSubNav';
import { AlertRow } from '@/components/blocks/AlertRow';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { showToast } from '@/lib/store/useToastStore';
import { hhmm } from '@/lib/utils/attendance';
import { useJuniorHomeData } from '@/lib/hooks/useJuniorHomeData';
import { styles } from '@/styles/juniorHomeStyles';

/** 홈 목록은 3건 + "전체보기 ›" — 전 화면 공통 배치 규칙(2026-08-05 블록 어휘). */
// 홈 목록 상한 — 사장 홈(owner/dashboard.tsx)과 같은 값을 유지한다(2026-08-12: 3 → 4).
const HOME_LIST_LIMIT = 4;

/**
 * 직원 홈 — 사령탑(하루의 앵커).
 *
 * ★2026-08-07 정본 §12: 섹션 5개 → **3개**.
 *   1) HeroSubNav(서브내비 없음) — "오늘 할 일 / n개 / 지금은 ○○ · 출퇴근 상태" + **출근 버튼이 CTA**
 *   2) 오늘 업무 — 목록 3건 + 전체보기 ›
 *   3) 안 푼 퀴즈 경고행(AlertRow) — 0건이면 스스로 안 그린다
 *
 * 뺀 것과 이유:
 *   · '노하우 물어보기' · '출퇴근' 섹션 → **하단 탭에 이미 있다.** 같은 진입점을 두 번 그리면
 *     화면만 길어지고 무엇이 중요한지가 흐려진다.
 *   · '오늘 한눈에'(MiniStats) → 카운트 3칸은 탭/벨과 겹치는 요약이었다.
 *   · '이런 것도 할 수 있어요'(FeatureCarousel) → 처음 며칠만 필요한 안내(합류 코치마크가 덮는다).
 *
 * 출근 버튼만은 하루 한 번 반드시 눌러야 하므로 맨 위 큰 색면(히어로 CTA)으로 올렸다.
 * 이 화면의 유일한 '채운' 버튼이라 Primary도 여기 하나다.
 * 직원은 화면이 14개뿐이라 **바로가기(서브내비)도 ☰도 만들지 않는다** — 사장 규칙 복사가 곧 과설계다.
 */
export default function JuniorHomeScreen() {
  const {
    loaded,
    userName,
    checkIn,
    checkOut,
    userId,
    todayRecs,
    openRec,
    working,
    taskTotal,
    taskRemain,
    todayTasks,
    openQuizCount,
  } = useJuniorHomeData();

  // 히어로 큰 수 — 0을 전시하지 않는다(할 일이 없거나 다 끝난 상태는 숫자가 아니라 말로).
  // ★도착 전엔 '없어요'(=0건 단정) 대신 중립 표기. 블록은 그대로 두고 값만 채운다.
  const heroValue = !loaded ? '—' : taskTotal === 0 ? '없어요' : taskRemain === 0 ? '다 했어요' : `${taskRemain}개`;
  // 히어로 한 줄 = [지금 할 일] · [출퇴근 상태]. 남은 일이 없으면 출퇴근 상태만.
  const nextTask = todayTasks.find((t) => !t.done);
  // ★'아직 출근 전이에요'는 도착 전엔 거짓말이다 — 근무 중인 직원에게도 그렇게 보인다.
  const clockLine = !loaded
    ? '출퇴근 기록을 가져오는 중이에요'
    : working
      ? `${hhmm(openRec!.check_in!)} 출근 · 근무 중`
      : todayRecs.length > 0
        ? `오늘 ${todayRecs.length}회 근무`
        : '아직 출근 전이에요';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* 네이티브 헤더 → 커스텀 상단바(사장 홈과 같은 AppTopBar). 2026-08-08 상단바 통일.
          네이티브 헤더는 화면 트리 밖이라 ① 두 홈의 구현이 갈라지고 ② 매장 목록을 pill 바로 아래로
          펼칠 자리가 없었다. 홈은 탭 루트라 뒤로가기가 필요 없으므로 헤더 크롬 자체를 끈다. */}
      <Stack.Screen options={{ headerShown: false }} />
      <AppTopBar />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>{userName}님, 오늘도 화이팅이에요</Text>

        {/* 1) 오늘 할 일 히어로 — items를 비워 서브내비 없이 히어로만 전체 라운드로 그린다.
            ★출퇴근 판정(근무 중 → 퇴근 / 오늘 기록 있음 → 다시 출근 / 없음 → 출근)은
            기존 출퇴근 카드에서 **그대로 옮겨온 것**이다. checkIn·checkOut 은 useAttendanceStore의
            같은 액션이라 중복 출근 방지도 스토어 쪽 로직을 그대로 탄다. */}
        <Appear>
          <HeroSubNav
            label="오늘 할 일"
            value={heroValue}
            caption={nextTask ? `지금은 ${nextTask.text} · ${clockLine}` : clockLine}
            ctaLabel={
              !loaded ? '출퇴근 기록 확인 중' : working ? '퇴근하기' : todayRecs.length > 0 ? '다시 출근하기' : '출근하기'
            }
            onCta={() => {
              // ★★중복 출근 방지: 도착 전엔 records 가 [] 라 checkIn 의 '열린 기록' 검사가 그냥 통과한다
              //   → 이미 근무 중인 직원이 이 버튼을 누르면 두 번째 출근이 찍히고 어제 기록이 24h로 부푼다.
              //   버튼을 지우면 히어로 높이가 튀므로, 자리는 두고 **동작만** 막는다(무음 무시 금지 — 왜 안 되는지 말해준다).
              if (!loaded) {
                showToast('출퇴근 기록을 가져오는 중이에요. 잠시 후 다시 눌러 주세요');
                return;
              }
              if (working) checkOut(userId);
              else checkIn(userId);
            }}
          />
        </Appear>

        {/* 2) 오늘 업무 — 목록 3건 + 전체보기 ›. 상세·완료 처리는 업무 탭이 소유한다. */}
        <Appear style={styles.section}>
          <SectionLabel
            icon="checkbox-outline"
            title="오늘 업무"
            trailing={
              loaded && taskTotal > 0 ? (
                <Pressable
                  onPress={() => goToTab('/junior/work?view=todo')}
                  accessibilityRole="button"
                  accessibilityLabel="오늘 업무 전체보기"
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  {/* 잘린 개수를 말한다 — "4개가 전부"와 "4개만 보여주는 중"은 화면만 봐선 구분이 안 된다. */}
                  <Text style={styles.moreLink}>
                    {taskTotal > HOME_LIST_LIMIT ? `전체보기 (${taskTotal - HOME_LIST_LIMIT}개 더) ›` : '전체보기 ›'}
                  </Text>
                </Pressable>
              ) : undefined
            }
          />
          <View style={styles.todoCard}>
            {!loaded ? (
              // 도착 전 '오늘 할 일이 없어요'는 0건 단정 — 업무가 있는 직원에게도 스쳤다.
              <Text style={styles.todoEmpty}>오늘 업무를 가져오는 중이에요</Text>
            ) : taskTotal === 0 ? (
              <Text style={styles.todoEmpty}>오늘 할 일이 없어요</Text>
            ) : (
              todayTasks.slice(0, HOME_LIST_LIMIT).map((t, i) => (
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
              ))
            )}
          </View>
        </Appear>

        {/* 3) 안 푼 퀴즈 — 0건이면 AlertRow가 스스로 null을 돌려준다(상시 노출 금지).
            Appear로 감싸지 않는다 — 0건일 때 빈 래퍼가 남아 목록 간격만 벌어진다. */}
        <AlertRow label="안 푼 퀴즈" count={loaded ? openQuizCount : 0} onPress={() => goToTab('/junior/work')} />
      </ScrollView>

      <RoleTabBar role="junior" />
      {/* 합류 직후 1회 — 물어보기/노하우 등록 인지 코치마크 */}
      <JuniorWelcomeCoach />
    </SafeAreaView>
  );
}
