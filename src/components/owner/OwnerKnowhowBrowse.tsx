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
import { KnowhowCarousel } from '@/components/KnowhowCarousel';
import { getCategoryMeta, ALL_CATEGORIES } from '@/lib/utils/category';
import { matchesKnowhowQuery } from '@/lib/utils/knowhowSearch';
import { verifyMeta } from '@/lib/utils/verification';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Category, PlaybookEntry } from '@/types';

// ── 정렬 옵션(목록 뷰) ───────────────────────────────────────
const UNSECTIONED = '기타'; // 섹션 미분류 노하우의 매뉴얼 뷰 표시 이름
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
              <Text style={styles.badgeReviewText}>확인 필요</Text>
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
}: {
  onSelect: (id: string) => void;
  /** 진입 즉시 '미검증만' 목록으로 시작(대시보드 미검증 배너에서 들어올 때). */
  initialNeedsReview?: boolean;
}) {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);
  const loadError = usePlaybookStore((s) => s.loadError);
  const hydrate = usePlaybookStore((s) => s.hydrate);
  const update = usePlaybookStore((s) => s.update);
  const userName = useSessionStore((s) => s.userName);

  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<Category | null>(null); // null = 전체(단일 선택)
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<'dashboard' | 'list' | 'manual'>(initialNeedsReview ? 'list' : 'dashboard');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(initialNeedsReview); // 미검증 배너에서 진입

  // 검토 대기(draft·인수인계서 파이프라인 증분저장분)는 둘러보기에서 제외 — 검수는 handover 화면이 담당.
  // (직원은 RLS 0064로 애초에 draft를 못 받지만, 사장 화면도 발행본과 섞이면 자산 목록이 오염된다.)
  const visible = useMemo(() => entries.filter((e) => e.status !== 'draft'), [entries]);
  const draftCount = entries.length - visible.length;

  const goAdd = () => router.push('/owner/coach' as never);
  const goTemplates = () => router.push('/owner/templates' as never);
  const goHandover = () => router.push('/owner/handover' as never);
  // 카테고리 필터는 단일 선택(라디오) — '전체' + 한 카테고리만. 같은 칩 재탭 시 전체로 해제.
  const selectCat = (c: Category) => setActiveCat((prev) => (prev === c ? null : c));

  // 미검증 상태 필터 — 켜면 미검증만 목록으로 전환.
  const toggleReview = () => {
    setOnlyNeedsReview((v) => !v);
    setView('list');
  };

  // 1탭 검증 — 우리 매장 기준 확인 완료. needs_review 해제 + 사장님 검증 배지.
  const verify = (e: PlaybookEntry) =>
    update(e.id, {
      needs_review: false,
      verification: { state: 'owner_verified', verified_by: userName, verified_at: new Date().toISOString() },
    });

  // 검색 + 카테고리 필터(대시보드/목록/매뉴얼 공통 베이스).
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = visible.filter((e) => matchesKnowhowQuery(e, q));
    if (activeCat) list = list.filter((e) => e.category === activeCat);
    return list;
  }, [visible, query, activeCat]);

  // 미검증(needs_review) — 전체 기준 카운트(배너·섹션 노출 판단). 0이 되면 배너/섹션 자동 소멸.
  const needsReview = useMemo(() => baseFiltered.filter(needsVerify), [baseFiltered]);

  // 대시보드 렌즈 — 회의 반영: '인기 노하우'·'잘 통하는 노하우'처럼 사용 통계(query_hits/resolution)에
  // 기대는 섹션은 제거했다. 초기 세팅 유저에겐 시드/템플릿의 조작된 수치가 마치 실적처럼 보여
  // (본인이 안 쓴 노하우가 인기·해결률로 노출) 신뢰를 깬다. 정직한 '최근 추가됨'만 남긴다.
  const recent = useMemo(
    () => [...baseFiltered].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, SECTION_LIMIT),
    [baseFiltered],
  );

  // 목록 뷰 필터(미검증만 보기 옵션 적용) → 정렬.
  const listFiltered = useMemo(() => {
    let list = baseFiltered;
    if (onlyNeedsReview) list = list.filter(needsVerify);
    if (sort !== 'category') {
      list = [...list].sort((a, b) => {
        if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        if (sort === 'resolution') return (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0);
        if (sort === 'cited') return (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0);
        return 0;
      });
    }
    return list;
  }, [baseFiltered, onlyNeedsReview, sort]);

  const groups = useMemo(() => {
    if (sort !== 'category') return null;
    return ALL_CATEGORIES.map((cat) => ({
      cat,
      items: listFiltered
        .filter((e) => e.category === cat)
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    })).filter((g) => g.items.length > 0);
  }, [listFiltered, sort]);

  // ── 매뉴얼 뷰(파생 뷰) — 발행본을 [섹션 → order_index] 순으로 렌더. 별도 저장물 없음(설계 §4·5c).
  // 섹션 순서 = 문서 등장 순서(섹션 내 최소 order_index), 미분류(기타)는 맨 뒤.
  const manualGroups = useMemo(() => {
    if (view !== 'manual') return [];
    const pub = [...baseFiltered.filter((e) => e.status === 'published')].sort(
      (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
    const order: string[] = [];
    const byName = new Map<string, PlaybookEntry[]>();
    for (const e of pub) {
      const name = e.section?.trim() || UNSECTIONED;
      if (!byName.has(name)) { byName.set(name, []); order.push(name); }
      byName.get(name)!.push(e);
    }
    const names = order.filter((n) => n !== UNSECTIONED);
    if (byName.has(UNSECTIONED)) names.push(UNSECTIONED);
    return names.map((name) => ({ name, items: byName.get(name)! }));
  }, [view, baseFiltered]);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
      </View>
    );
  }

  const hasEntries = visible.length > 0;

  // 미검증 섹션/목록 카드에 붙는 1탭 검증 버튼.
  const verifyButton = (e: PlaybookEntry) => (
    <Pressable
      // 카드(부모 Pressable) 위에 겹친 버튼 — 탭이 카드 편집 진입으로 새지 않게 전파 차단(웹 버블링).
      onPress={(ev) => {
        ev.stopPropagation();
        verify(e);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${e.title} 확인 완료로 표시`}
      style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="checkmark-circle" size={15} color={InkColors.ink} />
      <Text style={styles.verifyBtnText}>확인 완료 (우리 매장 기준 맞아요)</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* 상단행 */}
      <View style={styles.headRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Text style={styles.subline}>
            총 {visible.length}개{hasEntries ? ' · 탭하면 수정' : ''}
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

      {/* 검토 대기(draft) — 인수인계서 파이프라인이 증분 저장한 항목. 발행 전이라 직원·AI에 안 보임. */}
      {draftCount > 0 && (
        <Pressable
          onPress={goHandover}
          style={({ pressed }) => [styles.draftBanner, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel={`검토 대기 노하우 ${draftCount}개 검수하기`}
        >
          <Ionicons name="file-tray-full" size={18} color={InkColors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>검토 대기 노하우 {draftCount}개</Text>
            <Text style={styles.bannerBody}>인수인계서에서 정리한 항목이에요. 확인 후 등록해 주세요.</Text>
          </View>
          <Text style={styles.draftBannerCta}>검수하기 ›</Text>
        </Pressable>
      )}

      {/* 인수인계서 올리기 — 노하우 주 입구. 사장이 이미 가진 매뉴얼·메모를 통째로 올리면 AI가 항목별로 분리. */}
      <Pressable
        onPress={goHandover}
        style={({ pressed }) => [styles.templateLink, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="인수인계서 올리기"
      >
        <Ionicons name="cloud-upload-outline" size={16} color={InkColors.ink2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.templateLinkTitle}>인수인계서 올리기</Text>
          <Text style={styles.templateLinkSub}>오픈·마감·규칙 메모를 올리면 AI가 노하우로 정리해요</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
      </Pressable>

      {/* 템플릿 둘러보기 — 홈에서 이관(회의 반영). 업종 표준 노하우를 검색해 내 노하우로 가져온다. */}
      <Pressable
        onPress={goTemplates}
        style={({ pressed }) => [styles.templateLink, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="노하우 템플릿 둘러보기"
      >
        <Ionicons name="albums-outline" size={16} color={InkColors.ink2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.templateLinkTitle}>노하우 템플릿 둘러보기</Text>
          <Text style={styles.templateLinkSub}>업종에서 자주 쓰는 노하우를 내 노하우로 바로 가져와요</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
      </Pressable>

      {!hasEntries ? (
        loadError ? (
          // 로드 실패를 "노하우 없음"으로 위장하지 않고 재시도를 띄운다(무음 실패 방지).
          <EmptyState
            emoji="📡"
            title="노하우를 불러오지 못했어요"
            body="연결을 확인하고 다시 시도해 주세요."
            cta={{ label: '다시 시도', onPress: () => hydrate() }}
          />
        ) : (
          <EmptyState
            emoji="📒"
            title="아직 등록된 노하우가 없어요"
            body="알바 질문에 답하거나, 직접 추가하면 여기에 쌓여요."
            cta={{ label: '첫 노하우 추가하기', onPress: goAdd }}
          />
        )
      ) : (
        <>
          {/* 미검증 배너 — needs_review가 남아있는 동안만. 탭하면 확인할 노하우로 바로 데려간다. */}
          {needsReview.length > 0 && (
            <Pressable
              onPress={() => {
                // '확인하기'는 확인할 노하우를 곧장 연다(수정 저장 = 우리 매장 기준 확인 완료).
                // 필터만 바꾸면 진입 상태(홈 '확인 필요'로 들어오면 이미 목록+미검증)가 그대로라
                // 아무 반응이 없어 '안 눌린다'처럼 보인다. 목록 필터는 아래 '확인 필요 N' 칩이 담당.
                const first = needsReview[0];
                if (first) onSelect(first.id);
              }}
              style={({ pressed }) => [styles.banner, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel={`확인 필요한 노하우 ${needsReview.length}개 확인하기`}
            >
              <Ionicons name="alert-circle" size={18} color={BrandColors.warn} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>확인 필요한 노하우 {needsReview.length}개</Text>
                <Text style={styles.bannerBody}>업종 표준값이에요. 우리 매장 기준이 맞는지 확인해 주세요.</Text>
              </View>
              <Text style={styles.bannerCta}>확인하기 ›</Text>
            </Pressable>
          )}

          {/* 뷰 토글 */}
          <View style={styles.viewToggle}>
            <Pressable onPress={() => { setView('dashboard'); setOnlyNeedsReview(false); }} style={[styles.viewToggleBtn, view === 'dashboard' && styles.viewToggleBtnOn]}>
              <Ionicons name="grid-outline" size={13} color={view === 'dashboard' ? InkColors.bubbleText : InkColors.ink3} />
              <Text style={[styles.viewToggleText, view === 'dashboard' && styles.viewToggleTextOn]}>대시보드</Text>
            </Pressable>
            <Pressable onPress={() => setView('list')} style={[styles.viewToggleBtn, view === 'list' && styles.viewToggleBtnOn]}>
              <Ionicons name="list-outline" size={14} color={view === 'list' ? InkColors.bubbleText : InkColors.ink3} />
              <Text style={[styles.viewToggleText, view === 'list' && styles.viewToggleTextOn]}>목록</Text>
            </Pressable>
            {/* 매뉴얼 = 파생 뷰(섹션→순서로 발행본을 문서처럼) — 저장물이 아니라 같은 원자의 다른 투영. */}
            <Pressable onPress={() => { setView('manual'); setOnlyNeedsReview(false); }} style={[styles.viewToggleBtn, view === 'manual' && styles.viewToggleBtnOn]}>
              <Ionicons name="book-outline" size={13} color={view === 'manual' ? InkColors.bubbleText : InkColors.ink3} />
              <Text style={[styles.viewToggleText, view === 'manual' && styles.viewToggleTextOn]}>매뉴얼</Text>
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
            <Pressable onPress={() => setActiveCat(null)} style={[styles.chip, activeCat === null && styles.chipOn]}>
              <Text style={[styles.chipText, activeCat === null && styles.chipTextOn]}>전체</Text>
            </Pressable>
            {ALL_CATEGORIES.map((c) => {
              const on = activeCat === c;
              const m = getCategoryMeta(c);
              return (
                <Pressable key={c} onPress={() => selectCat(c)} style={[styles.chip, on && styles.chipOn]}>
                  <View style={[styles.chipDot, { backgroundColor: m.color }]} />
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 미검증 상태 필터 — 카운트>0일 때만 노출되는 정식 토글. 탭하면 미검증만 목록으로. */}
          {needsReview.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable
                onPress={toggleReview}
                style={[styles.statusChip, onlyNeedsReview && styles.statusReviewOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: onlyNeedsReview }}
                accessibilityLabel={`확인 필요 ${needsReview.length}개만 보기`}
              >
                <Ionicons name="alert-circle" size={13} color={onlyNeedsReview ? InkColors.ink : BrandColors.warn} />
                <Text style={[styles.statusChipText, onlyNeedsReview && styles.statusChipTextInk]}>확인 필요 {needsReview.length}</Text>
              </Pressable>
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
          {view === 'manual' ? (
            manualGroups.length === 0 ? (
              <EmptyResult onReset={() => { setQuery(''); setActiveCat(null); }} />
            ) : (
              manualGroups.map((g) => (
                <View key={g.name} style={{ gap: 8 }}>
                  <View style={styles.groupHead}>
                    <Ionicons name="bookmark" size={13} color={InkColors.ink2} />
                    <Text style={styles.groupTitle}>{g.name}</Text>
                    <Text style={styles.groupCount}>{g.items.length}</Text>
                  </View>
                  <View style={styles.list}>
                    {g.items.map((e) => (
                      <EntryRow key={e.id} e={e} onPress={() => onSelect(e.id)} />
                    ))}
                  </View>
                </View>
              ))
            )
          ) : view === 'dashboard' ? (
            baseFiltered.length === 0 ? (
              <EmptyResult onReset={() => { setQuery(''); setActiveCat(null); }} />
            ) : (
              <View style={{ gap: Space.xl }}>
                {needsReview.length > 0 && (
                  <Appear delay={0} style={styles.block}>
                    <SectionLabel icon="alert-circle-outline" title="확인이 필요해요" hint={`${needsReview.length}개`} />
                    <KnowhowCarousel entries={needsReview} onSelect={(e) => onSelect(e.id)} showCategory renderExtra={verifyButton} />
                  </Appear>
                )}
                {recent.length > 0 && (
                  <Appear delay={60} style={styles.block}>
                    <SectionLabel icon="sparkles-outline" title="최근 추가됨" hint="새로 올라온 순" />
                    <KnowhowCarousel entries={recent} onSelect={(e) => onSelect(e.id)} showCategory />
                  </Appear>
                )}
              </View>
            )
          ) : listFiltered.length === 0 ? (
            <EmptyResult
              onReset={() => { setQuery(''); setActiveCat(null); setOnlyNeedsReview(false); }}
              label={onlyNeedsReview ? '확인할 노하우가 없어요 🎉' : undefined}
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

  // 템플릿 둘러보기 진입 링크(홈에서 이관)
  templateLink: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.md, paddingVertical: Space.md, paddingHorizontal: Space.md, ...Elevation.e1,
  },
  templateLinkTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  templateLinkSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },

  // 미검증 배너
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.warnSoft,
    borderWidth: 1,
    borderColor: BrandColors.warnBorder,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
  },
  bannerTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  bannerBody: { fontSize: 12, color: InkColors.ink2, marginTop: 1 },
  bannerCta: { fontSize: 13, fontWeight: '800', color: BrandColors.warn },

  // 검토 대기(draft) 배너 — 인수인계서 검수 재진입점
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
  },
  draftBannerCta: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

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

  // 미검증 상태 필터 칩 — 카테고리 칩과 같은 형태의 정식 토글.
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill,
  },
  statusReviewOn: { backgroundColor: BrandColors.warnSoft, borderColor: BrandColors.warnBorder },
  statusChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  statusChipTextInk: { color: InkColors.ink },

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
    backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: BrandColors.warnBorder,
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
  badgeReview: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.warnSoft },
  badgeReviewText: { fontSize: 10, fontWeight: '800', color: BrandColors.warn },
  badgeUnused: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.accentSoft },
  badgeUnusedText: { fontSize: 10, fontWeight: '800', color: BrandColors.bad },

  // 빈 결과
  emptyResult: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyResultEmoji: { fontSize: 34 },
  emptyResultText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  resetLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, marginTop: 4, textDecorationLine: 'underline' },
});
