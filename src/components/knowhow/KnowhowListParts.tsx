// 노하우 목록 공용 부품 — 매장 노하우 탭(OwnerKnowhowBrowse)과 공간 노하우 탭(app/space/knowhow)이 같이 쓴다(실측 결함 R-2·R-3 · 2026-11-16).
//
// 무엇이 여기 있나: 개수 줄 + 톱니(목록 관리) · 찾기 바(검색 · 카테고리 칩) · 노하우 한 행 · 끊어 그리기 · 빈 결과 · 우하단 + 버튼.
// 데이터는 전부 props 로 받는다. 스토어를 읽지 않는다 — 매장은 usePlaybookStore, 공간은 공간 번호로 읽은 목록을 넘긴다.
// 매장 전용 블록(히트맵 · 목록 탭 · "사장님 검증"·"안 쓰임" 배지 · 1탭 점검 · 검토 대기 · 할 일 칸)은 OwnerKnowhowBrowse 에 남는다.
//   배지는 행의 extra 칸으로 넣는다. 공간은 아무것도 안 넣는다(사용자 결정 · 히트맵 없음 · 사장님 검증 없음).
import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Appear, stagger } from '@/components/Appear';
import { Collapse } from '@/components/Collapse';
import { getSectionMeta } from '@/lib/utils/category';
import { matchesKnowhowQuery } from '@/lib/utils/knowhowSearch';
import { UNSECTIONED, sectionOptions } from '@/lib/config/sections';
import type { CustomCategory } from '@/lib/store/knowhowCategories';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Type } from '@/lib/theme/type';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { SearchStyles, SEARCH_ICON } from '@/lib/theme/search';
import { Space } from '@/lib/theme/layout';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, FabSize } from '@/lib/theme/button';
import type { PlaybookEntry } from '@/types';

type IconName = keyof typeof Ionicons.glyphMap;

// 사용자 표면의 분류는 카테고리(= section) 하나 — 종류(루틴/돌발 등)는 AI 내부용이라 안 보여준다.
export const sectionOf = (e: PlaybookEntry) => e.section?.trim() || UNSECTIONED;

/**
 * 칩 목록 = 실제 쓰이는 카테고리 + 그 자리가 만든 카테고리(0개여도 노출). 순서: 표준 → 그 자리 고유 → 기타.
 * visible = 초안을 뺀 목록.
 */
export function knowhowChipCategories(visible: PlaybookEntry[], industry: string | undefined, customs: CustomCategory[]): string[] {
  const customLabels = customs.map((c) => c.label);
  const keep = new Set([...visible.map(sectionOf), ...customLabels]);
  const ordered = sectionOptions(industry, [...visible.map((e) => e.section), ...customLabels]).filter((s) => keep.has(s));
  if (keep.has(UNSECTIONED)) ordered.push(UNSECTIONED);
  return ordered;
}

/** 검색어 + 카테고리 하나로 거른다(cat = null 이면 전체). 매장은 목록 탭으로 먼저 거른 뒤 이걸 부른다. */
export function filterKnowhow(list: PlaybookEntry[], query: string, cat: string | null): PlaybookEntry[] {
  const q = query.trim().toLowerCase();
  const byQuery = list.filter((e) => matchesKnowhowQuery(e, q));
  return cat ? byQuery.filter((e) => sectionOf(e) === cat) : byQuery;
}

/**
 * 카테고리 색 — 넘긴 목록(그 자리 카테고리)에 저장된 색이 먼저다.
 * getSectionMeta 의 레지스트리는 지금 매장 것이라, 공간 화면은 자기 목록을 넘겨야 공간 카테고리 색이 맞다.
 */
export function sectionColor(name: string | null | undefined, customs: CustomCategory[]): string {
  const n = name?.trim();
  return (n && customs.find((c) => c.label === n)?.color) || getSectionMeta(name).color;
}

/** 목록 관리 패널의 한 줄(톱니 뒤). keepOpen = 누른 뒤 패널을 닫지 않는다(내보내기가 그 자리에서 "복사됐어요"를 보인다). */
export type KnowhowManageRow = { key: string; icon: IconName; label: string; a11y: string; onPress: () => void; keepOpen?: boolean };

/**
 * 개수 줄 + 톱니. 톱니 패널은 이 줄 아래에 **떠서** 열린다(밀어내지 않는다 · StoreToggle 매장 드롭다운과 같은 A7 규격 · 2026-08-19).
 * 누른 자리 바로 아래 absolute 앵커 + Collapse(높이 애니) + Appear(행 스태거). 닫기는 톱니(✕)가 맡는다.
 * manage 가 비면 톱니를 안 그린다(노하우 0건 · 카테고리 목록을 못 읽음).
 */
