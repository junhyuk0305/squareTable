import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { WeekStrip, type WeekDay } from '@/components/blocks/WeekStrip';
import { GutterRow } from '@/components/blocks/GutterRow';
import { ShiftEditorModal } from '@/components/schedule/ShiftEditorModal';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore, shiftsOn, type ShiftTemplate, type SwapRequest } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr } from '@/lib/utils/attendance';
import {
  addDays,
  mondayOf,
  weekDates,
  weekdayOf,
  dayOfMonth,
  fmtWeekRange,
  fmtDateKo,
  closedDaysLabel,
  WEEKDAY_LABELS,
} from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 주 이동 아이콘 버튼 한 변. */
const NAV_BTN = 36;
/** 자정을 넘기는 근무(22:00~02:00)를 음수로 만들지 않기 위한 하루 분(分). */
const MINUTES_PER_DAY = 1440;

function shiftMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff < 0 ? diff + MINUTES_PER_DAY : diff;
}

function hoursLabel(min: number): string {
  return `${Math.round((min / 60) * 10) / 10}시간`;
}

/** 하루 목록의 한 줄 — 그날 근무하는 사람은 시각, 아닌 사람은 휴무로 같은 목록에 들어간다. */
type DayRow = {
  key: string;
  staff?: Junior;
  name: string;
  start: string;
  end: string;
  working: boolean;
  pending: boolean;
  subtitle: string;
};

export default function OwnerScheduleScreen() {
  const router = useRouter();
  const staff = useStaffStore((s) => s.staff);
  const config = useScheduleStore((s) => s.config);
  const templates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const approveSwap = useScheduleStore((s) => s.approveSwap);
  const rejectSwap = useScheduleStore((s) => s.rejectSwap);

  const today = todayStr();
  // 날짜 선택 UI는 주간 스트립 하나. 보이는 주는 선택일에서 파생된다(월요일 시작 — 기존 규칙 유지).
  const [selected, setSelected] = useState(() => today);
  const [editStaff, setEditStaff] = useState<Junior | null>(null);
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

  // 근무자 + 그날 쉬는 직원을 한 목록으로 합친다(예전 '직원 근무표'/'전체 근무표' 두 섹션을 대체).
  const rows: DayRow[] = useMemo(() => {
    const weeklyDays = (id: string) => templates.filter((t) => t.staff_id === id).length;
    const subtitleOf = (id: string) => {
      const n = weeklyDays(id);
      return n > 0 ? `주 ${n}일 근무` : '근무표 미설정';
    };
    const working = dayShifts.map((sh) => ({
      key: sh.template.id,
      staff: staff.find((x) => x.id === sh.workerStaffId),
      name: nameOf(sh.workerStaffId),
      start: sh.template.start,
      end: sh.template.end,
      working: true,
      pending: sh.pending,
      subtitle: subtitleOf(sh.workerStaffId),
    }));
    const busy = new Set(dayShifts.map((sh) => sh.workerStaffId));
    const off = staff
      .filter((st) => !busy.has(st.id))
      .map((st) => ({
        key: st.id,
        staff: st,
        name: st.name,
        start: '—',
        end: '휴무',
        working: false,
        pending: false,
        subtitle: subtitleOf(st.id),
      }));
    return [...working, ...off];
  }, [dayShifts, staff, templates]);

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

        {/* ③ 하루 근무 — 시각을 좌측 거터로 뽑고, 근무·휴무를 한 목록으로 */}
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
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={20} color={InkColors.ink3} />
              <Text style={styles.emptyText}>합류한 직원이 없어요.{'\n'}먼저 직원을 초대해 주세요.</Text>
              {/* "직원 관리로 가세요"라고 쓰고 이동을 안 주면 사장이 메뉴를 찾아 헤맨다(복잡도 원칙 P6). */}
              <Pressable
                onPress={() => router.push('/owner/staff')}
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Text style={styles.emptyBtnText}>직원 초대하기</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.dayList}>
              {rows.map((r, i) => {
                const row = (
                  <GutterRow
                    timeStart={r.start}
                    timeEnd={r.end}
                    tone={r.working ? 'routine' : 'event'}
                    title={r.name}
                    subtitle={r.subtitle}
                    tag={r.pending ? '변경 중' : undefined}
                    last={i === rows.length - 1}
                  />
                );
                const target = r.staff;
                if (!target) return <View key={r.key}>{row}</View>;
                return (
                  <Pressable
                    key={r.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.name} 근무 시간 편집`}
                    onPress={() => setEditStaff(target)}
                    style={({ pressed }) => [pressed && styles.rowPressed]}
                  >
                    {row}
                  </Pressable>
                );
              })}
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

      {editStaff && <ShiftEditorModal staff={editStaff} onClose={() => setEditStaff(null)} />}

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
            {tpl ? `${tpl.start}~${tpl.end}` : ''}
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color={InkColors.ink3} />
        <View style={styles.flowCol}>
          <Text style={styles.flowLabel}>들어옴</Text>
          <Text style={styles.flowName}>{r.accepted_by ? nameOf(r.accepted_by) : '—'}</Text>
          <Text style={styles.flowWhen}>
            {r.kind === 'swap' && r.target_date ? fmtDateKo(r.target_date) : '같은 시간 대타'}
            {r.kind === 'swap' && tTpl ? `\n${tTpl.start}~${tTpl.end}` : ''}
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
  emptyBtn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.xl, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.ink, backgroundColor: '#FFFFFF' },
  emptyBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },

  // 주 이동 네비 — 스트립 위 한 줄
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: NAV_BTN, height: NAV_BTN, alignItems: 'center', justifyContent: 'center' },
  weekNavCenter: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  weekRange: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  todayText: { fontSize: 12, fontWeight: '800', color: BrandColors.warnText },

  // 하루 목록
  total: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  dayList: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: Space.md },
  rowPressed: { opacity: 0.7 },

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
