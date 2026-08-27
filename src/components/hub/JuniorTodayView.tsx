// 직원 허브 '오늘' 탭 본문 — 3블록(기획 v2 §04): 오늘 근무 · 오늘 할 일 · 이번달 근무/예상 급여.
// 전부 본인 데이터(my_cross_summary 는 본인 행만, 할일은 0077 원시 행 + isPendingAssignment SSOT).
// 사장 지표는 이 화면에 없다(시장 표준: 직원에게 관리자 위젯 숨김 — When I Work 명문화).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
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
import { FocusCard } from '@/components/blocks/FocusCard';
import { StatCardGrid } from '@/components/blocks/StatCardGrid';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear, stagger } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function JuniorTodayView({ header }: { header: ReactNode }) {
  const myCross = useHubStore((s) => s.myCross);
  const juniorLoaded = useHubStore((s) => s.juniorLoaded);
  const hydrateJunior = useHubStore((s) => s.hydrateJunior);
  const crossData = useCrossNotifStore((s) => s.data);
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const me = useSessionStore((s) => s.userId);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const prefsLoaded = useMemberPrefsStore((s) => s.loaded);
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
  // 0138: 근무 한 칸은 요일 반복이거나 날짜 지정이다. 판정은 shiftsOn(useScheduleStore)과 같은 모양.
  // ★0178·0180: 그날 예외로 빠진 반복은 없는 것으로 친다 — 안 빼면 이미 남에게 넘긴 근무가
  //   허브에 '오늘 근무'로 그대로 남는다(shiftsOn 이 매장 앱에서 하는 것과 같은 규칙).
  const onDay = (
    s: { id: string; weekday: number | null; date: string | null },
    date: string,
    wd: number,
    excluded: { template_id: string; date: string }[],
  ) => {
    if (s.date) return s.date === date;
    if (s.weekday !== wd) return false;
    return !excluded.some((e) => e.template_id === s.id && e.date === date);
  };

  const todayShifts = useMemo(
    () =>
      myCross
        .flatMap((r) => r.shifts.filter((s) => onDay(s, today, dow, r.exceptions ?? [])).map((s) => ({ uid: r.unit_id, ...s })))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [myCross, dow, today],
  );
  const nextShift = useMemo(() => {
    if (todayShifts.length > 0) return null;
    for (let off = 1; off <= 7; off += 1) {
      const d2 = (dow + off) % 7;
      const date2 = todayStr(new Date(new Date(`${today}T00:00:00`).getTime() + off * 86400000));
      const cands = myCross
        .flatMap((r) => r.shifts.filter((s) => onDay(s, date2, d2, r.exceptions ?? [])).map((s) => ({ uid: r.unit_id, dow: d2, ...s })))
        .sort((a, b) => a.start.localeCompare(b.start));
      if (cands.length > 0) return cands[0];
    }
    return null;
  }, [myCross, dow, today, todayShifts.length]);

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

  // ── 히어로(H4 FocusCard · §7-4 A) — 가장 급한 1건.
  //    ★우선순위 = **멘션 먼저**(2026-08-27 사용자 확정). 사람이 답을 기다리는 것이 지연 비용이 크고,
  //      FocusCard 는 따옴표 인용 블록이라 사람 말이 들어가야 문법이 맞는다.
  //      todoItems 가 이미 [멘션…, 배정…] 순서라 맨 앞이 곧 그 판정이다 — 새 정렬을 만들지 않는다.
  //    ★0건이면 카드를 비워 두지 않는다(빈 카드 금지) — 아래 '오늘 근무' 카드만 남는다.
  const hero = todoItems[0] ?? null;
  const restTodos = todoItems.slice(1);
  // 히어로 위 맥락 한 줄 — 오늘 근무를 여기서 말한다. 아래 '오늘 근무' 카드는 그대로 둔다:
  // 근무가 2건 이상이면 행마다 출퇴근 화면으로 가는 진입점이 필요하다.
  const heroKicker = todayShifts.length > 0
    ? `오늘 ${labelOf(todayShifts[0].uid)} ${todayShifts[0].start} – ${todayShifts[0].end} 근무`
    : nextShift
      ? `오늘은 근무가 없어요 · 다음 근무 ${WEEKDAYS[nextShift.dow]}요일 ${nextShift.start}`
      : '오늘은 근무가 없어요';

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
  // ★prefs(매장 별명·색)도 게이트에 넣는다(2026-08-25) — 빠져 있던 동안 근무 행·할일 행·매장별 행의
  //   이름과 점 색이 화면이 뜬 뒤에 갈아끼워졌다.
  if (!juniorLoaded || !crossLoaded || !prefsLoaded) {
    return (
      <View style={styles.loading}>
        <ScreenLoading label="오늘 일정을 불러오고 있어요…" />
      </View>
    );
  }

  return (
    <>
      {/* 화면 제목 — 게이트 안이다. 밖에 두면 제목만 먼저 등장하고 본문이 수 백 ms 뒤에 갈아끼워진다. */}
      {header}
      <View style={{ gap: Space.md }}>
      {/* ── 0) 히어로 — 가장 급한 1건(§7-4 A). 없으면 안 그린다. ── */}
      {hero && (
        <Appear delay={stagger(0)}>
          <FocusCard
            kicker={heroKicker}
            quote={hero.text}
            meta={`${labelOf(hero.uid)} · ${hero.kind === 'mention' ? '나를 불렀어요' : '내 담당'}`}
            cta={{
              label: hero.kind === 'mention' ? '업무 채팅에서 보기' : '업무 화면에서 보기',
              onPress: () => { if (!switching) goStore(hero.uid, '/junior/work'); },
            }}
          />
        </Appear>
      )}

      {/* ── 1) 오늘 근무 ── */}
      <Appear delay={stagger(1)}>
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
                  다음 근무 · {WEEKDAYS[nextShift.dow]}요일 {nextShift.start} {labelOf(nextShift.uid)}
                </Text>
              )}
            </View>
          )}
          <Text style={styles.caption}>바뀐 교대는 매장 근무표에서 확인해요</Text>
        </View>
      </Appear>

      {/* ── 2) 남은 할 일 — 히어로로 올라간 1건은 여기서 뺀다(같은 것을 두 번 그리지 않는다).
             ★히어로가 있고 나머지가 0건이면 이 섹션 자체를 그리지 않는다 — "오늘 처리할 일이 없어요"가
               바로 위 히어로와 정면으로 모순된다. ── */}
      {(!hero || restTodos.length > 0) && (
      <Appear delay={stagger(2)}>
        <SectionLabel
          title={hero ? '남은 할 일' : '오늘 할 일'}
          hint={restTodos.length > 0 ? `${restTodos.length}건` : undefined}
        />
        <View style={styles.card}>
          {restTodos.length === 0 ? (
            <Text style={styles.emptyText}>오늘 처리할 일이 없어요</Text>
          ) : (
            <>
              {(showAllTodos ? restTodos : restTodos.slice(0, TODO_CAP)).map((it) => (
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
              {!showAllTodos && restTodos.length > TODO_CAP && (
                <Pressable
                  onPress={() => setShowAllTodos(true)}
                  style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`남은 할 일 ${restTodos.length - TODO_CAP}건 더 보기`}
                >
                  <Text style={styles.moreText}>{restTodos.length - TODO_CAP}건 더 보기</Text>
                  <Ionicons name="chevron-down" size={14} color={InkColors.ink2} />
                </Pressable>
              )}
            </>
          )}
        </View>
      </Appear>
      )}

      {/* ── 3) 이번달 — 블록 L4(§7-2). 2026-08-27: MiniStats(숫자 나열) → 2열 지표 카드.
             ★R4 — **여기엔 막대를 그리지 않는다.** `my_cross_summary` 가 주는 건 `month_minutes`
               **합계 하나**뿐이라 일별 이력이 없다. 시간축 막대를 그리면 지어낸 그림이 된다.
               일별 원장은 매장 앱 출퇴근 화면이 갖고 있으므로 그쪽으로 보낸다(보조줄).
               매장이 2곳↑이면 매장별 분해가 실제 구성이지만 그건 바로 아래 카드가 이미 말한다. ── */}
      <Appear delay={stagger(3)}>
        <SectionLabel title="이번달" />
        <StatCardGrid
          items={[
            {
              key: 'hours',
              label: '근무시간',
              value: fmtHours(month.minutes),
              sub: myCross.length > 1 ? `매장 ${myCross.length}곳 합계` : '일별 기록은 출퇴근 화면에서 봐요',
            },
            ...(month.anyWage
              ? [{
                  key: 'pay',
                  label: '예상 급여',
                  value: `${month.pay.toLocaleString()}원`,
                  sub: '세전 예상액',
                  info: {
                    title: '예상 급여가 어떻게 나온 거예요?',
                    body: '근무 기록 × 시급으로 계산한 값이에요.\n실제 지급액은 매장 정산 기준에 따라 달라질 수 있어요.',
                  },
                }]
              : []),
          ]}
        />
        {myCross.length > 1 && (
          <View style={styles.card}>
            {month.perStore.map((s) => (
              <View key={s.uid} style={styles.storeRow}>
                <View style={[styles.dot, { backgroundColor: colorOf(s.uid) }]} />
                <Text style={styles.storeName} numberOfLines={1}>{labelOf(s.uid)}</Text>
                <Text style={styles.storeMeta}>
                  {fmtHours(s.minutes)}
                  {s.hasWage ? ` · ${s.pay.toLocaleString()}원` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Appear>
      </View>
    </>
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

  emptyText: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', paddingVertical: Space.sm },
  caption: { fontSize: 11.5, color: InkColors.ink3, marginTop: Space.sm, textAlign: 'center' },
});
