import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 규모 3단계(퀴즈 개발계획 §10-9 · 데모 §2-11) — 열 수는 개수로 자동.
 *  ≤96 → 12열(상자 ~28px) · ≤176 → 16열(~20px) · 그 위 → 20열 + 카테고리별 첫 줄만(접기).
 * 상자 최소 12px — 460 프레임·카드 안쪽 ~396px 에서 20열은 ~18px 라 하한 위다. 그 아래로는 줄이지 않는다.
 * 상자 사이 간격·라운드는 도형 치수라 간격 토큰(Space) 대상이 아니다.
 */
const STAGE = [
  { max: 96, cols: 12, gap: 4, radius: 4 },
  { max: 176, cols: 16, gap: 3, radius: 3 },
  { max: Infinity, cols: 20, gap: 2, radius: 2 },
] as const;
/** 범례 상자·피크 줄 높이 — 도형 치수. */
const LEGEND_BOX = 11;
const PEEK_MIN_H = 17;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export type HeatCell = {
  id: string;
  title: string;
  /** 0 = 문항 없음(점선) · 1~4 = 아는 직원 비율(옅음→전원). */
  level: HeatLevel;
  /** 호버·롱프레스에 제목과 같이 보이는 상태 한 줄 — "5명 중 2명 앎". */
  status: string;
  /** 노하우가 바뀐 뒤 문항을 안 고침 → 주황 테두리. */
  stale?: boolean;
  /** 낸 퀴즈에서 절반 넘게 오답 → 빨강 테두리. stale 과 겹치면 stale 이 이긴다(먼저 고칠 것). */
  miss?: boolean;
};

export type HeatGroup = { name: string; cells: HeatCell[] };

/**
 * 범례 문구 — 격자는 같고 **축이 다른** 두 화면이 쓴다(2026-08-27):
 *  · 퀴즈 홈(기본값): 색 = 아는 직원 비율 · 점선 = 문항 없음 · 주황 = 노하우 변경됨 · 빨강 = 높은 오답률
 *  · 매장 노하우 탭: 색 = 한 달간 물어본 횟수 · 점선 = 안 물어봄 · 주황 = 확인 필요 · 빨강 = 오래 손 안 댐
 */
export type HeatLegend = { empty: string; scale: [string, string]; stale: string; miss: string };
const QUIZ_LEGEND: HeatLegend = { empty: '문항 없음', scale: ['아는 직원', '전원'], stale: '노하우 변경됨', miss: '높은 오답률' };

/** 0단계는 흰 면(점선은 cellEmpty 가 얹는다). */
const LEVEL_BG: Record<HeatLevel, string> = {
  0: InkColors.bg,
  1: BrandColors.heat1,
  2: BrandColors.heat2,
  3: BrandColors.heat3,
  4: BrandColors.heat4,
};

/**
 * H5 · 히트맵(블록어휘 §7-2) — 노하우 1개 = 상자 1개, 카테고리별 그룹. **퀴즈 홈의 히어로.**
 *
 * 색 = **아는 직원 비율**(확정, 데모 §5) — "문제 낸 노하우"는 한 번 내면 영구 100%라 히어로 자격이 없다.
 * 점선 = 문항 없음 · 주황 테두리 = 노하우 변경됨 · 빨강 테두리 = 높은 오답률.
 * 호버(웹)·롱프레스(터치) = 제목+상태 한 줄이 머리 아래 피크 줄에 뜬다(툴팁 오버레이 아님 — 상자가
 * 14px 아래로 내려가면 손가락이 못 맞추고, 오버레이는 프레임 밖으로 샌다). 탭 = 그 노하우.
 * ★상자마다 Pressable 이고 부모는 View 다(RN-web 중첩 button 금지).
 * ★피크 줄은 항상 자리를 차지한다(minHeight) — 호버할 때마다 격자가 아래로 밀리면 안 된다.
 * 표시 전용: 레벨·stale·miss 판정은 `useQuizBoard.buildHeatmap()` 한 곳이다.
 */
