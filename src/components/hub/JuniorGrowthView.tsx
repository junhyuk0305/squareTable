// 직원 허브 '성장' 탭 본문 — 축적 레이어(슬라이스 C, 3탭 확장의 두 번째 탭).
//
// 무엇: "내가 남긴 것"의 축적을 본인에게 되돌려준다(순환 보상 단계 — M1 채택).
//   · 가르침 실적(내 답이 노하우로 채택) — 최고 역량 = "가르칠 수 있음"(실적, 도장 아님)
//   · 내 노하우·최근 30일 참조 수(query_hits — 살아있는 카운트)
//   · 해본 업무 종류 수 — ★완료≠숙련: "해봤다"(경험)까지만 말하고 숙련을 주장하지 않는다
// 원칙: 전부 본인 전용(my_growth RPC 내부 강제·사장 화면에 개인별 뷰 없음) · 남과 비교 없음 ·
//   빈 상태는 "예시" 라벨 카드(실데이터 1건 들어오면 자동 교체 — 조건 렌더) + 행동 버튼.
//   내 노하우는 원문까지 본인이 직접 본다(0094 — 행 탭 = EntryDetailModal 재사용).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { fetchMyTrainingHistory, type TrainingHistoryRow } from '@/lib/db';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { SectionLabel } from '@/components/SectionLabel';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { RollupRows } from '@/components/blocks/RollupRows';
import { StatCard, StatCardGrid } from '@/components/blocks/StatCardGrid';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear, stagger } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

const ENTRY_LIST_FIRST = 5; // 리스트 첫 노출 5±2 — 넘치면 "나머지 보기"로 아래로 펼침

