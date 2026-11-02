// 주간 근무표 뷰(직원 근무표) — 주 이동 네비 + 요일 띠(WeekStrip) + 고른 날 근무자 목록.
// 2026-11-02 사용자 승인 시안(근무표시안_누르는영역 1부): 7칸 격자에 이름·시간을 다 넣으면 시간이 "7:30-…"로 잘렸다.
// 요일 띠에는 날짜와 노랑 점(내 근무 있는 날)만 두고, 고른 날의 근무자를 아래 카드에 줄로 세운다.
// 승인된 교대는 실제 근무자로, 진행 중 교대는 줄의 점(•) + "변경 중(교대 진행)" 으로 표시한다.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  shiftsOn,
  type ShiftTemplate,
  type SwapRequest,
  type StoreConfig,
  type ResolvedShift,
  type ShiftException,
} from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr } from '@/lib/utils/attendance';
import {
  addDays,
  weekDates,
  fmtWeekRange,
  fmtMd,
  mondayOf,
  weekdayOf,
  dayOfMonth,
  WEEKDAY_LABELS,
} from '@/lib/utils/schedule';
import { WeekStrip, type WeekDay } from '@/components/blocks/WeekStrip';
import { SectionLabel } from '@/components/SectionLabel';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { ButtonStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { BadgeStyles } from '@/lib/theme/badge';

export function ScheduleWeek({
  monday,
  setMonday,
  templates,
  swaps,
  exceptions,
  staff,
  config,
  meId,
  onShiftPress,
  canPress,
  hideNav,
}: {
  monday: string;
  setMonday: (m: string) => void;
  templates: ShiftTemplate[];
  swaps: SwapRequest[];
  /** 그날 빠진 반복 근무(0178). 안 넘기면 교대로 옮긴 날의 근무가 **두 벌**로 보인다. */
  exceptions: ShiftException[];
  staff: Junior[];
  config: StoreConfig;
  meId?: string;
  onShiftPress?: (date: string, shift: ResolvedShift) => void;
  canPress?: (date: string, shift: ResolvedShift) => boolean;
  /** 주 이동 네비를 숨긴다 — 바깥에 이미 주 이동 컨트롤이 있는 화면에서 중복을 막는다. */
  hideNav?: boolean;
}) {
  const today = todayStr();
  const thisMonday = mondayOf(today);
  const days = useMemo(() => weekDates(monday), [monday]);
  const nameOf = (id: string) => staff.find((x) => x.id === id)?.name ?? '직원';

  // 고른 날. 처음엔 오늘(이번 주가 아니면 그 주 첫날). 주를 넘기면 같은 요일로 따라간다(goWeek).
  // 바깥에서 monday 만 바뀌어도 고른 날이 그 주 밖에 남지 않게 그릴 때 한 번 더 맞춘다.
  const [picked, setPicked] = useState(() => (weekDates(monday).includes(today) ? today : monday));
  const selected = days.includes(picked) ? picked : days.includes(today) ? today : monday;

  const goWeek = (delta: number) => {
    setMonday(addDays(monday, 7 * delta));
    setPicked(addDays(selected, 7 * delta));
  };
  const goToday = () => {
    setMonday(thisMonday);
    setPicked(today);
  };

  // 점 = 그날 내 근무가 있다(개수 아님 · WeekStrip 규칙).
  const strip: WeekDay[] = useMemo(
    () =>
      days.map((d) => {
        const wd = weekdayOf(d);
        const off = config.closedDays.includes(wd);
        return {
          key: d,
          dow: WEEKDAY_LABELS[wd],
          date: String(dayOfMonth(d)),
          // 휴무일은 목록이 비므로 점도 끈다 — 점과 목록이 서로 다른 말을 하지 않게.
          hasEvent: !off && !!meId && shiftsOn(templates, swaps, d, exceptions).some((sh) => sh.workerStaffId === meId),
          dimmed: off,
          sunday: wd === 0,
        };
      }),
    [days, templates, swaps, exceptions, meId, config.closedDays],
  );

  const wd = weekdayOf(selected);
  const closed = config.closedDays.includes(wd);
  const shifts = closed ? [] : shiftsOn(templates, swaps, selected, exceptions);
  const workers = new Set(shifts.map((sh) => sh.workerStaffId)).size;

  const renderRow = (sh: ResolvedShift, i: number) => {
    const mine = !!meId && sh.workerStaffId === meId;
    const pressable = !!onShiftPress && (!canPress || canPress(selected, sh));
    const name = nameOf(sh.workerStaffId);
    const time = `${sh.template.start}–${sh.template.end}`;
    const body = (
      <>
        <View style={[s.bar, mine && s.barMine]} />
        <View style={s.rowMain}>
          <View style={s.nameLine}>
            <Text numberOfLines={1} style={s.name}>{name}</Text>
            {mine && (
              <View style={s.meTag}>
                <Text style={s.meTagText}>나</Text>
              </View>
            )}
          </View>
          {sh.pending && (
            <View style={s.pendingLine}>
              <View style={s.dot} />
              <Text style={s.pendingText}>변경 중(교대 진행)</Text>
            </View>
          )}
        </View>
        <Text style={s.time}>{time}</Text>
      </>
    );
    // View 에는 함수 style 을 주지 않는다 — RN 은 그 style 을 버린다.
    return pressable ? (
      <Pressable
        key={sh.template.id}
        onPress={() => onShiftPress!(selected, sh)}
        accessibilityRole="button"
        accessibilityLabel={`${name} ${time} 근무`}
        style={({ pressed }) => [s.row, i > 0 && s.rowDivider, pressed && { opacity: 0.7 }]}
      >
        {body}
      </Pressable>
    ) : (
      <View key={sh.template.id} style={[s.row, i > 0 && s.rowDivider]}>
        {body}
      </View>
    );
  };

  return (
    <View style={s.wrap}>
      <View>
        {/* 주 이동 네비 */}
        {!hideNav && (
          <View style={s.nav}>
            <Pressable onPress={() => goWeek(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="지난 주" style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.6 }]}>
              <View style={s.navCircle}>
                <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
              </View>
            </Pressable>
            <View style={s.navCenter}>
              <Text style={s.navRange}>{fmtWeekRange(monday)}</Text>
              {monday === thisMonday ? (
                <Text style={s.navThis}>이번 주</Text>
              ) : (
                <Pressable onPress={goToday} accessibilityRole="button" style={({ pressed }) => [s.todayHit, pressed && { opacity: 0.6 }]}>
                  <Text style={s.navToday}>오늘로</Text>
                </Pressable>
              )}
            </View>
            <Pressable onPress={() => goWeek(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="다음 주" style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.6 }]}>
              <View style={s.navCircle}>
                <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
              </View>
            </Pressable>
          </View>
        )}

        <WeekStrip days={strip} selectedKey={selected} todayKey={today} onSelect={setPicked} dotTone="yellow" />
      </View>

      {/* 고른 날 근무자 — 내 줄 = 노랑 막대 + "나". 근무가 없는 날은 아무것도 띄우지 않는다
          ("휴무" 문구 금지 · 2026-11-02 사용자 결정 — 정기 휴무가 아닌 빈 날까지 휴무로 읽혔다). */}
      {shifts.length > 0 && (
        <View style={s.section}>
          <SectionLabel title={`${WEEKDAY_LABELS[wd]}요일 ${fmtMd(selected)}`} hint={`${workers}명 근무`} />
          <View style={CardStyles.rows}>{shifts.map(renderRow)}</View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // 요일 띠 묶음 ↔ 그날 목록 = 묶음 사이.
  wrap: { gap: Gap.group },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, marginBottom: 12 },
  // 주 이동 = 흰 원 버튼(ButtonStyles.iconCircle · 2026-11-02 결정). 누르는 상자 48(RN-web 은 hitSlop 을 무시한다).
  navBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  navCircle: { ...ButtonStyles.iconCircle },
  navCenter: { alignItems: 'center', gap: 2 },
  navRange: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  navThis: { ...Type.tag, fontWeight: '700', color: BrandColors.warnText },
  navToday: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
  // 글자 링크 = 누르는 높이 44(2026-11-02 누르는 영역 기준). RN-web 은 hitSlop 을 무시해 상자로 키운다.
  //   위아래 음수 margin 으로 상자만 넓히고 줄 높이는 그대로 둔다(글자 줄 ≈ 18).
  todayHit: { minHeight: 44, minWidth: 64, marginVertical: -13, alignItems: 'center', justifyContent: 'center' },

  // 제목 ↔ 카드 10(SectionLabel 아래 2 + 8).
  section: { gap: Space.sm },

  // 근무자 줄 — 누르는 상자 48 이상.
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: Radius.pill, backgroundColor: InkColors.line },
  barMine: { backgroundColor: BrandColors.yellow },
  rowMain: { flex: 1, minWidth: 0, gap: Gap.inline },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  name: { ...Type.body, flexShrink: 1, fontWeight: '700' },
  meTag: { ...BadgeStyles.box, backgroundColor: BrandColors.yellow },
  meTagText: { ...BadgeStyles.text, color: InkColors.ink },
  pendingLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BrandColors.warn },
  pendingText: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
  // 시간은 잘리지 않는다 — 줄어드는 쪽은 이름.
  time: { ...Type.body, flexShrink: 0, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
