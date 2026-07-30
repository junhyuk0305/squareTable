// 직원 허브 '오늘' 탭 본문 — 3블록(기획 v2 §04): 오늘 근무 · 오늘 할 일 · 이번달 근무/예상 급여.
// 전부 본인 데이터(my_cross_summary 는 본인 행만, 할일은 0077 원시 행 + isPendingAssignment SSOT).
// 사장 지표는 이 화면에 없다(시장 표준: 직원에게 관리자 위젯 숨김 — When I Work 명문화).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { todayStr } from '@/lib/utils/attendance';
import { isPendingAssignment, isUnreadMention } from '@/lib/utils/notifications';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function JuniorTodayView() {
  const myCross = useHubStore((s) => s.myCross);
  const juniorLoaded = useHubStore((s) => s.juniorLoaded);
  const hydrateJunior = useHubStore((s) => s.hydrateJunior);
  const crossData = useCrossNotifStore((s) => s.data);
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const me = useSessionStore((s) => s.userId);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();

  useEffect(() => {
    void hydrateJunior();
    void hydrateCross();
    void hydratePrefs();
  }, [hydrateJunior, hydrateCross, hydratePrefs]);

  const today = todayStr();
  // 요일은 KST 날짜 문자열에서 파생 — occursOn(useWorkStore)과 같은 계산 문법.
  const dow = new Date(`${today}T00:00:00`).getDay();

  const labelOf = (uid: string) =>
    prefFor(uid).nickname || myCross.find((r) => r.unit_id === uid)?.store_name || '매장';
  const colorOf = (uid: string) => storeColor(uid, prefFor(uid).color);

  // ── 1) 오늘 근무(전 매장, 시작 시각순) + 다음 근무(오늘 없을 때) ──
  const todayShifts = useMemo(
    () =>
      myCross
        .flatMap((r) => r.shifts.filter((s) => s.weekday === dow).map((s) => ({ uid: r.unit_id, ...s })))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [myCross, dow],
  );
  const nextShift = useMemo(() => {
    if (todayShifts.length > 0) return null;
    for (let off = 1; off <= 7; off += 1) {
      const d2 = (dow + off) % 7;
      const cands = myCross
        .flatMap((r) => r.shifts.filter((s) => s.weekday === d2).map((s) => ({ uid: r.unit_id, ...s })))
        .sort((a, b) => a.start.localeCompare(b.start));
      if (cands.length > 0) return cands[0];
    }
    return null;
  }, [myCross, dow, todayShifts.length]);

  // ── 2) 오늘 할 일 — 배정(미완료) + 안 읽은 멘션. 술어는 notifications.ts SSOT.
  //     멘션(사람이 기다림)을 위로, 매장은 그룹헤더 대신 행 보조줄로 — 근무 행과 같은 해부구조.
  const todoItems = useMemo(() => {
    const tasks: { key: string; uid: string; kind: 'task' | 'mention'; text: string }[] = [];
    const mentions: typeof tasks = [];
    crossData.forEach((d) => {
      d.taskTemplates
        .filter((t) => isPendingAssignment(t, me, today, d.done))
        .forEach((t) => tasks.push({ key: `t_${d.unitId}_${t.id}`, uid: d.unitId, kind: 'task', text: t.text }));
      d.feed
        .filter((f) => isUnreadMention(f, me))
        .forEach((f) => mentions.push({ key: `m_${d.unitId}_${f.id}`, uid: d.unitId, kind: 'mention', text: f.text }));
    });
    return [...mentions, ...tasks];
  }, [crossData, me, today]);
  const [showAllTodos, setShowAllTodos] = useState(false);
  const TODO_CAP = 5;

  // ── 3) 이번달 — 근무시간·예상 급여(근무분 × 시급 / 60, 기존 급여 집계식과 동일 계산) ──
  const month = useMemo(() => {
    const perStore = myCross.map((r) => ({
      uid: r.unit_id,
      minutes: r.month_minutes,
      pay: r.hourly_wage > 0 ? Math.round((r.month_minutes / 60) * r.hourly_wage) : 0,
      hasWage: r.hourly_wage > 0,
    }));
    return {
      perStore,
      minutes: perStore.reduce((n, s) => n + s.minutes, 0),
      pay: perStore.reduce((n, s) => n + s.pay, 0),
      anyWage: perStore.some((s) => s.hasWage),
    };
  }, [myCross]);
  const fmtHours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}시간` : `${min}분`);

  // 전부 도착 전엔 무조건 로딩 — 근무 카드만 먼저 그리고 할일이 나중에 튀어나오는 부분 렌더 금지.
  if (!juniorLoaded || !crossLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={InkColors.ink3} />
      </View>
    );
  }

  return (
    <View style={{ gap: Space.md }}>
      {/* ── 1) 오늘 근무 ── */}
      <Appear delay={40}>
        <SectionLabel title="오늘 근무" />
        <View style={styles.card}>
          {todayShifts.length > 0 ? (
            todayShifts.map((s) => (
              <Pressable
                key={`${s.uid}_${s.id}`}
                onPress={() => goStore(s.uid, '/junior/attendance')}
                disabled={!!switching}
                style={({ pressed }) => [styles.shiftRow, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.shiftIcon, { backgroundColor: colorOf(s.uid) + '22' }]}>
                  <Ionicons name="time-outline" size={19} color={colorOf(s.uid)} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.shiftTitle} numberOfLines={1}>
                    {labelOf(s.uid)} · {s.start} – {s.end}
                  </Text>
                  <Text style={styles.shiftSub}>탭하면 출퇴근 화면으로 가요</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
              </Pressable>
            ))
          ) : (
            <View style={{ paddingVertical: Space.xs, gap: 2 }}>
              <Text style={styles.emptyText}>오늘은 근무가 없어요</Text>
              {nextShift && (
                <Text style={styles.caption}>
                  다음 근무 · {WEEKDAYS[nextShift.weekday]}요일 {nextShift.start} {labelOf(nextShift.uid)}
                </Text>
              )}
            </View>
          )}
          <Text style={styles.caption}>바뀐 교대는 매장 근무표에서 확인해요</Text>
        </View>
      </Appear>

      {/* ── 2) 오늘 할 일 ── */}
      <Appear delay={80}>
        <SectionLabel title="오늘 할 일" hint={todoItems.length > 0 ? `${todoItems.length}건` : undefined} />
        <View style={styles.card}>
          {todoItems.length === 0 ? (
            <Text style={styles.emptyText}>오늘 처리할 일이 없어요</Text>
          ) : (
            <>
              {(showAllTodos ? todoItems : todoItems.slice(0, TODO_CAP)).map((it) => (
                <Pressable
                  key={it.key}
                  onPress={() => goStore(it.uid, '/junior/work')}
                  disabled={!!switching}
                  style={({ pressed }) => [styles.shiftRow, pressed && { opacity: 0.85 }]}
                >
                  <View
                    style={[
                      styles.shiftIcon,
                      { backgroundColor: it.kind === 'mention' ? BrandColors.mentionSoft : colorOf(it.uid) + '22' },
                    ]}
                  >
                    <Ionicons
                      name={it.kind === 'mention' ? 'at' : 'checkbox-outline'}
                      size={18}
                      color={it.kind === 'mention' ? BrandColors.mention : colorOf(it.uid)}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.todoText} numberOfLines={2}>{it.text}</Text>
                    <View style={styles.subLine}>
                      <View style={[styles.subDot, { backgroundColor: colorOf(it.uid) }]} />
                      <Text style={styles.shiftSub} numberOfLines={1}>
                        {labelOf(it.uid)} · {it.kind === 'mention' ? '나를 불렀어요' : '내 담당'}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
                </Pressable>
              ))}
              {!showAllTodos && todoItems.length > TODO_CAP && (
                <Pressable
                  onPress={() => setShowAllTodos(true)}
                  style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`남은 할 일 ${todoItems.length - TODO_CAP}건 더 보기`}
                >
                  <Text style={styles.moreText}>{todoItems.length - TODO_CAP}건 더 보기</Text>
                  <Ionicons name="chevron-down" size={14} color={InkColors.ink2} />
                </Pressable>
              )}
            </>
          )}
        </View>
      </Appear>

      {/* ── 3) 이번달 ── */}
      <Appear delay={120}>
        <SectionLabel title="이번달" />
        <View style={styles.card}>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <Text style={styles.statV}>{fmtHours(month.minutes)}</Text>
              <Text style={styles.statL}>근무시간</Text>
            </View>
            {month.anyWage && (
              <View style={[styles.statCell, styles.statDivider]}>
                <Text style={styles.statV}>{month.pay.toLocaleString()}<Text style={styles.statUnit}>원</Text></Text>
                <Text style={styles.statL}>예상 급여</Text>
              </View>
            )}
          </View>
          {myCross.length > 1 &&
            month.perStore.map((s) => (
              <View key={s.uid} style={styles.storeRow}>
                <View style={[styles.dot, { backgroundColor: colorOf(s.uid) }]} />
                <Text style={styles.storeName} numberOfLines={1}>{labelOf(s.uid)}</Text>
                <Text style={styles.storeMeta}>
                  {fmtHours(s.minutes)}
                  {s.hasWage ? ` · ${s.pay.toLocaleString()}원` : ''}
                </Text>
              </View>
            ))}
          {month.anyWage && <Text style={styles.caption}>예상 급여는 근무 기록 × 시급으로 계산해요</Text>}
        </View>
      </Appear>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Space.xl * 2, alignItems: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    marginTop: Space.sm,
    ...Elevation.e2,
  },

  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm },
  shiftIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  shiftTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3 },
  shiftSub: { fontSize: 11.5, color: InkColors.ink3, marginTop: 1 },

  todoText: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 20 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 1 },
  subDot: { width: 6, height: 6, borderRadius: 3 },
  moreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: Space.xs, paddingVertical: Space.sm,
  },
  moreText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  statRow: { flexDirection: 'row', paddingVertical: Space.xs },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  statV: { fontSize: 21, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  statUnit: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  statL: { fontSize: 11.5, color: InkColors.ink3 },

  storeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    borderTopWidth: 1, borderTopColor: InkColors.line, paddingVertical: Space.sm + 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  storeName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  storeMeta: { fontSize: 12, color: InkColors.ink3 },

  emptyText: { fontSize: 15, color: InkColors.ink3, textAlign: 'center', paddingVertical: Space.sm },
  caption: { fontSize: 11.5, color: InkColors.ink3, marginTop: Space.sm, textAlign: 'center' },
});
