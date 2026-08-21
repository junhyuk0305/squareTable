import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { Appear, stagger } from '@/components/Appear';
import { Vanish } from '@/components/Vanish';
import { Collapse } from '@/components/Collapse';
import { EmptyState } from '@/components/EmptyState';
import { InfoDot } from '@/components/InfoDot';
import { VerifyBadge } from '@/components/VerifyBadge';
import { SectionLabel } from '@/components/SectionLabel';
import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { CategoryEditSheet } from '@/components/owner/CategoryEditSheet';
import { OwnerTodoSegment } from '@/components/owner/OwnerTodoSegment';
import { useOwnerTodoCount } from '@/lib/hooks/useOwnerTodoCount';
import { getSectionMeta } from '@/lib/utils/category';
import { matchesKnowhowQuery } from '@/lib/utils/knowhowSearch';
import { track } from '@/lib/analytics/track';
import { UNSECTIONED, sectionOptions } from '@/lib/config/sections';
import { manualToText } from '@/lib/utils/manualText';
import { useCopyToClipboard, canCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

// ── 세그먼트(칸) ─────────────────────────────────────────────
// 세 칸이 곧 노하우가 만들어지는 순서다: 손대야 나아가는 것 → 다듬어져 AI가 쓰는 것 → 낡아서 다시 볼 것.
// 'unused' 는 2026-08-19 에 '할 일'로 흡수됐다. 딥링크(?review=1 등)가 물고 있으니 키는 남기고
// 진입 시 'todo' 로 착지시킨다 — 죽은 링크를 만들지 않는다.
export type KnowhowSegKey = 'todo' | 'knowhow';


/**
 * 목록을 묶음(그룹 헤더 + 집계)으로 나누기 시작하는 수.
 * ★30·100은 실측이 아니라 추정이다 — "한 화면 8~10행"을 기준으로, 3~4번 스크롤하면 목록이 벽처럼
 *   느껴진다는 계산에서 나온 값이다. 파일럿 매장에서 재고 나서 고쳐야 한다.
 */
const GROUP_MIN = 30;

/** 우하단 FAB 지름. 터치 타깃 하한 48dp보다 크게. */
const FAB_SIZE = 56;

// 미검증 = 온보딩 업종팩 fork분(needs_review) 또는 검증정보 없음/미검증.
// 검증 nudge의 대상은 needs_review(사장이 우리 매장 기준으로 아직 안 다듬음)로 좁힌다.
const needsVerify = (e: PlaybookEntry) => e.needs_review === true;

/** '안 쓰임' 판정 창(일). 라벨('한 달간 …')과 같은 값이어야 한다 — 바꾸면 라벨도 같이 바꾼다. */
const UNUSED_WINDOW_DAYS = 30;

// 안 쓰임 = 게시된 지 30일이 지났는데 그동안 인용 0회. 내용이 어렵거나 직원이 못 찾는다는 신호.
// (미검증과 다른 개념: 미검증=아직 확인 안 함 / 안 쓰임=확인은 됐는데 아무도 안 물어봄)
//
// ★나이 조건이 반드시 필요하다: 인용 0회만 보면 **방금 만든 노하우가 즉시** '한 달간 아무도 안
//   물어봤어요'로 들어간다(등록 직후엔 0회인 게 당연하다). 한 달이 지나지도 않았는데 화면이 지나갔다고
//   말하는 것이라, 사장이 처음 템플릿을 등록하자마자 '손볼 노하우'가 쌓인 것처럼 보였다.
const isUnused = (e: PlaybookEntry) => {
  if (e.status !== 'published') return false;
  if ((e.stats?.query_hits_30d ?? 0) > 0) return false;
  const created = Date.parse(e.created_at ?? '');
  // 만든 날짜를 모르면 단정하지 않는다 — 틀린 라벨을 붙이느니 묶음에서 빠지는 편이 낫다.
  if (!Number.isFinite(created)) return false;
  return Date.now() - created >= UNUSED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
};

// 사용자 표면의 분류는 카테고리(= section) 하나 — 종류(루틴/돌발 등)는 AI 내부용이라 안 보여준다.
const sectionOf = (e: PlaybookEntry) => e.section?.trim() || UNSECTIONED;

/**
 * 한 노하우 행(목록) — 탭하면 수정. usedBy=이 노하우를 첨부한 업무 수(0069 역조회, 임팩트).
 * divider=false 는 아래에 1탭 검증 버튼이 붙는 경우 — 구분선을 래퍼가 대신 갖는다.
 */
function EntryRow({ e, onPress, usedBy = 0, divider = true }: { e: PlaybookEntry; onPress: () => void; usedBy?: number; divider?: boolean }) {
  const meta = getSectionMeta(e.section);
  const ratePct = Math.round((e.stats?.resolution_rate ?? 0) * 100);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !divider && styles.rowNoDivider, pressed && { opacity: 0.7 }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {e.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {meta.label} · v{e.version}
          </Text>
          {e.stats?.resolution_rate ? <Text style={styles.metaRate}>· 해결률 {ratePct}%</Text> : null}
          {e.stats?.query_hits_30d ? <Text style={styles.meta}>· {e.stats.query_hits_30d}</Text> : null}
          {usedBy > 0 ? (
            <View style={styles.badgeUsed}>
              <Ionicons name="clipboard-outline" size={9} color={InkColors.ink2} />
              <Text style={styles.badgeUsedText}>업무 {usedBy}</Text>
            </View>
          ) : null}
          {e.needs_review ? (
            <View style={styles.badgeReview}>
              <Text style={styles.badgeReviewText}>확인 필요</Text>
            </View>
          ) : isUnused(e) ? (
            <View style={styles.badgeUnused}>
              <Text style={styles.badgeUnusedText}>안 쓰임</Text>
            </View>
          ) : null}
          {e.verification ? <VerifyBadge state={e.verification.state} size="list" /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
    </Pressable>
  );
}

/**
 * OwnerKnowhowBrowse — 사장 노하우 탭 본문(크롬리스). SafeAreaView/Stack.Screen/RoleTabBar 같은
 * 크롬은 상위(categories·knowledge)가 소유한다.
 *
 * 구성: 세그먼트 2칸(고정) → [할 일 | 노하우] 본문 → 우하단 FAB(고정).
 *  · 할 일  = 받은 질문·검토할 제안(OwnerTodoSegment) + 확인 안 한 것 / 한 달간 안 물어본 것 / 퀴즈 오답 링크
 *  · 노하우 = 검색·카테고리 칩·목록 (관리 액션은 상단 톱니 토글 뒤)
 *
 * (이력 2026-08-19) ① '안 쓰임' 칸을 '할 일'로 흡수 — 둘 다 "지금 손볼 것"이라 칸을 나눌 이유가 없었고,
 *  배지가 갈려 남은 일이 몇 건인지 한눈에 안 보였다. ② 목록 아래 '여러 개 한 번에 추가' 카드 삭제.
 *  ③ 카테고리 편집·내보내기를 개수 줄 오른쪽 톱니 토글로 접었다.
 *
 * (이력 2026-08-03) 뷰 3종[대시보드|목록|매뉴얼] → 목록 하나. 대시보드는 목록의 중복 투영이었고
 * (확인필요=상태칩·최근추가=최신순), 매뉴얼도 같은 EntryRow를 섹션으로 묶은 것뿐이라 '카테고리별'
 * 정렬과 실질 동일했다. 매뉴얼에만 있던 고유 기능인 **내보내기**(본문까지 평문화)는 목록으로 옮겼고,
 * 대시보드 캐러셀에만 있던 **1탭 검증**은 목록 행으로 옮겼다.
 *
 * (이력 2026-08-07) 받은질문 탭을 흡수해 3칸 세그먼트가 됐다. 같이 걷어낸 것:
 *  ① 미검증 AlertRow 배너 + '확인 필요만' 상태 칩 → 세그먼트 ③이 그 수를 센다(같은 말을 세 번 하지 않는다).
 *  ② 상단 '노하우 추가' 버튼 → 우하단 FAB(세 칸 전부에서 보인다).
 *  ③ 정렬 컨트롤 → SORT_MIN 미만에서는 그룹 헤더가 대신한다.
 */
export function OwnerKnowhowBrowse({
  onSelect,
  initialSegment,
}: {
  onSelect: (id: string) => void;
  /** 진입 즉시 열 칸(딥링크). `/owner/categories?seg=todo` · `/owner/knowledge?review=1`. 없으면 '노하우'. */
  initialSegment?: KnowhowSegKey;
}) {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);
  const loadError = usePlaybookStore((s) => s.loadError);
  const hydrate = usePlaybookStore((s) => s.hydrate);
  // 노하우 임팩트 = 이 노하우를 첨부한 업무 수(0069 역조회). 카운트가 실제이려면 업무 링크가 로드돼 있어야
  // 하므로 이 화면에서도 업무 스토어를 hydrate 한다(coalesce 로 중복 방지). 미로드로 인한 '0 위장' 방지.
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  useEffect(() => {
    useWorkStore.getState().hydrate();
    return useWorkStore.getState().subscribe();
  }, []);
  const usedCountByEntry = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of knowhowLinks) m.set(l.entryId, (m.get(l.entryId) ?? 0) + 1);
    return m;
  }, [knowhowLinks]);
  const update = usePlaybookStore((s) => s.update);
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName);
  const industry = useSessionStore((s) => s.industry);
  const role = useSessionStore((s) => s.role);
  const { copied, copy } = useCopyToClipboard();
  const todo = useOwnerTodoCount();

  const [seg, setSeg] = useState<KnowhowSegKey>(initialSegment ?? 'knowhow');
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null); // null = 전체(단일 선택). 카테고리(section) 이름.
  const [catSheet, setCatSheet] = useState(false); // 카테고리 편집 시트
  const [manageOpen, setManageOpen] = useState(false); // 톱니 토글(카테고리 편집·내보내기)
  // 확인 완료를 누르면 이 항목은 목록에서 빠진다 — 먼저 접히는 것을 보여주고(Vanish) 그 다음 검증을 쓴다.
  // 데이터를 먼저 바꾸면 optimisticPatch가 같은 틱에 행을 지워 애니메이션이 아예 안 보인다.
  const [leaving, setLeaving] = useState<string | null>(null);

  // 딥링크로 다시 들어오면(푸시 → /owner/inbox → ?seg=todo) 화면이 이미 떠 있어 useState 초기값이
  // 안 먹는다. prop이 **실제로 바뀐 렌더에서만** 칸을 옮긴다 — 값이 그대로면 사용자의 칸 선택을
  // 되돌리지 않는다. (effect가 아니라 렌더 중 조정 — effect로 하면 한 프레임 늦게 튄다.)
  const [lastSegParam, setLastSegParam] = useState(initialSegment);
  if (initialSegment && initialSegment !== lastSegParam) {
    setLastSegParam(initialSegment);
    setSeg(initialSegment);
  }

  // 검토 대기(draft·인수인계서 파이프라인 증분저장분)는 둘러보기에서 제외 — 검수는 handover 화면이 담당.
  // (직원은 RLS 0064로 애초에 draft를 못 받지만, 사장 화면도 발행본과 섞이면 자산 목록이 오염된다.)
  const visible = useMemo(() => entries.filter((e) => e.status !== 'draft'), [entries]);
  const draftCount = entries.length - visible.length;

  // 필터칩·카테고리별 그룹의 공통 목록 = 실제 쓰이는 카테고리 + 매장이 만든 카테고리(0개여도 노출).
  // 순서: 표준 → 매장 고유 → 기타.
  const customCats = usePlaybookStore((s) => s.customCategories);
  const allCats = useMemo(() => {
    const customLabels = customCats.map((c) => c.label);
    const keep = new Set([...visible.map(sectionOf), ...customLabels]);
    const ordered = sectionOptions(industry, [...visible.map((e) => e.section), ...customLabels]).filter((s) => keep.has(s));
    if (keep.has(UNSECTIONED)) ordered.push(UNSECTIONED);
    return ordered;
  }, [visible, industry, customCats]);

  // 노하우가 지워져 카테고리가 사라졌는데 활성 필터로 남았으면 전체 취급(상태 리셋 effect 대신 파생).
  const effectiveCat = activeCat && allCats.includes(activeCat) ? activeCat : null;

  const goAdd = () => router.push('/owner/coach' as never);
  const goHandover = () => router.push('/owner/handover' as never);
  const goTraining = () => router.push('/owner/training' as never);
  // 매니저 전용 물어보기(정본 §4 "AI 질문 매니저 ✅") — 검색으로 못 찾았을 때의 다음 행동.
  // 사장에겐 숨김(자기 노하우에 자기가 질문하는 표면은 불필요, 사장 AI는 coach가 담당).
  const goAsk = role === 'manager' ? () => router.push('/owner/ask' as never) : undefined;
  // 카테고리 필터는 단일 선택(라디오) — '전체' + 한 카테고리만. 같은 칩 재탭 시 전체로 해제.
  const selectCat = (c: string) => setActiveCat((prev) => (prev === c ? null : c));

  // 1탭 검증 — 우리 매장 기준 확인 완료. needs_review 해제 + 사장님 검증 배지.
  const verify = (e: PlaybookEntry) =>
    update(e.id, {
      needs_review: false,
      verification: { state: 'owner_verified', verified_by: userName, verified_at: new Date().toISOString() },
    });

  // 검색 + 카테고리 필터(목록·내보내기 공통 베이스).
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = visible.filter((e) => matchesKnowhowQuery(e, q));
    if (effectiveCat) list = list.filter((e) => sectionOf(e) === effectiveCat);
    return list;
  }, [visible, query, effectiveCat]);

  // 검색 실패 로그(O8, 슬라이스 D) — "찾다 못 찾은 주제"가 노하우 공백 신호다.
  // 타자 중 스팸 방지로 800ms 정지 후 1회만 기록. 노하우 0개 매장은 제외(공백 신호가 아니라 빈 매장).
  useEffect(() => {
    const q = query.trim();
    if (!q || baseFiltered.length > 0 || visible.length === 0) return;
    const t = setTimeout(() => track('knowhow_search_no_result', { q: q.slice(0, 80) }), 800);
    return () => clearTimeout(t);
  }, [query, baseFiltered.length, visible.length]);

  // '안 쓰임' 칸의 두 그룹 — 검색·카테고리 필터를 타지 않는다(그 칸엔 찾기 바가 없다).
  const reviewList = useMemo(() => visible.filter(needsVerify), [visible]);
  const unusedList = useMemo(() => visible.filter(isUnused), [visible]);
  // 칸 배지는 두 그룹의 **합집합**(둘 다 해당하는 항목을 두 번 세지 않는다).
  const unusedSegCount = useMemo(
    () => visible.filter((e) => needsVerify(e) || isUnused(e)).length,
    [visible],
  );

  /**
   * 목록 순서 — **최근 고친 것부터** 하나로 고정한다(2026-08-08 정렬 기능 삭제).
   *
   * 옛 판본은 정렬 4종(최신·해결률·인용·카테고리별)을 컨트롤로 내줬는데, 그 컨트롤이 뜨는 조건이
   * `노하우 100건 이상`이었고 **실사용 매장은 전부 그 아래**라 아무도 못 쓰는 기능이었다.
   * 쓰이지 않는 컨트롤은 화면만 차지하고 되돌림 경로(잠김 방지) 같은 부수 규칙까지 달고 다닌다.
   * "무엇부터 손볼까"는 아래 쓰임새 묶음(usageGroups)이 대신 답한다 — 정렬보다 그쪽이 질문에 맞는다.
   */
  const listFiltered = useMemo(
    () => [...baseFiltered].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    [baseFiltered],
  );

  // ── 내보내기 대상 — 지금 목록에 보이는 것 중 발행본을 [섹션 → order_index] 순으로 묶는다.
  // 별도 저장물 없음(설계 §4·5c): 매뉴얼은 원자의 파생 투영일 뿐이다.
  // 섹션 순서 = 문서 등장 순서(섹션 내 최소 order_index), 미분류(기타)는 맨 뒤.
  // 발행본만인 이유 = 남에게 주는 문서라 검토중·보관본이 섞이면 안 된다. 목록과 개수가 갈릴 수 있어
  // 버튼 라벨에 대상 개수를 적는다(무엇이 복사되는지 화면에서 보이게).
  const exportGroups = useMemo(() => {
    const pub = [...listFiltered.filter((e) => e.status === 'published')].sort(
      (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
    const order: string[] = [];
    const byName = new Map<string, PlaybookEntry[]>();
    for (const e of pub) {
      const name = e.section?.trim() || UNSECTIONED;
      if (!byName.has(name)) { byName.set(name, []); order.push(name); }
      byName.get(name)!.push(e);
    }
    const names = order.filter((n) => n !== UNSECTIONED);
    if (byName.has(UNSECTIONED)) names.push(UNSECTIONED);
    return names.map((name) => ({ name, items: byName.get(name)! }));
  }, [listFiltered]);
  const exportCount = useMemo(() => exportGroups.reduce((n, g) => n + g.items.length, 0), [exportGroups]);

  const hasEntries = visible.length > 0;

  // 찾기 바(검색·카테고리 칩)는 개수와 무관하게 **항상** 띄운다 — 2026-08-19 결정.
  //  옛 FILTER_MIN(8건) 게이트를 폐기한 것이다. 자리가 개수에 따라 나타났다 사라지면 "여기 검색이 있다"를
  //  익힐 수 없고, 게이트가 만들던 '필터 걸어둔 채 7건이 되면 못 푸는' 잠김 예외도 같이 사라진다.

  // 목록이 길면 쓰임새 묶음(많이 쓰임 / 오래 확인 안 함 / 그 밖)이 "무엇부터 손볼까"에 답한다.
  const showUsageGroups = listFiltered.length >= GROUP_MIN;

  // 끊어 그리기를 처음으로 되돌리는 조건 = 거르기 조건 전부.
  // ★한 곳에서만 만든다 — 묶음 뷰와 평면 목록이 각자 조합하던 때 묶음 쪽에만 activeCat 이 빠져서,
  //   거른 뒤에도 '더 보기'가 열린 채로 남았다(2026-08-11 QA P3-#5).
  const listKey = `${seg}-${query}-${activeCat ?? ''}`;

  // 필터를 한 줄로 압축하면 "지금 걸려 있다"가 안 보인다 — 카운트가 그 신호를 대신 든다.
  const countLabel =
    query.trim() || effectiveCat
      ? `${visible.length}개 중 ${listFiltered.length}개`
      : `총 ${visible.length}개${hasEntries ? ' · 탭하면 수정' : ''}`;

  // 확인 필요 노하우 행에 붙는 1탭 검증 버튼. 행(Pressable)과 형제로 둔다 — 중첩하면 RNW에서
  // role=button 이 겹쳐 탭이 편집 진입으로 샌다.
  const verifyButton = (e: PlaybookEntry) => (
    <Pressable
      onPress={() => setLeaving(e.id)}
      accessibilityRole="button"
      accessibilityLabel={`${e.title} 확인 완료로 표시`}
      style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="checkmark-circle" size={15} color={InkColors.ink} />
      <Text style={styles.verifyBtnText}>확인 완료 (우리 매장 기준 맞아요)</Text>
    </Pressable>
  );

  // 목록 한 항목 — 확인 필요면 행 아래에 1탭 검증 버튼을 함께 그린다(구분선은 래퍼가 갖는다).
  const entryItem = (e: PlaybookEntry, i: number) => {
    const usedBy = usedCountByEntry.get(e.id) ?? 0;
    return (
      <Appear key={e.id} delay={stagger(i)}>
        {needsVerify(e) ? (
          // 접힘이 끝나면 검증을 쓴다. leaving 해제는 실패해 되돌아온 행이 다시 접히는 것을 막는다.
          <Vanish
            hidden={leaving === e.id}
            onDone={() => {
              verify(e);
              setLeaving(null);
            }}
            style={styles.entryWrap}
          >
            <EntryRow e={e} usedBy={usedBy} onPress={() => onSelect(e.id)} divider={false} />
            {verifyButton(e)}
          </Vanish>
        ) : (
          <EntryRow e={e} usedBy={usedBy} onPress={() => onSelect(e.id)} />
        )}
      </Appear>
    );
  };

  // 묶음 한 덩어리 = [카드 밖 라벨 + n건] + 카드 목록.
  // ★묶음도 끊어 그린다. "갈래로 나뉘니 한 덩어리가 작다"는 틀린 판단이었다 —
  //   묶음은 **전부 한 화면에 같이 그려지므로** 총 행 수는 안 나눈 것과 똑같고,
  //   한 갈래에 몰리면(예: '고객 응대' 300건) 그 묶음 하나가 300줄이다.
  const groupBlock = (key: string, title: string, items: PlaybookEntry[]) => (
    <View key={key} style={styles.group}>
      <SectionLabel title={title} hint={`${items.length}건`} />
      <PagedRows key={`${key}-${listKey}`} items={items} render={entryItem} style={styles.list} />
    </View>
  );

  // 정렬 컨트롤 대신 쓰는 묶음 — "많이 쓰임 / 오래 확인 안 함 / 그 밖".
  // 사장이 목록을 여는 이유는 찾으려고가 아니라 **손볼 것을 고르려고**라서 쓰임새로 나눈다.
  // ★'그 밖'을 반드시 남긴다 — 두 조건에 안 걸리는 항목이 묶음 사이로 사라지면 안 된다.
  const usageGroups = useMemo(() => {
    const hot = listFiltered
      .filter((e) => (e.stats?.query_hits_30d ?? 0) > 0)
      .sort((a, b) => (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0));
    const cold = listFiltered.filter(isUnused);
    const seen = new Set([...hot, ...cold].map((e) => e.id));
    const rest = listFiltered.filter((e) => !seen.has(e.id));
    return [
      { key: 'hot', title: '많이 쓰임', items: hot },
      // ★라벨은 판정(isUnused = 만든 지 30일 경과 + 그동안 인용 0회)을 그대로 말한다. 다른 기간을
      //   쓰면 화면이 사실과 다른 말을 한다 — 기간은 라벨이 아니라 UNUSED_WINDOW_DAYS 를 바꾼다.
      { key: 'cold', title: '한 달간 아무도 안 물어봤어요', items: cold },
      { key: 'rest', title: '그 밖', items: rest },
    ].filter((g) => g.items.length > 0);
  }, [listFiltered]);

  // ★2026-08-19: '안 쓰임'을 '할 일'로 흡수해 2칸이 됐다.
  //   둘 다 "지금 손볼 것"을 모으는 칸이라 따로 설 이유가 없었다 — 사장은 손볼 게 있나 보려고
  //   두 칸을 번갈아 눌러야 했다. 배지도 두 군데로 갈려서 어느 쪽이 남은 일인지 안 보였다.
  const segItems: SegmentItem[] = [
    { key: 'todo', label: '할 일', count: todo.total + unusedSegCount },
    { key: 'knowhow', label: '노하우', count: visible.length },
  ];

  // ── 칸 ② 노하우 ────────────────────────────────────────────
  const knowhowSegment = () => {
    if (!loaded) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
        </View>
      );
    }
    return (
      <>
        {/* 개수 줄 + 톱니. 톱니 패널이 이 줄 아래에 **떠서** 열리므로(밀어내지 않는다) 이 블록이 그 앵커다. */}
        <View style={styles.headBlock}>
          <View style={styles.headRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
              <Text style={styles.subline}>{countLabel}</Text>
              <InfoDot
                title="노하우가 뭐예요?"
                body={'여기 적어두면 직원이 물을 때 AI가 사장님 대신 답해줘요.\n많이 쌓일수록 같은 질문에 일일이 답할 일이 줄어요.'}
              />
            </View>
            {/* 목록 관리(카테고리 편집·내보내기) — 매일 쓰는 게 아니라 이 톱니 뒤로 접었다.
                ★노하우 0건이면 아래 본문이 빈 화면(EmptyState)이라 이 톱니도 같이 안 뜬다.
                  옛 판본의 '카테고리 편집' 버튼도 같은 자리·같은 조건이었다(이 개편으로 생긴 공백이 아니다). */}
            {hasEntries && (
              <Pressable
                onPress={() => setManageOpen((v) => !v)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={manageOpen ? '목록 관리 닫기' : '목록 관리 열기'}
                style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name={manageOpen ? 'close' : 'settings-outline'} size={17} color={InkColors.ink2} />
              </Pressable>
            )}
          </View>

          {/* 톱니 패널 — StoreToggle 매장 드롭다운과 같은 A7 규격이다(2026-08-19에 밀어내기→띄우기로 바꿈):
              누른 자리 바로 아래 absolute 앵커 + Collapse(높이 애니) + Appear(행 스태거).
              밀어내면 열 때마다 목록이 통째로 내려가 "어디를 보고 있었는지"가 흔들린다. 닫기는 톱니(✕)가 맡는다. */}
          {hasEntries && manageOpen && (
            <View style={styles.manageAnchor}>
              <Collapse style={styles.manageActions}>
                <Appear delay={stagger(0)} offsetY={7}>
                  <Pressable
                    onPress={() => { setManageOpen(false); setCatSheet(true); }}
                    style={({ pressed }) => [styles.manageRow, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="카테고리 편집"
                  >
                    <Ionicons name="pricetags-outline" size={16} color={InkColors.ink2} />
                    <Text style={styles.manageRowText}>카테고리 편집</Text>
                    <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                  </Pressable>
                </Appear>
                {canCopyToClipboard() && exportCount > 0 && (
                  <Appear delay={stagger(1)} offsetY={7}>
                    <Pressable
                      onPress={() => copy(manualToText(exportGroups, { storeName, date: new Date().toLocaleDateString('ko-KR') }))}
                      style={({ pressed }) => [styles.manageRow, styles.manageRowDivider, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`지금 목록에 보이는 노하우 ${exportCount}개 내보내기`}
                    >
                      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={InkColors.ink2} />
                      <Text style={styles.manageRowText} numberOfLines={1}>{copied ? '복사됐어요' : `내보내기 ${exportCount}개`}</Text>
                      <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                    </Pressable>
                  </Appear>
                )}
              </Collapse>
            </View>
          )}
        </View>

        {/* 찾기 바 — 검색·카테고리. 톱니 줄 바로 아래 고정이다(2026-08-19). */}
        {hasEntries && (
          <View style={styles.findBar}>
            {/* 행1 — 검색 */}
            <View style={styles.search}>
              <Ionicons name="search" size={16} color={InkColors.ink3} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="제목·키워드로 검색"
                placeholderTextColor={InkColors.ink3}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
                </Pressable>
              ) : null}
            </View>

            {/* 행2 — 카테고리 가로 스크롤. */}
            <View style={styles.findRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.findScroll}
                contentContainerStyle={styles.chipRow}
              >
                <Pressable
                  onPress={() => setActiveCat(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  style={[styles.chip, effectiveCat === null && styles.chipOn]}
                >
                  <Text style={[styles.chipText, effectiveCat === null && styles.chipTextOn]}>전체</Text>
                </Pressable>
                {allCats.map((c) => {
                  const on = effectiveCat === c;
                  const m = getSectionMeta(c);
                  return (
                    <Pressable
                      key={c}
                      onPress={() => selectCat(c)}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <View style={[styles.chipDot, { backgroundColor: m.color }]} />
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

          </View>
        )}

      {/* 검토 대기(draft) — 인수인계서 파이프라인이 증분 저장한 항목. 발행 전이라 직원·AI에 안 보임. */}
      {draftCount > 0 && (
        <Pressable
          onPress={goHandover}
          style={({ pressed }) => [styles.draftBanner, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel={`검토 대기 노하우 ${draftCount}개 검수하기`}
        >
          <Ionicons name="file-tray-full" size={18} color={InkColors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>검토 대기 노하우 {draftCount}개</Text>
            <Text style={styles.bannerBody}>인수인계서에서 정리한 항목이에요. 확인 후 추가해 주세요.</Text>
          </View>
          <Text style={styles.draftBannerCta}>검수하기 ›</Text>
        </Pressable>
        )}

        {!hasEntries ? (
          loadError ? (
            // 로드 실패를 "노하우 없음"으로 위장하지 않고 재시도를 띄운다(무음 실패 방지).
            <EmptyState
              title="노하우를 불러오지 못했어요"
              body="연결을 확인하고 다시 시도해 주세요."
              cta={{ label: '다시 시도', onPress: () => hydrate() }}
            />
          ) : (
            <EmptyState
              title="아직 등록된 노하우가 없어요"
              body="직원 질문에 답하거나, 직접 추가하면 여기에 쌓여요."
              cta={{ label: '첫 노하우 추가하기', onPress: goAdd }}
            />
          )
        ) : (
          <>
            {/* 목록 */}
            {listFiltered.length === 0 ? (
              <EmptyResult onReset={() => { setQuery(''); setActiveCat(null); }} onAsk={goAsk} />
            ) : showUsageGroups ? (
              usageGroups.map((g) => groupBlock(g.key, g.title, g.items))
            ) : (
              // ★전량 렌더 금지 — 이 목록은 일반 ScrollView 안이라 가상화가 없다.
              //   2026-08-08 실측: 노하우 400건에서 DOM 5,776 노드 · 6.7초. 끊어 그리고 남은 수를 밝힌다.
              //   key = 거르기 조건 → 조건이 바뀌면 컴포넌트가 다시 서면서 '더 보기'가 처음으로 돌아간다.
              <PagedRows
                key={listKey}
                items={listFiltered}
                render={entryItem}
                style={styles.list}
              />
            )}
          </>
        )}

        {/* ★2026-08-19: '여러 개 한 번에 추가'(인수인계서 올리기 / 템플릿 둘러보기) 카드 삭제.
            매일 보는 목록 아래에 상시 붙어 있을 무게가 아니었다. 두 경로 자체는 살아 있다 —
            인수인계서=노하우 추가 채팅의 ＋메뉴·첫 출근 안내, 템플릿=허브 '노하우 담기'·시작 체크리스트. */}
      </>
    );
  };

  // ── 칸 ① 할 일 — 받은 질문·제안(OwnerTodoSegment) + 손볼 노하우(구 '안 쓰임' 칸) ───────
  // 옛 '안 쓰임' 칸의 본문을 그대로 이어 붙인다. 판정(needsVerify·isUnused)도 그대로다 —
  // 칸을 합친 것이지 기준을 바꾼 게 아니다.
  const todoSegment = () => (
    <>
      <OwnerTodoSegment />

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
        </View>
      ) : (
        <>
          {reviewList.length > 0 && groupBlock('review', '확인 안 한 것', reviewList)}
          {/* 라벨=판정(isUnused = 만든 지 30일 경과 + 인용 0회) 그대로. 위 usageGroups 의 'cold' 와 같은 말이어야 한다. */}
          {unusedList.length > 0 && groupBlock('unused', '한 달간 아무도 안 물어봤어요', unusedList)}

          {/* 오답이 몰린 노하우는 여기서 세지 않는다 — 퀴즈 결과가 이 화면에 없다.
              수를 지어내는 대신 그 수를 아는 화면으로 보내는 링크 한 줄만 둔다. */}
          <View style={styles.growCard}>
            <Pressable
              onPress={goTraining}
              style={({ pressed }) => [styles.growRow, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="퀴즈에서 자주 틀리는 노하우 보기"
            >
              <Ionicons name="help-circle-outline" size={16} color={InkColors.ink2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.templateLinkTitle}>퀴즈에서 자주 틀리는 노하우</Text>
                <Text style={styles.templateLinkSub}>직원이 자꾸 틀리면 설명이 부족하다는 뜻이에요</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          </View>
        </>
      )}
    </>
  );

  return (
    <View style={styles.flex}>
      {/* 세그먼트는 스크롤과 무관하게 항상 손 닿는 곳에 — 이게 사라지면 '할 일' 칸이 잠긴다. */}
      <SegmentTabs items={segItems} value={seg} onChange={(k) => setSeg(k as KnowhowSegKey)} style={styles.segTabs} />

      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {seg === 'todo' ? todoSegment() : knowhowSegment()}
      </ScrollView>

      {/* FAB — ★ScrollView '밖'(형제)이라 스크롤과 같이 움직이지 않는다. 부모가 프레임 안이라 460px을 안 넘는다. */}
      <Pressable
        onPress={goAdd}
        accessibilityRole="button"
        accessibilityLabel="노하우 추가"
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="add" size={28} color={InkColors.ink} />
      </Pressable>

      {catSheet && <CategoryEditSheet onClose={() => setCatSheet(false)} />}
    </View>
  );
}

/** 한 번에 그리는 행 수 — 전량 렌더가 실제로 무너지는 지점은 실측으로 확인했다(위 주석). */
const LIST_PAGE = 30;

/**
 * 목록을 LIST_PAGE 개씩 끊어 그린다. **남은 수를 버튼이 밝힌다** — 조용히 자르면
 * "이게 전부"로 읽혀서, 안 그려진 노하우가 없는 것이 된다.
 */
function PagedRows({
  items, render, style,
}: {
  items: PlaybookEntry[];
  render: (e: PlaybookEntry, i: number) => ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [shown, setShown] = useState(LIST_PAGE);
  const rest = items.length - shown;
  return (
    <View style={style}>
      {items.slice(0, shown).map(render)}
      {rest > 0 && (
        <Pressable
          onPress={() => setShown((n) => n + LIST_PAGE)}
          accessibilityRole="button"
          accessibilityLabel={`${Math.min(rest, LIST_PAGE)}개 더 보기`}
          style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.moreText}>{Math.min(rest, LIST_PAGE)}개 더 보기 · 남은 {rest}개</Text>
        </Pressable>
      )}
    </View>
  );
}

function EmptyResult({ onReset, onAsk }: { onReset: () => void; onAsk?: () => void }) {
  return (
    <View style={styles.emptyResult}>
      {/* 그림 이모지 금지(워딩 §1) — 같은 뜻을 Ionicons 로. 2026-08-07 QA #5-2. */}
      <Ionicons name="search-outline" size={30} color={InkColors.ink3} />
      <Text style={styles.emptyResultText}>조건에 맞는 노하우가 없어요</Text>
      {/* 매니저 전용: 목록에서 못 찾으면 다음 행동은 물어보기(AI 답변, 없으면 사장님께 질문) */}
      {onAsk && (
        <Pressable onPress={onAsk} accessibilityRole="button" accessibilityLabel="물어보기">
          <Text style={styles.resetLink}>물어보기</Text>
        </Pressable>
      )}
      <Pressable onPress={onReset}>
        <Text style={styles.resetLink}>필터 초기화</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 하단 여백 = FAB 지름 + 위아래 거터. 마지막 행이 FAB 밑에 깔리지 않게.
  scroll: { padding: Space.gutter, paddingBottom: FAB_SIZE + Space.gutter * 2, gap: Space.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48 },
  loadingText: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },

  // 세그먼트 — 공용 SegmentTabs 의 margin(16)을 화면 거터(20)에 맞춘다.
  segTabs: { marginHorizontal: Space.gutter, marginTop: Space.md, marginBottom: 0 },

  // 톱니 패널의 앵커. zIndex 가 없으면 뒤에 오는 형제(찾기 바·목록)가 위에 그려져 패널이 가려진다.
  headBlock: { position: 'relative', zIndex: 20 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // "총 N개 · 탭하면 수정" = 카운트+힌트라 **보조**다(본문 아님).
  // 15sp였던 건 크기가 틀린 것이지 색이 틀린 게 아니다 — ink3는 보조의 정당한 색이고,
  // 보조는 15sp 하한 대상이 아니다(simplicity-voice §4). 12sp로 내린다. (2026-08-06)
  subline: { flexShrink: 1, fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

  // 노하우 추가 FAB — 세 칸 전부에서 보이는 이 화면의 Primary. 상단 버튼을 대체한다(2026-08-07).
  fab: {
    position: 'absolute',
    right: Space.gutter,
    bottom: Space.gutter,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.yellow,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    ...Elevation.ey,
  },

  // 템플릿 둘러보기 진입 링크(홈에서 이관)
  // '여러 개 한 번에 추가' — 두 진입을 한 카드 안 2행으로. 카드 1장 = 블록 1개(2026-08-06).
  growCard: {
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.md, ...Elevation.e1,
  },
  growRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    paddingVertical: Space.md, paddingHorizontal: Space.md,
  },
  templateLinkTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  templateLinkSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },

  // 검토 대기(draft) 배너가 계속 쓰는 두 줄.
  bannerTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  bannerBody: { fontSize: 12, color: InkColors.ink2, marginTop: 1 },

  // 검토 대기(draft) 배너 — 인수인계서 검수 재진입점
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
  },
  draftBannerCta: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  // 찾기 바 — [검색] / [정렬 고정 · 구분선 · 칩 가로 스크롤] / [정렬 펼침]
  findBar: { gap: Space.sm },
  findRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  // ★minWidth:0 없으면 웹 flexbox 의 min-width:auto 때문에 가로 스크롤이 안 생기고 부모를 밀어낸다.
  findScroll: { flex: 1, minWidth: 0 },

  // 검색
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...Elevation.e1,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, padding: 0 },

  // 카테고리 칩
  chipRow: { flexDirection: 'row', gap: 7, paddingVertical: 1, paddingRight: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipDot: { width: 7, height: 7, borderRadius: Radius.pill },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.bubbleText },

  // (2026-08-08: 정렬 컨트롤 스타일 8종 + 카테고리 묶음 헤더 3종은 기능과 함께 삭제됐다.)

  // 확인 필요 항목 = [행 + 1탭 검증 버튼] 묶음. 구분선을 행 대신 래퍼가 갖는다(버튼이 다음 항목에
  // 붙어 보이지 않게).
  entryWrap: { borderBottomWidth: 1, borderBottomColor: InkColors.line, paddingBottom: Space.md },

  // 1탭 검증 버튼(행 하단)
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    marginTop: 4, paddingVertical: 9, borderRadius: Radius.sm,
    backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: BrandColors.warnBorder,
  },
  verifyBtnText: { fontSize: 12, fontWeight: '800', color: InkColors.ink },

  // 톱니 패널 — 개수 줄 **아래에 떠서** 열린다(목록을 밀어내지 않는다).
  // Collapse 의 style 은 안쪽 내용 View 로 가고 바깥은 높이를 재는 클리핑 박스라, '띄우기'는 이 앵커가 맡는다
  // (StoreToggle.menuAnchor 와 같은 구조 — 그쪽 주석이 정본이다).
  manageAnchor: { position: 'absolute', top: '100%', right: 0, minWidth: 220, zIndex: 30, marginTop: Space.xs },
  manageActions: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    backgroundColor: '#FFFFFF', overflow: 'hidden', ...Elevation.e2,
  },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingHorizontal: Space.md },
  manageRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  manageRowText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  // 개수 줄 오른쪽 톱니 — 작게 그리되 hitSlop 으로 48dp 하한을 지킨다.
  gearBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  // 묶음(쓰임새·안 쓰임) = 카드 밖 라벨 + 목록
  group: { gap: Space.sm },


  // 리스트/행
  list: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  // '더 보기' — 행과 같은 세로 리듬. 누를 수 있는 행이라 최소 터치 타깃 48.
  moreRow: { minHeight: 48, justifyContent: 'center', paddingVertical: 14 },
  moreText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  rowNoDivider: { borderBottomWidth: 0 },
  dot: { width: 10, height: 10, borderRadius: Radius.pill },
  rowTitle: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  metaRate: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  badgeReview: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.warnSoft },
  badgeReviewText: { fontSize: 10, fontWeight: '800', color: BrandColors.warnText },
  badgeUnused: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.accentSoft },
  badgeUnusedText: { fontSize: 10, fontWeight: '800', color: BrandColors.badText },
  // 업무 첨부 수(0069 역조회) — 임팩트 신호. 중립 톤(검증·미검증 배지와 색 충돌 방지).
  badgeUsed: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },
  badgeUsedText: { fontSize: 10, fontWeight: '800', color: InkColors.ink2 },

  // 빈 결과
  emptyResult: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyResultText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  resetLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, marginTop: 4, textDecorationLine: 'underline' },
});
