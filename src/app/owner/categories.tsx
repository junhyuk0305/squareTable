import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { CategoryBigButton } from '@/components/CategoryBigButton';
import { RoleTabBar } from '@/components/RoleTabBar';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { InkColors } from '@/lib/theme/colors';
import contextPack from '@/data/context-pack.json';
import type { Category } from '@/types';

/**
 * 사장님 빅뱅 입력 — 4 카테고리 큰 버튼 화면 (B안: Playful Bold).
 *
 * 흐름:
 *  - 위: 인사 / 큰 질문 / 보조 설명
 *  - 중간: 2x2 그리드 4 카테고리 큰 버튼 (각 누적 카운트 표시)
 *  - 아래: ─ 또는 ─ 구분 → 인박스 답변 진입점 카드
 *  - 헤더 우상단: '알바로 전환' (세션 스위치)
 *
 * 데모 단계라 카테고리 tap은 placeholder Alert (메인 시연 흐름은 인박스).
 */
export default function OwnerCategoriesScreen() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const getPending = useUnknownQueueStore((s) => s.getPending);
  const userName = useSessionStore((s) => s.userName);
  const storeName = (contextPack as { store_name: string }).store_name;

  // 카테고리별 누적 카운트 — entries에서 published/draft 가리지 않고 전부 집계
  const countsByCategory = useMemo(() => {
    const acc: Record<Category, number> = {
      Routine: 0,
      Event: 0,
      Context: 0,
      'Know-how': 0,
    };
    for (const e of entries) {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
    }
    return acc;
  }, [entries]);

  const pendingCount = getPending().length;

  const handleCategoryPress = (category: Category) => {
    router.push({ pathname: '/owner/add/[category]', params: { category } });
  };

  const goHome = () => void logout();

  const handleOpenInbox = () => {
    // 데모: 인박스로 돌아가기
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/owner/inbox' as never);
    }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: '노하우 추가',
          headerRight: () => (
            <Pressable
              onPress={goHome}
              style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="나가기"
            >
              <Text style={styles.switchText}>나가기</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* 상단 보조 라인 */}
        <Text style={styles.greet}>{userName} 사장님 · {storeName}</Text>

        {/* 큰 질문 */}
        <Text style={styles.question}>오늘 어떤 노하우를{'\n'}알려주실래요?</Text>

        {/* 보조 설명 */}
        <Text style={styles.subhint}>매장 운영 가이드 4 카테고리 중 골라주세요</Text>

        {/* 2x2 그리드 */}
        <View style={styles.grid}>
          <View style={styles.row}>
            <CategoryBigButton
              category="Routine"
              count={countsByCategory.Routine}
              onPress={() => handleCategoryPress('Routine')}
            />
            <CategoryBigButton
              category="Event"
              count={countsByCategory.Event}
              onPress={() => handleCategoryPress('Event')}
            />
          </View>
          <View style={styles.row}>
            <CategoryBigButton
              category="Context"
              count={countsByCategory.Context}
              onPress={() => handleCategoryPress('Context')}
            />
            <CategoryBigButton
              category="Know-how"
              count={countsByCategory['Know-how']}
              onPress={() => handleCategoryPress('Know-how')}
            />
          </View>
        </View>

        {/* 구분선: ─ 또는 ─ */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* 인박스 답변 진입점 카드 */}
        <Pressable
          onPress={handleOpenInbox}
          accessibilityRole="button"
          accessibilityLabel={`알바 질문 답변, ${pendingCount}건 답변 대기`}
          style={({ pressed }) => [styles.inboxCard, pressed && styles.inboxCardPressed]}
        >
          <Text style={styles.inboxEmoji}>📥</Text>
          <View style={styles.inboxMiddle}>
            <Text style={styles.inboxTitle}>알바 질문 답변</Text>
            <Text style={styles.inboxSub}>{pendingCount}건 답변 대기</Text>
          </View>
          <Text style={styles.inboxArrow}>→</Text>
        </Pressable>

        {/* sentinel — 스크롤 여백 */}
        <View style={{ height: 32 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: InkColors.cream,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  greet: {
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '600',
    marginBottom: 8,
  },
  question: {
    fontSize: 24,
    fontWeight: '800',
    color: InkColors.ink,
    lineHeight: 29, // 24 * 1.2
    marginBottom: 6,
  },
  subhint: {
    fontSize: 14,
    color: InkColors.ink3,
    fontWeight: '500',
    marginBottom: 20,
  },
  grid: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: InkColors.line,
  },
  dividerText: {
    fontSize: 12,
    color: InkColors.ink3,
    fontWeight: '600',
  },
  inboxCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: InkColors.bgSoft,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  inboxCardPressed: { opacity: 0.85 },
  inboxEmoji: {
    fontSize: 32,
    lineHeight: 38,
  },
  inboxMiddle: {
    flex: 1,
    gap: 2,
  },
  inboxTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: InkColors.ink,
  },
  inboxSub: {
    fontSize: 14,
    color: InkColors.ink3,
    fontWeight: '500',
  },
  inboxArrow: {
    fontSize: 22,
    color: InkColors.ink2,
    fontWeight: '700',
  },
  switchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  switchBtnPressed: { opacity: 0.6 },
  switchText: {
    fontSize: 13,
    color: InkColors.ink2,
    fontWeight: '700',
  },
});
