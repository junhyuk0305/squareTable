import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { InfoDot } from '@/components/InfoDot';
import { logout } from '@/lib/auth';
import { getCategoryMeta, ALL_CATEGORIES } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import type { Category, PlaybookEntry } from '@/types';

function LogoutHeaderBtn() {
  return (
    <Pressable onPress={() => void logout()} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: BrandColors.brand }}>로그아웃</Text>
    </Pressable>
  );
}

// 검증 3-state 배지 — BrowseList/SquareCard와 동일 매핑.
type VerifyMeta = { label: string; fg: string; bg: string };
function verifyMeta(state: PlaybookEntry['verification']): VerifyMeta | null {
  switch (state?.state) {
    case 'owner_verified':
      return { label: '사장님 검증', fg: InkColors.ink, bg: BrandColors.yellowSoft };
    case 'field_tested':
      return { label: '현장 검증', fg: BrandColors.good, bg: '#E6F1EA' };
    case 'unverified':
      return { label: '미검증', fg: InkColors.ink3, bg: InkColors.bgSoft };
    default:
      return null;
  }
}

// ── 정렬 옵션 ────────────────────────────────────────────────
type SortKey = 'recent' | 'resolution' | 'cited' | 'category';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '최신순' },
  { key: 'resolution', label: '해결률순' },
  { key: 'cited', label: '인용순' },
  { key: 'category', label: '카테고리별' },
];

// 검색 매칭 — 제목·키워드·태그 부분일치(대소문자·# 무시).
function matchesQuery(e: PlaybookEntry, q: string): boolean {
  if (!q) return true;
  if (e.title?.toLowerCase().includes(q)) return true;
  if ((e.search_keywords ?? []).some((k) => k.toLowerCase().includes(q))) return true;
  if ((e.tags ?? []).some((t) => t.replace(/^#/, '').toLowerCase().includes(q))) return true;
  return false;
}

/** 한 노하우 행 — 평면/그룹 양쪽에서 재사용. 탭하면 수정. */
function EntryRow({ e, onPress }: { e: PlaybookEntry; onPress: () => void }) {
  const meta = getCategoryMeta(e.category);
  const v = verifyMeta(e.verification);
  const ratePct = Math.round((e.stats?.resolution_rate ?? 0) * 100);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {e.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {meta.label} · v{e.version}
          </Text>
          {e.stats?.resolution_rate ? <Text style={styles.metaRate}>· 해결률 {ratePct}%</Text> : null}
          {e.stats?.query_hits_30d ? <Text style={styles.meta}>· 인용 {e.stats.query_hits_30d}</Text> : null}
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
 * 내 노하우 — 사장님이 등록한 노하우 전체 목록.
 * 검색 + 카테고리 필터 + 정렬(최신/해결률/인용/카테고리별 그룹핑). 행 탭하면 수정.
 */
export default function OwnerKnowledgeScreen() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);

  const [query, setQuery] = useState('');
  const [activeCats, setActiveCats] = useState<Category[]>([]); // 빈 배열 = 전체
  const [sort, setSort] = useState<SortKey>('recent');

  const openEntry = (id: string) => router.push({ pathname: '/owner/edit/[id]', params: { id } });
  const toggleCat = (c: Category) =>
    setActiveCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  // 필터(검색+카테고리) → 정렬. 그룹핑은 sort==='category'일 때만 섹션으로.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter((e) => matchesQuery(e, q));
    if (activeCats.length > 0) list = list.filter((e) => activeCats.includes(e.category));

    if (sort !== 'category') {
      list = [...list].sort((a, b) => {
        if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        if (sort === 'resolution') return (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0);
        if (sort === 'cited') return (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0);
        return 0;
      });
    }
    return list;
  }, [entries, query, activeCats, sort]);

  // 카테고리별 그룹(빈 그룹 제외, 각 그룹 내부는 최신순).
  const groups = useMemo(() => {
    if (sort !== 'category') return null;
    return ALL_CATEGORIES.map((cat) => ({
      cat,
      items: filtered
        .filter((e) => e.category === cat)
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    })).filter((g) => g.items.length > 0);
  }, [filtered, sort]);

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: '내 노하우', headerRight: () => <LogoutHeaderBtn /> }} />
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
      </SafeAreaView>
    );
  }

  const hasEntries = entries.length > 0;
  const isEmptyResult = hasEntries && filtered.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '내 노하우' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
            <Text style={styles.subline}>
              총 {entries.length}개{hasEntries ? ' · 탭하면 수정할 수 있어요' : ''}
            </Text>
            <InfoDot
              title="노하우가 뭐예요?"
              body={
                '여기 적어두면 직원이 물을 때 AI가 사장님 대신 답해줘요.\n많이 쌓일수록 같은 질문에 일일이 답할 일이 줄어요.'
              }
            />
          </View>
          <Pressable
            onPress={() => router.push('/owner/categories')}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.addBtnText}>노하우 추가</Text>
          </Pressable>
        </View>

        {!hasEntries ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📒</Text>
            <Text style={styles.emptyTitle}>아직 등록된 노하우가 없어요</Text>
            <Text style={styles.emptyHint}>알바 질문에 답하거나, 직접 추가하면 여기에 쌓여요.</Text>
            <Pressable
              onPress={() => router.push('/owner/categories')}
              style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.emptyBtnText}>첫 노하우 추가하기</Text>
            </Pressable>
          </View>
        ) : (
          <>
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

            {/* 카테고리 칩 필터 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable
                onPress={() => setActiveCats([])}
                style={[styles.chip, activeCats.length === 0 && styles.chipOn]}
              >
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

            {/* 정렬 */}
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

            {/* 결과 */}
            {isEmptyResult ? (
              <View style={styles.emptyResult}>
                <Text style={styles.emptyResultEmoji}>🔍</Text>
                <Text style={styles.emptyResultText}>조건에 맞는 노하우가 없어요</Text>
                <Pressable
                  onPress={() => {
                    setQuery('');
                    setActiveCats([]);
                  }}
                >
                  <Text style={styles.resetLink}>필터 초기화</Text>
                </Pressable>
              </View>
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
                        <EntryRow key={e.id} e={e} onPress={() => openEntry(e.id)} />
                      ))}
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.list}>
                {filtered.map((e) => (
                  <EntryRow key={e.id} e={e} onPress={() => openEntry(e.id)} />
                ))}
              </View>
            )}
          </>
        )}
        <View style={{ height: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  scroll: { padding: 20, gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  subline: { flex: 1, fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: InkColors.ink,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  addBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },

  // 검색
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    ...Elevation.e1,
  },
  searchInput: { flex: 1, fontSize: 14, color: InkColors.ink, padding: 0 },

  // 칩
  chipRow: { flexDirection: 'row', gap: 7, paddingVertical: 1, paddingRight: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF' },

  // 정렬
  sortRow: { flexDirection: 'row', gap: 6, paddingRight: 4 },
  sortChip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },
  sortChipOn: { backgroundColor: BrandColors.yellowSoft },
  sortText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  sortTextOn: { color: '#7a5e00' },

  // 그룹
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingHorizontal: 2 },
  groupTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  groupCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  // 리스트/행
  list: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  metaRate: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  badge: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill },
  badgeText: { fontSize: 10, fontWeight: '800' },

  // 빈 상태
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 16 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  emptyHint: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },
  emptyBtn: { marginTop: 8, backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 12 },
  emptyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  emptyResult: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyResultEmoji: { fontSize: 34 },
  emptyResultText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  resetLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, marginTop: 4, textDecorationLine: 'underline' },
});
