import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { EmptyState } from '@/components/EmptyState';
import { InfoDot } from '@/components/InfoDot';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';
import { BrowseCard } from '@/components/BrowseList';
import { KnowhowCarousel } from '@/components/KnowhowCarousel';
import { getCategoryMeta, ALL_CATEGORIES } from '@/lib/utils/category';
import { verifyMeta } from '@/lib/utils/verification';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Category, PlaybookEntry } from '@/types';

// ── 정렬 옵션(목록 뷰) ───────────────────────────────────────
type SortKey = 'recent' | 'resolution' | 'cited' | 'category';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '최신순' },
  { key: 'resolution', label: '해결률순' },
  { key: 'cited', label: '인용순' },
  { key: 'category', label: '카테고리별' },
];

const SECTION_LIMIT = 8;

// 미검증 = 온보딩 업종팩 fork분(needs_review) 또는 검증정보 없음/미검증.
// 검증 nudge의 대상은 needs_review(사장이 우리 매장 기준으로 아직 안 다듬음)로 좁힌다.
const needsVerify = (e: PlaybookEntry) => e.needs_review === true;

// 안 쓰임 = 게시됐는데 최근 30일 인용 0회. 내용이 어렵거나 알바가 못 찾는다는 신호 → 다듬거나 정리.
// (미검증과 다른 개념: 미검증=아직 확인 안 함 / 안 쓰임=확인은 됐는데 아무도 안 물어봄)
const isUnused = (e: PlaybookEntry) =>
  e.status === 'published' && (e.stats?.query_hits_30d ?? 0) === 0;

