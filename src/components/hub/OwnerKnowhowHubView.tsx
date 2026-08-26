// 사장 허브 '노하우' 탭 본문 — 지식 신선도(슬라이스 D, 3탭 확장의 두 번째 탭).
//
// 무엇: "매장 지식이 지금도 맞는가"를 매장 단위로 보여준다(O4·O5 — 격자·bus factor 없이).
//   · 노하우로 만들 것 = 미답변 질문(pending_q) — 답 하나가 노하우 하나가 되는 입구
//   · 확인이 필요한 노하우(needs_review) — 시드·제안 반영분의 확인 대기
//   · 오래 손 안 댄 노하우(stale, 90일+) — 메뉴·가격이 변했는데 노하우만 옛날일 위험
// 원칙: 허브는 읽기·이동까지(실행은 매장 화면) · 매장 단위만 · 0은 위험이 아니라 좋은 소식
//   ("지금은 손볼 노하우가 없어요") · 노하우 0인 매장은 행동 버튼(노하우 담기)이 먼저.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { sortByUrgency } from '@/lib/utils/unknownQuery';
import { formatAsked } from '@/lib/utils/time';
import { StorePickerSheet, type StorePickerRow } from '@/components/hub/StorePickerSheet';
import { SectionLabel } from '@/components/SectionLabel';
import { ActionRow } from '@/components/blocks/ActionRow';
import { FocusCard } from '@/components/blocks/FocusCard';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { RollupRows, type RollupRow } from '@/components/blocks/RollupRows';
import { AlertRow } from '@/components/blocks/AlertRow';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear, stagger } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Href } from 'expo-router';

