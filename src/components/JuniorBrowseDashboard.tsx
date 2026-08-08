import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, Animated, Easing, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SectionLabel } from './SectionLabel';
import { KnowhowCarousel } from './KnowhowCarousel';
import { BrowseList } from './BrowseList';
import { EmptyState } from './EmptyState';
import { EntryDetailModal } from './EntryDetailModal';
import { Appear } from './Appear';
import { matchesKnowhowQuery } from '@/lib/utils/knowhowSearch';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

export type JuniorBrowseDashboardProps = {
  /** 둘러보기에 노출할 발행 노하우 목록 */
  entries: PlaybookEntry[];
  /** 빈 상태 안내 문구 */
  emptyHint?: string;
};

const SECTION_LIMIT = 4;

type ViewKey = 'dashboard' | 'list';

/**
 * 둘러보기(주니어) — 사장 '둘러보기'처럼 직원도 노하우를 **검색**하고 **전체 목록**으로 볼 수 있다.
 *
 *  · 검색창(상단 고정): 제목·키워드로 찾기. 검색어를 입력하면 자동으로 목록(매칭 전체)으로 전환.
 *  · 대시보드: 3개 관점(렌즈)으로 추려 보여준다 — 🔥 인기 / 🆕 최근 / ✅ 잘 통하는.
 *  · 목록: 매칭되는 노하우 전체를 세로 카드로(공용 BrowseList 재사용).
 *
 * 카드는 공용 BrowseCard를 그대로 재사용(검증배지·DO/DON'T·해결률·출처 동일).
 * 프레임 v2 — 직원 화면이라 카테고리 라벨은 숨기고 색 점만 노출(showCategory=false).
 *
 * 카드를 탭하면 원본 노하우(단계·기준·사진·출처 전체)를 읽기 전용 시트(EntryDetailModal)로 연다.
 * 사장 화면과 달리 '수정/검증/추가' 같은 관리 액션은 없다 — 직원은 읽기 전용(둘러보기=읽기, 물어보기=질문).
 */
