import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { CategoryEditSheetView } from '@/components/owner/CategoryEditSheet';
import {
  KnowhowCountRow, KnowhowEmptyResult, KnowhowEntryRow, KnowhowFab, KnowhowFindBar, KNOWHOW_FAB_SPACE, PagedRows,
  filterKnowhow, knowhowChipCategories, knowhowChipCounts,
} from '@/components/knowhow/KnowhowListParts';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { useSpaceKnowhowCategories } from '@/lib/hooks/useSpaceKnowhowCategories';
import { connectStoreOpen, fetchEntries, renameEntrySection, subscribePlaybook } from '@/lib/db';
import { subscribeDebounced } from '@/lib/store/realtimeSync';
import type { CustomCategory } from '@/lib/store/knowhowCategories';
import { CONNECT, SPACE_KNOWHOW, SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { TouchSize } from '@/lib/theme/button';
import { Gap, Space, screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry } from '@/types';

/** 쓰기 화면(S07). 고치기는 ?edit=노하우 번호 · 질문으로 남기기는 ?uqId= · 입력 미리 채우기는 ?seed=. */
const WRITE = '/space/write';
/** 공간은 업종이 없다 — 표준 카테고리는 공통 세트만(저장 시트 PublishConfirmSheet pool 갈래와 같다). */
const NO_INDUSTRY = undefined;

/**
 * S04 공간 노하우 탭(주인) — 매장 노하우 목록과 같은 부품(KnowhowListParts · 실측 결함 R-2·R-3 · 2026-11-16).
 *  검색 · 카테고리 칩(건수) · 총 개수 · 톱니(카테고리 편집) · 행 → 상세(S08) · 우하단 노란 알약 [노하우 쓰기] → 쓰기(S07 · 0개면 없음).
 *  매장 전용 블록(히트맵 · 목록 탭 · "사장님 검증"·"안 쓰임" 배지 · 할 일 칸)은 없다(사용자 결정).
 * 읽기는 fetchEntries(공간 번호) 한 번(매장 스토어 usePlaybookStore 를 안 쓴다 · 공간 화면은 공간 번호를 넘긴다).
 * 카테고리 목록은 공간 전용 함수로 읽고 쓴다(0780 · useSpaceKnowhowCategories). 못 읽으면 톱니를 안 그린다(덮어쓰기 = 삭제).
 * 탭에 돌아올 때마다 다시 읽는다(쓰기·고치기·지우기 뒤 바로 맞게).
 * ★night-1111 g5: 다른 기기에서 쓰거나 지운 노하우도 실시간으로 맞춘다(subscribePlaybook(공간 번호) · 300ms 묶음).
 *   "매장과 연결하기" 줄(S12 입구)은 my_connect_store_open 이 참일 때만 그린다(꺼진 계정 = 지금 화면 그대로).
 */
export default function SpaceKnowhow() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [catSheet, setCatSheet] = useState(false);
  const cats = useSpaceKnowhowCategories(spaceId);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setFailed(false);
    const { data, error } = await fetchEntries(spaceId);
    // 못 읽었으면 빈 목록으로 위장하지 않는다(빈 화면 = "노하우 없음"이라는 사실 주장이 된다).
    if (error) setFailed(true);
    else setEntries(data);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!spaceId) return;
    return subscribeDebounced((cb) => subscribePlaybook(cb, spaceId), () => void load(), 300, 'space_knowhow');
  }, [spaceId, load]);

  useEffect(() => {
    let alive = true;
    void connectStoreOpen().then((r) => {
      if (alive) setConnectOpen(r.data === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const write = () => router.push(WRITE);
  const open = (id: string) => router.push({ pathname: '/space/knowhow/[id]', params: { id } });

  // 초안은 목록에서 뺀다(매장 목록과 같은 규칙 · 공간 쓰기는 바로 발행한다).
  const visible = useMemo(() => (entries ?? []).filter((e) => e.status !== 'draft'), [entries]);
  const customs = useMemo<CustomCategory[]>(() => cats.customs ?? [], [cats.customs]);
  const allCats = useMemo(() => knowhowChipCategories(visible, NO_INDUSTRY, customs), [visible, customs]);
  const chipCounts = useMemo(() => ({ total: visible.length, by: knowhowChipCounts(visible) }), [visible]);
  // 노하우가 지워져 카테고리가 사라졌는데 활성 필터로 남았으면 전체 취급(매장과 같은 파생).
  const effectiveCat = activeCat && allCats.includes(activeCat) ? activeCat : null;
  const filtered = useMemo(
    () => [...filterKnowhow(visible, query, effectiveCat)].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    [visible, query, effectiveCat],
  );
  const selectCat = (c: string) => setActiveCat((prev) => (prev === c ? null : c));
  const countLabel = query.trim() || effectiveCat ? SPACE_KNOWHOW.filteredCount(visible.length, filtered.length) : SPACE_KNOWHOW.totalCount(visible.length);
  const listKey = `${query}-${effectiveCat ?? ''}`;

  const saveCats = async (items: CustomCategory[]) => {
    const ok = await cats.save(items);
    if (!ok) showToast(SPACE_KNOWHOW.categorySaveFail, 'warn');
    return ok;
  };
  const renameSection = (from: string, to: string | null) => renameEntrySection(from, to, spaceId);
  const closeSheet = () => {
    setCatSheet(false);
    void load(); // 이름 바꾸기·지우기로 옮겨진 노하우를 바로 맞춘다(실시간 구독도 곧 맞춘다).
  };

  let body;
  if (failed && !entries) body = <LoadErrorState title={SPACE_KNOWHOW.loadFail} onRetry={() => void load()} />;
  else if (!entries) body = <ScreenLoading label={SPACE_KNOWHOW.loading} />;
  // 0개면 떠 있는 버튼 없이 빈 상태의 노란 버튼 하나(11절 2번 보충).
  else if (visible.length === 0) body = <EmptyState title={SPACE_KNOWHOW.emptyTitle} body={SPACE_KNOWHOW.emptyBody} cta={{ label: SPACE_KNOWHOW.add, onPress: write }} ctaTone="yellow" />;
  else
    body = (
      <>
        {connectOpen ? (
          <Pressable
            onPress={() => router.push('/space/connect')}
            accessibilityRole="button"
            accessibilityLabel={SPACE_WORDS.connectStore}
            style={({ pressed }) => [styles.connect, pressed && styles.pressed]}
          >
            <Ionicons name="storefront-outline" size={Type.title.fontSize} color={InkColors.ink} />
            <View style={styles.connectText}>
              <Text style={styles.connectTitle} numberOfLines={1}>{SPACE_WORDS.connectStore}</Text>
              <Text style={styles.connectSub} numberOfLines={1}>{CONNECT.rowHint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={Type.body.fontSize} color={TextColor.iconMuted} />
          </Pressable>
        ) : null}
        {/* 찾기 줄이 개수 줄 위(1차 추천대로 · 화면조립표 3-2). 칩에 건수. */}
        <KnowhowFindBar
          query={query}
          onQuery={setQuery}
          cats={allCats}
          active={effectiveCat}
          onSelect={selectCat}
          onAll={() => setActiveCat(null)}
          customs={customs}
          counts={chipCounts}
        />
        <KnowhowCountRow
          label={countLabel}
          manage={
            cats.customs
              ? [{ key: 'cat', icon: 'pricetags-outline', label: SPACE_KNOWHOW.editCategories, a11y: SPACE_KNOWHOW.editCategories, onPress: () => setCatSheet(true) }]
              : undefined
          }
        />
        {filtered.length === 0 ? (
          <KnowhowEmptyResult onReset={() => { setQuery(''); setActiveCat(null); }} />
        ) : (
          <PagedRows
            key={listKey}
            items={filtered}
            render={(e) => <KnowhowEntryRow key={e.id} e={e} onPress={() => open(e.id)} customs={customs} />}
            style={styles.list}
          />
        )}
      </>
    );

  return (
    // 목록이 자기 스크롤·떠 있는 + 버튼을 가져서 scroll={false}(매장 노하우 탭 owner/categories 와 같다).
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabKnowhow} line={spaceName} />} tabBar="space" scroll={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      {/* 만들기 입구 = 오른쪽 아래 떠 있는 노란 알약(11절 2번). 0개·읽는 중·실패면 그리지 않는다(빈 상태 버튼이 같은 일). */}
      {visible.length > 0 ? <KnowhowFab onPress={write} label={SPACE_KNOWHOW.add} showLabel /> : null}
      {catSheet && cats.customs ? (
        <CategoryEditSheetView
          entries={visible}
          customs={cats.customs}
          industry={NO_INDUSTRY}
          saveCustomCategories={saveCats}
          renameSection={renameSection}
          onClose={closeSheet}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 위·좌우 = 화면 기본 여백 · 사이 = 매장 노하우 목록과 같은 md · 아래 = + 버튼 자리.
  scroll: { ...screenScrollStyle, gap: Space.md, paddingBottom: KNOWHOW_FAB_SPACE },
  pressed: { opacity: 0.7 },
  list: CardStyles.rows,
  connect: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: TouchSize.inline },
  connectText: { flex: 1, minWidth: 0, gap: Gap.inline },
  connectTitle: { ...Type.body, fontWeight: '700' },
  connectSub: { ...Type.desc },
});
