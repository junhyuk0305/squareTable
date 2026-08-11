import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { fetchOwnerKnowhowEntries } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { SectionLabel } from '@/components/SectionLabel';
import { EmptyState } from '@/components/EmptyState';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

/**
 * 찾기 바를 띄우는 최소 건수 — `OwnerKnowhowBrowse.FILTER_MIN` 과 같은 판정이다.
 * 이 수 미만이면 거르는 장치가 목록보다 커진다(복잡도 원칙 §4).
 */
const FILTER_MIN = 8;

/**
 * 허브 노하우 목록(계정 층) — 2026-08-07 신설.
 *
 * ★ 이 화면의 존재 이유는 **매장 전환 없이** 소유 매장 전체의 노하우를 한 번에 훑고
 *   가로질러 검색하는 것이다. 지금까지 허브의 '노하우 목록'은 `goStore(uid, ...)` =
 *   매장을 전환한 뒤 매장 앱으로 내려보내는 동작이었다. 그래서 "어느 매장 것을 볼지"를
 *   먼저 고르지 않으면 아무것도 볼 수 없었고, 매장을 가로지르는 검색은 아예 불가능했다.
 *
 * ★ 읽기 원천은 definer RPC `owner_knowhow_entries()`(0121)다. playbook_entries 의 RLS 는
 *   `unit_id = auth_unit_id()`(= profiles.active_unit_id = **UI 상태**)라 허브에서는
 *   권한이 아니라 "지금 보고 있는 매장"으로 좁혀진다. 층이 어긋난 것을 definer 로 뚫는다.
 *
 * ★ 고치는 것은 여기서 하지 않는다. 행을 누르면 **그 매장으로 내려간다**(goStore) —
 *   수정은 매장 앱의 RLS 경로 그대로여야 한다. 허브에 수정 경로를 새로 만들면 같은 판정이
 *   두 곳에 복제된다.
 */
