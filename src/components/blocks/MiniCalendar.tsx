import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

/** 요일 머리글 — 일요일부터(국내 달력 관행). */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 날짜 칸 높이 — 손가락으로 고르는 칸이라 48dp 하한을 그대로 받는다(복잡도 §4). */
const CELL_H = 48;

/** Date → "YYYY-MM-DD"(로컬). 서버로 나가는 값이 아니라 화면이 고르는 날짜다. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 월 달력 — 날짜 하나를 직접 고른다.
 *
 * 2026-08-26에 `TaskComposerModal` 안에 있던 것을 블록으로 올렸다. 퀴즈 일정(발송일·마감일)과
 * 링크 만료일이 같은 것을 필요로 하는데, 자리마다 다시 만들면 "며칠 뒤" 칩과 달력이 섞여
 * 화면마다 날짜 고르는 법이 달라진다(블록 어휘가 갈리는 전형적인 경로다).
 *
 * ★`min`/`max` 밖의 날은 **눌리지 않는다.** 죽은 컨트롤을 만들지 않으려고 흐리게 그리고 막는다
 *   (예: 마감일은 발송일보다 빠를 수 없다 — 화면이 아니라 이 두 값이 규칙을 강제한다).
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function MiniCalendar({
  value,
  today,
  min,
  max,
  onChange,
}: {
  /** 고른 날 "YYYY-MM-DD" */
  value: string;
  /** 오늘 "YYYY-MM-DD" — 다른 달을 보고 있어도 "여기가 오늘"을 잃지 않게 표시한다. */
  today: string;
  /** 이 날 이전은 못 고른다(포함). */
  min?: string;
  /** 이 날 이후는 못 고른다(포함). */
  max?: string;
  onChange: (d: string) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date(`${value}T00:00:00`));

  /**
   * 고른 날이 **다른 달로 옮겨지면** 달력도 그 달을 편다.
   * ★부르는 쪽이 값을 밀어 줄 때가 있다(예: 보내는 날을 다음 달로 잡으면 마감일도 따라 밀린다).
   *   그때 달력이 이번 달에 남아 있으면 **전부 흐린 달**이 보인다 — 고를 수 있는 날이 화면에 없다.
   * ★이펙트가 아니라 렌더 중에 맞춘다(React 가 문서화한 "값이 바뀌면 state 를 맞춘다" 패턴).
   *   이펙트로 하면 흐린 달을 한 프레임 그린 뒤 바뀐다.
   */
  const [syncedMonth, setSyncedMonth] = useState(() => value.slice(0, 7));
  if (value.slice(0, 7) !== syncedMonth) {
    setSyncedMonth(value.slice(0, 7));
    setCursor(new Date(`${value}T00:00:00`));
  }

  const grid = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const lead = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { date: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < lead; i++) {
      const d = new Date(y, m, 1 - (lead - i));
      cells.push({ date: ymd(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: ymd(new Date(y, m, d)), day: d, inMonth: true });
    while (cells.length % 7 !== 0) {
      const last = new Date(`${cells[cells.length - 1].date}T00:00:00`);
      last.setDate(last.getDate() + 1);
      cells.push({ date: ymd(last), day: last.getDate(), inMonth: false });
    }
    return cells;
  }, [cursor]);

  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
  const shift = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  // 고를 날이 하나도 없는 달로는 넘어가지 않는다 — 넘어가 봐야 전부 흐린 달력이다.
  const canPrev = !min || grid[0].date > min;
  const canNext = !max || grid[grid.length - 1].date < max;

  return (
    <View style={st.cal}>
      <View style={st.bar}>
        <Pressable
          onPress={() => canPrev && shift(-1)}
          disabled={!canPrev}
          style={st.navBtn}
          accessibilityRole="button"
          accessibilityLabel="이전 달"
        >
          <Ionicons name="chevron-back" size={18} color={canPrev ? InkColors.ink2 : InkColors.line} />
        </Pressable>
        <Text style={st.month}>{monthLabel}</Text>
        <Pressable
          onPress={() => canNext && shift(1)}
          disabled={!canNext}
          style={st.navBtn}
          accessibilityRole="button"
          accessibilityLabel="다음 달"
        >
          <Ionicons name="chevron-forward" size={18} color={canNext ? InkColors.ink2 : InkColors.line} />
        </Pressable>
      </View>

      <View style={st.weekRow}>
        {DOW.map((w, i) => (
          <Text key={w} style={[st.weekCell, i === 0 && { color: BrandColors.badText }]}>{w}</Text>
        ))}
      </View>

      <View style={st.days}>
        {grid.map((c) => {
          const blocked = (!!min && c.date < min) || (!!max && c.date > max);
          const isSel = c.date === value;
          const isToday = c.date === today;
          return (
            <Pressable
              key={c.date}
              onPress={() => onChange(c.date)}
              disabled={blocked}
              style={[st.cell, isToday && !isSel && st.cellToday, isSel && st.cellSel]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel, disabled: blocked }}
              accessibilityLabel={`${c.date}${blocked ? ' 고를 수 없음' : ''}`}
            >
              <Text
                style={[
                  st.num,
                  !c.inMonth && st.numMute,
                  blocked && st.numBlocked,
                  isSel && { color: '#FFFFFF' },
                ]}
              >
                {c.day}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cal: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 6 },
  month: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  // ★hitSlop 이 아니라 상자로 48dp 를 만든다(RN-web 은 hitSlop 을 무시한다 — 실측 20dp 였다).
  navBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' },
  weekCell: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '800', color: InkColors.ink3, paddingVertical: 3 },
  days: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: CELL_H, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm },
  cellToday: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line },
  cellSel: { backgroundColor: InkColors.ink },
  num: { fontSize: 13, fontWeight: '600', color: InkColors.ink },
  numMute: { color: InkColors.ink3, opacity: 0.45 },
  numBlocked: { color: InkColors.ink3, opacity: 0.3 },
});
