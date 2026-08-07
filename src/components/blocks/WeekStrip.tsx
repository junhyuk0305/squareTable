import { View, Text, Pressable, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 점 지름 — "그날 뭔가 있다"만 뜻하는 표식이라 작게. */
const DOT = 4;

export type WeekDay = {
  key: string;
  /** 요일 한 글자 — 월·화·수… */
  dow: string;
  /** 일자 — "06" */
  date: string;
  /** 그날 뭔가 있는가. ★개수를 넘기지 않는다 — 숫자를 두 번 세게 된다. */
  hasEvent?: boolean;
  /** 흐리게(휴무·지난 날) */
  dimmed?: boolean;
};

/**
 * D9 · 주간 날짜 스트립 — 요일 7칸. 선택된 날은 검정 알약.
 *
 * Homebase · 7shifts · Delightree · 시프티 4개가 전부 똑같이 쓰고 있었다.
 * 시장 표준이라 우리식으로 새로 만들 이유가 없다(2026-08-05 실측).
 *
 * ★ 점은 "그날 뭔가 있다"만 뜻한다 — 개수 표기 금지.
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function WeekStrip({
  days,
  selectedKey,
  todayKey,
  onSelect,
}: {
  days: WeekDay[];
  selectedKey: string;
  /** 오늘의 key — 다른 날을 골라 놨을 때 "여기가 오늘"을 잃지 않게 옅은 면으로 표시한다. */
  todayKey?: string;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.strip}>
      {days.map((d) => {
        const on = d.key === selectedKey;
        const isToday = !!todayKey && d.key === todayKey;
        return (
          <Pressable
            key={d.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${isToday ? '오늘 ' : ''}${d.dow}요일 ${d.date}일${d.hasEvent ? ' · 일정 있음' : ''}`}
            onPress={() => onSelect(d.key)}
            style={({ pressed }) => [
              styles.cell,
              isToday && !on && styles.cellToday,
              on && styles.cellOn,
              d.dimmed && !on && styles.cellDim,
              pressed && !on && styles.pressed,
            ]}
          >
            <Text style={[styles.dow, on && styles.dowOn]}>{d.dow}</Text>
            <Text style={[styles.date, on && styles.dateOn]}>{d.date}</Text>
            <View style={[styles.dot, d.hasEvent ? on && styles.dotOn : styles.dotHidden]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: Space.xs,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.sm,
    padding: Space.xs,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
    minHeight: 48,
  },
  cellOn: { backgroundColor: InkColors.ink },
  // 오늘 ≠ 선택일. 색이 아니라 면의 세기로 구분한다 — 점(일정 있음)과 뜻이 겹치면 안 된다.
  cellToday: { backgroundColor: InkColors.bgSoft },
  cellDim: { opacity: 0.45 },
  pressed: { backgroundColor: InkColors.bgSoft },
  dow: { fontSize: 10, fontWeight: '700', color: InkColors.ink2 },
  dowOn: { color: InkColors.bubbleText, opacity: 0.6 },
  date: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  dateOn: { color: InkColors.bubbleText },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    marginTop: 2,
    backgroundColor: BrandColors.mention,
  },
  dotOn: { backgroundColor: BrandColors.yellow },
  // 자리는 남기고 색만 뺀다 — 점 유무로 행 높이가 흔들리면 스트립이 들썩인다.
  dotHidden: { backgroundColor: 'transparent' },
});
