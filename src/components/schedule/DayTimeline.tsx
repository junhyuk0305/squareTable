// 하루 근무 타임라인 — 매장 운영시간을 가로 축 하나로 깔고 사람마다 자기 구간을 바로 그린다.
// 시각 텍스트만 나열하면 "몇 시부터 몇 시가 비는지"가 안 읽힌다(2026-08-11 실측 피드백).
// 축을 하나로 고정해 밀도를 얻는 방식은 GutterRow와 같은 원칙이다.
//
// 표시 전용: props로 받은 비율(left·width)만 그린다 — 시간 계산은 lib/utils/schedule.ts(barSpan).
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 바 트랙 높이 — 이름 줄보다 얇아야 '이름이 주, 바는 보조'로 읽힌다. */
const TRACK_H = 10;
/** 아주 짧은 근무(30분)도 사라지지 않게 하는 최소 폭. */
const MIN_FILL = 6;

export type TimelineRow = {
  key: string;
  name: string;
  /** "07:00 ~ 13:00" */
  timeText: string;
  /** "6시간" */
  hoursText: string;
  /** 운영시간 창 안에서의 시작 위치·길이 (0~1) */
  left: number;
  width: number;
  /** 교대 요청이 걸려 있는 근무 */
  pending?: boolean;
};

export function DayTimeline({
  axis,
  rows,
  onPressRow,
}: {
  /** 축 눈금 라벨 — [개점, 중간, 마감]. */
  axis: [string, string, string];
  rows: TimelineRow[];
  onPressRow: (row: TimelineRow) => void;
}) {
  return (
    <View style={s.wrap}>
      <View style={s.axis}>
        {axis.map((label, i) => (
          <Text key={label + i} style={[s.axisText, i === 1 && s.axisMid, i === 2 && s.axisEnd]}>
            {label}
          </Text>
        ))}
      </View>

      {rows.map((r) => (
        <Pressable
          key={r.key}
          accessibilityRole="button"
          accessibilityLabel={`${r.name} ${r.timeText} 근무 고치기`}
          onPress={() => onPressRow(r)}
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
        >
          <View style={s.head}>
            <Text style={s.name} numberOfLines={1}>{r.name}</Text>
            {!!r.pending && (
              <View style={s.tag}>
                <Text style={s.tagText}>변경 중</Text>
              </View>
            )}
            <View style={s.spacer} />
            <Text style={s.time}>{r.timeText}</Text>
            <Text style={s.hours}>{r.hoursText}</Text>
          </View>
          <View style={s.track}>
            <View
              style={[
                s.fill,
                { left: `${r.left * 100}%`, width: `${r.width * 100}%` },
                r.pending && s.fillPending,
              ]}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: Space.sm },

  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { flex: 1, fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  axisMid: { textAlign: 'center' },
  axisEnd: { textAlign: 'right' },

  row: { paddingVertical: Space.sm, gap: Space.xs },
  rowPressed: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  spacer: { flex: 1 },
  name: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink, flexShrink: 1 },
  time: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  hours: { fontSize: 12, fontWeight: '700', color: InkColors.ink3, marginLeft: Space.xs },

  tag: { paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.pill, backgroundColor: BrandColors.warnSoft },
  tagText: { fontSize: 11, fontWeight: '800', color: BrandColors.warnText },

  track: { height: TRACK_H, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  // 색만으로 상태를 가르지 않는다 — '변경 중'은 위 태그 텍스트가 함께 말한다.
  fill: { position: 'absolute', top: 0, bottom: 0, minWidth: MIN_FILL, borderRadius: Radius.pill, backgroundColor: InkColors.ink },
  fillPending: { backgroundColor: BrandColors.warnSolid },
});
