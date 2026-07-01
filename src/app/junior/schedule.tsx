import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { SectionLabel } from '@/components/SectionLabel';
import { SegmentTabs } from '@/components/SegmentTabs';
import { ScheduleWeek } from '@/components/schedule/ScheduleWeek';
import { SwapRequestModal } from '@/components/schedule/SwapRequestModal';
import { MyShiftPicker } from '@/components/schedule/MyShiftPicker';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import {
  useScheduleStore,
  shiftsOn,
  type ShiftTemplate,
  type SwapRequest,
} from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr } from '@/lib/utils/attendance';
import { mondayOf, fmtDateKo, closedDaysLabel, weekdayOf, addDays } from '@/lib/utils/schedule';
import { formatAsked } from '@/lib/utils/time';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

const STATUS_META: Record<
  SwapRequest['status'],
  { label: string; color: string; bg: string }
> = {
  open: { label: '수락 대기', color: BrandColors.warn, bg: '#FBF1DC' },
  accepted: { label: '사장님 컨펌 대기', color: BrandColors.warn, bg: '#FBF1DC' },
  approved: { label: '확정', color: BrandColors.good, bg: '#E4F2E8' },
  rejected: { label: '사장님 반려', color: BrandColors.bad, bg: BrandColors.accentSoft },
  cancelled: { label: '취소됨', color: InkColors.ink3, bg: InkColors.bgSoft },
};

