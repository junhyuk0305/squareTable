import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar, goToTab } from '@/components/RoleTabBar';
import { AppTopBar } from '@/components/AppTopBar';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { JuniorWelcomeCoach } from '@/components/junior/JuniorWelcomeCoach';
import { SectionLabel } from '@/components/SectionLabel';
import { HeroSubNav } from '@/components/blocks/HeroSubNav';
import { AlertRow } from '@/components/blocks/AlertRow';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { hhmm } from '@/lib/utils/attendance';
import { useJuniorHomeData } from '@/lib/hooks/useJuniorHomeData';
import { useGuideOnce } from '@/lib/store/useGuideStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { confirmAction } from '@/lib/utils/confirm';
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
    today,
    openQuizCount,
  } = useJuniorHomeData();

  // 첫 진입 사용 안내 — 본문이 다 선 뒤에만(loaded 전엔 빈 화면 위에 뜬다).
  useGuideOnce('junior_home_v1', loaded);

  // 오늘 업무: 홈에서 직접 완료(2026-09-03) — 사장 홈과 같은 toggleTask 하나(판정을 두 벌로 만들지 않는다).
  const toggleTask = useWorkStore((s) => s.toggleTask);
  const onToggleTask = (t: (typeof todayTasks)[number]) => {
    const task = { text: t.text, roomId: t.roomId };
    // 완료 해제 시 첨부한 완료 사진이 함께 삭제된다 — 할일 화면과 같은 확인을 먼저 띄운다.
    if (t.done && t.photoUrl) {
      void confirmAction(
        '완료를 취소할까요?',
        '체크를 풀면 이 업무에 첨부한 완료 사진도 함께 삭제돼요.',
        '취소하고 사진 삭제',
        { destructive: true, icon: 'image-outline' },
      ).then((ok) => {
        if (ok) toggleTask(today, t.id, userId, userName, 'junior', undefined, task);
      });
      return;
    }
    toggleTask(today, t.id, userId, userName, 'junior', undefined, task);
  };

  // 히어로 큰 수 — 0을 전시하지 않는다(할 일이 없거나 다 끝난 상태는 숫자가 아니라 말로).
  const heroValue = taskTotal === 0 ? '없어요' : taskRemain === 0 ? '다 했어요' : `${taskRemain}개`;
  // 히어로 한 줄 = [지금 할 일] · [출퇴근 상태]. 남은 일이 없으면 출퇴근 상태만.
  const nextTask = todayTasks.find((t) => !t.done);
  // ★'아직 출근 전이에요'는 도착 전엔 거짓말이다 — 근무 중인 직원에게도 그렇게 보인다.
  //   값마다 "가져오는 중" 문구를 박는 대신 아래 loaded 게이트가 본문을 통째로 늦춘다.
  const clockLine = working
    ? `${hhmm(openRec!.check_in!)} 출근 · 근무 중`
    : todayRecs.length > 0
      ? `오늘 ${todayRecs.length}회 근무`
      : '아직 출근 전이에요';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 네이티브 헤더 → 커스텀 상단바(사장 홈과 같은 AppTopBar). 2026-08-08 상단바 통일.
          네이티브 헤더는 화면 트리 밖이라 ① 두 홈의 구현이 갈라지고 ② 매장 목록을 pill 바로 아래로
          펼칠 자리가 없었다. 홈은 탭 루트라 뒤로가기가 필요 없으므로 헤더 크롬 자체를 끈다. */}
      <Stack.Screen options={{ headerShown: false }} />
      <AppTopBar />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>{userName}님, 오늘도 화이팅이에요</Text>

        {!loaded ? (
          // ★업무·출퇴근·근무표가 **전부** 도착하기 전에는 본문을 마운트하지 않는다.
          //   값마다 '—'·"가져오는 중이에요"를 박으면 반쯤 채워진 화면이 먼저 서고,
          //   중복 출근 방지도 버튼 안에서 따로 막아야 했다(도착 전엔 records가 [] 라 검사가 그냥 통과한다).
          <ScreenLoading label="오늘 할일을 불러오고 있어요…" />
        ) : (
          <>
        {/* 1) 오늘 할 일 히어로 — items를 비워 서브내비 없이 히어로만 전체 라운드로 그린다.
            ★출퇴근 판정(근무 중 → 퇴근 / 오늘 기록 있음 → 다시 출근 / 없음 → 출근)은
            기존 출퇴근 카드에서 **그대로 옮겨온 것**이다. checkIn·checkOut 은 useAttendanceStore의
            같은 액션이라 중복 출근 방지도 스토어 쪽 로직을 그대로 탄다. */}
        <Appear delay={stagger(0)}>
          <HeroSubNav
            label="남은 할일"
            value={heroValue}
            caption={nextTask ? `지금은 ${nextTask.text} · ${clockLine}` : clockLine}
            ctaLabel={working ? '퇴근하기' : todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}
            onCta={() => {
              if (working) checkOut(userId);
              else checkIn(userId);
            }}
          />
        </Appear>

        {/* 2) 오늘 업무 — 목록 3건 + 전체보기 ›. 체크는 컨트롤이다 — 누르면 진짜 완료된다(업무 탭과 같은 toggleTask). */}
        <Appear delay={stagger(1)} style={styles.section}>
          <SectionLabel
            icon="checkbox-outline"
            title="오늘 업무"
            trailing={
              taskTotal > 0 ? (
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
            {taskTotal === 0 ? (
              <Text style={styles.todoEmpty}>오늘 할일이 없어요</Text>
            ) : (
              todayTasks.slice(0, HOME_LIST_LIMIT).map((t, i) => (
                <Pressable
                  key={t.id}
                  onPress={() => onToggleTask(t)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: t.done }}
                  accessibilityLabel={`${t.text}${t.done ? ' 완료 해제' : ' 완료'}`}
                  style={({ pressed }) => [styles.todoRow, i > 0 && styles.todoRowDivider, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons
                    name={t.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={t.done ? BrandColors.good : InkColors.ink3}
                  />
                  <Text style={[styles.todoText, t.done && styles.todoTextDone]} numberOfLines={1}>
                    {t.text}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </Appear>

        {/* 3) 안 푼 퀴즈 — 0건이면 AlertRow가 스스로 null을 돌려준다(상시 노출 금지).
            Appear로 감싸지 않는다 — 0건일 때 빈 래퍼가 남아 목록 간격만 벌어진다. */}
        <AlertRow label="안 푼 퀴즈" count={openQuizCount} onPress={() => goToTab('/junior/work')} />
          </>
        )}
      </ScrollView>

      <RoleTabBar role="junior" />
      {/* 합류 직후 1회 — 물어보기/노하우 등록 인지 코치마크 */}
      <JuniorWelcomeCoach />
    </SafeAreaView>
  );
}
