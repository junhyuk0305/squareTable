// 사장 허브 '노하우' 탭 본문 — 지식 신선도(슬라이스 D, 3탭 확장의 두 번째 탭).
//
// 무엇: "매장 지식이 지금도 맞는가"를 매장 단위로 보여준다(O4·O5 — 격자·bus factor 없이).
//   · 노하우로 만들 것 = 미답변 질문(pending_q) — 답 하나가 노하우 하나가 되는 입구
//   · 확인이 필요한 노하우(needs_review) — 시드·제안 반영분의 확인 대기
//   · 오래 손 안 댄 노하우(stale, 90일+) — 메뉴·가격이 변했는데 노하우만 옛날일 위험
// 원칙: 허브는 읽기·이동까지(실행은 매장 화면) · 매장 단위만 · 0은 위험이 아니라 좋은 소식
//   ("지금은 손볼 노하우가 없어요") · 노하우 0인 매장은 행동 버튼(노하우 담기)이 먼저.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { StorePickerSheet, type StorePickerRow } from '@/components/hub/StorePickerSheet';
import { SectionLabel } from '@/components/SectionLabel';
import { MiniStats } from '@/components/blocks/MiniStats';
import { ActionRow } from '@/components/blocks/ActionRow';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { AlertRow } from '@/components/blocks/AlertRow';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Href } from 'expo-router';

