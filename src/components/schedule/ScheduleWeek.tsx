// 주간 근무표 뷰(직원·사장 공용) — 주 이동 네비 + 요일(월~일) 7칼럼 그리드.
// 시간표처럼 한 주를 한눈에 본다. 각 칸엔 그날 근무자 칩이 시간순으로 쌓인다.
// 승인된 교대는 실제 근무자로, 진행 중 교대는 칩 우상단 점(•)으로 표시한다.
import { useMemo } from 'react';
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
  mondayOf,
  weekdayOf,
  dayOfMonth,
  compactRange,
  WEEKDAY_LABELS,
} from '@/lib/utils/schedule';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Type } from '@/lib/theme/type';
import { ButtonStyles } from '@/lib/theme/button';

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
  /** 주 이동 네비를 숨긴다 — 바깥에 이미 주 이동 컨트롤이 있는 화면(사장 근무표)에서 중복을 막는다. */
  hideNav?: boolean;
}) {
  const today = todayStr();
  const thisMonday = mondayOf(today);
  const days = useMemo(() => weekDates(monday), [monday]);
  const nameOf = (id: string) => staff.find((x) => x.id === id)?.name ?? '직원';

  // 이번 주에 진행 중(변경 중) 교대가 하나라도 있으면 범례에 점을 노출.
  const hasPending = useMemo(
    () => days.some((d) => shiftsOn(templates, swaps, d, exceptions).some((sh) => sh.pending)),
    [days, templates, swaps, exceptions],
  );

  return (
    <View>
      {/* 주 이동 네비 */}
      {!hideNav && (
        <View style={s.nav}>
          <Pressable onPress={() => setMonday(addDays(monday, -7))} hitSlop={8} style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.6 }]}>
            <View style={s.navCircle}>
              <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
            </View>
          </Pressable>
          <View style={s.navCenter}>
            <Text style={s.navRange}>{fmtWeekRange(monday)}</Text>
            {monday === thisMonday ? (
              <Text style={s.navThis}>이번 주</Text>
            ) : (
              <Pressable onPress={() => setMonday(thisMonday)} hitSlop={6}>
                <Text style={s.navToday}>오늘로</Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => setMonday(addDays(monday, 7))} hitSlop={8} style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.6 }]}>
            <View style={s.navCircle}>
              <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
            </View>
          </Pressable>
        </View>
      )}

      {/* 요일 7칼럼 그리드 */}
      <View style={s.grid}>
        {days.map((date) => {
          const wd = weekdayOf(date);
          const closed = config.closedDays.includes(wd);
          const shifts = shiftsOn(templates, swaps, date, exceptions);
          const isToday = date === today;
          const isSun = wd === 0;
          return (
            <View key={date} style={[s.col, isToday && s.colToday]}>
              <View style={[s.colHead, isToday && s.colHeadToday]}>
                <Text style={[s.colDow, isSun && s.sun, isToday && s.headTextToday]}>{WEEKDAY_LABELS[wd]}</Text>
                <Text style={[s.colDate, isToday && s.headTextToday]}>{dayOfMonth(date)}</Text>
              </View>

              <View style={s.colBody}>
                {closed ? (
                  <Text style={s.rest}>휴무</Text>
                ) : shifts.length === 0 ? (
                  <Text style={s.none}>·</Text>
                ) : (
                  shifts.map((sh) => {
                    const mine = !!meId && sh.workerStaffId === meId;
                    const pressable = !!onShiftPress && (!canPress || canPress(date, sh));
                    const Comp: any = pressable ? Pressable : View;
                    return (
                      <Comp
                        key={sh.template.id}
                        onPress={pressable ? () => onShiftPress!(date, sh) : undefined}
                        style={({ pressed }: { pressed?: boolean }) => [
                          s.chip,
                          mine && s.chipMine,
                          sh.pending && s.chipPending,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text numberOfLines={1} style={s.chipName}>
                          {nameOf(sh.workerStaffId)}
                        </Text>
                        <Text numberOfLines={1} style={[s.chipTime, mine && s.chipTimeMine]}>
                          {compactRange(sh.template.start, sh.template.end)}
                        </Text>
                        {sh.pending && <View style={s.dot} />}
                      </Comp>
                    );
                  })
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* 범례 */}
      <View style={s.legend}>
        {!!meId && (
          <View style={s.legItem}>
            <View style={[s.legSwatch, { backgroundColor: BrandColors.yellow }]} />
            <Text style={s.legText}>내 근무</Text>
          </View>
        )}
        {hasPending && (
          <View style={s.legItem}>
            <View style={s.legDot} />
            <Text style={s.legText}>변경 중(교대 진행)</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, marginBottom: 12 },
  // 주 이동 = 흰 원 버튼(ButtonStyles.iconCircle · 2026-11-02 결정). 누르는 상자 48(RN-web 은 hitSlop 을 무시한다).
  navBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  navCircle: { ...ButtonStyles.iconCircle },
  navCenter: { alignItems: 'center', gap: 2 },
  navRange: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  navThis: { ...Type.tag, fontWeight: '700', color: BrandColors.warnText },
  navToday: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },

  // 7칼럼 그리드
  grid: { flexDirection: 'row', gap: 3, alignItems: 'flex-start' },
  col: { flex: 1, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, overflow: 'hidden' },
  colToday: { borderColor: InkColors.ink },

  colHead: { alignItems: 'center', paddingVertical: 5, gap: 1, backgroundColor: InkColors.cream, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  colHeadToday: { backgroundColor: InkColors.ink, borderBottomColor: InkColors.ink },
  // 요일·휴무·칩 글자 = Type.micro(11). 9·10·10.5 를 쓰지 않는다(2026-11-02 2차 결정).
  colDow: { ...Type.micro, fontWeight: '800', color: TextColor.secondary },
  colDate: { fontSize: 13, fontWeight: '900', color: InkColors.ink },
  sun: { color: BrandColors.badText },
  headTextToday: { color: InkColors.bubbleText },

  colBody: { padding: 3, gap: 3, minHeight: 44 },
  rest: { ...Type.micro, fontWeight: '700', color: TextColor.secondary, textAlign: 'center', paddingVertical: 8 },
  none: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', paddingVertical: 8 },

  chip: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm, paddingVertical: 4, paddingHorizontal: 3, alignItems: 'center', gap: 1 },
  chipMine: { backgroundColor: BrandColors.yellow },
  chipPending: { borderWidth: 1, borderColor: BrandColors.warn },
  chipName: { ...Type.micro, fontWeight: '800', color: InkColors.ink, textAlign: 'center' },
  // 예외: 칩 시간만 10. 7칸 격자 한 칸 안쪽이 약 44px 라 11 이면 "7:30-16" 이 말줄임으로 잘린다(2026-11-02 캡처 확인).
  chipTime: { fontSize: 10, fontWeight: '700', color: TextColor.secondary, textAlign: 'center' },
  chipTimeMine: { color: InkColors.ink },
  dot: { position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: BrandColors.warn },

  legend: { flexDirection: 'row', gap: 14, marginTop: 10, paddingHorizontal: 2 },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legSwatch: { width: 12, height: 12, borderRadius: 4 },
  legDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BrandColors.warn },
  legText: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
});
