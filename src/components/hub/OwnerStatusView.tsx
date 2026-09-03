// 사장 허브 '현황' 탭 본문 — 대시보드 본체 4블록(기획 v2 §03).
//  1) 오늘 스냅샷: 매장별 근무중/예정 카운트(카운트까지만 — 명단은 매장 출퇴근 화면)
//  2) 확인 필요: 합류 신청·받은질문·검토할 제안·확인 필요 노하우(행 탭 = 해당 매장 화면)
//  3) 매장 비교 표: 손 필요 순 기본·헤더 탭 정렬(★이 블록만 multi 게이팅, 매장 1곳=단일 요약)
//  4) 이번달: 인건비 합계 + AI 사용(무료 캡 대비 표기)
// 원칙: 전부 매장 단위(개인별 지표 산출 금지) · 허브는 읽기·이동까지(실행 UI 없음).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { canUseMultistore, PLANS } from '@/lib/config/tiers';
import { starterGraduated } from '@/lib/utils/starterProgress';
import { PlanUpgradeNotice } from '@/components/PlanUpgradeNotice';
import { StarterChecklist } from '@/components/hub/StarterChecklist';
import { StorePickerSheet, type StorePickerRow } from '@/components/hub/StorePickerSheet';
import { SectionLabel } from '@/components/SectionLabel';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHead } from '@/components/owner/quiz/kit';
import { AlertRow } from '@/components/blocks/AlertRow';
import { ProgressPill } from '@/components/blocks/ProgressPill';
import { StackBar } from '@/components/blocks/StackBar';
import { StatCardGrid, type StatCardItem } from '@/components/blocks/StatCardGrid';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Appear, stagger } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Href } from 'expo-router';

type SortKey = 'pending_q' | 'working' | 'uncovered' | 'labor_month';

/**
 * 로딩 자리표의 최소 높이 — 본문(경고행·오늘·확인 필요·이번달)이 도착해도 화면이 튀지 않게 미리 자리를 잡는다.
 * ⚠️ 고정 height 금지: 글자 배율이 커지면 상자가 터진다(재발 이력). 최소값만 잡고 내용이 넘치면 늘어난다.
 */
const LOADING_MIN_HEIGHT = 360;

/** 표 셀용 축약 금액 — 1만 미만은 그대로, 이상은 만 단위(표 폭 보호). */
const fmtWonShort = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n.toLocaleString());