export function OwnerKnowhowHubView({ header }: { header: ReactNode }) {
  const overview = useHubStore((s) => s.overview);
  const ownerLoaded = useHubStore((s) => s.ownerLoaded);
  const hydrateOwner = useHubStore((s) => s.hydrateOwner);
  const stats = useHubStore((s) => s.knowhowStats);
  const statsLoaded = useHubStore((s) => s.knowhowStatsLoaded);
  const hydrateStats = useHubStore((s) => s.hydrateKnowhowStats);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const prefsLoaded = useMemberPrefsStore((s) => s.loaded);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();
  const router = useRouter();
  /**
   * 가장 급한 질문 1건(FocusCard · §7-4 A) — 질문 본문은 활성 매장 큐에만 있다(허브 RPC 는 건수뿐).
   * 그래서 **단일 매장에서만** 인용한다. 다점포는 롤업(B)으로 — 어느 매장 질문인지가 먼저다.
   */
  const uqQueue = useUnknownQueueStore((s) => s.queue);
  const uqLoaded = useUnknownQueueStore((s) => s.loaded);
  const hydrateUq = useUnknownQueueStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateOwner();
    void hydrateStats();
    void hydratePrefs();
    void hydrateUq();
  }, [hydrateOwner, hydrateStats, hydratePrefs, hydrateUq]);

  /**
   * 이해도 합계 — ★매장마다 (노하우 × 직원)을 곱한 뒤 더한다.
   * 합계끼리 곱하면(전체 노하우 × 전체 직원) 다른 매장의 노하우와 직원이 교차해
   * 존재하지 않는 칸까지 분모에 들어간다. 다점포에서 이해율이 실제보다 낮게 나오는 경로다.
   */
  const understanding = useMemo(() => {
    let cells = 0;
    let known = 0;
    let noItems = 0;
    let entries = 0;
    let staff = 0;
    for (const s of stats) {
      cells += s.entries * s.staff;
      known += s.understood;
      noItems += s.no_items;
      entries += s.entries;
      staff += s.staff;
    }
    return { cells, known, noItems, entries, staff };
  }, [stats]);

  const labelOf = (uid: string) =>
    prefFor(uid).nickname || overview.find((r) => r.unit_id === uid)?.store_name || '매장';
  const colorOf = (uid: string) => storeColor(uid, prefFor(uid).color);

  const totals = useMemo(
    () =>
      overview.reduce(
        (a, r) => ({
          pending: a.pending + r.pending_q,
          review: a.review + r.needs_review,
          stale: a.stale + r.stale,
          knowhow: a.knowhow + r.knowhow,
        }),
        { pending: 0, review: 0, stale: 0, knowhow: 0 },
      ),
    [overview],
  );
  const emptyStores = useMemo(() => overview.filter((r) => r.knowhow === 0), [overview]);
  const allClear = totals.pending === 0 && totals.review === 0 && totals.stale === 0;
  /** 단일 매장의 가장 오래 기다린 질문(sortByUrgency SSOT). 다점포·0건이면 null → 롤업(B). */
  const urgent = useMemo(() => {
    if (overview.length !== 1) return null;
    const pending = uqQueue.filter((u) => u.status === 'pending_owner_answer');
    return pending.length > 0 ? sortByUrgency(pending)[0] : null;
  }, [overview.length, uqQueue]);

  // 매장 선택 시트 공용 — "어느 매장에/에서"가 먼저인 모든 흐름이 쓴다.
  // 2026-08-06: templates·import 두 상수였던 것을 범용 형태로 바꿨다. 챙길 것 3지표(MiniStats)도
  // 다점포에서는 같은 시트로 매장을 고르게 하고, **매장별 건수는 시트의 배지가 보여준다** —
  // 옛 판본은 그 분해를 위해 섹션 카드를 3장 세워서 '제목 → 카드' 반복을 만들고 있었다.
  /**
   * ★`stay: true` = **활성 매장을 건드리지 않고** 그 매장을 대상으로만 삼는다(0121).
   * 여기서 고르는 매장은 권한 관문이 아니라 **입력 항목**이다 — 사장 권한은
   * `units.owner_id = auth.uid()` 로 매장 전체를 이미 덮는다. 전환하면 다른 탭의 맥락이
   * 따라 움직이고, "끝나면 되돌리기"라는 없어도 될 개념이 생긴다(재기획 §4-1).
   */
  type Picker = { title: string; hint: string; path: Href; rows: StorePickerRow[]; stay?: boolean };
  const [picker, setPicker] = useState<Picker | null>(null);
  const allRows = (): StorePickerRow[] =>
    overview.map((r) => ({ uid: r.unit_id, label: labelOf(r.unit_id), color: colorOf(r.unit_id) }));
  const startTemplates = (uid: string) => {
    if (overview.length > 1) {
      setPicker({ title: '노하우 담기', hint: '어느 매장에 담을지 골라 주세요', path: '/owner/templates', rows: allRows() });
    } else void goStore(uid, '/owner/templates');
  };

  /**
   * 관리 액션(A1) — 다점포면 "어느 매장에서 할지"를 먼저 고른다. 건수 배지는 없다:
   * 챙길 것 3지표와 달리 이건 "밀린 일"이 아니라 어느 매장에서든 시작할 수 있는 행동이다.
   */
  const act = (title: string, hint: string, path: Href, stay = false) => () => {
    if (overview.length > 1) setPicker({ title, hint, path, rows: allRows(), stay });
    else if (overview[0]) {
      if (stay) router.push(`${path}?unit=${overview[0].unit_id}` as never);
      else void goStore(overview[0].unit_id, path);
    }
  };

  /** 챙길 것 한 칸을 눌렀을 때 — 다점포면 매장 선택(건수 배지 포함), 단일이면 바로 이동. */
  const jump = (title: string, val: (r: (typeof overview)[number]) => number, path: Href) => () => {
    const hits = overview.filter((r) => val(r) > 0);
    if (overview.length > 1) {
      setPicker({
        title,
        hint: '확인할 매장을 골라 주세요',
        path,
        // 0건 매장은 배지를 그리지 않는다(배지 없음 = 없음) — StatusView와 같은 규칙.
        rows: overview.map((r) => ({ uid: r.unit_id, label: labelOf(r.unit_id), color: colorOf(r.unit_id), count: val(r) > 0 ? val(r) : undefined })),
      });
    } else if (hits[0]) void goStore(hits[0].unit_id, path);
    else if (overview[0]) void goStore(overview[0].unit_id, path);
  };

  // 전부 도착 전엔 무조건 로딩 — 화면 단일 게이트 하나로 판정한다(2026-08-25).
  // ★옛 판본은 `!ownerLoaded && overview.length === 0` 이라 **캐시된 overview 가 있으면 로딩 없이
  //   옛 값으로 그렸다**(`&&` → `||`). statsLoaded 는 게이트가 아니라 섹션 조건이어서 히어로 링과
  //   경고행이 화면이 뜬 뒤에 밀고 들어왔고, prefs 는 아예 빠져 매장 별명·색이 갈아끼워졌다.
  // 실패 표면화는 db.ts readFail(SyncBanner), 재시도는 각 hydrate 의 TTL 리셋이 맡는다.
  // ★단일 매장은 질문 큐(FocusCard 인용)까지 와야 한다 — 먼저 그리면 롤업이 떴다가 카드로 갈아끼워진다.
  if (!ownerLoaded || !statsLoaded || !prefsLoaded || (overview.length === 1 && !uqLoaded)) {
    return (
      <View style={styles.loading}>
        <ScreenLoading label="매장 노하우 현황을 불러오고 있어요…" />
      </View>
    );
  }

  // (2026-08-06) 매장별 카운트 행 storeRows는 제거했다 — 세 섹션 카드가 사라지면서 소비자가 없어졌고,
  // 매장별 분해는 이제 매장 선택 시트의 count 배지가 맡는다.

  return (
    <>
    {/* 화면 제목 — 게이트 안이다. 밖에 두면 제목만 먼저 등장하고 본문이 수 백 ms 뒤에 갈아끼워진다. */}
    {header}
    <View style={{ gap: Space.md }}>
      {/* ── 노하우 0 매장 = 담기가 먼저(빈 화면 행동 버튼).
             2026-08-07: **단일 매장에서만** 그린다. 다점포에서는 아래 '매장별 노하우' 카드가
             0개인 매장까지 전부 행으로 보여주므로, 여기에 또 세우면 같은 매장이 두 번 나온다. ── */}
      {overview.length === 1 && emptyStores.map((r) => (
        <Appear key={r.unit_id} delay={stagger(0)}>
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>{labelOf(r.unit_id)}에 아직 노하우가 없어요</Text>
            <Text style={styles.emptyBody}>업종 추천 노하우를 담으면 직원이 물을 때 AI가 대신 답해요.</Text>
            <Pressable
              onPress={() => startTemplates(r.unit_id)}
              disabled={!!switching}
              style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel="노하우 담기"
            >
              <Ionicons name="add-circle-outline" size={15} color={InkColors.ink} />
              <Text style={styles.emptyBtnText}>노하우 담기</Text>
            </Pressable>
          </View>
        </Appear>
      ))}

      {/* ── 이해도 히어로(블록 H3) — 2026-08-07 신설.
             "우리 매장 노하우를 직원들이 실제로 아는가"에 답하는 단 하나의 숫자.
             ★분모 = 발행 노하우 전체 × 직원(사용자 확정). 노하우를 추가하면 비율이 내려가므로
             절대 수(노하우 n개 · 직원 m명)를 함께 보여 "분모가 늘어난 것"이 실패로 안 읽히게 한다.
             ★로드 전에는 그리지 않는다 — 0%가 잠깐 스쳐 지나가면 사실이 아닌 것을 말한 것이다. ── */}
      {/* ★2026-08-19: 0이어도 **그린다**(옛 조건 `understanding.cells > 0` 해제).
             분모가 0이면 링이 통째로 사라졌는데, 그 상태가 정확히 "직원이 없거나 노하우가 없는" 신규
             매장이다 — 사장이 이 기능의 **존재 자체**를 알 다른 경로가 없다. 직원을 넣어야 링이 나타나는데
             넣을 이유를 그 링이 알려주는 순환이었다.
             ProgressRing 은 total===0 을 이미 처리한다(ratio 0 = 빈 트랙) — 블록은 손대지 않는다.
             ★도착 전 0/0 은 "정말 0"이 아니라 "아직 안 옴"이다 — 그 판정은 이제 화면 게이트가 한다
             (옛 판본의 `statsLoaded &&` 섹션 조건은 링을 뒤늦게 밀어 넣어 레이아웃이 튀었다). */}
      {/* ★2026-08-27(§7-2 H3′): 라벨 "직원이 확인한" → **"직원이 아는 노하우"** — 퀴즈 홈 히트맵과 같은 값을
             같은 이름으로 부른다. 링 고정 + 오른쪽 두 면 4초 전환(1회전 후 정지):
             앞면 = 범례(V1 · 얼마나 됐나) / 뒷면 = 큰숫자(V4 · 다음에 뭘 하나: 문항 없음 → 퀴즈 내기).
             대상형(V2, 노하우 제목 나열)은 허브 원장에 제목이 없어 쓰지 않는다(가짜 금지 R4). */}
      <Appear delay={stagger(1)}>
        {understanding.cells > 0 ? (
          <View style={styles.heroCard}>
            <ProgressRing
              value={understanding.known}
              total={understanding.cells}
              center={`${Math.round((understanding.known / understanding.cells) * 100)}%`}
              label="직원이 아는 노하우"
              swap={{
                faces: [
                  <View key="legend">
                    {[
                      { color: BrandColors.good, text: '직원이 앎', value: understanding.known },
                      { color: InkColors.bgSoft, border: true, text: '아직 모름', value: understanding.cells - understanding.known, hot: true },
                      { color: BrandColors.warn, text: '문항 없음', value: understanding.noItems, hot: understanding.noItems > 0 },
                    ].map((r, i) => (
                      <View key={r.text} style={[styles.lgRow, i > 0 && styles.lgDivider]}>
                        <View style={[styles.lgDot, { backgroundColor: r.color }, r.border && styles.lgDotBorder]} />
                        <Text style={styles.lgText} numberOfLines={1}>{r.text}</Text>
                        <Text style={[styles.lgValue, r.hot && styles.lgHot]}>{r.value}</Text>
                      </View>
                    ))}
                  </View>,
                  <View key="big">
                    {[
                      { n: understanding.noItems, text: '문항이 없는 노하우' },
                      { n: understanding.cells - understanding.known, text: '아직 모르는 칸' },
                    ].map((r, i) => (
                      <View key={r.text} style={[styles.bnRow, i > 0 && styles.lgDivider]}>
                        <Text style={[styles.bnValue, r.n > 0 && styles.lgHot]}>{r.n}</Text>
                        <Text style={styles.lgText} numberOfLines={1}>{r.text}</Text>
                      </View>
                    ))}
                  </View>,
                ],
                captions: [
                  `노하우 ${understanding.entries}개 × 직원 ${understanding.staff}명 = ${understanding.cells}칸 중 ${understanding.known}칸을 알아요.`,
                  understanding.noItems > 0
                    ? `문항이 없는 노하우 ${understanding.noItems}개부터 퀴즈로 내 보세요.`
                    : '모든 노하우에 문항이 있어요. 직원이 풀면 칸이 채워져요.',
                ],
              }}
            />
          </View>
        ) : (
          <ProgressRing
            value={understanding.known}
            total={understanding.cells}
            label="직원이 아는 노하우"
            sub={
              understanding.staff === 0
                ? '직원이 들어오면 우리 매장 노하우를 얼마나 아는지 여기서 보여드려요'
                : '노하우를 담으면 직원이 얼마나 아는지 여기서 보여드려요'
            }
          />
        )}
        {/* 빈 상태엔 다음 행동 하나 — 어느 쪽이 0인지에 따라 목적지가 다르다(둘 다 0이면 직원부터:
            노하우 담기는 바로 위 '노하우가 없어요' 카드가 이미 말하고 있다). */}
        {understanding.cells === 0 && (
          <Pressable
            onPress={
              understanding.staff === 0
                ? act('직원 초대', '어느 매장에 초대할지 골라 주세요', '/owner/staff')
                : act('노하우 담기', '어느 매장에 담을지 골라 주세요', '/owner/templates')
            }
            disabled={!!switching}
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={understanding.staff === 0 ? '직원 초대하기' : '노하우 담기'}
          >
            <Ionicons
              name={understanding.staff === 0 ? 'person-add-outline' : 'add-circle-outline'}
              size={15}
              color={InkColors.ink}
            />
            <Text style={styles.emptyBtnText}>{understanding.staff === 0 ? '직원 초대하기' : '노하우 담기'}</Text>
          </Pressable>
        )}
      </Appear>

      {/* ── 경고행(블록 X2) — 퀴즈로 안 쓰인 노하우. 0건이면 AlertRow 가 스스로 숨는다.
             ★2026-08-07: '아무도 모르는 노하우'(통과자 0)가 아니라 **문항이 없는 노하우**(no_items)를
             건다. 파이프라인상 이쪽이 먼저다 — 문항이 없으면 직원이 알 방법 자체가 없어서 아무리
             기다려도 이해율이 오르지 않는다. 사장이 지금 바로 할 수 있는 일이기도 하다.
             (통과자 0 지표 no_one 은 C단계 퀴즈 대시보드가 쓴다) ── */}
      {/* ★직원이 0명이면 그리지 않는다(cells === 0). 1인 매장에서는 모든 노하우가 정의상
             '아무도 모르는' 것이 되어 "24개가 위험"이라고 겁을 주는데, 직원이 없으니 사실은
             위험이 아니다. 지표가 참이어도 그 상태에서 할 수 있는 일이 없으면 경고가 아니다. */}
      {understanding.cells > 0 && (
        <Appear delay={stagger(2)}>
          <AlertRow
            label="퀴즈로 안 쓰인 노하우"
            count={understanding.noItems}
            unit="개"
            onPress={act('퀴즈로 안 쓰인 노하우', '어느 매장의 퀴즈를 볼지 골라 주세요', '/owner/training')}
          />
        </Appear>
      )}

      {/* ── 관리 액션(블록 A1) — 2026-08-07 신설.
             이 탭에서 할 수 있는 일이 '가져오기'뿐이라, 노하우를 추가하려면 매장을 고르고 한 층
             아래(매장 앱 노하우 탭)로 내려가야 했다. 진입점을 여기로 끌어올린다.
             ★ 새 입력 경로를 만들지 않는다 — '노하우 추가'는 매장 앱과 같은 /owner/coach 로 보낸다.
             퀴즈는 현황 탭에서 옮겨 온 것이다(퀴즈 = 노하우 이해도의 계측기). ── */}
      {/* ★2026-08-27: AR1(맨바닥 원형) 폐기 → `card`(AR2+). 형제 액션 = 한 상자. '추가'만 주 액션(노랑). */}
      <Appear delay={stagger(3)}>
        <ActionRow
          variant="card"
          items={[
            {
              key: 'add',
              icon: 'add',
              label: '노하우 추가',
              hint: '말로 · 사진으로',
              primary: true,
              // ★2026-08-07(0121): 매장을 골라도 **전환하지 않는다**. 고른 매장은 대상(입력 항목)일
              // 뿐이고, 쓰기는 definer RPC 가 `units.owner_id = auth.uid()` 를 검사해 처리한다.
              // 예전엔 전환 → 추가 → 되돌리기였는데, 그건 UI 상태가 권한 정책에 박혀 있어서
              // 생긴 땜질이었다(재기획 §4-1).
              onPress: act('노하우 추가', '어느 매장 이야기예요?', '/owner/coach', true),
            },
            {
              key: 'list',
              icon: 'list-outline',
              label: '노하우 목록',
              hint: totals.knowhow > 0 ? `${totals.knowhow}개` : undefined,
              // ★2026-08-07(0121): 매장을 먼저 고르게 하지 않는다. 허브 층 목록이 소유 매장 전체를
              // 매장별로 묶어 보여주고 **매장을 가로질러 검색**한다 — 전환해서 내려가면 그게 불가능했다.
              onPress: () => router.push('/hub-knowhow' as never),
            },
            {
              key: 'quiz',
              icon: 'school-outline',
              label: '퀴즈',
              onPress: act('퀴즈', '어느 매장의 퀴즈를 볼지 골라 주세요', '/owner/training'),
            },
          ]}
        />
      </Appear>

      {/* ── 매장별 노하우 — 매장 간 비교·가져오기. 2026-08-07: **다점포에서만** 그린다.
             단일 매장에서는 행이 하나뿐이라 "어느 매장이 비었나"라는 새 정보가 없고, 그 숫자는
             바로 위 히어로가 이미 말한다(현황 탭이 매장별 행에 쓰는 규칙과 같다).
             목록으로 가는 길은 위 ActionRow '노하우 목록'이 대신한다 — 도달 경로 손실 0. ── */}
      {overview.length > 1 && (
        <Appear delay={stagger(4)}>
          <SectionLabel title="매장별 노하우" />
          <View style={styles.card}>
            {/* 0개인 매장도 뺴지 않는다 — "어느 매장이 비었나"가 이 카드의 존재 이유다.
                착지는 매장을 가리지 않고 노하우 목록 하나로 통일한다(빈 목록 화면이 담기를 안내한다). */}
            {overview
              .map((r) => (
                <Pressable
                  key={r.unit_id}
                  onPress={() => goStore(r.unit_id, '/owner/knowledge')}
                  disabled={!!switching}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${labelOf(r.unit_id)} 노하우 ${r.knowhow}개 관리`}
                >
                  <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                  <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                  <Text style={styles.cntNeutral}>{r.knowhow}</Text>
                  <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                </Pressable>
              ))}
            {overview.length > 1 && (
              <Pressable
                onPress={() => setPicker({ title: '다른 매장에서 가져오기', hint: '어느 매장으로 가져올지 골라 주세요', path: '/owner/import-knowhow', rows: allRows() })}
                disabled={!!switching}
                style={({ pressed }) => [styles.row, styles.importRow, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="다른 매장에서 노하우 가져오기"
              >
                <Ionicons name="swap-horizontal" size={15} color={InkColors.ink2} />
                <Text style={styles.importText}>다른 매장에서 가져오기</Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </Pressable>
            )}
          </View>
        </Appear>
      )}

      {/* ── 오늘 손볼 것 — 2026-08-27(§7-4): '챙길 것' MiniStats 3칸(숫자 나열) 폐기.
             급한 질문이 있는 날(단일 매장) = **A: FocusCard**(가장 오래 기다린 질문 인용) + 나머지 두 지표 롤업.
             없는 날·다점포 = **B: 롤업 3행**. 지표마다 자기 행과(있으면) 대표 대상(R2).
             ★다점포 롤업에 대상이 없는 이유: 허브 RPC(owner_overview)는 건수뿐이다 — 지어내지 않는다(R4).
             매장별 분해는 탭했을 때 매장 선택 시트의 배지가 맡는다(StatusView 와 같은 패턴).
             '직원 질문'은 현황 탭의 '답 기다리는 질문'과 같은 수(pending_q)다 — 같은 이름으로 부른다. ── */}
      {!(allClear && totals.knowhow > 0) && (
        <Appear delay={stagger(5)}>
          <SectionLabel title="오늘 손볼 것" hint={`${totals.pending + totals.review + totals.stale}건`} />
          {/* 제목과 카드 사이 = 다른 섹션 카드의 marginTop(Space.sm)과 같게 — 블록 자체엔 바깥 여백이 없다. */}
          <View style={{ marginTop: Space.sm }}>
          {(() => {
            const reviewRow: RollupRow = {
              key: 'review',
              title: '확인 필요한 노하우',
              count: totals.review,
              unit: '개',
              hot: totals.review > 0,
              // ★'검증'은 승인 어휘 밖 — 매장 앱과 같은 '확인 필요'. 착지 = ?review=1 필터 목록.
              onPress: jump('확인이 필요한 노하우', (r) => r.needs_review, '/owner/knowledge?review=1'),
            };
            const staleRow: RollupRow = {
              key: 'stale',
              title: '오래 손 안 댄 노하우',
              count: totals.stale,
              unit: '개',
              hot: totals.stale > 0,
              target: totals.stale > 0 ? '90일 넘게 수정이 없어요' : undefined,
              onPress: jump('오래 손 안 댄 노하우', (r) => r.stale, '/owner/knowledge'),
            };
            if (urgent) {
              return (
                <View style={{ gap: Space.sm }}>
                  <FocusCard
                    kicker={`가장 급한 것 — 답 기다리는 질문 ${totals.pending}건 중 제일 오래됨`}
                    quote={urgent.query_text}
                    meta={`${urgent.junior_name} · ${formatAsked(urgent.asked_at)}부터 기다리는 중`}
                    cta={{
                      label: '답해서 노하우로 만들기',
                      // 받은질문 목록은 sortByUrgency 로 정렬돼 이 질문이 맨 위다(상세 라우트 없음).
                      onPress: () => { if (overview[0]) void goStore(overview[0].unit_id, '/owner/inbox'); },
                    }}
                  />
                  <RollupRows rows={[reviewRow, staleRow].filter((r) => r.count > 0)} />
                </View>
              );
            }
            const pendingRow: RollupRow = {
              key: 'pending',
              title: '답 기다리는 질문',
              count: totals.pending,
              unit: '건',
              hot: totals.pending > 0,
              target: totals.pending > 0 ? '답 하나가 노하우 하나가 돼요' : undefined,
              onPress: jump('답 기다리는 질문', (r) => r.pending_q, '/owner/inbox'),
            };
            return <RollupRows rows={[pendingRow, reviewRow, staleRow].filter((r) => r.count > 0)} />;
          })()}
          </View>
        </Appear>
      )}

      {allClear && totals.knowhow > 0 && (
        <Appear delay={stagger(6)}>
          <Text style={styles.allClearText}>지금은 손볼 노하우가 없어요</Text>
        </Appear>
      )}

      <StorePickerSheet
        visible={picker !== null}
        title={picker?.title ?? ''}
        hint={picker?.hint ?? ''}
        rows={picker?.rows ?? []}
        onPick={(uid) => {
          const path = picker?.path;
          const stay = picker?.stay;
          setPicker(null);
          if (!path) return;
          // stay = 활성 매장을 안 바꾸고 대상만 넘긴다. 쓰기는 definer RPC 가 소유를 검사한다(0121).
          if (stay) router.push(`${path}?unit=${uid}` as never);
          else void goStore(uid, path);
        }}
        onClose={() => setPicker(null)}
      />
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

  // 히어로 카드(H3′) — 링 + 범례. 데모 §4 `card.hero` 20/20/16.
  heroCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.gutter,
    paddingTop: Space.gutter,
    paddingBottom: Space.lg,
    ...Elevation.e2,
  },
  lgRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 1 },
  lgDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  lgDot: { width: 9, height: 9, borderRadius: Radius.pill },
  lgDotBorder: { borderWidth: 1, borderColor: InkColors.line },
  // 범례는 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  lgText: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 17, fontWeight: '700', color: InkColors.ink2 },
  lgValue: { fontSize: 17, lineHeight: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4 },
  lgHot: { color: BrandColors.warnText },
  // 뒷면(V4 큰숫자형) — 급한 값 두 개만 크게.
  bnRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm + 2, paddingVertical: Space.sm + 2 },
  bnValue: { minWidth: 52, textAlign: 'right', fontSize: 30, lineHeight: 36, fontWeight: '900', color: InkColors.ink, letterSpacing: -1.2 },

  emptyTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink, paddingTop: Space.xs },
  emptyBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, marginTop: 2 },
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

  // 빈 상태 문구 = 본문(simplicity-voice §4) → 꼬리표용 ink3(2.55:1)를 쓰지 않는다.
  allClearText: { fontSize: 13, color: InkColors.ink2, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  // 매장별 노하우 개수 — 경고가 아닌 중립 정보라 warn 배지 대신 무채색.
  cntNeutral: {
    minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: '900', color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.xs + 2, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },
  importRow: { borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: Space.xs },
  importText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink2, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
