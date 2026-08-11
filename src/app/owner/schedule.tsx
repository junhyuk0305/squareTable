import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { WeekStrip, type WeekDay } from '@/components/blocks/WeekStrip';
import { DayTimeline, type TimelineRow } from '@/components/schedule/DayTimeline';
import { ShiftQuickSheet, type ShiftEditTarget } from '@/components/schedule/ShiftQuickSheet';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore, shiftsOn, type ShiftTemplate, type SwapRequest } from '@/lib/store/useScheduleStore';
import { todayStr } from '@/lib/utils/attendance';
import {
  addDays,
  mondayOf,
  weekDates,
  weekdayOf,
  dayOfMonth,
  fmtWeekRange,
  fmtDateKo,
  fmtRange,
  fmtMinutes,
  shiftMinutes,
  hoursLabel,
  dayWindow,
  spanIn,
  closedDaysLabel,
  WEEKDAY_LABELS,
} from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 주 이동 아이콘 버튼 한 변. */
const NAV_BTN = 36;

export default function OwnerScheduleScreen() {
  const router = useRouter();
  const staff = useStaffStore((s) => s.staff);
  const config = useScheduleStore((s) => s.config);
  const templates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const approveSwap = useScheduleStore((s) => s.approveSwap);
  const rejectSwap = useScheduleStore((s) => s.rejectSwap);

  const today = todayStr();
  // 날짜 선택 UI는 주간 스트립 **하나뿐**이다. 보이는 주는 선택일에서 파생(월요일 시작 — 기존 규칙 유지).
  //   ★2026-08-11: 스트립 + 7칼럼 주간 그리드가 같이 떠서 "달력이 두 개"로 읽혔다(실측 피드백).
  //     누가 언제 나오는지는 아래 하루 타임라인이 바로 보여주므로 그리드는 뺐다.
  const [selected, setSelected] = useState(() => today);
  // 근무 추가·고치기 시트. null이면 닫힘.
  const [sheet, setSheet] = useState<null | { edit?: ShiftEditTarget }>(null);
  const monday = useMemo(() => mondayOf(selected), [selected]);

  const nameOf = (id: string) => staff.find((x) => x.id === id)?.name ?? '직원';
  const tplById = (id: string) => templates.find((t) => t.id === id);

  // 사장 컨펌 대기(직원이 수락 완료한) 요청. 이미 지난 날짜는 컨펌 의미가 없어 제외.
  const pending = useMemo(
    () => swaps.filter((r) => r.status === 'accepted' && r.date >= today),
    [swaps, today],
  );

  // 점은 "그날 근무가 있다"만 뜻한다 — 건수는 표시하지 않는다(그룹 헤더 합계와 이중 계산이 된다).
  const days: WeekDay[] = useMemo(
    () =>
      weekDates(monday).map((d) => {
        const wd = weekdayOf(d);
        return {
          key: d,
          dow: WEEKDAY_LABELS[wd],
          date: String(dayOfMonth(d)).padStart(2, '0'),
          hasEvent: shiftsOn(templates, swaps, d).length > 0,
          dimmed: config.closedDays.includes(wd),
        };
      }),
    [monday, templates, swaps, config.closedDays],
  );

  const dayShifts = useMemo(() => shiftsOn(templates, swaps, selected), [templates, swaps, selected]);
  const totalMin = useMemo(
    () => dayShifts.reduce((sum, sh) => sum + shiftMinutes(sh.template.start, sh.template.end), 0),
    [dayShifts],
  );
  const closedToday = config.closedDays.includes(weekdayOf(selected));

  // 하루 타임라인 행 — 운영시간 축 위에서 각자 차지하는 구간을 비율로 미리 계산해 넘긴다
  // (DayTimeline은 표시 전용이라 시간 계산을 하지 않는다).
  // 축이 덮는 시간 창 — 운영시간 + 그날 실제 근무(운영시간 밖 근무도 온전히 보이게).
  const win = useMemo(
    () => dayWindow(dayShifts.map((sh) => sh.template), config.open, config.close),
    [dayShifts, config.open, config.close],
  );

  const timeline: (TimelineRow & { edit: ShiftEditTarget })[] = useMemo(
    () =>
      dayShifts.map((sh) => {
        const { start, end } = sh.template;
        const span = spanIn(win, start, end, config.open, config.close);
        // nameOf 를 쓰지 않고 여기서 직접 찾는다 — 렌더마다 새로 만들어지는 클로저를
        // useMemo 가 잡으면 staff 가 늦게 도착했을 때 '직원' 폴백이 굳는다.
        const name = staff.find((x) => x.id === sh.workerStaffId)?.name ?? '직원';
        return {
          key: sh.template.id,
          name,
          timeText: fmtRange(start, end),
          hoursText: hoursLabel(shiftMinutes(start, end)),
          left: span.left,
          width: span.width,
          pending: sh.pending,
          edit: {
            templateId: sh.template.id,
            name,
            weekday: sh.template.weekday,
            date: sh.template.date,
            start,
            end,
          },
        };
      }),
    [dayShifts, staff, win, config.open, config.close],
  );

  // 그날 쉬는 사람은 행으로 늘어놓지 않는다 — 바가 없는 빈 행이 절반이면 타임라인이 안 읽힌다.
  const offNames = useMemo(() => {
    const busy = new Set(dayShifts.map((sh) => sh.workerStaffId));
    return staff.filter((st) => !busy.has(st.id)).map((st) => st.name);
  }, [dayShifts, staff]);

  // 축 눈금 3개 — 운영시간이 아니라 **창** 기준이다(운영시간 밖 근무가 있으면 창이 그만큼 넓어진다).
  const axis: [string, string, string] = useMemo(
    () => [fmtMinutes(win.from), fmtMinutes(Math.round((win.from + win.to) / 2)), fmtMinutes(win.to)],
    [win],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '근무표' }} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ① 주간 날짜 스트립 — 하루 이동을 이 화면 안에서 끝낸다 */}
        <Appear delay={0}>
        <View style={styles.section}>
          <View style={styles.weekNav}>
            <Pressable
              onPress={() => setSelected(addDays(selected, -7))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="지난 주"
              style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="chevron-back" size={18} color={InkColors.ink2} />
            </Pressable>
            <View style={styles.weekNavCenter}>
              <Text style={styles.weekRange}>{fmtWeekRange(monday)}</Text>
              {selected !== today && (
                <Pressable onPress={() => setSelected(today)} hitSlop={6} accessibilityRole="button">
                  <Text style={styles.todayText}>오늘로</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => setSelected(addDays(selected, 7))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="다음 주"
              style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="chevron-forward" size={18} color={InkColors.ink2} />
            </Pressable>
          </View>
          <WeekStrip days={days} selectedKey={selected} todayKey={today} onSelect={setSelected} />
        </View>
        </Appear>

        {/* ② 컨펌 대기 — 사장의 핵심 액션. 제목은 카드 밖, 대기 건수는 우측 뱃지 */}
        <Appear delay={60}>
        <View style={styles.section}>
          <SectionLabel
            icon="swap-horizontal-outline"
            title="교대 승인"
            trailing={
              pending.length > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pending.length}</Text>
                </View>
              ) : undefined
            }
          />
          {pending.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="checkmark-done-outline" size={20} color={InkColors.ink3} />
              <Text style={styles.emptyText}>승인할 교대 요청이 없어요.{'\n'}직원이 서로 합의하면 여기로 올라와요.</Text>
            </View>
          ) : (
            <View style={{ gap: Space.sm }}>
              {pending.map((r) => (
                <PendingCard
                  key={r.id}
                  r={r}
                  nameOf={nameOf}
                  tplById={tplById}
                  onApprove={() => approveSwap(r.id)}
                  onReject={() => rejectSwap(r.id)}
                />
              ))}
            </View>
          )}
        </View>
        </Appear>

        {/* ③ 하루 근무 — 운영시간 축 하나 위에 사람마다 바. 추가는 이 카드 안에서 끝낸다 */}
        <Appear delay={120}>
        <View style={styles.section}>
          <SectionLabel
            title={fmtDateKo(selected)}
            trailing={
              <Text style={styles.total}>
                {closedToday ? '정기 휴무' : totalMin > 0 ? hoursLabel(totalMin) : '근무 없음'}
              </Text>
            }
          />
          {staff.length === 0 ? (
            /* "직원 관리로 가세요"라고 쓰고 이동을 안 주면 사장이 메뉴를 찾아 헤맨다(복잡도 원칙 P6). */
            <EmptyState
              title="합류한 직원이 없어요"
              body="먼저 직원을 초대하면 근무 시간을 넣을 수 있어요."
              cta={{ label: '직원 초대하기', onPress: () => router.push('/owner/staff') }}
            />
          ) : (
            <View style={styles.dayCard}>
              {timeline.length > 0 ? (
                <DayTimeline axis={axis} rows={timeline} onPressRow={(r) => {
                  const hit = timeline.find((t) => t.key === r.key);
                  if (hit) setSheet({ edit: hit.edit });
                }} />
              ) : (
                <Text style={styles.dayNone}>이 날은 근무가 없어요.</Text>
              )}

              {offNames.length > 0 && <Text style={styles.offText}>휴무 · {offNames.join(', ')}</Text>}

              {/* 근무 추가 — 예전엔 목록 행을 눌러야 편집이 열려서 "추가하는 법"이 안 보였다. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${fmtDateKo(selected)}에 근무 추가`}
                onPress={() => setSheet({})}
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="add" size={18} color={InkColors.ink} />
                <Text style={styles.addText}>근무 추가</Text>
              </Pressable>
            </View>
          )}
        </View>
        </Appear>

        {/* ④ 가게 기본 정보 */}
        <Appear delay={160}>
        <Pressable
          onPress={() => router.push('/owner/store-config')}
          style={({ pressed }) => [styles.infoCard, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.infoIcon}>
            <Ionicons name="storefront-outline" size={18} color={InkColors.ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>매장 기본 정보</Text>
            <Text style={styles.infoSub}>
              운영 {config.open}~{config.close} · 휴무 {closedDaysLabel(config.closedDays)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
        </Pressable>
        </Appear>

        <View style={{ height: Space.md }} />
      </ScrollView>

      {sheet && (
        <ShiftQuickSheet
          date={selected}
          weekday={weekdayOf(selected)}
          staff={staff}
          editing={sheet.edit}
          onClose={() => setSheet(null)}
        />
      )}

      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function PendingCard({
  r,
  nameOf,
  tplById,
  onApprove,
  onReject,
}: {
  r: SwapRequest;
  nameOf: (id: string) => string;
  tplById: (id: string) => ShiftTemplate | undefined;
  onApprove: () => void;
  onReject: () => void;
}) {
  const tpl = tplById(r.template_id);
  const tTpl = r.target_template_id ? tplById(r.target_template_id) : undefined;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindTag, r.kind === 'swap' && styles.kindTagSwap]}>
          <Text style={[styles.kindTagText, r.kind === 'swap' && { color: InkColors.bubbleText }]}>
            {r.kind === 'cover' ? '대타' : '맞교환'}
          </Text>
        </View>
        <Text style={styles.cardWait}>승인 대기</Text>
      </View>

      {/* 누가 빠지고 누가 들어오는지 */}
      <View style={styles.flow}>
        <View style={styles.flowCol}>
          <Text style={styles.flowLabel}>빠짐</Text>
          <Text style={styles.flowName}>{nameOf(r.requester_id)}</Text>
          <Text style={styles.flowWhen}>
            {fmtDateKo(r.date)}
            {'\n'}
            {tpl ? fmtRange(tpl.start, tpl.end) : ''}
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color={InkColors.ink3} />
        <View style={styles.flowCol}>
          <Text style={styles.flowLabel}>들어옴</Text>
          <Text style={styles.flowName}>{r.accepted_by ? nameOf(r.accepted_by) : '—'}</Text>
          <Text style={styles.flowWhen}>
            {r.kind === 'swap' && r.target_date ? fmtDateKo(r.target_date) : '같은 시간 대타'}
            {r.kind === 'swap' && tTpl ? `\n${fmtRange(tTpl.start, tTpl.end)}` : ''}
          </Text>
        </View>
      </View>

      {!!r.note && <Text style={styles.cardNote}>“{r.note}”</Text>}

      <View style={styles.actions}>
        <Pressable onPress={onReject} accessibilityRole="button" accessibilityLabel="교대 요청 반려" style={({ pressed }) => [styles.actBtn, styles.rejectBtn, pressed && { opacity: 0.8 }]}>
          <Text style={styles.rejectText}>반려</Text>
        </Pressable>
        <Pressable onPress={onApprove} accessibilityRole="button" accessibilityLabel="교대 요청 승인" style={({ pressed }) => [styles.actBtn, styles.approveBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="checkmark" size={16} color={InkColors.bubbleText} />
          <Text style={styles.approveText}>승인</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.lg },
  section: { gap: Space.sm },

  badge: { minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '900', color: InkColors.bubbleText },

  emptyBox: { alignItems: 'center', gap: Space.sm, paddingVertical: Space.xl, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line },
  emptyText: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', lineHeight: 22 },

  // 주 이동 네비 — 스트립 위 한 줄
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: NAV_BTN, height: NAV_BTN, alignItems: 'center', justifyContent: 'center' },
  weekNavCenter: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  weekRange: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  todayText: { fontSize: 12, fontWeight: '800', color: BrandColors.warnText },

  // 하루 타임라인
  total: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  dayCard: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: Space.md, ...Elevation.e1 },
  dayNone: { fontSize: 15, lineHeight: 21, color: InkColors.ink2, textAlign: 'center', paddingVertical: Space.lg },
  offText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3, paddingTop: Space.sm },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: 48, marginTop: Space.sm, borderRadius: Radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: InkColors.line },
  addText: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },

  // 컨펌 카드
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.yellowDeep, padding: Space.md, gap: Space.sm, ...Elevation.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  kindTag: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  kindTagSwap: { backgroundColor: InkColors.ink },
  kindTagText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  cardWait: { fontSize: 11.5, fontWeight: '800', color: BrandColors.warnText },

  flow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  flowCol: { flex: 1, gap: 2 },
  flowLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  flowName: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  flowWhen: { fontSize: 12, color: InkColors.ink2, lineHeight: 17, fontWeight: '700' },
  cardNote: { fontSize: 15, color: InkColors.ink2, fontStyle: 'italic', backgroundColor: InkColors.cream, borderRadius: Radius.sm, paddingHorizontal: Space.sm, paddingVertical: Space.sm },

  actions: { flexDirection: 'row', gap: Space.sm },
  actBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, paddingVertical: Space.md, borderRadius: Radius.md },
  rejectBtn: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  rejectText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  approveBtn: { backgroundColor: InkColors.ink },
  approveText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },

  // 가게 정보
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: Space.md, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: Space.md, ...Elevation.e1 },
  infoIcon: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  infoSub: { fontSize: 12.5, color: InkColors.ink3, marginTop: 2, fontWeight: '700' },
});