export function OwnerStatusView({ header }: { header: ReactNode }) {
  const overview = useHubStore((s) => s.overview);
  const today = useHubStore((s) => s.today);
  const ownerLoaded = useHubStore((s) => s.ownerLoaded);
  const todayLoaded = useHubStore((s) => s.todayLoaded);
  const ownerLoadError = useHubStore((s) => s.ownerLoadError);
  // 이번달 인건비 원장 = 근무표 기준·computePay(0185) — 직원 관리 히어로와 **같은 계산**. overview.labor_month(출퇴근×시급)는 안 읽는다.
  const labor = useHubStore((s) => s.labor);
  const laborLoaded = useHubStore((s) => s.laborLoaded);
  const laborLoadError = useHubStore((s) => s.laborLoadError);
  const hydrateOwner = useHubStore((s) => s.hydrateOwner);
  const retryOwner = useHubStore((s) => s.retryOwner);
  // L4 '직원이 아는 노하우' 칸(D6 · 2026-08-27) — 노하우 탭 링·퀴즈 홈 히트맵과 **같은 원장**(owner_knowhow_stats).
  const knowhowStats = useHubStore((s) => s.knowhowStats);
  const knowhowStatsLoaded = useHubStore((s) => s.knowhowStatsLoaded);
  const hydrateKnowhowStats = useHubStore((s) => s.hydrateKnowhowStats);
  const crossData = useCrossNotifStore((s) => s.data);
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const plan = useSessionStore((s) => s.plan);
  const freeMode = useSessionStore((s) => s.freeMode);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const prefsLoaded = useMemberPrefsStore((s) => s.loaded);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();
  // 현재 플랜의 월 AI 캡(무료 150 / 유료 매장당 1500). null 이면 캡 없음 = 분모를 그리지 않는다.
  const aiCap = PLANS[plan].aiMonthly;

  useEffect(() => {
    void hydrateOwner();
    void hydrateCross();
    void hydratePrefs();
    void hydrateKnowhowStats();
  }, [hydrateOwner, hydrateCross, hydratePrefs, hydrateKnowhowStats]);

  const [sortKey, setSortKey] = useState<SortKey>('pending_q');
  /** '확인 필요' 칸을 눌렀는데 갈래가 둘 이상일 때 — 갈래 3행을 시트로(목적지가 제각각이라 한 칸이 못 고른다). */
  const [inboxOpen, setInboxOpen] = useState(false);

  /** 노하우 이해도 합계 — 매장마다 (노하우 × 직원)을 곱한 뒤 더한다(노하우 탭과 같은 계산). */
  const knowing = useMemo(() => {
    let cells = 0; let known = 0; let entries = 0; let staff = 0;
    for (const s of knowhowStats) { cells += s.entries * s.staff; known += s.understood; entries += s.entries; staff += s.staff; }
    return { cells, known, entries, staff, pct: cells > 0 ? Math.round((known / cells) * 100) : 0 };
  }, [knowhowStats]);

  const todayByUnit = useMemo(() => {
    const m: Record<string, { working_now: number; scheduled: number }> = {};
    for (const r of today) m[r.unit_id] = r;
    return m;
  }, [today]);

  const labelOf = (uid: string) =>
    prefFor(uid).nickname || overview.find((r) => r.unit_id === uid)?.store_name || '매장';
  const colorOf = (uid: string) => storeColor(uid, prefFor(uid).color);

  // 소유 매장 집합 = overview(owner_overview 소유검증)가 SSOT — 직원 수 판정 4중 복제 방지(실사 경고).
  const ownedIds = useMemo(() => new Set(overview.map((r) => r.unit_id)), [overview]);

  // ── 확인 필요 집계(합류·질문·제안·검증) — 항목마다 "어느 매장에 몇 건"을 들고 있는다.
  //    다점포면 행 탭 = 항상 매장 선택 시트(0건 매장 포함 — 어느 매장 건인지 보이게, 2026-07-31),
  //    매장 1곳이면 시트 없이 바로 이동. ──
  const inbox = useMemo(() => {
    const joins = crossData
      .filter((d) => ownedIds.has(d.unitId))
      .flatMap((d) => d.pending.map((p) => ({ uid: d.unitId, name: p.name })));
    const joinCounts = new Map<string, number>();
    for (const j of joins) joinCounts.set(j.uid, (joinCounts.get(j.uid) ?? 0) + 1);
    const unitsOf = (val: (r: (typeof overview)[number]) => number) =>
      overview.map((r) => ({ uid: r.unit_id, count: val(r) }));
    return {
      joins,
      joinUnits: unitsOf((r) => joinCounts.get(r.unit_id) ?? 0),
      questions: overview.reduce((n, r) => n + r.pending_q, 0),
      questionUnits: unitsOf((r) => r.pending_q),
      suggestions: overview.reduce((n, r) => n + r.sugg_pending, 0),
      suggestionUnits: unitsOf((r) => r.sugg_pending),
      needsReview: overview.reduce((n, r) => n + r.needs_review, 0),
      needsReviewUnits: unitsOf((r) => r.needs_review),
    };
  }, [crossData, ownedIds, overview]);
  const [picker, setPicker] = useState<{ title: string; path: Href; units: { uid: string; count: number }[] } | null>(null);

  // ── 매장 비교 정렬(손 필요 순 기본) — 정렬은 표 전용, 스냅샷·이번달은 매장 생성순 유지 ──
  const sorted = useMemo(() => {
    const val = (uid: string): number => {
      const r = overview.find((x) => x.unit_id === uid);
      if (!r) return 0;
      if (sortKey === 'working') return todayByUnit[uid]?.working_now ?? 0;
      if (sortKey === 'labor_month') return labor[uid] ?? 0;
      return r[sortKey];
    };
    return [...overview].sort((a, b) => val(b.unit_id) - val(a.unit_id));
  }, [overview, sortKey, todayByUnit, labor]);

  const laborTotal = overview.reduce((n, r) => n + (labor[r.unit_id] ?? 0), 0);
  const workingTotal = today.reduce((n, r) => n + r.working_now, 0);
  const scheduledTotal = today.reduce((n, r) => n + r.scheduled, 0);
  const multi = overview.length > 1;

  // 전부 도착 전엔 무조건 로딩 — 스냅샷 '—' 채움부터 그리지 않는다(부분 렌더 금지, 2026-07-31).
  // ★위 effect 가 같이 당기는 cross·prefs 도 게이트에 넣는다(2026-08-25). 빠져 있던 동안
  //   ① '확인 필요'가 "지금 확인할 일이 없어요"로 떴다가 합류 신청 행이 끼어들며 카드가 뒤바뀌었고
  //      (inboxEmpty 가 crossData 의 joins 를 센다) ② 매장 별명·색이 뒤늦게 갈아끼워졌다.
  // ★2026-08-25: `loaded` 계약이 "시도가 끝났다"로 통일되면서 이 게이트는 더 이상 영구 스피너가
  //   되지 않는다(#6). 예전엔 넷 다 "실패하면 loaded 를 안 올림" 계약이라 **하나만 실패해도
  //   사장이 로그인 직후 착지하는 이 화면이 영원히 "매장 현황을 불러오고 있어요…"** 였고,
  //   마운트 1회 fetch 라 재시도 버튼도 트리거도 없었다.
  if (!ownerLoaded || !todayLoaded || !laborLoaded || !crossLoaded || !prefsLoaded || !knowhowStatsLoaded) {
    return (
      <View style={styles.loading}>
        <ScreenLoading label="매장 현황을 불러오고 있어요…" />
      </View>
    );
  }

  // 실패는 "0건"으로 위장하지 않는다 — 현황 본문(overview)이 없으면 그릴 수 있는 게 없으므로
  // 재시도 화면으로 갈음한다. cross·prefs 만 실패한 경우는 본문이 유효하니 배너(readFail)에 맡긴다.
  if (ownerLoadError) {
    return (
      <View style={styles.loading}>
        <LoadErrorState title="매장 현황을 불러오지 못했어요" onRetry={() => void retryOwner()} />
      </View>
    );
  }

  const inboxRow = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    count: number,
    units: { uid: string; count: number }[],
    path: Href,
    sub?: string,
  ) => {
    if (count === 0) return null;
    return (
      <Pressable
        key={title}
        onPress={() => {
          setInboxOpen(false);
          if (multi) setPicker({ title, path, units });
          else if (units[0]) void goStore(units[0].uid, path);
        }}
        disabled={!!switching}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={15} color={InkColors.ink2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
          {!!sub && <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>}
        </View>
        <ProgressPill text={String(count)} tone="neutral" />
        <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
      </Pressable>
    );
  };

  /** 확인 필요 갈래 3행 — 시트와 (갈래가 하나뿐일 때) 칸 탭이 같은 것을 쓴다. */
  const inboxKinds = [
    { key: 'join', n: inbox.joins.length, label: '합류', color: BrandColors.mention, path: '/owner/staff' as Href, units: inbox.joinUnits, title: '합류 신청' },
    { key: 'sugg', n: inbox.suggestions, label: '제안', color: BrandColors.good, path: '/owner/suggestions' as Href, units: inbox.suggestionUnits, title: '승인 기다리는 제안' },
    { key: 'review', n: inbox.needsReview, label: '노하우', color: BrandColors.warn, path: '/owner/knowledge?review=1' as Href, units: inbox.needsReviewUnits, title: '점검할 노하우' },
  ];
  const inboxTotal = inboxKinds.reduce((n, k) => n + k.n, 0);
  const inboxLive = inboxKinds.filter((k) => k.n > 0);
  const goKind = (k: (typeof inboxKinds)[number]) => {
    if (multi) setPicker({ title: k.title, path: k.path, units: k.units });
    else { const u = k.units.find((x) => x.count > 0) ?? k.units[0]; if (u) void goStore(u.uid, k.path); }
  };

  /**
   * L4 매장 상태 그리드(§7-2 · 2026-08-27). 칸 = [라벨+›][큰 값][시각요소]. R4: 원장 있는 것만 그림 —
   *  · 직원이 아는 노하우 = 스냅샷(구성 원장 없음) → 시각요소 없이 절대 수 한 줄
   *  · 확인 필요 = 지금 값의 **구성**(합류/제안/노하우) → StackBar
   *  · 이번달 인건비·AI 답변 = 월 이력 원장을 클라가 안 갖고 있어 막대 없음(가짜 추세 금지)
   * ★'이번 주 퀴즈' 칸은 넣지 않았다 — 허브 RPC 에 발송·응시 집계가 없다. 퀴즈 홈이 담당한다.
   * ★퀴즈 관리 진입은 2026-08-07 결정대로 노하우 탭이다(D6). 여기 칸은 **읽기 진입**(/owner/training).
   */
  const gridItems: StatCardItem[] = [
    {
      // 옛 '오늘' MiniStats 2칸(근무중·예정)을 한 칸으로. 막대 없음(R4): working_now(출퇴근 기록)와
      // scheduled(근무 편성)는 서로 부분집합이 아니라 `scheduled − working_now` 로 구성을 그릴 수 없다.
      key: 'today',
      label: '오늘 근무',
      value: scheduledTotal,
      unit: '명 예정',
      sub: workingTotal > 0 ? `지금 ${workingTotal}명 근무중` : '지금은 출근 전이에요',
      onPress: () => {
        if (multi) setPicker({ title: '근무표', path: '/owner/schedule', units: overview.map((r) => ({ uid: r.unit_id, count: 0 })) });
        else if (overview[0]) void goStore(overview[0].unit_id, '/owner/schedule');
      },
    },
    {
      key: 'knowing',
      label: '직원이 아는 노하우',
      value: knowing.cells > 0 ? knowing.pct : '없어요',
      unit: knowing.cells > 0 ? '%' : undefined,
      // ★다점포는 곱식을 쓰지 않는다 — 칸은 매장별 곱의 합이라 "전체 노하우 × 전체 직원"과 안 맞는다.
      sub: knowing.cells > 0 ? (multi ? `${knowing.cells}칸 중 ${knowing.known}칸` : `노하우 ${knowing.entries}개 × 직원 ${knowing.staff}명`) : knowing.staff === 0 ? '직원이 들어오면 보여요' : '노하우를 담으면 보여요',
      onPress: () => {
        if (multi) setPicker({ title: '퀴즈', path: '/owner/training', units: overview.map((r) => ({ uid: r.unit_id, count: 0 })) });
        else if (overview[0]) void goStore(overview[0].unit_id, '/owner/training');
      },
    },
    {
      key: 'inbox',
      // 2026-08-27 어휘 분리: 점검(노하우 다시 보기) ≠ 승인(제안·합류). 한 줄 "확인 필요 4건"으로 합치지 않고
      // 위 줄 = 점검할 노하우 수, 아래 줄 = 승인 기다리는 것(제안·합류). 칸은 그대로 1장, 구성은 StackBar.
      label: '점검할 노하우',
      value: inbox.needsReview > 0 ? inbox.needsReview : '없어요',
      unit: inbox.needsReview > 0 ? '개' : undefined,
      sub: inboxLive.filter((k) => k.key !== 'review').map((k) => `${k.key === 'sugg' ? '승인 기다리는 제안' : k.title} ${k.n}건`).join(' · ') || undefined,
      visual: inboxTotal > 0 ? <StackBar parts={inboxKinds.map((k) => ({ n: k.n, label: k.label, color: k.color }))} /> : undefined,
      onPress: inboxTotal === 0 ? undefined : inboxLive.length === 1 ? () => goKind(inboxLive[0]) : () => setInboxOpen(true),
    },
    {
      key: 'labor',
      label: '이번달 인건비',
      // 근무표 기준·computePay(0185) = 직원 관리 히어로와 같은 숫자. 못 읽었으면 0원으로 위장하지 않는다.
      value: laborLoadError ? '—' : laborTotal >= 10000 ? Math.round(laborTotal / 10000).toLocaleString() : laborTotal.toLocaleString(),
      unit: laborLoadError ? undefined : laborTotal >= 10000 ? '만원' : '원',
      sub: laborLoadError ? '불러오지 못했어요' : multi ? `매장 ${overview.length}곳 합계 · 근무표 기준` : '근무표 기준',
      onPress: () => {
        if (multi) setPicker({ title: '급여', path: '/owner/payroll', units: overview.map((r) => ({ uid: r.unit_id, count: 0 })) });
        else if (overview[0]) void goStore(overview[0].unit_id, '/owner/payroll');
      },
    },
    // 'AI 답변 사용' 칸은 2026-08-27 §7-6 판정으로 뺐다 — 월 사용/캡은 매장 설정(owner/settings)의 한 행으로 옮김.
  ];

  // 시작 체크리스트(콜드스타트) — 매장 1곳 사장만(신규 단일 매장이 타깃, 다점포는 이미 루프를 앎).
  // ownerLoaded 게이트로 "로드 전"을 "새 매장"으로 위장하지 않는다. 4단계 완료 시 영구 소멸.
  const starterRow = overview.length === 1 && !starterGraduated(overview[0]) ? overview[0] : null;

  return (
    <>
      {/* 화면 제목 — 게이트 안이다. 밖에 두면 제목만 먼저 등장하고 본문이 수 백 ms 뒤에 갈아끼워진다. */}
      {header}
      {/* 카드↔카드 = md(12). 제목 달린 섹션 앞의 추가 여백은 SectionLabel 자신이 든다(2026-09-03). */}
      <View style={{ gap: Space.md }}>
      {starterRow && (
        <Appear delay={stagger(0)}>
          <StarterChecklist row={starterRow} />
        </Appear>
      )}

      {/* ── 1) 답 기다리는 질문(블록 X2) — 사장이 오늘 손대야 할 유일한 '막힌 것'.
             2026-08-06: '확인 필요' 카드 안 한 행이던 것을 맨 위 경고행으로 승격했다.
             0건이면 AlertRow가 스스로 숨는다. 아래 '확인 필요'에서는 뺐다(같은 사실 두 번 금지). ── */}
      <Appear delay={stagger(1)}>
        <AlertRow
          label="답 기다리는 질문"
          count={inbox.questions}
          unit="건"
          icon="chatbubble"
          onPress={() => {
            if (multi) setPicker({ title: '답 기다리는 질문', path: '/owner/inbox', units: inbox.questionUnits });
            else if (inbox.questionUnits[0]) void goStore(inbox.questionUnits[0].uid, '/owner/inbox');
          }}
        />
      </Appear>

      {/* ── 2) '오늘' 섹션(MiniStats 2칸)은 2026-08-27 §7-6 판정으로 아래 L4 첫 칸('오늘 근무')에 흡수했다.
             MiniStats 2칸이 바로 아래 그리드와 형태가 겹치고 숫자 옆에 대상이 없었다(R2). ── */}

      {/* 매장별 근무 현황 — 단일 매장이면 아래 '오늘 근무' 칸이 이미 같은 숫자를 말하므로 그리지 않는다.
          다점포에서만 '어느 매장이 비었나'가 새 정보가 된다. */}
      {multi && (
      <Appear delay={stagger(2)}>
        <View style={styles.card}>
          {overview.map((r) => {
            const t = todayByUnit[r.unit_id];
            return (
              <Pressable
                key={r.unit_id}
                // 이 행이 말하는 것은 '근무중 n · 예정 n' = 출퇴근+근무표다. 착지도 근무표여야 한다
                // (2026-08-11 P2: 직원 관리에는 스케줄이 없어 "예정 N"이 가리키는 곳에 그게 없었다).
                // 지금 누가 근무중인지의 명단은 직원 관리 로스터가 계속 담당한다(staff에 근무표 진입점 행을 둠).
                onPress={() => goStore(r.unit_id, '/owner/schedule')}
                disabled={!!switching}
                style={({ pressed }) => [styles.row, styles.rowTop, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                <Text style={[styles.rowSub, (t?.working_now ?? 0) > 0 && styles.onair]}>
                  {`${(t?.working_now ?? 0) > 0 ? `${t!.working_now}명 근무중` : '출근 전'} · 예정 ${t?.scheduled ?? 0}`}
                </Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </Pressable>
            );
          })}
        </View>
      </Appear>
      )}

      {/* ── 3) 매장 상태 — L4 2열 지표 그리드(2026-08-27 §7-2).
             옛 '확인 필요' 카드 3행 → 스택바 1칸(구성 = 합류/제안/노하우), 옛 '이번달' MiniStats 2칸 → 그리드 칸.
             퀴즈 관리 진입점은 2026-08-07 결정대로 노하우 탭(OwnerKnowhowHubView)이다 — 되돌리는 게 아니다.
             '직원이 아는 노하우' 칸은 **읽기 진입**(D6 확정: 현황엔 지표 칸만, 관리는 노하우 탭).
             받은질문은 맨 위 AlertRow(2026-08-06) — 여기서 다시 세지 않는다. ── */}
      <Appear delay={stagger(3)}>
        <SectionLabel title="매장 상태" />
        <View style={{ marginTop: Space.sm }}>
          <StatCardGrid items={gridItems} />
        </View>
      </Appear>

      {/* ── 3) 매장 비교(다점포) / 단일 매장 요약 ── */}
      {multi && (
        <Appear delay={stagger(4)}>
          <SectionLabel title="매장 비교" />
          {canUseMultistore(plan, freeMode) ? (
            <View style={styles.card}>
              <View style={styles.thRow}>
                <Text style={[styles.th, styles.thName]}>매장</Text>
                <SortTh label="질문" k="pending_q" cur={sortKey} onPress={setSortKey} />
                <SortTh label="근무" k="working" cur={sortKey} onPress={setSortKey} />
                <SortTh label="미첨부" k="uncovered" cur={sortKey} onPress={setSortKey} />
                <SortTh label="인건비" k="labor_month" cur={sortKey} onPress={setSortKey} />
              </View>
              {sorted.map((r) => {
                const t = todayByUnit[r.unit_id];
                return (
                  <Pressable
                    key={r.unit_id}
                    onPress={() => goStore(r.unit_id, '/owner/dashboard', 'replace')}
                    disabled={!!switching}
                    style={({ pressed }) => [styles.tdRow, pressed && { opacity: 0.85 }]}
                  >
                    <View style={[styles.tdName, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                      <Text style={styles.tdNameText} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                    </View>
                    <Text style={[styles.td, r.pending_q > 0 && styles.tdHot]}>{r.pending_q}</Text>
                    <Text style={styles.td}>{`${t?.working_now ?? 0}/${t?.scheduled ?? 0}`}</Text>
                    <Text style={styles.td}>{r.uncovered}</Text>
                    <Text style={styles.td}>{laborLoadError ? '—' : fmtWonShort(labor[r.unit_id] ?? 0)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <PlanUpgradeNotice description="전체 매장을 지표로 비교하는 표는 다점포 요금제 기능이에요." />
          )}
        </Appear>
      )}

      {/* ── 4) 이번달 매장별 내역 — 다점포에서만. 합계는 위 그리드 칸(인건비)이 말한다. ── */}
      {multi && (
      <Appear delay={stagger(5)}>
        <SectionLabel title="이번달 매장별" />
          <View style={[styles.card, { marginTop: Space.sm }]}>
            {overview.map((r) => (
              <View key={r.unit_id} style={[styles.row, styles.rowTop]}>
                <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                <Text style={styles.rowSub}>
                  {`${laborLoadError ? '—' : `${(labor[r.unit_id] ?? 0).toLocaleString()}원`} · AI ${r.ai_used}${aiCap != null ? `/${aiCap.toLocaleString()}` : ''}건`}
                </Text>
              </View>
            ))}
          </View>
      </Appear>
      )}

      {/* 확인 필요 갈래 시트 — 갈래가 둘 이상일 때만 열린다(하나면 칸 탭이 바로 그리로 간다). */}
      {inboxOpen && (
        <BottomSheet visible onClose={() => setInboxOpen(false)}>
          {/* X 없음 — 바깥 탭·아래로 드래그로 닫힌다(BottomSheet). 카드는 제목에 바싹(marginTop 0). */}
          <SheetHead title="점검·승인" />
          <View style={[styles.card, { marginTop: 0, marginHorizontal: Space.lg, marginBottom: Space.lg }]}>
            {inboxRow(
              'person-add-outline', '합류 신청', inbox.joins.length, inbox.joinUnits, '/owner/staff',
              inbox.joins[0] ? `${labelOf(inbox.joins[0].uid)} · ${inbox.joins[0].name}님` : undefined,
            )}
            {inboxRow('bulb-outline', '승인 기다리는 제안', inbox.suggestions, inbox.suggestionUnits, '/owner/suggestions')}
            {inboxRow('search-outline', '점검할 노하우', inbox.needsReview, inbox.needsReviewUnits, '/owner/knowledge?review=1')}
          </View>
        </BottomSheet>
      )}

      <StorePickerSheet
        visible={!!picker}
        title={picker?.title ?? ''}
        hint="매장을 골라 주세요"
        rows={(picker?.units ?? []).map(
          // 0건 매장은 배지를 그리지 않는다(배지 없음 = 없음) — "0" 경고 배지는 오독을 부른다.
          (u): StorePickerRow => ({ uid: u.uid, label: labelOf(u.uid), color: colorOf(u.uid), count: u.count > 0 ? u.count : undefined }),
        )}
        onPick={(uid) => {
          const path = picker?.path;
          setPicker(null);
          if (path) void goStore(uid, path);
        }}
        onClose={() => setPicker(null)}
      />
      </View>
    </>
  );
}

function SortTh({ label, k, cur, onPress }: { label: string; k: SortKey; cur: SortKey; onPress: (k: SortKey) => void }) {
  const on = cur === k;
  return (
    <Pressable onPress={() => onPress(k)} hitSlop={6} style={styles.thCell}>
      <Text style={[styles.th, on && styles.thOn]}>{label}{on ? ' ↓' : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { minHeight: LOADING_MIN_HEIGHT, paddingVertical: Space.xl * 2, alignItems: 'center', justifyContent: 'center' },
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
  statRow: { flexDirection: 'row', paddingVertical: Space.xs },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  statV: { fontSize: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  statUnit: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  statL: { fontSize: 11.5, color: InkColors.ink3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2 },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowIcon: {
    width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  rowSub: { fontSize: 12, color: InkColors.ink3 },
  onair: { color: BrandColors.goodText, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  emptyText: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', paddingVertical: Space.sm },
  caption: { fontSize: 11.5, color: InkColors.ink3, marginTop: Space.sm, textAlign: 'center' },

  // 비교 표 — 이름 열 flex, 수치 열 고정폭 우측 정렬(웹·네이티브 공통 문법)
  thRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: Space.xs, gap: 2 },
  thCell: { width: 52, alignItems: 'flex-end' },
  th: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  thOn: { color: InkColors.ink },
  thName: { flex: 1 },
  tdRow: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderTopWidth: 1, borderTopColor: InkColors.line, paddingVertical: Space.sm + 2,
  },
  tdName: { flex: 1, minWidth: 0 },
  tdNameText: { fontSize: 13, fontWeight: '700', color: InkColors.ink, flexShrink: 1 },
  td: { width: 52, textAlign: 'right', fontSize: 12.5, fontWeight: '600', color: InkColors.ink2 },
  // 주황 글자색은 2026-09-03 폐기 — 굵기만으로 강조한다.
  tdHot: { color: InkColors.ink, fontWeight: '900' },
});