export default function JuniorScheduleScreen() {
  const me = useSessionStore((s) => s.userId);
  const staff = useStaffStore((s) => s.staff);
  const config = useScheduleStore((s) => s.config);
  const templates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const acceptSwap = useScheduleStore((s) => s.acceptSwap);
  const cancelSwap = useScheduleStore((s) => s.cancelSwap);

  const today = todayStr();
  const [tab, setTab] = useState<'week' | 'swap'>('week');
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [composer, setComposer] = useState<{ date: string; template: ShiftTemplate } | null>(null);
  const [picking, setPicking] = useState(false);

  const nameOf = (id: string) => (id === me ? '나' : staff.find((x) => x.id === id)?.name ?? '직원');
  const tplById = (id: string) => templates.find((t) => t.id === id);

  // 내가 대응할 수 있는 열린 요청(대타 전체 + 나에게 온 맞교환). 지난 날짜는 자동 제외.
  const incoming = useMemo(
    () =>
      swaps.filter(
        (r) =>
          r.status === 'open' &&
          r.requester_id !== me &&
          r.date >= today &&
          (r.kind === 'cover' || r.target_staff_id === me),
      ),
    [swaps, me, today],
  );

  // 수락 시 내 기존 근무와 시간이 겹치는지(더블부킹) — 막지는 않고 경고만, 최종은 사장 컨펌.
  const conflictOf = (r: SwapRequest): boolean => {
    const tpl = tplById(r.template_id);
    if (!tpl) return false;
    const wd = weekdayOf(r.date);
    return templates.some(
      (t) =>
        t.staff_id === me &&
        t.weekday === wd &&
        t.id !== r.target_template_id && // 맞교환으로 내가 내주는 시프트는 제외
        t.start < tpl.end &&
        tpl.start < t.end,
    );
  };
  // 내가 올린 요청.
  const mine = useMemo(() => swaps.filter((r) => r.requester_id === me), [swaps, me]);
  // 마무리된 요청(이력).
  const history = useMemo(
    () =>
      swaps
        .filter((r) => ['approved', 'rejected', 'cancelled'].includes(r.status))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [swaps],
  );

  // 현재 시각 "HH:MM"(오늘 이미 끝난 근무 제외용). 순수 헬퍼로 분리 — useMemo 안에서 new Date()를
  // 부르면 비순수라 React Compiler가 메모이즈를 못 한다(컴파일러가 헬퍼 호출 결과를 자동 메모이즈).
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const myNext = nextShiftOf(templates, swaps, me, today, staff, nowHM);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '근무표' }} />

      <SegmentTabs
        items={[
          { key: 'week', label: '근무표' },
          { key: 'swap', label: '교대 요청', count: incoming.length || undefined },
        ]}
        value={tab}
        onChange={(k) => setTab(k as 'week' | 'swap')}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'week' ? (
          <>
            {/* 내 다음 근무 — 직원이 가장 알고싶은 ‘언제·누구와’를 격자보다 먼저 */}
            {myNext ? (
              <View style={styles.hero}>
                <Text style={styles.heroTitle}>{myNext.ongoing ? '지금 근무 중' : '내 다음 근무'}</Text>
                <Text style={styles.heroBig}>
                  {myNext.dayWord} {myNext.sh.template.start}–{myNext.sh.template.end}
                  {durLabel(myNext.sh.template.start, myNext.sh.template.end)
                    ? ` (${durLabel(myNext.sh.template.start, myNext.sh.template.end)})`
                    : ''}
                </Text>
                <Text style={styles.heroSub}>{myNext.sub}</Text>
                <Pressable
                  onPress={() => setPicking(true)}
                  accessibilityRole="button"
                  accessibilityLabel="교대 요청하기"
                  style={({ pressed }) => [styles.heroCta, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color="#fff" />
                  <Text style={styles.heroCtaText}>교대 요청하기</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.heroEmpty}>
                <Ionicons name="calendar-clear-outline" size={16} color={InkColors.ink3} />
                <Text style={styles.heroEmptyText}>앞으로 2주간 예정된 내 근무가 없어요.</Text>
              </View>
            )}
            <ScheduleWeek
              monday={monday}
              setMonday={setMonday}
              templates={templates}
              swaps={swaps}
              staff={staff}
              config={config}
              meId={me}
              onShiftPress={(date, sh) => setComposer({ date, template: sh.template })}
              canPress={(date, sh) => sh.workerStaffId === me && date >= today && !sh.pending}
            />
            <Text style={styles.tip}>내 근무(노랑)를 누르거나 ‘교대 요청’ 탭에서 대타·맞교환을 올릴 수 있어요.</Text>
          </>
        ) : (
          <View style={{ gap: 18 }}>
            {/* 교대 요청 올리기 — 교대 탭의 주 진입점 */}
            <Pressable
              onPress={() => setPicking(true)}
              accessibilityRole="button"
              accessibilityLabel="교대 요청하기"
              style={({ pressed }) => [styles.reqBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.reqText}>교대 요청하기</Text>
            </Pressable>

            {/* 내가 대응할 수 있는 요청 */}
            <Section icon="people-outline" title="동료가 올린 요청" hint="수락하면 사장님 컨펌으로 넘어가요">
              {incoming.length === 0 ? (
                <Empty text="지금 대응할 교대 요청이 없어요." />
              ) : (
                incoming.map((r) => {
                  const conflict = conflictOf(r);
                  return (
                    <SwapCard key={r.id} r={r} nameOf={nameOf} tplById={tplById}>
                      {conflict && (
                        <View style={styles.conflict}>
                          <Ionicons name="alert-circle-outline" size={14} color={BrandColors.bad} />
                          <Text style={styles.conflictText}>이날 내 근무와 시간이 겹쳐요. 수락하면 같은 시간에 두 곳이 돼요.</Text>
                        </View>
                      )}
                      <Pressable
                        onPress={() => acceptSwap(r.id, me)}
                        accessibilityRole="button"
                        accessibilityLabel={r.kind === 'cover' ? '대타 수락하기' : '맞교환 수락하기'}
                        style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.85 }]}
                      >
                        <Ionicons name="hand-left-outline" size={15} color="#fff" />
                        <Text style={styles.acceptText}>
                          {r.kind === 'cover' ? '내가 대신할게요' : '맞교환 수락'}
                        </Text>
                      </Pressable>
                    </SwapCard>
                  );
                })
              )}
            </Section>

            {/* 내가 올린 요청 */}
            <Section icon="paper-plane-outline" title="내가 올린 요청">
              {mine.filter((r) => (r.status === 'open' || r.status === 'accepted') && r.date >= today).length === 0 ? (
                <Empty text="진행 중인 요청이 없어요. 위 ‘교대 요청하기’로 올려보세요." />
              ) : (
                mine
                  .filter((r) => r.status === 'open' || r.status === 'accepted')
                  .map((r) => (
                    <SwapCard key={r.id} r={r} nameOf={nameOf} tplById={tplById}>
                      <Pressable
                        onPress={() => cancelSwap(r.id)}
                        style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.cancelText}>요청 취소</Text>
                      </Pressable>
                    </SwapCard>
                  ))
              )}
            </Section>

            {/* 처리 결과 */}
            {history.length > 0 && (
              <Section icon="time-outline" title="지난 요청">
                {history.slice(0, 8).map((r) => (
                  <SwapCard key={r.id} r={r} nameOf={nameOf} tplById={tplById} />
                ))}
              </Section>
            )}
          </View>
        )}

        {/* 가게 기본 정보 — 보조로 강등(하단 한 줄 칩) */}
        <View style={styles.storeChip}>
          <Ionicons name="storefront-outline" size={15} color={InkColors.ink3} />
          <Text style={styles.storeChipText}>
            운영 {config.open}~{config.close} · 휴무 {closedDaysLabel(config.closedDays)}
          </Text>
        </View>
        {!!config.note && <Text style={styles.infoNote}>{config.note}</Text>}

        <View style={{ height: 12 }} />
      </ScrollView>

      {picking && (
        <MyShiftPicker
          me={me}
          templates={templates}
          swaps={swaps}
          onPick={(date, template) => {
            setPicking(false);
            setComposer({ date, template });
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {composer && (
        <SwapRequestModal
          me={me}
          date={composer.date}
          template={composer.template}
          staff={staff}
          templates={templates}
          onClose={() => setComposer(null)}
        />
      )}

      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <SectionLabel icon={icon} title={title} hint={hint} />
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

/**
 * 오늘부터 2주 내 '나'의 가장 가까운(또는 진행 중) 근무. 없으면 null.
 * 순수 함수 — render에서 호출하면 React Compiler가 자동 메모이즈한다.
 */
function nextShiftOf(
  templates: ShiftTemplate[],
  swaps: SwapRequest[],
  me: string,
  today: string,
  staff: Junior[],
  nowHM: string,
) {
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i);
    const all = shiftsOn(templates, swaps, date);
    const mineShifts = all
      .filter((sh) => sh.workerStaffId === me)
      .sort((a, b) => a.template.start.localeCompare(b.template.start));
    for (const sh of mineShifts) {
      if (i === 0 && sh.template.end <= nowHM) continue; // 오늘 이미 끝난 근무는 건너뜀
      const coworkers = all
        .filter(
          (o) =>
            o.workerStaffId !== me &&
            o.template.start < sh.template.end &&
            sh.template.start < o.template.end,
        )
        .map((o) => staff.find((x) => x.id === o.workerStaffId)?.name ?? '동료');
      const ongoing = i === 0 && sh.template.start <= nowHM && nowHM < sh.template.end;
      const dayWord = i === 0 ? '오늘' : i === 1 ? '내일' : fmtDateKo(date);
      const subParts = [coworkers.length ? `${coworkers.join('·')}님과 함께` : '혼자 근무'];
      if (ongoing) subParts.push('근무 중');
      return { date, sh, ongoing, dayWord, sub: subParts.join(' · ') };
    }
  }
  return null;
}

/** "13:00"~"18:00" → "5시간" / "4시간 30분". 음수(자정 넘김)면 빈 문자열. */
function durLabel(start: string, end: string): string {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const d = toMin(end) - toMin(start);
  if (d <= 0) return '';
  const h = Math.floor(d / 60);
  const m = d % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function SwapCard({
  r,
  nameOf,
  tplById,
  children,
}: {
  r: SwapRequest;
  nameOf: (id: string) => string;
  tplById: (id: string) => ShiftTemplate | undefined;
  children?: React.ReactNode;
}) {
  const meta = STATUS_META[r.status];
  const tpl = tplById(r.template_id);
  const tTpl = r.target_template_id ? tplById(r.target_template_id) : undefined;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindTag, r.kind === 'swap' && styles.kindTagSwap]}>
          <Text style={[styles.kindTagText, r.kind === 'swap' && { color: '#fff' }]}>
            {r.kind === 'cover' ? '대타' : '맞교환'}
          </Text>
        </View>
        <View style={[styles.statusTag, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.cardTime}>{formatAsked(r.created_at)}</Text>
      </View>

      <Text style={styles.cardLine}>
        <Text style={styles.cardStrong}>{nameOf(r.requester_id)}</Text>님 ·{' '}
        {fmtDateKo(r.date)} {tpl ? `${tpl.start}~${tpl.end}` : ''}
      </Text>
      {r.kind === 'swap' && r.target_date && (
        <Text style={styles.cardLine}>
          ↔ <Text style={styles.cardStrong}>{nameOf(r.target_staff_id ?? '')}</Text>님 ·{' '}
          {fmtDateKo(r.target_date)} {tTpl ? `${tTpl.start}~${tTpl.end}` : ''}
        </Text>
      )}
      {r.accepted_by && (
        <Text style={styles.cardAccepted}>
          {nameOf(r.accepted_by)}님이 수락{r.status === 'approved' ? ' · 확정' : ''}
        </Text>
      )}
      {!!r.note && <Text style={styles.cardNote}>“{r.note}”</Text>}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { paddingHorizontal: 20, paddingBottom: 8, gap: 14 },

  // 내 다음 근무 히어로(노랑) — 격자 위 단일 강조.
  hero: { backgroundColor: BrandColors.yellow, borderRadius: Radius.lg, paddingVertical: 16, paddingHorizontal: 16, ...Elevation.e2 },
  heroTitle: { fontSize: 12.5, fontWeight: '800', color: '#7a6712' },
  heroBig: { fontSize: 17, fontWeight: '900', color: InkColors.ink, marginTop: 6, letterSpacing: -0.2 },
  heroSub: { fontSize: 12.5, fontWeight: '600', color: '#6f5f2a', marginTop: 3 },
  heroCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 11, marginTop: 13 },
  heroCtaText: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  heroEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 14, paddingHorizontal: 14, ...Elevation.e1 },
  heroEmptyText: { flex: 1, fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  infoNote: { fontSize: 12, color: InkColors.ink3, paddingHorizontal: 2 },
  storeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: InkColors.cream, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 10, paddingHorizontal: 12 },
  storeChipText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  tip: { fontSize: 12, color: InkColors.ink3, marginTop: 10, textAlign: 'center' },

  reqBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, ...Elevation.e1 },
  reqText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  empty: { fontSize: 13, color: InkColors.ink3, lineHeight: 19, paddingVertical: 6 },

  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 14, gap: 6, ...Elevation.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindTag: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  kindTagSwap: { backgroundColor: InkColors.ink },
  kindTagText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  statusTag: { borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '800' },
  cardTime: { marginLeft: 'auto', fontSize: 11.5, color: InkColors.ink3, fontWeight: '600' },

  cardLine: { fontSize: 13.5, color: InkColors.ink2, lineHeight: 20 },
  cardStrong: { fontWeight: '800', color: InkColors.ink },
  cardAccepted: { fontSize: 12.5, fontWeight: '700', color: BrandColors.good },
  cardNote: { fontSize: 13, color: InkColors.ink2, fontStyle: 'italic', backgroundColor: InkColors.cream, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8 },

  conflict: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BrandColors.accentSoft, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: 2 },
  conflictText: { flex: 1, fontSize: 12, color: BrandColors.bad, fontWeight: '700', lineHeight: 17 },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 12, marginTop: 4 },
  acceptText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, paddingVertical: 11, marginTop: 4, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  cancelText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },
});