export function OwnerKnowhowHubView() {
  const overview = useHubStore((s) => s.overview);
  const ownerLoaded = useHubStore((s) => s.ownerLoaded);
  const hydrateOwner = useHubStore((s) => s.hydrateOwner);
  const stats = useHubStore((s) => s.knowhowStats);
  const statsLoaded = useHubStore((s) => s.knowhowStatsLoaded);
  const hydrateStats = useHubStore((s) => s.hydrateKnowhowStats);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();
  const router = useRouter();

  useEffect(() => {
    void hydrateOwner();
    void hydrateStats();
    void hydratePrefs();
  }, [hydrateOwner, hydrateStats, hydratePrefs]);

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

  if (!ownerLoaded && overview.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={InkColors.ink3} />
      </View>
    );
  }

  // (2026-08-06) 매장별 카운트 행 storeRows는 제거했다 — 세 섹션 카드가 사라지면서 소비자가 없어졌고,
  // 매장별 분해는 이제 매장 선택 시트의 count 배지가 맡는다.

  return (
    <View style={{ gap: Space.md }}>
      {/* ── 노하우 0 매장 = 담기가 먼저(빈 화면 행동 버튼).
             2026-08-07: **단일 매장에서만** 그린다. 다점포에서는 아래 '매장별 노하우' 카드가
             0개인 매장까지 전부 행으로 보여주므로, 여기에 또 세우면 같은 매장이 두 번 나온다. ── */}
      {overview.length === 1 && emptyStores.map((r) => (
        <Appear key={r.unit_id} delay={0}>
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
             ★statsLoaded 게이트는 유지: 도착 전 0/0 은 "정말 0"이 아니라 "아직 안 옴"이다. */}
      {statsLoaded && (
        <Appear delay={10}>
          <ProgressRing
            value={understanding.known}
            total={understanding.cells}
            label="직원이 확인한 노하우"
            sub={
              understanding.cells > 0
                ? `노하우 ${understanding.entries}개 × 직원 ${understanding.staff}명`
                : understanding.staff === 0
                  ? '직원이 들어오면 우리 매장 노하우를 얼마나 아는지 여기서 보여드려요'
                  : '노하우를 담으면 직원이 얼마나 아는지 여기서 보여드려요'
            }
          />
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
      )}

      {/* ── 경고행(블록 X2) — 퀴즈로 안 쓰인 노하우. 0건이면 AlertRow 가 스스로 숨는다.
             ★2026-08-07: '아무도 모르는 노하우'(통과자 0)가 아니라 **문항이 없는 노하우**(no_items)를
             건다. 파이프라인상 이쪽이 먼저다 — 문항이 없으면 직원이 알 방법 자체가 없어서 아무리
             기다려도 이해율이 오르지 않는다. 사장이 지금 바로 할 수 있는 일이기도 하다.
             (통과자 0 지표 no_one 은 C단계 퀴즈 대시보드가 쓴다) ── */}
      {/* ★직원이 0명이면 그리지 않는다(cells === 0). 1인 매장에서는 모든 노하우가 정의상
             '아무도 모르는' 것이 되어 "24개가 위험"이라고 겁을 주는데, 직원이 없으니 사실은
             위험이 아니다. 지표가 참이어도 그 상태에서 할 수 있는 일이 없으면 경고가 아니다. */}
      {statsLoaded && understanding.cells > 0 && (
        <Appear delay={20}>
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
      <Appear delay={20}>
        <ActionRow
          items={[
            {
              key: 'add',
              icon: 'add-circle-outline',
              label: '노하우 추가',
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
        <Appear delay={40}>
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

      {/* ── 챙길 것(블록 I3) — 세 지표를 한 줄로.
             2026-08-06: '노하우로 만들 것 / 검증이 필요한 / 오래 손 안 댄'이 각각 제목+카드였다.
             셋 다 "N건 남았다" 하나만 말하는데 카드를 3장 세우니 이 화면이 카드 나열이 됐다.
             숫자는 MiniStats 한 줄로 내리고, 매장별 분해는 탭했을 때 매장 선택 시트의 배지가 맡는다
             (StatusView가 이미 쓰는 패턴). 섹션 힌트는 각 칸의 ⓘ로 옮겼다. ── */}
      <Appear delay={60}>
        <SectionLabel title="챙길 것" />
        <MiniStats
          items={[
            {
              key: 'pending',
              value: totals.pending,
              // 2026-08-07: '노하우로 만들 것' → '직원 질문'. 앞의 이름은 사장이 해야 할 **가공**을
              // 가리켰는데, 정작 그게 무엇에서 나온 것인지(직원이 물었다)를 감췄다. 있는 그대로 부른다.
              label: '직원 질문',
              onPress: jump('직원 질문', (r) => r.pending_q, '/owner/inbox'),
              info: {
                title: "'직원 질문'이 뭐예요?",
                // 같은 pending_q 를 현황 탭은 '답 기다리는 질문'이라 부른다 — 한 수치를 두 이름으로 부르면
                // 사장이 서로 다른 지표로 읽는다. 이름을 통일하는 대신(탭마다 문맥이 다르다) 같은 수임을 밝힌다.
                body: '노하우에 없어서 사장님 답을 기다리는 질문이에요.\n답 하나가 노하우 하나가 돼요.\n현황 탭의 ‘답 기다리는 질문’과 같은 수예요.',
              },
            },
            {
              key: 'review',
              // ★2026-08-06: '검증'은 승인 어휘 8개 밖 신조어였다(허브 개편에서 새로 쓴 말).
              //   매장 앱은 같은 needs_review 를 전부 '확인 필요'로 부른다 → 앱 쪽으로 통일.
              //   착지도 매장 앱과 맞춘다: /owner/knowledge?review=1 = '확인 필요만' 필터가 걸린 목록.
              //   (옛 /owner/categories 는 필터 없는 전체 목록이라 "N건"을 눌러도 그 N건이 안 보였다)
              value: totals.review,
              label: '확인 필요',
              onPress: jump('확인이 필요한 노하우', (r) => r.needs_review, '/owner/knowledge?review=1'),
              info: {
                title: "'확인 필요'가 뭐예요?",
                body: '업종 추천이나 직원 제안으로 들어온 노하우 중, 아직 우리 매장 기준이 맞는지 확인하지 않은 것이에요.',
              },
            },
            {
              key: 'stale',
              value: totals.stale,
              label: '오래 손 안 댐',
              // 위 '확인 필요'와 같은 층(백버튼 있는 서브화면)으로 보낸다 — 한 줄의 세 칸이 서로 다른
              // 네비게이션 층에 떨어지면 뒤로가기가 칸마다 다르게 동작한다.
              onPress: jump('오래 손 안 댄 노하우', (r) => r.stale, '/owner/knowledge'),
              info: {
                title: "'오래 손 안 댐'이 뭐예요?",
                body: '90일 넘게 수정이 없는 노하우예요.\n메뉴·가격이 바뀌었는데 노하우만 옛날일 수 있어요. 한 번 훑어봐 주세요.',
              },
            },
          ]}
        />
      </Appear>

      {allClear && totals.knowhow > 0 && (
        <Appear delay={160}>
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
