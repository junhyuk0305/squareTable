// 주간 근무표 뷰(직원·사장 공용) — 주 이동 네비 + 요일별 시프트 목록.
// 승인된 교대는 실제 근무자로, 진행 중 교대는 '변경 중' 배지로 표시한다.
import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  shiftsOn,
  type ShiftTemplate,
  type SwapRequest,
  type StoreConfig,
  type ResolvedShift,
} from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr } from '@/lib/utils/attendance';
import { addDays, weekDates, fmtWeekRange, fmtMd, mondayOf, WEEKDAY_LABELS } from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

export function ScheduleWeek({
  monday,
  setMonday,
  templates,
  swaps,
  staff,
  config,
  meId,
  onShiftPress,
  canPress,
}: {
  monday: string;
  setMonday: (m: string) => void;
  templates: ShiftTemplate[];
  swaps: SwapRequest[];
  staff: Junior[];
  config: StoreConfig;
  meId?: string;
  onShiftPress?: (date: string, shift: ResolvedShift) => void;
  canPress?: (date: string, shift: ResolvedShift) => boolean;
}) {
  const today = todayStr();
  const thisMonday = mondayOf(today);
  const days = useMemo(() => weekDates(monday), [monday]);
  const nameOf = (id: string) => staff.find((x) => x.id === id)?.name ?? '직원';

  return (
    <View>
      {/* 주 이동 네비 */}
      <View style={s.nav}>
        <Pressable onPress={() => setMonday(addDays(monday, -7))} hitSlop={8} style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.6 }]}>
          <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
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
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
        </Pressable>
      </View>

      {/* 요일별 카드 */}
      <View style={s.list}>
        {days.map((date) => {
          const wd = new Date(`${date}T00:00:00`).getDay();
          const closed = config.closedDays.includes(wd);
          const shifts = shiftsOn(templates, swaps, date);
          const isToday = date === today;
          return (
            <View key={date} style={[s.dayCard, isToday && s.dayCardToday]}>
              <View style={s.dayHead}>
                <Text style={[s.dayDow, wd === 0 && { color: BrandColors.bad }]}>{WEEKDAY_LABELS[wd]}</Text>
                <Text style={s.dayDate}>{fmtMd(date)}</Text>
                {isToday && <Text style={s.todayTag}>오늘</Text>}
                {closed && <Text style={s.closedTag}>정기휴무</Text>}
              </View>

              {shifts.length === 0 ? (
                <Text style={s.noShift}>{closed ? '쉬는 날' : '근무 없음'}</Text>
              ) : (
                <View style={s.shifts}>
                  {shifts.map((sh) => {
                    const mine = meId && sh.workerStaffId === meId;
                    const pressable = !!onShiftPress && (!canPress || canPress(date, sh));
                    const Comp: any = pressable ? Pressable : View;
                    return (
                      <Comp
                        key={sh.template.id}
                        onPress={pressable ? () => onShiftPress!(date, sh) : undefined}
                        style={({ pressed }: { pressed?: boolean }) => [
                          s.shiftRow,
                          mine && s.shiftRowMine,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <View style={[s.avatar, mine && s.avatarMine]}>
                          <Text style={[s.avatarText, mine && { color: '#fff' }]}>{nameOf(sh.workerStaffId).slice(0, 1)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.shiftName}>
                            {nameOf(sh.workerStaffId)}
                            {mine ? ' (나)' : ''}
                          </Text>
                          <Text style={s.shiftTime}>
                            {sh.template.start}~{sh.template.end}
                          </Text>
                        </View>
                        {sh.pending && (
                          <View style={s.pendingBadge}>
                            <Ionicons name="swap-horizontal" size={12} color={BrandColors.warn} />
                            <Text style={s.pendingText}>변경 중</Text>
                          </View>
                        )}
                        {pressable && !sh.pending && (
                          <View style={s.swapHint}>
                            <Text style={s.swapHintText}>교대요청</Text>
                            <Ionicons name="chevron-forward" size={13} color={InkColors.ink3} />
                          </View>
                        )}
                      </Comp>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, marginBottom: 12 },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  navCenter: { alignItems: 'center', gap: 2 },
  navRange: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  navThis: { fontSize: 12, fontWeight: '700', color: BrandColors.warn },
  navToday: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  list: { gap: 8 },
  dayCard: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14, paddingVertical: 12 },
  dayCardToday: { borderColor: InkColors.ink },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayDow: { fontSize: 14, fontWeight: '900', color: InkColors.ink },
  dayDate: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  todayTag: { fontSize: 10.5, fontWeight: '800', color: '#fff', backgroundColor: InkColors.ink, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.pill, overflow: 'hidden' },
  closedTag: { marginLeft: 'auto', fontSize: 11, fontWeight: '700', color: BrandColors.bad },

  noShift: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600', marginTop: 8 },
  shifts: { gap: 8, marginTop: 10 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: Radius.sm, backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line },
  shiftRowMine: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellowDeep },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center' },
  avatarMine: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  avatarText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },
  shiftName: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  shiftTime: { fontSize: 12.5, color: InkColors.ink2, fontWeight: '600', marginTop: 1 },

  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FBF1DC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.pill },
  pendingText: { fontSize: 11, fontWeight: '800', color: BrandColors.warn },
  swapHint: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  swapHintText: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink3 },
});