export default function HubKnowhowScreen() {
  const stores = useSessionStore((s) => s.stores);
  const { goStore, switching } = useStoreNav();

  const [rows, setRows] = useState<PlaybookEntry[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');

  // 동기 setState 를 이펙트에 두지 않는다(cascading render 방지) — 재시도 리셋은 아래 핸들러가 한다.
  useEffect(() => {
    let alive = true;
    void fetchOwnerKnowhowEntries().then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) { setLoadErr(true); setRows([]); }
      else { setLoadErr(false); setRows(data); }
    });
    return () => { alive = false; };
  }, [nonce]);
  const retry = () => { setLoadErr(false); setRows(null); setNonce((n) => n + 1); };

  const storeNameOf = useMemo(() => {
    const m = new Map(stores.map((s) => [s.unit_id, s.store_name]));
    return (uid: string) => m.get(uid) ?? '내 매장';
  }, [stores]);

  const filtering = query.trim() !== '';
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows ?? [];
    if (!q) return list;
    return list.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      (e.search_keywords ?? []).some((k) => k.toLowerCase().includes(q)) ||
      String(e.square?.situation ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  /**
   * 소유 매장 — `owner_knowhow_entries()` 가 `units.owner_id = auth.uid()` 로 좁히므로 목록도 같은 범위여야 한다.
   * `stores`(=`my_units`)는 **멤버십** 기준이라 매니저·직원으로 속한 남의 매장까지 들고 있다 —
   * 그걸 그대로 세면 "노하우 0개"라고 말할 자격이 없는 매장까지 0개로 단정하게 된다(0093 역할 분리).
   */
  const ownedStores = useMemo(() => stores.filter((s) => s.role === 'owner'), [stores]);

  /**
   * 매장별 묶음 — RPC 는 표현을 정하지 않는다(행이 unit_id 를 들고 온다). 순서는 매장 목록 순.
   *
   * ★2026-08-11(P2-#5): **노하우 0개인 매장도 센다.** 예전엔 항목이 있는 매장만 묶어서
   *   머리말이 "매장 1곳"이라 말했는데 사장은 2곳을 갖고 있었다(`/hub-growth` 는 둘 다 세고 있어 화면끼리 어긋났다).
   *   새 매장은 **항상 0개로 시작**하므로, 정작 노하우를 채워야 할 매장이 노하우 화면에서 사라지는 게 옛 동작이었다.
   *   단 **검색 중에는 0건 매장을 끼우지 않는다** — 적중하지 않은 것이 결과처럼 보이면 안 된다.
   */
  const groups = useMemo(() => {
    const by = new Map<string, PlaybookEntry[]>();
    for (const e of visible) {
      const uid = e.unit_id;
      if (!by.has(uid)) by.set(uid, []);
      by.get(uid)!.push(e);
    }
    const order = filtering ? [] : ownedStores.map((s) => s.unit_id);
    // 항목이 있는데 소유 목록에 없는 매장(목록 미도착 등)은 절대 감추지 않는다 — 뒤에 붙인다.
    for (const uid of by.keys()) if (!order.includes(uid)) order.push(uid);
    return order.map((uid) => ({ uid, name: storeNameOf(uid), items: by.get(uid) ?? [] }));
  }, [visible, ownedStores, storeNameOf, filtering]);

  const total = rows?.length ?? 0;

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '노하우 목록' }} />
      {rows === null ? (
        <View style={st.center}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={st.centerText}>노하우를 불러오는 중...</Text>
        </View>
      ) : loadErr ? (
        // 읽기 실패를 "노하우 없음"으로 위장하지 않는다(무음 실패 방지).
        <EmptyState
          title="노하우를 불러오지 못했어요"
          body="연결을 확인하고 다시 시도해 주세요."
          cta={{ label: '다시 시도', onPress: retry }}
        />
      ) : total === 0 ? (
        <EmptyState
          title="아직 등록된 노하우가 없어요"
          body="노하우 탭의 '노하우 추가'로 첫 노하우를 적어 보세요."
        />
      ) : (
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={st.countLabel}>
            {filtering ? `${total}개 중 ${visible.length}개 보임` : `매장 ${groups.length}곳 · 노하우 ${total}개`}
          </Text>

          {/* 찾기 — 매장을 가로지르는 검색이 이 화면의 핵심 기능이다.
              검색어가 남아 있으면 8건 미만이어도 바를 띄운다(끌 수 없는 거르기 금지). */}
          {total >= FILTER_MIN || filtering ? (
            <View style={st.search}>
              <Ionicons name="search" size={16} color={InkColors.ink3} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="모든 매장에서 찾기"
                placeholderTextColor={InkColors.ink3}
                style={st.searchInput}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                  <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {visible.length === 0 ? (
            <View style={st.center}>
              <Text style={st.centerText}>찾는 노하우가 없어요</Text>
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                <Text style={st.resetText}>검색어 지우기</Text>
              </Pressable>
            </View>
          ) : (
            groups.map((g) => (
              <View key={g.uid} style={st.group}>
                {/* 0은 "0개"가 아니라 "없어요" (워딩 §5). */}
                <SectionLabel title={g.name} hint={g.items.length === 0 ? '없어요' : `${g.items.length}개`} />
                <View style={st.card}>
                  {g.items.length === 0 ? (
                    // 빈 매장을 이름만 세워 두면 막다른 길이 된다 — 채우러 갈 곳을 준다(복잡도 §4 빈 화면 규칙).
                    <Pressable
                      onPress={() => goStore(g.uid, '/owner/knowledge')}
                      disabled={!!switching}
                      style={({ pressed }) => [st.row, pressed && { opacity: 0.85 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${g.name} 첫 노하우 추가하러 가기`}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={st.emptyTitle}>아직 노하우가 없어요</Text>
                        <Text style={st.rowSub} numberOfLines={1}>이 매장에 첫 노하우를 적어 보세요</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
                    </Pressable>
                  ) : g.items.map((e, i) => (
                    <Pressable
                      key={e.id}
                      // 고치는 것은 매장 앱에서 — 허브에 수정 경로를 새로 만들지 않는다.
                      onPress={() => goStore(g.uid, '/owner/knowledge')}
                      disabled={!!switching}
                      style={({ pressed }) => [st.row, i > 0 && st.rowTop, pressed && { opacity: 0.85 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${g.name} · ${e.title} 관리`}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={st.rowTitle} numberOfLines={1}>{e.title}</Text>
                        <Text style={st.rowSub} numberOfLines={1}>
                          {String(e.square?.situation ?? '').trim() || '내용 없음'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          )}
          <View style={{ height: Space.xl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, gap: Space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.xl * 2 },
  centerText: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },
  resetText: { fontSize: 15, fontWeight: '800', color: InkColors.ink, textDecorationLine: 'underline' },

  countLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, paddingVertical: 8 },

  group: { gap: Space.sm },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, ...Elevation.e2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm + 2, minHeight: 56 },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  rowSub: { fontSize: 12, color: InkColors.ink3, marginTop: 1 },
  // 0건 매장 행 — 제목이 안내문(본문)이라 15sp 하한 적용(복잡도 §4).
  emptyTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
});
