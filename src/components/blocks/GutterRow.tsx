import { View, Text, StyleSheet } from 'react-native';

import { BrandColors, CategoryColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 시각 거터 고정폭 — 이 폭이 곧 "눈이 따라가는 축"이다. */
const GUTTER_WIDTH = 52;
/** 종류 구분 컬러바 두께. */
const BAR_WIDTH = 3;

/** 컬러바 = 종류. 색 단독 판정이 아니라 부제 텍스트와 병기해서 쓴다. */
export type GutterTone = 'routine' | 'knowhow' | 'event';

const TONE: Record<GutterTone, string> = {
  routine: CategoryColors.Routine,
  knowhow: CategoryColors['Know-how'],
  event: CategoryColors.Event,
};

/**
 * D4 · 좌측 거터 행 — 시각을 전부 왼쪽 고정폭으로 몰아 눈이 따라갈 축을 하나로 만든다.
 *
 * 밀도는 폰트를 줄여서가 아니라 **축을 하나로 고정해서** 얻는다(시프티·7shifts 실측).
 * 시각이 없는 행은 timeStart에 `—`, timeEnd에 `휴무`를 넣어 표현한다.
 *
 * 한 행만 그린다 — 목록 컨테이너(흰 카드)는 호출부가 만든다.
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function GutterRow({
  timeStart,
  timeEnd,
  tone,
  title,
  subtitle,
  tag,
  last = false,
}: {
  timeStart: string;
  timeEnd?: string;
  tone: GutterTone;
  title: string;
  subtitle?: string;
  /** 우측 상태 태그 — 예: "근무 중" */
  tag?: string;
  /** 목록의 마지막 행이면 아래 구분선을 지운다. */
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.time}>
        <Text style={styles.timeStart}>{timeStart}</Text>
        {!!timeEnd && <Text style={styles.timeEnd}>{timeEnd}</Text>}
      </View>
      <View style={[styles.bar, { backgroundColor: TONE[tone] }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {!!tag && (
        <View style={styles.tag}>
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Space.md,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  time: { width: GUTTER_WIDTH, flexShrink: 0, alignItems: 'flex-end' },
  timeStart: { fontSize: 12, lineHeight: 17, fontWeight: '700', color: InkColors.ink2 },
  timeEnd: { fontSize: 12, lineHeight: 17, fontWeight: '400', color: InkColors.ink2 },
  // height를 주지 않는다 — 행 높이만큼 늘어나야 시각 축과 종류 축이 같이 읽힌다.
  bar: { width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2, flexShrink: 0, alignSelf: 'stretch' },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: InkColors.ink },
  subtitle: { fontSize: 12, lineHeight: 17, color: InkColors.ink2, marginTop: 2 },
  tag: {
    alignSelf: 'center',
    flexShrink: 0,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
  },
  tagText: { fontSize: 11, fontWeight: '800', color: BrandColors.warnText },
});
