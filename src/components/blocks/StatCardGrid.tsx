import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InfoDot } from '@/components/InfoDot';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 칸 최소 높이 — 시각요소(막대 26px)까지 3층이 들어가는 높이. 고정 height 가 아니라 minHeight 다
 * (배율이 오르면 글자가 아니라 상자가 늘어야 한다 — 복잡도 원칙 §4).
 */
const CARD_MIN_H = 112;

export type StatCardItem = {
  key: string;
  label: string;
  value: string | number;
  /** 값 뒤 작은 단위("건"·"개"·"/5명"·"만원"). */
  unit?: string;
  /** 값 아래 한 줄("가장 오래: 6일째"). 시각요소가 없는 칸은 이 줄이 3층째다. */
  sub?: string;
  /**
   * 시각요소 — `Sparkline`(이력 있음) 또는 `StackBar`(스냅샷의 구성). R4: 원장이 없는 지표에
   * 장식용 그림을 넣지 않는다 — 그런 칸은 visual 없이 sub 로 끝낸다.
   */
  visual?: ReactNode;
  /**
   * 라벨 옆 ⓘ — "이 숫자가 어떻게 나왔나"를 탭으로 연다(`MiniStats.info` 와 같은 슬롯).
   * ★금액 칸에는 사실상 필수다: 예상 급여는 분쟁 대상이라 계산 근거·공제 사유를 화면에서
   *   지울 수 없다(2026-08-26 근무표 기준 전환). MiniStats → L4 로 갈아탈 때 이 슬롯이 없으면
   *   그 설명이 조용히 사라진다.
   */
  info?: { title: string; body: string };
  /** 눌러서 갈 곳. 없으면 › 를 그리지 않는다. */
  onPress?: () => void;
  /** hot = 손봐야 할 값(주황 틴트) · dim = 아직 아무 일도 아닌 것(초안). */
  tone?: 'hot' | 'dim';
};

/**
 * L4 · 2열 지표 카드(블록어휘 §7-2). 칸 = [라벨 + ›] [큰 값] [시각요소] 3층.
 *
 * 옛 `MiniStats`(숫자만 나열)의 자리를 새 화면에서는 이것이 먼저 맡는다 — 숫자 옆에 대상(R2)과
 * 그림(R4)이 붙어야 "지표 나열"로 안 읽힌다. **같은 폭 반복 3회 = 2열로 접는다**(R3).
 * 홀수 개면 마지막 줄은 빈 칸으로 채워 폭을 맞춘다(마지막 칸만 두 배로 넓어지면 위계가 생긴다).
 * 표시 전용: 값·단위·톤은 호출부가 정한다.
 */
export function StatCardGrid({ items }: { items: StatCardItem[] }) {
  if (items.length === 0) return null;
  const rows: StatCardItem[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));

  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((it) => (
            <StatCard key={it.key} item={it} style={styles.cell} />
          ))}
          {row.length === 1 ? <View style={styles.cell} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * 칸 하나. 가로 스크롤(D 형태 — '푸는 중' 카드 줄)에서도 같은 칸을 쓰므로 따로 내보낸다 —
 * 그리드와 스크롤이 서로 다른 카드를 그리면 같은 지표가 다르게 보인다.
 */
export function StatCard({ item, style }: { item: StatCardItem; style?: StyleProp<ViewStyle> }) {
  const hot = item.tone === 'hot';
  const dim = item.tone === 'dim';
  const body = (
    <>
      <View style={styles.labelRow}>
        <Text
          style={[styles.label, item.info && styles.labelShrink, hot && styles.hotText]}
          numberOfLines={1}
        >
          {item.label}
        </Text>
        {/* ⓘ 는 라벨 **바로 옆**이다 — 오른쪽 끝(›)에 붙이면 무엇에 대한 설명인지 안 읽힌다.
            그래서 info 가 있을 때만 라벨이 flex 를 놓고 뒤에 빈 칸이 남는 자리를 만든다. */}
        {item.info ? (
          <>
            <InfoDot size={13} title={item.info.title} body={item.info.body} />
            <View style={styles.spacer} />
          </>
        ) : null}
        {item.onPress ? <Ionicons name="chevron-forward" size={13} color={hot ? BrandColors.warnText : InkColors.ink3} /> : null}
      </View>
      <Text style={[styles.value, hot && styles.hotText]} numberOfLines={1}>
        {item.value}
        {item.unit ? <Text style={[styles.unit, hot && styles.hotSub]}>{item.unit}</Text> : null}
      </Text>
      {item.sub ? <Text style={[styles.sub, hot && styles.hotSub]} numberOfLines={1}>{item.sub}</Text> : null}
      {item.visual ? <View style={styles.visual}>{item.visual}</View> : null}
    </>
  );
  const cardStyle = [
    dim ? styles.cardDim : styles.card,
    hot && styles.cardHot,
    style,
  ];

  if (!item.onPress) return <View style={cardStyle}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.label} ${item.value}${item.unit ?? ''}${item.sub ? `, ${item.sub}` : ''}`}
      onPress={item.onPress}
      style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const cardBase = {
  flexDirection: 'column' as const,
  minHeight: CARD_MIN_H,
  paddingHorizontal: Space.md,
  paddingVertical: Space.md,
  borderRadius: Radius.md,
  borderWidth: 1,
  borderColor: InkColors.line,
  backgroundColor: InkColors.bg,
};

const styles = StyleSheet.create({
  grid: { gap: Space.sm },
  row: { flexDirection: 'row', gap: Space.sm },
  cell: { flex: 1, minWidth: 0 },
  card: { ...cardBase, ...Elevation.e1 },
  // 초안 칸 — 아직 아무 일도 아닌 것이라 떠 보이지 않게(그림자 없음·회색 면).
  cardDim: { ...cardBase, backgroundColor: InkColors.bgSoft },
  cardHot: { borderColor: BrandColors.warnBorder, backgroundColor: BrandColors.warnSoft },
  pressed: { opacity: 0.75 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  // 라벨·단위·부제는 위치·상태 꼬리표라 본문 15sp 하한 대상이 아니다(simplicity-voice §4 '보조').
  label: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 17, fontWeight: '800', color: InkColors.ink2 },
  value: { marginTop: Space.xs, fontSize: 26, lineHeight: 31, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  unit: { fontSize: 14, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0 },
  // info 가 있을 때만 — 라벨이 자리를 다 먹지 않고 ⓘ 를 바로 옆에 붙인다.
  // ★`flex: 0` 를 쓰면 안 된다: RN 의 flex 단축은 basis 를 **0%** 로 잡아서 grow 0 과 겹치면
  //   라벨 폭이 그대로 0 이 된다 — 2026-08-27 브라우저 실측에서 '내가 만든 노하우' 글자가
  //   통째로 사라졌다(ⓘ만 남았다). 세 값을 따로 준다.
  labelShrink: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' },
  spacer: { flex: 1 },
  sub: { fontSize: 11.5, lineHeight: 16, color: InkColors.ink3 },
  visual: { marginTop: 'auto', paddingTop: Space.sm },
  hotText: { color: BrandColors.warnText },
  hotSub: { color: BrandColors.warnText, opacity: 0.8 },
});
