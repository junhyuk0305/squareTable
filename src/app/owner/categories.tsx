import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { CategoryBigButton } from '@/components/CategoryBigButton';
import { RoleTabBar } from '@/components/RoleTabBar';
import { KnowhowSegment } from '@/components/KnowhowSegment';
import { BrowseList } from '@/components/BrowseList';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import contextPack from '@/data/context-pack.json';
import type { Category, PlaybookEntry } from '@/types';

/**
 * 노하우 탭(사장님) — KnowhowSegment 컨테이너.
 *  · 둘러보기: 발행된 매장 노하우를 BrowseList로 (주니어·시니어 공용 카드)
 *  · 물어보기: 사장님용 안내(알바 질문은 받은질문 탭에서 답변)
 *  · 내 노하우: 4카테고리 추가 그리드 + 받은질문 진입 (= 기존 categories 본문)
 *
 * 크롬(헤더·탭바) 소유권은 이 컨테이너. 슬롯은 자체 탭바를 갖지 않는다.
 */
export default function OwnerCategoriesScreen() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);

  const publishedEntries = useMemo(
    () => entries.filter((e) => e.status === 'published' || !e.status),
    [entries],
  );

  const goHome = () => void logout();

  // 사장님이 카드를 탭하면 해당 노하우 수정으로 (검토/보강 흐름).
  const handleBrowseSelect = (entry: PlaybookEntry) => {
    router.push({ pathname: '/owner/edit/[id]', params: { id: entry.id } });
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: '노하우',
          headerRight: () => (
            <Pressable
              onPress={goHome}
              style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="로그아웃"
            >
              <Text style={styles.switchText}>로그아웃</Text>
            </Pressable>
          ),
        }}
      />

      <KnowhowSegment
        role="owner"
        initial="mine"
        browse={
          <BrowseList
            entries={publishedEntries}
            onSelect={handleBrowseSelect}
            emptyHint="아직 발행된 노하우가 없어요. '내 노하우'에서 추가하면 여기에 쌓여요."
          />
        }
        ask={<OwnerAsk />}
        mine={<OwnerMine />}
      />
      <RoleTabBar role="owner" />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────
 * OwnerAsk — '물어보기' 슬롯(사장님). 알바 질문은 받은질문에서 답변.
 * ───────────────────────────────────────────────────────── */
function OwnerAsk() {
  const router = useRouter();
  const getPending = useUnknownQueueStore((s) => s.getPending);
  const pendingCount = getPending().length;

  return (
    <ScrollView contentContainerStyle={styles.askScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.askCard}>
        <Text style={styles.askEmoji}>💬</Text>
        <Text style={styles.askTitle}>알바가 물어보면 여기로 와요</Text>
        <Text style={styles.askBody}>
          알바가 매장 가이드에 없는 걸 물으면 받은 질문함에 쌓여요. 한 번 답하면 노하우가 되고,
          다음부터는 알바가 바로 답을 받아요.
        </Text>
        <Pressable
          onPress={() => router.push('/owner/inbox' as never)}
          accessibilityRole="button"
          accessibilityLabel={`받은 질문 보기, ${pendingCount}건 대기`}
          style={({ pressed }) => [styles.askBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.askBtnText}>
            받은 질문 보기{pendingCount > 0 ? ` · ${pendingCount}건 대기` : ''}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────────────────────────────────────
 * OwnerMine — '내 노하우' 슬롯. 기존 categories 본문(4카테고리 추가 + 받은질문 진입).
 * ───────────────────────────────────────────────────────── */
function OwnerMine() {
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
    router.push({ pathname: '/owner/coach', params: { category } });
  };

  const handleVoiceFirst = () => {
    router.push('/owner/coach' as never);
  };

  const handleOpenInbox = () => {
    router.push('/owner/inbox' as never);
  };

  return (
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
      <Text style={styles.subhint}>한 가지씩 골라서 알려주세요</Text>

      {/* 등록된 노하우 전체 보기 */}
      <Pressable
        onPress={() => router.push('/owner/knowledge' as never)}
        accessibilityRole="button"
        accessibilityLabel="내 노하우 전체 목록 보기"
        style={({ pressed }) => [styles.listLink, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.listLinkText}>등록된 노하우 {entries.length}개 전체 보기</Text>
        <Text style={styles.listLinkArrow}>→</Text>
      </Pressable>

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

      {/* 보조 진입 — 개업 준비·한가할 때 여러 개를 말로 몰아서 (콜드스타트 선입력) */}
      <Pressable
        onPress={handleVoiceFirst}
        accessibilityRole="button"
        accessibilityLabel="여러 노하우 한 번에 정리하기"
        style={({ pressed }) => [styles.voiceCard, pressed && styles.voiceCardPressed]}
      >
        <Text style={styles.voiceEmoji}>📝</Text>
        <View style={styles.voiceMiddle}>
          <Text style={styles.voiceTitle}>여러 개 한 번에</Text>
          <Text style={styles.voiceSub}>개업 준비·한가할 때 몰아서 — AI가 정리·분류</Text>
        </View>
        <Text style={styles.voiceArrow}>→</Text>
      </Pressable>

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
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: InkColors.cream,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
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
  // 전체 목록 진입 링크
  listLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  listLinkText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  listLinkArrow: { fontSize: 16, fontWeight: '700', color: InkColors.ink3 },
  voiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    borderRadius: 14,
    marginTop: 20,
  },
  voiceCardPressed: { opacity: 0.85 },
  voiceEmoji: { fontSize: 26, lineHeight: 32 },
  voiceMiddle: { flex: 1, gap: 2 },
  voiceTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  voiceSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '500' },
  voiceArrow: { fontSize: 20, color: InkColors.ink2, fontWeight: '700' },
  subhint: {
    fontSize: 14,
    color: InkColors.ink3,
    fontWeight: '500',
    marginBottom: 16,
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
  // OwnerAsk 슬롯
  askScroll: { padding: 20 },
  askCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 20,
    gap: 10,
    alignItems: 'flex-start',
  },
  askEmoji: { fontSize: 30 },
  askTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  askBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  askBtn: {
    marginTop: 6,
    backgroundColor: BrandColors.brand,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.sm,
  },
  askBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