export function JuniorBrowseDashboard({ entries, emptyHint }: JuniorBrowseDashboardProps) {
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewKey>('dashboard');

  // 대시보드/목록 토글의 검정 pill을 세그먼트 사이로 부드럽게 슬라이드시킨다(색은 그대로).
  // 두 버튼의 폭이 다르므로(대시보드>목록) onLayout으로 각 버튼의 x·width를 재고, 그 사이를 보간한다.
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피(Appear와 동일 패턴).
  const toggleAnim = useMemo(() => new Animated.Value(0), []); // 초기 view='dashboard'(0) — 아래 effect가 동기화
  const [segLayouts, setSegLayouts] = useState<{ x: number; width: number }[]>([]);

  useEffect(() => {
    Animated.timing(toggleAnim, {
      toValue: view === 'dashboard' ? 0 : 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width는 네이티브 드라이버 불가 → JS 드라이버(작은 UI라 무해)
    }).start();
  }, [view, toggleAnim]);

  const onSegLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setSegLayouts((prev) => {
      if (prev[i] && prev[i].x === x && prev[i].width === width) return prev;
      const next = prev.slice();
      next[i] = { x, width };
      return next;
    });
  };

  const pillReady = segLayouts.length === 2 && !!segLayouts[0] && !!segLayouts[1];
  const pillStyle = pillReady
    ? {
        width: toggleAnim.interpolate({ inputRange: [0, 1], outputRange: [segLayouts[0].width, segLayouts[1].width] }),
        transform: [
          { translateX: toggleAnim.interpolate({ inputRange: [0, 1], outputRange: [segLayouts[0].x, segLayouts[1].x] }) },
        ],
      }
    : null;

  // 검색 중에는 항상 목록(매칭 전체)을 보여준다 — 검색의 목적이 "리스트로 훑어보기"이므로.
  const searching = query.trim().length > 0;
  /**
   * 렌즈를 나눌 만큼 노하우가 쌓였는가.
   *
   * 대시보드의 세 렌즈(인기·최근·해결률)는 **같은 목록을 정렬만 바꿔 자른다.** 노하우가 적으면
   * 세 섹션이 글자 그대로 같은 카드를 3번 보여준다(2026-08-06 실측: 3건 매장에서 3섹션 전부 동일).
   * 캐러셀 나열은 콘텐츠가 많을 때 성립하는 형태다 — 적을 때는 목록 하나가 낫다.
   * 기준 = 한 섹션이 자르는 최대치(SECTION_LIMIT)의 2배. 그 미만이면 렌즈가 서로 구분되지 않는다.
   */
  const enoughForLenses = entries.length >= SECTION_LIMIT * 2;
  const effectiveView: ViewKey = searching || !enoughForLenses ? 'list' : view;

  // 목록/검색용 필터 — 제목·키워드·태그 매칭(SSOT: matchesKnowhowQuery) 후 최근 갱신순.
  const listEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => matchesKnowhowQuery(e, q))
      .sort((a, b) => (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''));
  }, [entries, query]);

  // 대시보드 렌즈 — 전체 발행 노하우 기준(검색 중엔 목록으로 가려 렌더되지 않음).
  const popular = useMemo(
    () =>
      entries
        .filter((e) => (e.stats?.query_hits_30d ?? 0) > 0)
        .sort((a, b) => (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0))
        .slice(0, SECTION_LIMIT),
    [entries],
  );

  const recent = useMemo(
    () =>
      [...entries]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .slice(0, SECTION_LIMIT),
    [entries],
  );

  const resolved = useMemo(
    () =>
      entries
        .filter((e) => typeof e.stats?.resolution_rate === 'number')
        .sort((a, b) => (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0))
        .slice(0, SECTION_LIMIT),
    [entries],
  );

  // 등록된 노하우 자체가 없을 때 — 검색/토글 없이 안내만.
  if (!entries || entries.length === 0) {
    const hint = emptyHint ?? '아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요.';
    return <EmptyState title="아직 보여줄 노하우가 없어요" body={hint} />;
  }

  return (
    <>
      <View style={styles.flex}>
        {/* 상단 고정 컨트롤: 검색창 + (검색 중이 아닐 때) 뷰 토글 */}
        <View style={styles.controls}>
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={InkColors.ink3} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="제목·키워드로 검색"
              placeholderTextColor={InkColors.ink3}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
              </Pressable>
            ) : null}
          </View>

          {searching ? (
            <Text style={styles.resultCount}>{listEntries.length}개 찾음</Text>
          ) : !enoughForLenses ? (
            // 렌즈가 구분되지 않는 구간에서는 토글을 숨긴다 — 남겨두면 '대시보드'를 눌러도
            // effectiveView가 목록으로 고정돼 있어 아무 반응이 없는 죽은 버튼이 된다.
            null
          ) : (
            <View style={styles.viewToggle}>
              {/* padding 없는 inner를 좌표계 기준으로 — 슬라이딩 pill(절대배치)과 버튼 onLayout 좌표가 같은 원점을 쓴다. */}
              <View style={styles.viewToggleInner}>
                {pillReady && <Animated.View pointerEvents="none" style={[styles.viewTogglePill, pillStyle]} />}
                <Pressable
                  onLayout={onSegLayout(0)}
                  onPress={() => setView('dashboard')}
                  style={styles.viewToggleBtn}
                  accessibilityRole="button"
                  accessibilityState={{ selected: view === 'dashboard' }}
                >
                  <Ionicons name="grid-outline" size={13} color={view === 'dashboard' ? InkColors.bubbleText : InkColors.ink3} />
                  <Text style={[styles.viewToggleText, view === 'dashboard' && styles.viewToggleTextOn]}>대시보드</Text>
                </Pressable>
                <Pressable
                  onLayout={onSegLayout(1)}
                  onPress={() => setView('list')}
                  style={styles.viewToggleBtn}
                  accessibilityRole="button"
                  accessibilityState={{ selected: view === 'list' }}
                >
                  <Ionicons name="list-outline" size={14} color={view === 'list' ? InkColors.bubbleText : InkColors.ink3} />
                  <Text style={[styles.viewToggleText, view === 'list' && styles.viewToggleTextOn]}>목록</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* 본문 — 목록(BrowseList) ↔ 대시보드(렌즈 캐러셀) */}
        {effectiveView === 'list' ? (
          <BrowseList
            entries={listEntries}
            onSelect={setDetailEntry}
            showCategory={false}
            emptyHint={
              searching
                ? '검색어에 맞는 노하우가 없어요. 다른 단어로 검색해 보세요.'
                : '아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요.'
            }
          />
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {popular.length > 0 && (
              <Appear delay={0} style={styles.block}>
                <SectionLabel icon="flame-outline" title="인기 노하우" hint="많이 물어본 순" />
                <KnowhowCarousel entries={popular} onSelect={setDetailEntry} showCategory={false} />
              </Appear>
            )}

            {recent.length > 0 && (
              <Appear delay={60} style={styles.block}>
                <SectionLabel icon="time-outline" title="최근 추가됨" hint="새로 올라온 순" />
                <KnowhowCarousel entries={recent} onSelect={setDetailEntry} showCategory={false} />
              </Appear>
            )}

            {resolved.length > 0 && (
              <Appear delay={120} style={styles.block}>
                <SectionLabel icon="checkmark-circle-outline" title="잘 통하는 노하우" hint="해결률 순" />
                <KnowhowCarousel entries={resolved} onSelect={setDetailEntry} showCategory={false} />
              </Appear>
            )}
          </ScrollView>
        )}
      </View>

      {/* 카드 탭 → 원본 노하우 전체(읽기 전용) */}
      <EntryDetailModal
        entry={detailEntry}
        visible={!!detailEntry}
        onClose={() => setDetailEntry(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // 상단 고정 컨트롤(스크롤과 분리 — 목록 뷰가 자체 스크롤을 가지므로 검색창을 밖에 고정).
  controls: { paddingHorizontal: Space.gutter, paddingTop: Space.md, gap: Space.sm },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...Elevation.e1,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, padding: 0 },

  resultCount: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, paddingLeft: 4 },

  viewToggle: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, padding: 3, alignSelf: 'flex-start' },
  // pill 좌표 기준(패딩 없음) — 버튼 x·width가 이 컨테이너 원점에 상대적, 절대배치 pill과 동일 원점.
  viewToggleInner: { flexDirection: 'row', gap: Space.xs, position: 'relative' },
  // 슬라이딩 검정 pill — inner 높이(=버튼 높이)를 채우고, width·translateX만 애니메이션.
  viewTogglePill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: Radius.pill, backgroundColor: InkColors.ink },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.pill },
  viewToggleText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3 },
  viewToggleTextOn: { color: InkColors.bubbleText },

  scroll: { flex: 1 },
  // 가로 패딩은 Space.gutter(20)로 — KnowhowCarousel이 -Space.gutter로 가장자리까지 흘리므로
  // 같은 값이어야 상쇄돼 460 프레임을 벗어나지 않는다(Space.lg=16이면 4px 오버플로).
  content: { paddingHorizontal: Space.gutter, paddingTop: Space.lg, paddingBottom: Space.lg, gap: Space.xl },
  // 한 블록 = [밖 라벨] + [카드들].
  block: { gap: Space.md },
});
