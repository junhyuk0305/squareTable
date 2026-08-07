import { View, Text, Pressable, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { Appear, stagger } from './Appear';
import { EmptyState } from './EmptyState';
import { VerifyBadge } from './VerifyBadge';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { getSectionMeta } from '@/lib/utils/category';
import { verifyMeta } from '@/lib/utils/verification';
import { knowhowSourceLabel } from '@/lib/utils/knowhowSource';
import type { PlaybookEntry } from '@/types';

export type BrowseListProps = {
  /** '둘러보기' 세그먼트에 노출할 노하우 엔트리 목록 */
  entries: PlaybookEntry[];
  /** 카드 탭 시 상세로 이동 */
  onSelect: (entry: PlaybookEntry) => void;
  /** 빈 상태 안내 문구(미지정 시 카탈로그 기본 문구 사용) */
  emptyHint?: string;
  /**
   * 카테고리(= section) 칩 노출 여부(기본 true). 종류(루틴/돌발 등)는 AI 내부 비계라
   * 어디에도 라벨을 노출하지 않는다(2026-07-31 카테고리 단일화).
   */
  showCategory?: boolean;
};

// 카드 한 장(축약). DO/DON'T 미리보기 1줄씩, 해결률, 물어본 수, 검증배지, 출처.
// export — JuniorBrowseDashboard·OwnerKnowhowBrowse가 3블록(인기·최근·해결률)에서 같은 카드를 재사용한다.
// style: 가로 캐러셀(KnowhowCarousel)에서 고정폭을 주입하기 위한 선택 prop. renderExtra: 카드 하단 추가 액션(예: 1탭 검증).
export function BrowseCard({
  entry,
  onSelect,
  showCategory,
  style,
  renderExtra,
}: {
  entry: PlaybookEntry;
  onSelect: (e: PlaybookEntry) => void;
  showCategory: boolean;
  style?: ViewStyle;
  renderExtra?: (entry: PlaybookEntry) => React.ReactNode;
}) {
  const v = verifyMeta(entry.verification?.state);
  const ratePct = Math.round((entry.stats?.resolution_rate ?? 0) * 100);
  const hits = entry.stats?.query_hits_30d ?? 0;
  const doText = entry.square?.extract?.do?.trim();
  const dontText = entry.square?.extract?.dont?.trim();
  const sourceLabel = knowhowSourceLabel(entry);

  return (
    // 카드 시각(테두리·배경)은 바깥 View가 소유. 탭 영역은 안쪽 Pressable 하나로 좁혀,
    // renderExtra(예: 1탭 검증 버튼)가 카드 버튼 '안'에 중첩되지 않게(웹: <button> 안 <button> 금지) 형제로 뺀다.
    <View style={[styles.card, style]}>
      <Pressable
        onPress={() => onSelect(entry)}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}, ${v.label}, 해결률 ${ratePct}%${hits > 0 ? `, ${hits}명이 물어봄` : ''}`}
        style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
      >
        {/* 헤더: 카테고리(색점+이름) + 검증배지. 노출은 showCategory로 제어. */}
        <View style={[styles.header, !showCategory && { justifyContent: 'flex-end' }]}>
          {showCategory && (() => {
            const sm = getSectionMeta(entry.section);
            return (
              <View style={styles.sectionChip}>
                <View style={[styles.sectionDot, { backgroundColor: sm.color }]} />
                <Text style={styles.sectionChipText}>{sm.label}</Text>
              </View>
            );
          })()}
          <VerifyBadge state={entry.verification?.state} size="list" />
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>

        {/* 해결률 · 물어본 수 — 있는 것만 */}
        <View style={styles.statRow}>
          <Text style={styles.rate}>해결률 {ratePct}%</Text>
          {hits > 0 ? <Text style={styles.hits}>{hits}명이 물어봤어요</Text> : null}
        </View>

        {/* DO / DON'T 1줄 미리보기 — 있는 것만 */}
        {doText ? (
          <View style={[styles.preview, { borderLeftColor: BrandColors.good }]}>
            <Text style={[styles.previewTag, { color: BrandColors.goodText }]}>DO</Text>
            <Text style={styles.previewText} numberOfLines={1}>
              {doText}
            </Text>
          </View>
        ) : null}
        {dontText ? (
          <View style={[styles.preview, { borderLeftColor: BrandColors.warn }]}>
            <Text style={[styles.previewTag, { color: BrandColors.warnText }]}>{"DON'T"}</Text>
            <Text style={styles.previewText} numberOfLines={1}>
              {dontText}
            </Text>
          </View>
        ) : null}

        {/* 출처 */}
        <Text style={styles.source} numberOfLines={1}>
          출처 · {sourceLabel}
        </Text>
      </Pressable>

      {/* 추가 액션 슬롯(예: 미검증 섹션의 1탭 검증 버튼) — 카드 버튼의 형제(중첩 금지) */}
      {renderExtra ? renderExtra(entry) : null}
    </View>
  );
}

/**
 * BrowseList — 노하우 '둘러보기' 세그먼트의 카드 리스트(프레젠테이셔널).
 * 각 카드: 카테고리칩 · 검증배지 · 해결률 · DO/DON'T 1줄 · 출처.
 * 데이터/필터/로딩은 부모(KnowhowSegment 슬롯) 책임. 여기선 받은 entries만 그린다.
 */
export function BrowseList({ entries, onSelect, emptyHint, showCategory = true }: BrowseListProps) {
  if (!entries || entries.length === 0) {
    // 03 카탈로그 search.empty.senior / knowhow.empty 톤(해요체).
    const hint = emptyHint ?? '찾는 노하우가 없어요. 검색어를 바꾸거나, 새 노하우로 만들어 둘 수 있어요.';
    return <EmptyState title="아직 보여줄 노하우가 없어요" body={hint} />;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {entries.map((entry, i) => (
        <Appear key={entry.id} delay={stagger(i)}>
          <BrowseCard entry={entry} onSelect={onSelect} showCategory={showCategory} />
        </Appear>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    gap: 8, // 카드 본문(Pressable) ↔ 추가 액션(renderExtra) 간격
    ...Elevation.e1,
  },
  cardBody: { gap: 8 }, // 카드 본문 내부 행 간격(헤더·제목·통계·미리보기·출처)
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  // 카테고리(section) 칩 — 색점 + 이름
  sectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft,
  },
  sectionDot: { width: 7, height: 7, borderRadius: Radius.pill },
  sectionChipText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  title: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
  statRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rate: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  hits: { fontSize: 12, fontWeight: '700', color: BrandColors.warnText },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderLeftWidth: 3,
    paddingLeft: 8,
  },
  previewTag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, width: 36 },
  previewText: { flex: 1, fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  source: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
});