// 검색 매칭 — 제목·키워드·태그 부분일치(대소문자·# 무시).
function matchesQuery(e: PlaybookEntry, q: string): boolean {
  if (!q) return true;
  if (e.title?.toLowerCase().includes(q)) return true;
  if ((e.search_keywords ?? []).some((k) => k.toLowerCase().includes(q))) return true;
  if ((e.tags ?? []).some((t) => t.replace(/^#/, '').toLowerCase().includes(q))) return true;
  return false;
}

/** 한 노하우 행(목록 뷰) — 탭하면 수정. */
function EntryRow({ e, onPress }: { e: PlaybookEntry; onPress: () => void }) {
  const meta = getCategoryMeta(e.category);
  const v = e.verification ? verifyMeta(e.verification.state) : null;
  const ratePct = Math.round((e.stats?.resolution_rate ?? 0) * 100);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {e.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {meta.label} · v{e.version}
          </Text>
          {e.stats?.resolution_rate ? <Text style={styles.metaRate}>· 해결률 {ratePct}%</Text> : null}
          {e.stats?.query_hits_30d ? <Text style={styles.meta}>· 🔥 {e.stats.query_hits_30d}</Text> : null}
          {e.needs_review ? (
            <View style={styles.badgeReview}>
              <Text style={styles.badgeReviewText}>미검증</Text>
            </View>
          ) : isUnused(e) ? (
            <View style={styles.badgeUnused}>
              <Text style={styles.badgeUnusedText}>안 쓰임</Text>
            </View>
          ) : null}
          {v ? (
            <View style={[styles.badge, { backgroundColor: v.bg }]}>
              <Text style={[styles.badgeText, { color: v.fg }]}>{v.label}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
    </Pressable>
  );
}

/**
 * OwnerKnowhowBrowse — 사장 '둘러보기' 본문(크롬리스). KnowhowSegment 슬롯으로 들어가며
 * SafeAreaView/Stack.Screen/RoleTabBar 같은 크롬은 상위(categories)가 소유한다.
 *
 * 구성: 상단행(개수+추가) → 미검증 배너 → 검색/필터/뷰토글
 *      → 대시보드(가로 캐러셀: 검증필요·인기·최근·잘통하는) ↔ 목록(세로 정렬 리스트).
 */
export function OwnerKnowhowBrowse({
  onSelect,
  initialNeedsReview = false,
  initialUnused = false,
}: {
  onSelect: (id: string) => void;
  /** 진입 즉시 '미검증만' 목록으로 시작(대시보드 미검증 배너에서 들어올 때). */
  initialNeedsReview?: boolean;
  /** 진입 즉시 '안 쓰임만' 목록으로 시작(받은질문 화면의 안 쓰임 카드에서 들어올 때). */
  initialUnused?: boolean;
}) {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);
  const update = usePlaybookStore((s) => s.update);
  const userName = useSessionStore((s) => s.userName);

  const [query, setQuery] = useState('');
  const [activeCats, setActiveCats] = useState<Category[]>([]); // 빈 배열 = 전체
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<'dashboard' | 'list'>(initialNeedsReview || initialUnused ? 'list' : 'dashboard');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(initialNeedsReview); // 미검증 배너에서 진입
  const [onlyUnused, setOnlyUnused] = useState(initialUnused); // 안 쓰임 배너/카드에서 진입

  const goAdd = () => router.push('/owner/coach' as never);
  const toggleCat = (c: Category) =>
    setActiveCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  // 상태 필터(미검증·안 쓰임) — 단일 선택. 켜면 다른 하나는 끄고, 목록 뷰로 전환.
  const toggleStatus = (k: 'review' | 'unused') => {
    if (k === 'review') {
      setOnlyNeedsReview((v) => !v);
      setOnlyUnused(false);
    } else {
      setOnlyUnused((v) => !v);
      setOnlyNeedsReview(false);
    }
    setView('list');
  };

  // 1탭 검증 — 우리 매장 기준 확인 완료. needs_review 해제 + 사장님 검증 배지.
  const verify = (e: PlaybookEntry) =>
    update(e.id, {
      needs_review: false,
      verification: { state: 'owner_verified', verified_by: userName, verified_at: new Date().toISOString() },
    });

  // 검색 + 카테고리 필터(대시보드/목록 공통 베이스).
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter((e) => matchesQuery(e, q));
    if (activeCats.length > 0) list = list.filter((e) => activeCats.includes(e.category));
    return list;
  }, [entries, query, activeCats]);

  // 미검증(needs_review) — 전체 기준 카운트(배너·섹션 노출 판단). 0이 되면 배너/섹션 자동 소멸.
  const needsReview = useMemo(() => baseFiltered.filter(needsVerify), [baseFiltered]);
  // 안 쓰임(게시·30일 인용 0) — 배너/필터칩 노출 판단.
  const unused = useMemo(() => baseFiltered.filter(isUnused), [baseFiltered]);

  // 대시보드 렌즈
  const popular = useMemo(
    () =>
      baseFiltered
        .filter((e) => (e.stats?.query_hits_30d ?? 0) > 0)
        .sort((a, b) => (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0))
        .slice(0, SECTION_LIMIT),
    [baseFiltered],
  );
  const recent = useMemo(
    () => [...baseFiltered].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, SECTION_LIMIT),
    [baseFiltered],
  );
  const resolved = useMemo(
    () =>
      baseFiltered
        .filter((e) => typeof e.stats?.resolution_rate === 'number' && (e.stats?.resolution_rate ?? 0) > 0)
        .sort((a, b) => (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0))
        .slice(0, SECTION_LIMIT),
    [baseFiltered],
  );

  // 목록 뷰 필터(미검증만/안 쓰임만 보기 옵션 적용) → 정렬.
  const listFiltered = useMemo(() => {
    let list = baseFiltered;
    if (onlyNeedsReview) list = list.filter(needsVerify);
    if (onlyUnused) list = list.filter(isUnused);
    if (sort !== 'category') {
      list = [...list].sort((a, b) => {
        if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        if (sort === 'resolution') return (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0);
        if (sort === 'cited') return (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0);
        return 0;
      });
    }
    return list;
  }, [baseFiltered, onlyNeedsReview, onlyUnused, sort]);

  const groups = useMemo(() => {
    if (sort !== 'category') return null;
    return ALL_CATEGORIES.map((cat) => ({
      cat,
      items: listFiltered
        .filter((e) => e.category === cat)
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    })).filter((g) => g.items.length > 0);
  }, [listFiltered, sort]);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
      </View>
    );
  }

  const hasEntries = entries.length > 0;

  // 미검증 섹션/목록 카드에 붙는 1탭 검증 버튼.
  const verifyButton = (e: PlaybookEntry) => (
    <Pressable
      // 카드(부모 Pressable) 위에 겹친 버튼 — 탭이 카드 편집 진입으로 새지 않게 전파 차단(웹 버블링).
      onPress={(ev) => {
        ev.stopPropagation();
        verify(e);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${e.title} 검증 완료로 표시`}
      style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="checkmark-circle" size={15} color={InkColors.ink} />
      <Text style={styles.verifyBtnText}>검증 완료 (우리 매장 기준 맞아요)</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* 상단행 */}
      <View style={styles.headRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Text style={styles.subline}>
            총 {entries.length}개{hasEntries ? ' · 탭하면 수정' : ''}
          </Text>
          <InfoDot
            title="노하우가 뭐예요?"
            body={'여기 적어두면 직원이 물을 때 AI가 사장님 대신 답해줘요.\n많이 쌓일수록 같은 질문에 일일이 답할 일이 줄어요.'}
          />
        </View>
        <Pressable onPress={goAdd} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="add" size={16} color={InkColors.bubbleText} />
          <Text style={styles.addBtnText}>노하우 추가</Text>
        </Pressable>
      </View>

      {!hasEntries ? (
        <EmptyState
          emoji="📒"
          title="아직 등록된 노하우가 없어요"
          body="알바 질문에 답하거나, 직접 추가하면 여기에 쌓여요."
          cta={{ label: '첫 노하우 추가하기', onPress: goAdd }}
        />
      ) : (
        <>
          {/* 미검증 배너 — needs_review가 남아있는 동안만. 탭하면 미검증만 모아 보여준다. */}
          {needsReview.length > 0 && (
            <Pressable
              onPress={() => {
                setOnlyNeedsReview(true);
                setOnlyUnused(false);
                setView('list');
              }}
              style={({ pressed }) => [styles.banner, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel={`미검증 노하우 ${needsReview.length}개 검증하기`}
            >
              <Ionicons name="alert-circle" size={18} color={BrandColors.warn} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>미검증 노하우 {needsReview.length}개</Text>
                <Text style={styles.bannerBody}>업종 표준값이에요. 우리 매장 기준으로 검증해 주세요.</Text>
              </View>
              <Text style={styles.bannerCta}>검증하기 ›</Text>
            </Pressable>
          )}

          {/* 안 쓰임 배너 — 게시됐는데 30일 인용 0. 탭하면 안 쓰임만 모아 목록으로. */}
          {unused.length > 0 && !onlyUnused && (
            <Pressable
              onPress={() => {
                setOnlyUnused(true);
                setOnlyNeedsReview(false);
                setView('list');
              }}
              style={({ pressed }) => [styles.bannerUnused, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel={`안 쓰이는 노하우 ${unused.length}개 모아보기`}
            >
              <Ionicons name="trending-down" size={18} color={BrandColors.bad} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>안 쓰이는 노하우 {unused.length}개</Text>
                <Text style={styles.bannerBody}>30일간 아무도 안 물어봤어요. 다듬거나 정리해보세요.</Text>
              </View>
              <Text style={styles.bannerCtaBad}>모아보기 ›</Text>
            </Pressable>
          )}

          {/* 뷰 토글 */}
          <View style={styles.viewToggle}>
            <Pressable onPress={() => { setView('dashboard'); setOnlyNeedsReview(false); setOnlyUnused(false); }} style={[styles.viewToggleBtn, view === 'dashboard' && styles.viewToggleBtnOn]}>
              <Ionicons name="grid-outline" size={13} color={view === 'dashboard' ? InkColors.bubbleText : InkColors.ink3} />
              <Text style={[styles.viewToggleText, view === 'dashboard' && styles.viewToggleTextOn]}>대시보드</Text>
            </Pressable>
            <Pressable onPress={() => setView('list')} style={[styles.viewToggleBtn, view === 'list' && styles.viewToggleBtnOn]}>
              <Ionicons name="list-outline" size={14} color={view === 'list' ? InkColors.bubbleText : InkColors.ink3} />
              <Text style={[styles.viewToggleText, view === 'list' && styles.viewToggleTextOn]}>목록</Text>
            </Pressable>
          </View>

          {/* 검색창 */}
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
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
              </Pressable>
            ) : null}
          </View>

          {/* 카테고리 칩 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Pressable onPress={() => setActiveCats([])} style={[styles.chip, activeCats.length === 0 && styles.chipOn]}>
              <Text style={[styles.chipText, activeCats.length === 0 && styles.chipTextOn]}>전체</Text>
            </Pressable>
            {ALL_CATEGORIES.map((c) => {
              const on = activeCats.includes(c);
              const m = getCategoryMeta(c);
              return (
                <Pressable key={c} onPress={() => toggleCat(c)} style={[styles.chip, on && styles.chipOn]}>
                  <View style={[styles.chipDot, { backgroundColor: m.color }]} />
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 상태 필터(미검증·안 쓰임) — 카운트>0일 때만 노출되는 정식 토글. 탭하면 그 상태만 목록으로. */}
          {(needsReview.length > 0 || unused.length > 0) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {needsReview.length > 0 && (
                <Pressable
                  onPress={() => toggleStatus('review')}
                  style={[styles.statusChip, onlyNeedsReview && styles.statusReviewOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: onlyNeedsReview }}
                  accessibilityLabel={`미검증 ${needsReview.length}개만 보기`}
                >
                  <Ionicons name="alert-circle" size={13} color={onlyNeedsReview ? InkColors.ink : BrandColors.warn} />
                  <Text style={[styles.statusChipText, onlyNeedsReview && styles.statusChipTextInk]}>미검증 {needsReview.length}</Text>
                </Pressable>
              )}
              {unused.length > 0 && (
                <Pressable
                  onPress={() => toggleStatus('unused')}
                  style={[styles.statusChip, onlyUnused && styles.statusUnusedOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: onlyUnused }}
                  accessibilityLabel={`안 쓰임 ${unused.length}개만 보기`}
                >
                  <Ionicons name="trending-down" size={13} color={onlyUnused ? InkColors.bubbleText : BrandColors.bad} />
                  <Text style={[styles.statusChipText, onlyUnused && styles.statusChipTextOnBad]}>안 쓰임 {unused.length}</Text>
                </Pressable>
              )}
            </ScrollView>
          )}

          {/* 정렬 — 목록 뷰에서만 */}
          {view === 'list' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
              {SORTS.map((s) => {
                const on = sort === s.key;
                return (
                  <Pressable key={s.key} onPress={() => setSort(s.key)} style={[styles.sortChip, on && styles.sortChipOn]}>
                    <Text style={[styles.sortText, on && styles.sortTextOn]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* 결과 */}
          {view === 'dashboard' ? (
            baseFiltered.length === 0 ? (
              <EmptyResult onReset={() => { setQuery(''); setActiveCats([]); setOnlyUnused(false); }} />
            ) : (
              <View style={{ gap: Space.xl }}>
                {needsReview.length > 0 && (
                  <Appear delay={0} style={styles.block}>
                    <SectionLabel icon="alert-circle-outline" title="검증이 필요해요" hint={`${needsReview.length}개`} />
                    <KnowhowCarousel entries={needsReview} onSelect={(e) => onSelect(e.id)} showCategory renderExtra={verifyButton} />
                  </Appear>
                )}
                {popular.length > 0 && (
                  <Appear delay={60} style={styles.block}>
                    <SectionLabel icon="flame-outline" title="인기 노하우" hint="많이 물어본 순" />
                    <KnowhowCarousel entries={popular} onSelect={(e) => onSelect(e.id)} showCategory />
                  </Appear>
                )}
                {recent.length > 0 && (
                  <Appear delay={120} style={styles.block}>
                    <SectionLabel icon="sparkles-outline" title="최근 추가됨" hint="새로 올라온 순" />
                    <KnowhowCarousel entries={recent} onSelect={(e) => onSelect(e.id)} showCategory />
                  </Appear>
                )}
                {resolved.length > 0 && (
                  <Appear delay={180} style={styles.block}>
                    <SectionLabel icon="checkmark-circle-outline" title="잘 통하는 노하우" hint="해결률 순" />
                    <KnowhowCarousel entries={resolved} onSelect={(e) => onSelect(e.id)} showCategory />
                  </Appear>
                )}
              </View>
            )
          ) : listFiltered.length === 0 ? (
            <EmptyResult
              onReset={() => { setQuery(''); setActiveCats([]); setOnlyNeedsReview(false); setOnlyUnused(false); }}
              label={onlyNeedsReview ? '미검증 노하우가 없어요 🎉' : onlyUnused ? '안 쓰이는 노하우가 없어요 🎉' : undefined}
            />
          ) : groups ? (
            groups.map((g) => {
              const m = getCategoryMeta(g.cat);
              return (
                <View key={g.cat} style={{ gap: 8 }}>
                  <View style={styles.groupHead}>
                    <View style={[styles.dot, { backgroundColor: m.color }]} />
                    <Text style={styles.groupTitle}>{m.label}</Text>
                    <Text style={styles.groupCount}>{g.items.length}</Text>
                  </View>
                  <View style={styles.list}>
                    {g.items.map((e) => (
                      <EntryRow key={e.id} e={e} onPress={() => onSelect(e.id)} />
                    ))}
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.list}>
              {listFiltered.map((e) => (
                <EntryRow key={e.id} e={e} onPress={() => onSelect(e.id)} />
              ))}
            </View>
          )}
        </>
      )}
      <View style={{ height: 16 }} />
    </ScrollView>
  );
}

function EmptyResult({ onReset, label }: { onReset: () => void; label?: string }) {
  return (
    <View style={styles.emptyResult}>
      <Text style={styles.emptyResultEmoji}>{label ? '✅' : '🔍'}</Text>
      <Text style={styles.emptyResultText}>{label ?? '조건에 맞는 노하우가 없어요'}</Text>
      <Pressable onPress={onReset}>
        <Text style={styles.resetLink}>필터 초기화</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48 },
  loadingText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  subline: { flexShrink: 1, fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: InkColors.ink, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.pill },
  addBtnText: { color: InkColors.bubbleText, fontSize: 13, fontWeight: '800' },

  // 미검증 배너
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.gold,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
  },
  bannerTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  bannerBody: { fontSize: 12, color: InkColors.ink2, marginTop: 1 },
  bannerCta: { fontSize: 13, fontWeight: '800', color: BrandColors.warn },
  bannerCtaBad: { fontSize: 13, fontWeight: '800', color: BrandColors.bad },

  // 안 쓰임 배너 — 상태 레드 틴트(미검증 배너와 구분)
  bannerUnused: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.accentSoft,
    borderWidth: 1,
    borderColor: BrandColors.bad,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
  },

  // 뷰 토글
  viewToggle: { flexDirection: 'row', gap: Space.xs, backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, padding: 3, alignSelf: 'flex-start' },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.pill },
  viewToggleBtnOn: { backgroundColor: InkColors.ink },
  viewToggleText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3 },
  viewToggleTextOn: { color: InkColors.bubbleText },

  // 캐러셀 블록 = [밖 라벨] + [가로 카드]
  block: { gap: Space.md },

  // 검색
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...Elevation.e1,
  },
  searchInput: { flex: 1, fontSize: 14, color: InkColors.ink, padding: 0 },

  // 카테고리 칩
  chipRow: { flexDirection: 'row', gap: 7, paddingVertical: 1, paddingRight: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipDot: { width: 7, height: 7, borderRadius: Radius.pill },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.bubbleText },

  // 상태 필터 칩(미검증·안 쓰임) — 카테고리 칩과 같은 형태의 정식 토글.
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill,
  },
  statusReviewOn: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.gold },
  statusUnusedOn: { backgroundColor: BrandColors.bad, borderColor: BrandColors.bad },
  statusChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  statusChipTextInk: { color: InkColors.ink },
  statusChipTextOnBad: { color: InkColors.bubbleText },

  // 정렬
  sortRow: { flexDirection: 'row', gap: 6, paddingRight: 4 },
  sortChip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },
  sortChipOn: { backgroundColor: BrandColors.yellowSoft },
  sortText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  sortTextOn: { color: InkColors.ink },

  // 1탭 검증 버튼(카드 하단)
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    marginTop: 4, paddingVertical: 9, borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft, borderWidth: 1, borderColor: BrandColors.gold,
  },
  verifyBtnText: { fontSize: 12, fontWeight: '800', color: InkColors.ink },

  // 그룹(목록·카테고리별)
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingHorizontal: 2 },
  groupTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  groupCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  // 리스트/행
  list: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  dot: { width: 10, height: 10, borderRadius: Radius.pill },
  rowTitle: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  metaRate: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  badge: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill },
  badgeText: { fontSize: 10, fontWeight: '800' },
  badgeReview: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.yellowSoft },
  badgeReviewText: { fontSize: 10, fontWeight: '800', color: BrandColors.warn },
  badgeUnused: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.accentSoft },
  badgeUnusedText: { fontSize: 10, fontWeight: '800', color: BrandColors.bad },

  // 빈 결과
  emptyResult: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyResultEmoji: { fontSize: 34 },
  emptyResultText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  resetLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, marginTop: 4, textDecorationLine: 'underline' },
});