export function KnowhowCountRow({ label, info, manage }: { label: string; info?: ReactNode; manage?: KnowhowManageRow[] }) {
  const [open, setOpen] = useState(false);
  const rows = manage ?? [];
  return (
    <View style={styles.headBlock}>
      <View style={styles.headRow}>
        <View style={styles.headLeft}>
          <Text style={styles.subline}>{label}</Text>
          {info}
        </View>
        {rows.length > 0 && (
          <Pressable
            onPress={() => setOpen((v) => !v)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={open ? '목록 관리 닫기' : '목록 관리 열기'}
            style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name={open ? 'close' : 'settings-outline'} size={17} color={InkColors.ink2} />
          </Pressable>
        )}
      </View>
      {rows.length > 0 && open && (
        <View style={styles.manageAnchor}>
          <Collapse style={styles.manageActions}>
            {rows.map((r, i) => (
              <Appear key={r.key} delay={stagger(i)} offsetY={7}>
                <Pressable
                  onPress={() => { if (!r.keepOpen) setOpen(false); r.onPress(); }}
                  style={({ pressed }) => [styles.manageRow, i > 0 && styles.manageRowDivider, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={r.a11y}
                >
                  <Ionicons name={r.icon} size={16} color={InkColors.ink2} />
                  <Text style={styles.manageRowText} numberOfLines={1}>{r.label}</Text>
                  <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                </Pressable>
              </Appear>
            ))}
          </Collapse>
        </View>
      )}
    </View>
  );
}

/** 찾기 바 — [검색] / [카테고리 가로 스크롤]. 단일 선택 — '전체' + 한 카테고리. 같은 칩을 다시 누르면 전체로(selectCat 은 부르는 쪽). */
export function KnowhowFindBar({
  query, onQuery, cats, active, onSelect, onAll, customs,
}: {
  query: string;
  onQuery: (q: string) => void;
  cats: string[];
  active: string | null;
  onSelect: (c: string) => void;
  onAll: () => void;
  customs: CustomCategory[];
}) {
  return (
    <View style={styles.findBar}>
      <View style={SearchStyles.box}>
        <Ionicons name="search" size={SEARCH_ICON.size} color={SEARCH_ICON.color} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="제목·키워드로 검색"
          placeholderTextColor={InkColors.ink3}
          style={SearchStyles.input}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => onQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.findRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.findScroll} contentContainerStyle={styles.chipRow}>
          <Pressable onPress={onAll} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} style={[styles.chip, active === null && styles.chipOn]}>
            <Text style={[styles.chipText, active === null && styles.chipTextOn]}>전체</Text>
          </Pressable>
          {cats.map((c) => {
            const on = active === c;
            return (
              <Pressable key={c} onPress={() => onSelect(c)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} style={[styles.chip, on && styles.chipOn]}>
                <View style={[styles.chipDot, { backgroundColor: sectionColor(c, customs) }]} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{getSectionMeta(c).label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * 노하우 한 행 — 탭하면 고치기/상세. extra = 매장 배지 자리(공간은 비운다).
 * divider=false 는 아래에 1탭 점검 버튼이 붙는 경우 — 구분선을 래퍼가 대신 갖는다.
 */
export function KnowhowEntryRow({
  e, onPress, divider = true, extra, customs,
}: { e: PlaybookEntry; onPress: () => void; divider?: boolean; extra?: ReactNode; customs: CustomCategory[] }) {
  const meta = getSectionMeta(e.section);
  const ratePct = Math.round((e.stats?.resolution_rate ?? 0) * 100);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={e.title}
      style={({ pressed }) => [styles.row, !divider && styles.rowNoDivider, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.dot, { backgroundColor: sectionColor(e.section, customs) }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {e.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {meta.label} · v{e.version}
          </Text>
          {e.stats?.resolution_rate ? <Text style={styles.metaRate}>· 해결률 {ratePct}%</Text> : null}
          {e.stats?.query_hits_30d ? <Text style={styles.meta}>· {e.stats.query_hits_30d}</Text> : null}
          {extra}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
    </Pressable>
  );
}

/** 한 번에 그리는 행 수 — 전량 렌더가 실제로 무너지는 지점은 실측으로 확인했다(2026-08-08 · 노하우 400건에서 DOM 5,776 노드 · 6.7초). */
const LIST_PAGE = 30;

/**
 * 목록을 LIST_PAGE 개씩 끊어 그린다. **남은 수를 버튼이 밝힌다** — 조용히 자르면
 * "이게 전부"로 읽혀서, 안 그려진 노하우가 없는 것이 된다.
 * 거르기 조건이 바뀌면 부르는 쪽이 key 를 바꿔 '더 보기'를 처음으로 돌린다.
 */
export function PagedRows({
  items, render, style,
}: {
  items: PlaybookEntry[];
  render: (e: PlaybookEntry, i: number) => ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [shown, setShown] = useState(LIST_PAGE);
  const rest = items.length - shown;
  return (
    <View style={style}>
      {items.slice(0, shown).map(render)}
      {rest > 0 && (
        <Pressable
          onPress={() => setShown((n) => n + LIST_PAGE)}
          accessibilityRole="button"
          accessibilityLabel={`${Math.min(rest, LIST_PAGE)}개 더 보기`}
          style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.moreText}>{Math.min(rest, LIST_PAGE)}개 더 보기 · 남은 {rest}개</Text>
        </Pressable>
      )}
    </View>
  );
}

export function KnowhowEmptyResult({ onReset }: { onReset: () => void }) {
  return (
    <View style={styles.emptyResult}>
      {/* 그림 이모지 금지(워딩 §1) — 같은 뜻을 Ionicons 로. 2026-08-07 QA #5-2. */}
      <Ionicons name="search-outline" size={30} color={InkColors.ink3} />
      <Text style={styles.emptyResultText}>조건에 맞는 노하우가 없어요</Text>
      <Pressable onPress={onReset} style={styles.resetBtn}>
        <Text style={styles.resetLink}>필터 초기화</Text>
      </Pressable>
    </View>
  );
}

/**
 * 노하우 추가 + — 우하단 떠 있는 노란 버튼(2026-08-07 · 상단 버튼을 대체한 이 화면의 Primary).
 * ★스크롤 '밖'(형제)에 둔다. 그래야 스크롤과 같이 움직이지 않는다. 부모가 460 프레임 안이라 프레임을 안 넘는다.
 * 목록 스크롤 아래 여백은 KNOWHOW_FAB_SPACE 만큼 둔다(마지막 행이 버튼 밑에 깔리지 않게).
 */
export function KnowhowFab({ onPress, label = '노하우 추가' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="add" size={FabSize.icon} color={InkColors.ink} />
    </Pressable>
  );
}

/** 스크롤 아래 여백 = 버튼 지름 + 위아래 거터. */
export const KNOWHOW_FAB_SPACE = FabSize.face + Space.gutter * 2;

const styles = StyleSheet.create({
  // 톱니 패널의 앵커. zIndex 가 없으면 뒤에 오는 형제(찾기 바·목록)가 위에 그려져 패널이 가려진다.
  // 위아래 -xs: 부모 gap(md) 12 를 8 로 — 개수 한 줄이 탭·찾기 바 사이에서 붕 떠 보였다(2026-09-03).
  headBlock: { position: 'relative', zIndex: 20, marginVertical: -Space.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 },
  // "총 N개 · 탭하면 수정" = 카운트+힌트라 **보조**다(본문 아님). 보조는 15sp 하한 대상이 아니다(simplicity-voice §4).
  // 색은 읽는 회색(TextColor.secondary) — ink3 는 아이콘·비활성에만 남긴다(2026-11-02).
  subline: { flexShrink: 1, fontSize: 12, color: TextColor.secondary, fontWeight: '600' },
  // 개수 줄 오른쪽 톱니 — 작게 그리되 hitSlop 으로 48dp 하한을 지킨다.
  gearBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // Collapse 의 style 은 안쪽 내용 View 로 가고 바깥은 높이를 재는 클리핑 박스라, '띄우기'는 이 앵커가 맡는다
  // (StoreToggle.menuAnchor 와 같은 구조 — 그쪽 주석이 정본이다).
  manageAnchor: { position: 'absolute', top: '100%', right: 0, minWidth: 220, zIndex: 30, marginTop: Space.xs },
  manageActions: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    backgroundColor: '#FFFFFF', overflow: 'hidden', ...Elevation.e2,
  },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingHorizontal: Space.md },
  manageRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  manageRowText: { ...Type.body, flex: 1, fontWeight: '700' },

  // 찾기 바
  findBar: { ...CardStyles.list, gap: Space.sm },
  findRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  // ★minWidth:0 없으면 웹 flexbox 의 min-width:auto 때문에 가로 스크롤이 안 생기고 부모를 밀어낸다.
  findScroll: { flex: 1, minWidth: 0 },
  chipRow: { flexDirection: 'row', gap: 7, paddingVertical: 1, paddingRight: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipDot: { width: 7, height: 7, borderRadius: Radius.pill },
  chipText: { ...Type.tag, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.bubbleText },

  // 행
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  rowNoDivider: { borderBottomWidth: 0 },
  dot: { width: 10, height: 10, borderRadius: Radius.pill },
  rowTitle: { ...Type.body, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: TextColor.secondary, fontWeight: '600' },
  metaRate: { ...Type.tag, color: InkColors.ink2, fontWeight: '700' },

  // 더 보기 줄 = 목록 맨 아래 가로 꽉 보조 알약(R-11 · 2026-11-16).
  moreRow: { ...ButtonStyles.secondary, alignSelf: 'stretch', marginTop: Space.sm },
  moreText: ButtonTextStyles.secondary,

  // 빈 결과
  emptyResult: { ...CardStyles.list, alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyResultText: { ...Type.body, fontWeight: '700', color: InkColors.ink2 },
  resetBtn: { ...ButtonStyles.secondary, alignSelf: 'center', marginTop: 4 },
  resetLink: ButtonTextStyles.secondary,

  // 노하우 추가 + (2026-08-07 · 노랑 · yellowDeep 테두리 · 노랑 그림자)
  fab: {
    position: 'absolute',
    right: Space.gutter,
    bottom: Space.gutter,
    width: FabSize.face,
    height: FabSize.face,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.yellow,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    ...Elevation.ey,
  },
});