// 통과 시각 표기 — "8월 2일". 연도는 생략(최근 이력 중심, 좁은 행 폭).
const fmtMonthDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export function JuniorGrowthView({ header }: { header: ReactNode }) {
  const growth = useHubStore((s) => s.growth);
  const growthLoaded = useHubStore((s) => s.growthLoaded);
  const hydrateGrowth = useHubStore((s) => s.hydrateGrowth);
  const myEntries = useHubStore((s) => s.myEntries);
  const myEntriesLoaded = useHubStore((s) => s.myEntriesLoaded);
  const hydrateMyEntries = useHubStore((s) => s.hydrateMyEntries);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const prefsLoaded = useMemberPrefsStore((s) => s.loaded);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();
  const [openEntry, setOpenEntry] = useState<PlaybookEntry | null>(null);
  const [showAllEntries, setShowAllEntries] = useState(false);
  // 훈련 통과 이력(0104) — 교차 매장·본인 한정. 통과만 저장되는 테이블이라 이력 = 통과 이력.
  const [trainingHistory, setTrainingHistory] = useState<TrainingHistoryRow[]>([]);
  const [trainingLoaded, setTrainingLoaded] = useState(false); // 부분 렌더 금지 게이트에 합류(빈상태↔실화면 플립 방지)
  const [showAllTraining, setShowAllTraining] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchMyTrainingHistory().then((rows) => {
      if (!alive) return;
      setTrainingHistory(rows);
      setTrainingLoaded(true); // 에러여도 []로 확정(readFail 로그) — 로딩에 갇히지 않는다
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    void hydrateGrowth();
    void hydrateMyEntries();
    void hydratePrefs();
  }, [hydrateGrowth, hydrateMyEntries, hydratePrefs]);

  const totals = useMemo(
    () =>
      growth.reduce(
        (a, r) => ({
          knowhow: a.knowhow + r.my_knowhow,
          hits: a.hits + r.my_hits,
          taught: a.taught + r.taught,
          doneKinds: a.doneKinds + r.done_kinds,
          // ★분모(0184). 마이그레이션 적용 전에는 이 칸이 안 와서 0 이 된다 — 그때는 링을 안 그린다.
          entriesTotal: a.entriesTotal + (r.entries_total ?? 0),
        }),
        { knowhow: 0, hits: 0, taught: 0, doneKinds: 0, entriesTotal: 0 },
      ),
    [growth],
  );
  // 히어로(H3′) 분자 = 퀴즈로 통과한 노하우 수. 통과만 저장되는 테이블이라 행 수가 곧 "아는 노하우"다.
  const knownCount = trainingHistory.length;
  // 최근 통과 2건 — 링 오른쪽 뒷면(V2 대상형)이 쓴다. 원장에 제목이 있으므로 대상을 말할 수 있다(R2).
  const recentPassed = useMemo(
    () => [...trainingHistory].sort((a, b) => (b.verifiedAt ?? '').localeCompare(a.verifiedAt ?? '')).slice(0, 2),
    [trainingHistory],
  );
  // 매장별 롤업(L5) 대표 대상 — 그 매장에서 가장 최근에 통과한 노하우 1개.
  const latestByUnit = useMemo(() => {
    const m = new Map<string, TrainingHistoryRow>();
    for (const h of trainingHistory) {
      const prev = m.get(h.unitId);
      if (!prev || (h.verifiedAt ?? '') > (prev.verifiedAt ?? '')) m.set(h.unitId, h);
    }
    return m;
  }, [trainingHistory]);
  // 훈련 통과만 있는 신입(업무 완료·노하우 0)도 실화면을 봐야 한다 — 이력이 있으면 빈 상태가 아니다.
  const empty = totals.knowhow === 0 && totals.taught === 0 && totals.doneKinds === 0 && trainingHistory.length === 0;
  const labelOf = (uid: string, fallback: string) => prefFor(uid).nickname || fallback;

  // 전부 도착 전엔 무조건 로딩 — 집계만 먼저 그리고 목록이 나중에 튀어나오는 부분 렌더 금지.
  // ★prefs(매장 별명·색)도 게이트에 넣는다(2026-08-25) — 매장별 행의 이름·점 색이 뒤늦게 바뀌었다.
  if (!growthLoaded || !myEntriesLoaded || !trainingLoaded || !prefsLoaded) {
    return (
      <View style={styles.loading}>
        <ScreenLoading label="내가 남긴 기록을 불러오고 있어요…" />
      </View>
    );
  }

  // ── 빈 상태: 골격 + 정직한 예시(라벨 명시·실데이터 들어오면 이 분기 자체가 사라짐) ──
  if (empty) {
    const firstUnit = growth[0]?.unit_id;
    return (
      <>
      {/* 화면 제목 — 게이트 안이다. 밖에 두면 제목만 먼저 등장하고 본문이 수 백 ms 뒤에 갈아끼워진다. */}
      {header}
      <View style={{ gap: Space.md }}>
        <Appear delay={stagger(0)}>
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>여기에 내가 남긴 것이 쌓여요</Text>
            <Text style={styles.emptyBody}>
              일하다 막히면 물어보고, 할일을 완료하면 그 기록이 이 화면에 모여요. 이 화면은 나만 볼 수 있어요.
            </Text>
            {firstUnit && (
              <Pressable
                onPress={() => goStore(firstUnit, '/junior/chat')}
                disabled={!!switching}
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel="물어보러 가기"
              >
                <Ionicons name="chatbubble-outline" size={15} color={InkColors.ink} />
                <Text style={styles.emptyBtnText}>물어보러 가기</Text>
              </Pressable>
            )}
          </View>
        </Appear>
        {/* ★2026-08-06: 가짜 실적("내 노하우가 최근 30일 7번 도움 됐어요")을 **스켈레톤**으로 교체했다.
            옛 판본은 카드 전체에 opacity 0.55를 걸어 가짜임을 표현했는데, 합성 대비 실측 결과
            가짜 숫자 2.22:1 > '예시' 배지 1.54:1 이라 **가짜 주장이 그것을 부정하는 표시보다 또렷했다**.
            대비만 올리면 가짜가 실데이터처럼 읽히고, 흐리게 두면 딱지가 안 읽히는 딜레마라
            "무엇이 쌓이는지"만 남기고 수치 자체를 없앤다 — 그러면 흐릴 이유도, '예시' 딱지도 없다.
            (자동 검사는 조상 opacity를 색에 합성하지 않아 이 자리를 앞으로도 못 잡는다.) */}
        <Appear delay={stagger(1)}>
          <View style={styles.ghostCard}>
            <Text style={styles.ghostTitle}>최근 30일 도움 된 횟수</Text>
            <View style={styles.ghostBar} />
            <Text style={styles.ghostBody}>첫 기록이 들어오면 여기에 숫자가 나와요.</Text>
          </View>
        </Appear>
      </View>
      </>
    );
  }

  return (
    <>
    {/* 화면 제목 — 게이트 안이다. 밖에 두면 제목만 먼저 등장하고 본문이 수 백 ms 뒤에 갈아끼워진다. */}
    {header}
    <View style={{ gap: Space.md }}>
      {/* ── 히어로(H3′ · 블록어휘 §7-2) — "우리 매장 노하우 중 내가 아는 것".
             ★2026-08-27 오밀조밀 확산 6-1 B안. 옛 판본은 노랑 '가르침' 카드가 맨 위였는데,
             taught 는 대부분 0이라 화면 첫인상이 "아직 없음"이었다. 히어로는 신입 첫날에도
             말이 되는 값이어야 한다 — 0%도 "이제부터 채운다"로 읽힌다.
             ★분모(entries_total)는 0184 로 서버에서 온다. **안 오면 링을 그리지 않는다** —
               분모 없이 링을 그리면 4/4 = 100% 처럼 거짓으로 가득 찬다(R4 가짜 금지).
             ★감시원칙 D1~D5: 분모가 "매장 노하우 수"라 사람 비교가 아니다. 전부 본인 값이다. ── */}
      <Appear delay={stagger(0)}>
        {totals.entriesTotal > 0 ? (
          <View style={styles.heroCard}>
            <ProgressRing
              value={knownCount}
              total={totals.entriesTotal}
              center={`${Math.round((knownCount / totals.entriesTotal) * 100)}%`}
              label="내가 아는 노하우"
              swap={{
                faces: [
                  <View key="legend">
                    {[
                      { color: BrandColors.good, text: '퀴즈로 확인함', value: knownCount },
                      { color: InkColors.bgSoft, border: true, text: '아직 안 본 노하우', value: Math.max(0, totals.entriesTotal - knownCount) },
                    ].map((r, i) => (
                      <View key={r.text} style={[styles.lgRow, i > 0 && styles.lgDivider]}>
                        <View style={[styles.lgDot, { backgroundColor: r.color }, r.border && styles.lgDotBorder]} />
                        <Text style={styles.lgText} numberOfLines={1}>{r.text}</Text>
                        <Text style={styles.lgValue}>{r.value}</Text>
                      </View>
                    ))}
                  </View>,
                  <View key="targets">
                    <Text style={styles.faceLabel}>가장 최근에 안 것</Text>
                    {recentPassed.length > 0 ? (
                      recentPassed.map((h, i) => (
                        <View key={`${h.unitId}_${h.entryId}`} style={[styles.tgRow, i > 0 && styles.lgDivider]}>
                          <Text style={styles.tgTitle} numberOfLines={1}>{h.entryTitle}</Text>
                          <Text style={styles.tgSub}>{`${fmtMonthDay(h.verifiedAt)} 통과`}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.tgSub}>아직 통과한 퀴즈가 없어요</Text>
                    )}
                  </View>,
                ],
                captions: [
                  `우리 매장 노하우 ${totals.entriesTotal}개 중 ${knownCount}개를 퀴즈로 확인했어요.`,
                  '이 화면은 나만 볼 수 있어요 — 다른 사람과 비교하지 않아요.',
                ],
              }}
            />
          </View>
        ) : (
          // 분모가 없을 때(매장에 발행 노하우가 0개이거나 0184 미적용) — 링 대신 분자만 말한다.
          <StatCard
            item={{
              key: 'known',
              label: '퀴즈로 확인한 노하우',
              value: knownCount,
              unit: '개',
              sub: recentPassed[0] ? `가장 최근 · ${recentPassed[0].entryTitle}` : '아직 통과한 퀴즈가 없어요',
            }}
          />
        )}
      </Appear>

      {/* ── 내가 남긴 것 ── */}
      <Appear delay={stagger(1)} style={{ gap: Space.sm }}>
        <SectionLabel title="내가 남긴 것" />
        {/* 블록 L4(§7-2) — MiniStats(숫자 3칸 나열)를 2열 지표 카드로 갈아탔다(2026-08-27).
            숫자 옆에 대상·근거가 붙는다(R2): '내가 만든 노하우'는 참조 횟수를 보조줄로 데리고 오고,
            0건일 때 큰 숫자를 세우던 '최근 30일 참조' 칸은 사라진다.
            가르침 실적(taught)은 **0건이면 칸을 만들지 않고** 아래 한 줄 링크가 대신 말한다 —
            28sp '0건'은 성과 없음을 크게 외치는 꼴이다(2026-08-19 판정 유지).
            ★막대(visual)를 주지 않는다: 이 세 값에는 이력 원장도, 쪼갤 구성도 없다(R4). */}
        <StatCardGrid
          items={[
            {
              key: 'knowhow',
              label: '내가 만든 노하우',
              value: totals.knowhow,
              unit: '개',
              sub: `최근 30일 참조 ${totals.hits}번`,
              info:
                totals.knowhow > 0 && totals.hits === 0
                  ? {
                      title: '참조가 0이에요',
                      body: '아직 참조 전이에요 — 누가 같은 걸 물으면 숫자가 올라요.',
                    }
                  : undefined,
            },
            { key: 'done', label: '해본 업무', value: totals.doneKinds, unit: '종' },
            ...(totals.taught > 0
              ? [{
                  key: 'taught',
                  label: '매장 노하우가 된 내 답',
                  value: totals.taught,
                  unit: '건',
                  sub: '그만둬도 매장에 남아요',
                }]
              : []),
          ]}
        />
        {/* 노하우 0개면 카드를 세우지 않는다 — 옛 판본은 테두리·그림자만 있는 빈 상자가 남았다(2026-08-06). */}
        {myEntries.length > 0 && (
        <View style={styles.card}>
          {/* 내 노하우 원문 목록(0094) — 행 탭 = 원문 시트. 카운트와 같은 술어라 개수가 일치한다. */}
          {(showAllEntries ? myEntries : myEntries.slice(0, ENTRY_LIST_FIRST)).map((e) => (
            <Pressable
              key={e.id}
              onPress={() => setOpenEntry(e)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`노하우 ${e.title} 원문 보기`}
            >
              {growth.length > 1 && (
                <View style={[styles.dot, { backgroundColor: storeColor(e.unit_id, prefFor(e.unit_id).color) }]} />
              )}
              <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
              {(e.stats?.query_hits_30d ?? 0) > 0 && (
                <Text style={styles.rowSub}>{`${e.stats.query_hits_30d}번 참조`}</Text>
              )}
              <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
            </Pressable>
          ))}
          {!showAllEntries && myEntries.length > ENTRY_LIST_FIRST && (
            <Pressable
              onPress={() => setShowAllEntries(true)}
              style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="노하우 나머지 보기"
            >
              <Text style={styles.moreBtnText}>{`나머지 ${myEntries.length - ENTRY_LIST_FIRST}개 보기`}</Text>
            </Pressable>
          )}
        </View>
        )}
      </Appear>

      {/* ── 매장별 축적 — 합계는 위 L4로 올라갔다. 여기 남는 건 매장별 분해뿐이라
             **다매장 직원에게만** 그린다. 단일 매장이면 위 숫자가 곧 그 매장의 값이라 섹션 자체가 사라진다.
             ★2026-08-27: 행 리스트 → **RollupRows(L5)**. 지표가 매장별로 대등하고 각자 대표 대상을
               가질 수 있는 모양이라(그 매장에서 가장 최근에 통과한 노하우) §7-4 B 그대로다.
             숙련 주장 없음(완료 ≠ 숙련). ── */}
      {growth.length > 1 && (
      <Appear delay={stagger(2)} style={{ gap: Space.sm }}>
        <SectionLabel title="매장별" />
        <RollupRows
          rows={growth.map((r) => {
            const last = latestByUnit.get(r.unit_id);
            return {
              key: r.unit_id,
              title: labelOf(r.unit_id, r.store_name),
              // 건수는 히어로와 **같은 축**이다 — 그 매장에서 내가 아는(통과한) 노하우 수.
              // 다른 축을 세우면 위 링과 아래 행이 서로 다른 말을 한다.
              count: trainingHistory.filter((h) => h.unitId === r.unit_id).length,
              unit: '개' as const,
              // 대표 대상 1줄(R2) — 통과 이력이 있으면 그 노하우, 없으면 해본 업무로 대신 말한다.
              target: last
                ? `가장 최근 · ${last.entryTitle}`
                : `해본 업무 ${r.done_kinds}종 · 내가 만든 노하우 ${r.my_knowhow}개`,
              onPress: () => { if (!switching) goStore(r.unit_id, '/junior/work'); },
            };
          })}
        />
      </Appear>
      )}

      {/* ── 훈련 통과 이력(0104) — 있을 때만. 통과 사실만 말하고 점수·등급을 만들지 않는다 ── */}
      {trainingHistory.length > 0 && (
        <Appear delay={stagger(3)}>
          {/* 제목이 히어로와 같은 말을 쓴다 — 위 링의 분자가 곧 이 목록이다(되물음 테스트: "퀴즈"만으론
              뭘 통과했는지 안 읽힌다). */}
          <SectionLabel title="퀴즈로 확인한 노하우" hint={`${trainingHistory.length}개`} />
          <View style={styles.card}>
            {(showAllTraining ? trainingHistory : trainingHistory.slice(0, ENTRY_LIST_FIRST)).map((h) => (
              <View key={`${h.unitId}_${h.entryId}`} style={styles.row}>
                {growth.length > 1 && (
                  <View style={[styles.dot, { backgroundColor: storeColor(h.unitId, prefFor(h.unitId).color) }]} />
                )}
                <Text style={styles.rowTitle} numberOfLines={1}>{h.entryTitle}</Text>
                <Text style={styles.rowSub}>{fmtMonthDay(h.verifiedAt)}</Text>
              </View>
            ))}
            {!showAllTraining && trainingHistory.length > ENTRY_LIST_FIRST && (
              <Pressable
                onPress={() => setShowAllTraining(true)}
                style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="퀴즈 이력 나머지 보기"
              >
                <Text style={styles.moreBtnText}>{`나머지 ${trainingHistory.length - ENTRY_LIST_FIRST}개 보기`}</Text>
              </Pressable>
            )}
          </View>
        </Appear>
      )}

      {/* ── 제안 진입점 — 가르침 실적이 0건일 때만.
             ★2026-08-19 판정("0건에도 이 존재를 알려야 한다")은 그대로 지키되, 자리를 맨 위 노랑 카드에서
               맨 아래 한 줄로 내렸다(2026-08-27). 카드가 아니므로 블록 예산에 세지 않는다.
               1건 이상이면 위 L4 '매장 노하우가 된 내 답' 칸이 같은 말을 이미 한다. ── */}
      {totals.taught === 0 && growth[0] && (
        <Appear delay={stagger(4)}>
          <Pressable
            onPress={() => goStore(growth[0].unit_id, '/junior/suggest')}
            disabled={!!switching}
            style={({ pressed }) => [styles.suggestLink, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="노하우 제안하러 가기"
          >
            <Ionicons name="bulb-outline" size={15} color={InkColors.ink2} />
            <Text style={styles.suggestText}>내가 아는 것을 제안하면 매장 노하우로 남아요 · 제안하기</Text>
            <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
          </Pressable>
        </Appear>
      )}

      {/* 노하우 원문 시트 — 물어보기 [출처]와 동일 컴포넌트(읽기 전용) 재사용 */}
      <EntryDetailModal entry={openEntry} visible={!!openEntry} onClose={() => setOpenEntry(null)} />
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

  // 빈 상태
  emptyTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink, paddingTop: Space.xs },
  emptyBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, marginTop: Space.xs },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: BrandColors.yellowSoft,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    marginTop: Space.md,
    marginBottom: Space.xs,
  },
  emptyBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  // 스켈레톤 카드 — 가짜 수치가 없으므로 opacity 로 흐리지 않는다(흐림 = 가짜 표시였다).
  ghostCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    gap: Space.xs,
  },
  ghostTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  // 숫자가 올 자리 — 값을 지어내지 않고 '여기에 온다'만 표시한다.
  ghostBar: { width: 64, height: 22, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft },
  ghostBody: { fontSize: 12.5, color: InkColors.ink2 },

  // 히어로 카드(H3′) — 링 + 우측 슬롯. 노하우 허브 heroCard 와 같은 여백(데모 §4 `card.hero` 20/20/16).
  heroCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.gutter,
    paddingTop: Space.gutter,
    // 하단 여백은 점 인디케이터 상자(48dp)가 겸한다 — 사장 노하우 탭 히어로와 같은 값(2026-09-03).
    paddingBottom: 0,
    ...Elevation.e2,
  },
  // 앞면(V1 범례) — 꼬리표라 본문 15sp 하한 대상이 아니다.
  lgRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 1 },
  lgDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  lgDot: { width: 9, height: 9, borderRadius: Radius.pill },
  lgDotBorder: { borderWidth: 1, borderColor: InkColors.line },
  lgText: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 17, fontWeight: '700', color: InkColors.ink2 },
  lgValue: { fontSize: 17, lineHeight: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4 },
  // 뒷면(V2 대상형) — 최근 통과 노하우 제목. 원장에 제목이 있어 대상을 말할 수 있다(R2).
  faceLabel: { fontSize: 11.5, lineHeight: 16, fontWeight: '800', color: InkColors.ink3, marginBottom: 2 },
  tgRow: { paddingVertical: Space.sm, minWidth: 0 },
  tgTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800', color: InkColors.ink },
  tgSub: { fontSize: 11.5, lineHeight: 16, color: InkColors.ink3, marginTop: 1 },
  // 제안 진입점 한 줄 — 카드가 아니다(블록 예산 밖).
  suggestLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.sm,
  },
  suggestText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '700', color: InkColors.ink2 },

  statRow: { flexDirection: 'row', paddingVertical: Space.xs },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  statV: { fontSize: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  statUnit: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  statL: { fontSize: 11.5, color: InkColors.ink3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2, borderTopWidth: 1, borderTopColor: InkColors.line },
  moreBtn: { alignItems: 'center', paddingVertical: Space.sm + 2, borderTopWidth: 1, borderTopColor: InkColors.line },
  moreBtnText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  rowSub: { fontSize: 12, color: InkColors.ink3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