export function Heatmap({
  head,
  groups,
  onPressCell,
  onPressGroup,
  legend = QUIZ_LEGEND,
  hint = '상자 하나 = 노하우 하나 · 길게 누르면 이름이 보여요',
}: {
  /** 머리줄 — 큰 값("41" + "%") · 제목("직원이 아는 노하우") · 우측 보조("58개"·"이번 주 ↑14칸"). */
  head: { value: string; unit?: string; title: string; aside?: string };
  groups: HeatGroup[];
  onPressCell: (id: string) => void;
  /** 카테고리 이름 탭 + 3단계(접힘)의 "+n개 더 · 이 카테고리 보기 ›". 없으면 글자만 남는다. */
  onPressGroup?: (name: string) => void;
  legend?: HeatLegend;
  /** 피크 줄의 평소 안내문. */
  hint?: string;
}) {
  const total = groups.reduce((n, g) => n + g.cells.length, 0);
  const stage = STAGE.find((s) => total <= s.max) ?? STAGE[STAGE.length - 1];
  const collapse = total > STAGE[1].max;
  const [peek, setPeek] = useState<HeatCell | null>(null);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.big}>
          {head.value}
          {head.unit ? <Text style={styles.bigUnit}>{head.unit}</Text> : null}
        </Text>
        <Text style={styles.headTitle} numberOfLines={1}>{head.title}</Text>
        {head.aside ? <Text style={styles.aside} numberOfLines={1}>{head.aside}</Text> : null}
      </View>
      <Text style={styles.peek} numberOfLines={1}>
        {peek ? `${peek.title} — ${peek.status}` : hint}
      </Text>

      {groups.map((g) => {
        const shown = collapse ? g.cells.slice(0, stage.cols) : g.cells;
        const rest = g.cells.length - shown.length;
        return (
          <View key={g.name} style={[styles.group, onPressGroup && styles.groupTight]}>
            {onPressGroup ? (
              // 카테고리 이름 = 그 카테고리로 가는 길(노하우 탭에서는 목록 필터). 48dp 는 상자 크기로.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${g.name} ${g.cells.length}개`}
                onPress={() => onPressGroup(g.name)}
                style={({ pressed }) => [styles.groupBtn, pressed && styles.cellPressed]}
              >
                <Text style={styles.groupLabel}>
                  {g.name}<Text style={styles.groupCount}>  {g.cells.length}개</Text> ›
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.groupLabel}>
                {g.name}<Text style={styles.groupCount}>  {g.cells.length}개</Text>
              </Text>
            )}
            <View style={[styles.grid, { marginHorizontal: -stage.gap / 2 }]}>
              {shown.map((c) => {
                const border = c.stale
                  ? styles.cellStale
                  : c.miss
                    ? styles.cellMiss
                    : c.level === 0
                      ? styles.cellEmpty
                      : null;
                return (
                  <View key={c.id} style={{ width: `${100 / stage.cols}%`, padding: stage.gap / 2 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${c.title}, ${c.status}`}
                      onPress={() => onPressCell(c.id)}
                      onLongPress={() => setPeek(c)}
                      onHoverIn={() => setPeek(c)}
                      onHoverOut={() => setPeek(null)}
                      style={({ pressed }) => [
                        styles.cell,
                        { borderRadius: stage.radius, backgroundColor: LEVEL_BG[c.level] },
                        border,
                        pressed && styles.cellPressed,
                      ]}
                    />
                  </View>
                );
              })}
            </View>
            {rest > 0 ? (
              onPressGroup ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${g.name} ${rest}개 더 보기`}
                  onPress={() => onPressGroup(g.name)}
                  style={({ pressed }) => [styles.more, pressed && styles.cellPressed]}
                >
                  <Text style={styles.moreText}><Text style={styles.moreN}>+{rest}개</Text> 더 · 이 카테고리 보기 ›</Text>
                </Pressable>
              ) : (
                <Text style={[styles.moreText, styles.more]}><Text style={styles.moreN}>+{rest}개</Text> 더</Text>
              )
            ) : null}
          </View>
        );
      })}

      {/* 범례 — 색 단독으로 상태를 말하지 않는다(글자 병기). */}
      <View style={styles.legend}>
        <Text style={styles.legendText}>{legend.empty}</Text>
        <View style={[styles.legendBox, styles.cellEmpty]} />
        <View style={styles.legendGap} />
        <Text style={styles.legendText}>{legend.scale[0]}</Text>
        <View style={[styles.legendBox, { backgroundColor: BrandColors.heat1 }]} />
        <View style={[styles.legendBox, { backgroundColor: BrandColors.heat2 }]} />
        <View style={[styles.legendBox, { backgroundColor: BrandColors.heat3 }]} />
        <View style={[styles.legendBox, { backgroundColor: BrandColors.heat4 }]} />
        <Text style={styles.legendText}>{legend.scale[1]}</Text>
        <View style={styles.legendGap} />
        <View style={[styles.legendBox, styles.cellStale]} />
        <Text style={styles.legendText}>{legend.stale}</Text>
        <View style={styles.legendGap} />
        <View style={[styles.legendBox, styles.cellMiss]} />
        <Text style={styles.legendText}>{legend.miss}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    paddingBottom: Space.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e2,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm },
  big: { fontSize: 28, lineHeight: 34, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  bigUnit: { fontSize: 14, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0 },
  headTitle: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 19, fontWeight: '800', color: InkColors.ink2 },
  aside: { fontSize: 11.5, lineHeight: 16, fontWeight: '800', color: BrandColors.goodText },
  // 피크·그룹 라벨·범례는 꼬리표(보조)라 본문 15sp 하한 대상이 아니다(simplicity-voice §4).
  peek: { marginTop: Space.xs, minHeight: PEEK_MIN_H, fontSize: 11, lineHeight: PEEK_MIN_H, fontWeight: '700', color: InkColors.ink2 },
  group: { marginTop: Space.md },
  groupLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800', color: InkColors.ink3, marginBottom: Space.xs },
  // 눌리는 라벨 — 글자는 작아도 상자는 48dp(hitSlop 은 RN-web 에서 안 먹는다). 아래 여백은 라벨이 갖는다.
  groupBtn: { minHeight: 48, justifyContent: 'flex-end', alignSelf: 'flex-start' },
  // 라벨이 48dp 상자를 가지면 그룹 위 여백은 그 상자가 대신한다.
  groupTight: { marginTop: 0 },
  groupCount: { color: InkColors.ink2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { aspectRatio: 1, backgroundColor: InkColors.bgSoft },
  cellEmpty: { backgroundColor: InkColors.bg, borderWidth: 1, borderStyle: 'dashed', borderColor: InkColors.line },
  cellStale: { borderWidth: 2, borderColor: BrandColors.warn },
  cellMiss: { borderWidth: 2, borderColor: BrandColors.bad },
  cellPressed: { opacity: 0.6 },
  // 눌리는 행이라 48dp — RN-web 은 hitSlop 을 무시한다(2026-08-26 실측).
  more: { minHeight: 48, justifyContent: 'center' },
  moreText: { fontSize: 11, lineHeight: 15, fontWeight: '800', color: InkColors.ink2 },
  moreN: { color: InkColors.ink },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.xs - 1, marginTop: Space.md },
  legendText: { fontSize: 10, lineHeight: 14, color: InkColors.ink3 },
  legendBox: { width: LEGEND_BOX, height: LEGEND_BOX, borderRadius: 3, backgroundColor: InkColors.bg },
  legendGap: { width: Space.xs },
});
