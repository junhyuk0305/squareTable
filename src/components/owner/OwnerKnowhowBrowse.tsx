import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { EmptyState } from '@/components/EmptyState';
import { InfoDot } from '@/components/InfoDot';
import { VerifyBadge } from '@/components/VerifyBadge';
import { AlertRow } from '@/components/blocks/AlertRow';
import { SectionLabel } from '@/components/SectionLabel';
import { CategoryEditSheet } from '@/components/owner/CategoryEditSheet';
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

// ── 정렬 옵션(목록 뷰) ───────────────────────────────────────

type SortKey = 'recent' | 'resolution' | 'cited' | 'category';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '최신순' },
  { key: 'resolution', label: '해결률순' },
  { key: 'cited', label: '인용순' },
  // 이것만 순서가 아니라 그룹 분기(groups)다 — 왜 혼자 다르게 구는지 라벨로 밝힌다.
  { key: 'category', label: '카테고리별로 묶어보기' },
];

/**
 * 찾기 바(검색·카테고리·상태·정렬)를 띄우는 최소 노하우 수.
 * ① 복잡도 원칙 §4 "리스트 첫 노출 5±2" — 7건까지는 스크롤 한 번이면 다 훑힌다.
 * ② JuniorBrowseDashboard 의 SECTION_LIMIT*2(=8)와 같은 수 — "잘라 보여줄 만큼 쌓였나"라는 같은 판정.
 * 이 수 미만에서는 거르는 장치가 목록보다 커진다(실측: 데모 매장 4~5건에 필터 4종).
 */
const FILTER_MIN = 8;

// 미검증 = 온보딩 업종팩 fork분(needs_review) 또는 검증정보 없음/미검증.
// 검증 nudge의 대상은 needs_review(사장이 우리 매장 기준으로 아직 안 다듬음)로 좁힌다.
const needsVerify = (e: PlaybookEntry) => e.needs_review === true;

// 안 쓰임 = 게시됐는데 최근 30일 인용 0회. 내용이 어렵거나 알바가 못 찾는다는 신호 → 다듬거나 정리.
// (미검증과 다른 개념: 미검증=아직 확인 안 함 / 안 쓰임=확인은 됐는데 아무도 안 물어봄)
const isUnused = (e: PlaybookEntry) =>
  e.status === 'published' && (e.stats?.query_hits_30d ?? 0) === 0;

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
 * OwnerKnowhowBrowse — 사장 '둘러보기' 본문(크롬리스). KnowhowSegment 슬롯으로 들어가며
 * SafeAreaView/Stack.Screen/RoleTabBar 같은 크롬은 상위(categories)가 소유한다.
 *
 * 구성: 상단행(개수+추가) → 미검증 배너 → 한 번에 늘리기 → 찾기 바(검색+칩+정렬, N≥FILTER_MIN) → 관리 액션 → 목록.
 *
 * (이력 2026-08-03) 뷰 3종[대시보드|목록|매뉴얼] → 목록 하나. 대시보드는 목록의 중복 투영이었고
 * (확인필요=상태칩·최근추가=최신순), 매뉴얼도 같은 EntryRow를 섹션으로 묶은 것뿐이라 '카테고리별'
 * 정렬과 실질 동일했다. 매뉴얼에만 있던 고유 기능인 **내보내기**(본문까지 평문화)는 목록으로 옮겼고,
 * 대시보드 캐러셀에만 있던 **1탭 검증**은 목록 행으로 옮겼다.
 */
export function OwnerKnowhowBrowse({
  onSelect,
  initialNeedsReview = false,
}: {
  onSelect: (id: string) => void;
  /** 진입 즉시 '미검증만' 목록으로 시작(대시보드 미검증 배너에서 들어올 때). */
  initialNeedsReview?: boolean;
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

  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null); // null = 전체(단일 선택). 카테고리(section) 이름.
  const [sort, setSort] = useState<SortKey>('recent');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(initialNeedsReview); // 미검증 배너에서 진입
  const [catSheet, setCatSheet] = useState(false); // 카테고리 편집 시트
  const [sortOpen, setSortOpen] = useState(false); // 정렬 펼침(인라인, 모달 아님)

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
  const goTemplates = () => router.push('/owner/templates' as never);
  const goHandover = () => router.push('/owner/handover' as never);
  // 매니저 전용 물어보기(정본 §4 "AI 질문 매니저 ✅") — 검색으로 못 찾았을 때의 다음 행동.
  // 사장에겐 숨김(자기 노하우에 자기가 질문하는 표면은 불필요, 사장 AI는 coach가 담당).
  const goAsk = role === 'manager' ? () => router.push('/owner/ask' as never) : undefined;
  // 카테고리 필터는 단일 선택(라디오) — '전체' + 한 카테고리만. 같은 칩 재탭 시 전체로 해제.
  const selectCat = (c: string) => setActiveCat((prev) => (prev === c ? null : c));

  // 미검증 상태 필터 — 켜면 미검증만 남긴다.
  const toggleReview = () => setOnlyNeedsReview((v) => !v);

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

  // 미검증(needs_review) — 전체 기준 카운트(배너·섹션 노출 판단). 0이 되면 배너/섹션 자동 소멸.
  const needsReview = useMemo(() => baseFiltered.filter(needsVerify), [baseFiltered]);

  // 목록 필터(미검증만 보기 옵션 적용) → 정렬.
  const listFiltered = useMemo(() => {
    let list = baseFiltered;
    if (onlyNeedsReview) list = list.filter(needsVerify);
    if (sort !== 'category') {
      list = [...list].sort((a, b) => {
        if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        if (sort === 'resolution') return (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0);
        if (sort === 'cited') return (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0);
        return 0;
      });
    }
    return list;
  }, [baseFiltered, onlyNeedsReview, sort]);

  const groups = useMemo(() => {
    if (sort !== 'category') return null;
    // allCats는 visible 전체에서 파생되므로 listFiltered의 모든 항목이 반드시 어느 그룹엔가 속한다.
    const byCat = allCats.map((cat) => ({
      cat,
      items: listFiltered
        .filter((e) => sectionOf(e) === cat)
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    }));
    return byCat.filter((g) => g.items.length > 0);
  }, [listFiltered, sort, allCats]);

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

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
      </View>
    );
  }

  const hasEntries = visible.length > 0;

  // 찾기 바 노출 — FILTER_MIN 미만이면 목록이 곧 전부라 거를 게 없다(필터가 목록보다 커진다).
  // 뒤 두 절은 전부 "잠김 방지"다. 하나라도 빠지면 끌 수 없는 필터가 생긴다:
  //  ① /owner/knowledge?review=1 로 들어온 소형 매장 — 바가 없으면 '확인 필요만'을 끌 수 없다.
  //     state(onlyNeedsReview)가 아니라 prop을 보는 이유 = 칩을 끄는 순간 바가 손가락 밑에서 사라지는 것도 막는다.
  //  ② 8건에서 필터를 건 뒤 노하우를 지워 7건이 되는 경로 — 바가 사라지면 그 필터를 풀 방법이 없다.
  //     ★정렬도 같은 경로다(2026-08-06 검증에서 잡힘). 정렬만 바꾼 뒤 7건이 되면 바가 사라지는데
  //     sort 상태는 'recent'로 안 돌아가서, 목록이 계속 비-기본 순서인 채 되돌릴 수단이 없어진다.
  //     그래서 '거르기'가 아니라 **기본값에서 벗어난 상태 전부**를 센다.
  const viewAltered =
    query.trim() !== '' || effectiveCat !== null || onlyNeedsReview || sort !== 'recent';
  const showFindBar = visible.length >= FILTER_MIN || initialNeedsReview || viewAltered;

  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? SORTS[0].label;

  // 필터를 한 줄로 압축하면 "지금 걸려 있다"가 안 보인다 — 카운트가 그 신호를 대신 든다.
  const countLabel = onlyNeedsReview
    ? `확인 필요 ${listFiltered.length}개만`
    : query.trim() || effectiveCat
      ? `${visible.length}개 중 ${listFiltered.length}개`
      : `총 ${visible.length}개${hasEntries ? ' · 탭하면 수정' : ''}`;

  // 확인 필요 노하우 행에 붙는 1탭 검증 버튼. 행(Pressable)과 형제로 둔다 — 중첩하면 RNW에서
  // role=button 이 겹쳐 탭이 편집 진입으로 샌다.
  const verifyButton = (e: PlaybookEntry) => (
    <Pressable
      onPress={() => verify(e)}
      accessibilityRole="button"
      accessibilityLabel={`${e.title} 확인 완료로 표시`}
      style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="checkmark-circle" size={15} color={InkColors.ink} />
      <Text style={styles.verifyBtnText}>확인 완료 (우리 매장 기준 맞아요)</Text>
    </Pressable>
  );

  // 목록 한 항목 — 확인 필요면 행 아래에 1탭 검증 버튼을 함께 그린다(구분선은 래퍼가 갖는다).
  const entryItem = (e: PlaybookEntry) => {
    const usedBy = usedCountByEntry.get(e.id) ?? 0;
    if (!needsVerify(e)) return <EntryRow key={e.id} e={e} usedBy={usedBy} onPress={() => onSelect(e.id)} />;
    return (
      <View key={e.id} style={styles.entryWrap}>
        <EntryRow e={e} usedBy={usedBy} onPress={() => onSelect(e.id)} divider={false} />
        {verifyButton(e)}
      </View>
    );
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* 상단행 */}
      <View style={styles.headRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Text style={styles.subline}>{countLabel}</Text>
          <InfoDot
            title="노하우가 뭐예요?"
            body={'여기 적어두면 직원이 물을 때 AI가 사장님 대신 답해줘요.\n많이 쌓일수록 같은 질문에 일일이 답할 일이 줄어요.'}
          />
        </View>
        <Pressable onPress={goAdd} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="add" size={16} color={InkColors.ink} />
          <Text style={styles.addBtnText}>노하우 추가</Text>
        </Pressable>
      </View>

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

      {/* 미검증 경고행(블록 X2) — 화면 맨 위. 0건이면 AlertRow가 스스로 숨는다.
          2026-08-06: 아래 '한 번에 늘리기' 카드보다 밑에 있어서 경고가 안내에 묻혀 있었다 → 위로 올렸다.
          ★2026-08-06(2차): 탭하면 첫 항목 하나를 열던 것을 **'확인 필요만' 목록 필터**로 바꿨다.
            "n건"을 눌렀는데 1건만 열리면 나머지 n-1건으로 돌아올 길이 없고, 대시보드 배너의 착지
            (/owner/knowledge?review=1 = 미검증 필터)와도 서로 달랐다.
            필터를 켜면 viewAltered 가 true 가 되어 찾기 바가 강제로 나오므로 '확인 필요' 칩으로
            되돌릴 수 있다 — 끌 수 없는 필터가 생기지 않는다(위 showFindBar 주석). */}
      <AlertRow
        label="확인이 필요한 노하우"
        count={needsReview.length}
        onPress={() => setOnlyNeedsReview(true)}
      />

      {/* 인수인계서 업로드 / 업종 템플릿 — 한 건씩 쓰지 않고 여러 건을 한꺼번에 만드는 두 경로.
          ★2026-08-06: 같은 형태의 카드 2장이 나란히 서 있어(이번 개편이 없애려던 증상) **한 카드 안 2행**으로 묶었다.
          반복은 블록 1개로 센다(복잡도 원칙 §4) — 형태가 늘지 않는다.
          ★2026-08-07: 제목을 '한 번에 늘리기' → '여러 개 한 번에 추가'로. 무엇이 늘어나는지·무엇을 하는지가
          이름에 없었다(QA #5-1). 장식용 sparkles 아이콘도 뺐다 — 뜻을 더하지 않는 그림이다(QA #5-2). */}
      <View style={styles.growSection}>
        <SectionLabel title="여러 개 한 번에 추가" />
        <View style={styles.growCard}>
          <Pressable
            onPress={goHandover}
            style={({ pressed }) => [styles.growRow, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="인수인계서 올리기"
          >
            <Ionicons name="cloud-upload-outline" size={16} color={InkColors.ink2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.templateLinkTitle}>인수인계서 올리기</Text>
              <Text style={styles.templateLinkSub}>오픈·마감·규칙 메모를 올리면 AI가 노하우로 정리해요</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </Pressable>

          <Pressable
            onPress={goTemplates}
            style={({ pressed }) => [styles.growRow, styles.growRowDivider, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="노하우 템플릿 둘러보기"
          >
            <Ionicons name="albums-outline" size={16} color={InkColors.ink2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.templateLinkTitle}>노하우 템플릿 둘러보기</Text>
              <Text style={styles.templateLinkSub}>업종에서 자주 쓰는 노하우를 내 노하우로 바로 가져와요</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </Pressable>
        </View>
      </View>

      {!hasEntries ? (
        loadError ? (
          // 로드 실패를 "노하우 없음"으로 위장하지 않고 재시도를 띄운다(무음 실패 방지).
          // 그림 이모지는 워딩 규칙상 금지다(기호·Ionicons만) — 남아 있던 위반을 걷었다(2026-08-07 QA #5-2).
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
          {/* 목록 관리 액션 — 필터가 아니라 관리라서 칩 줄에서 내렸다(2026-08-06).
              ★2026-08-07(QA #6): 목록 폭을 꽉 채우던 두 버튼을 **찾기 바 위 오른쪽의 작은 버튼**으로 줄였다.
              ★표시 조건은 찾기 바(showFindBar)와 **분리한다.** 안에 넣으면 노하우가 8건 미만인 매장에서
                카테고리 편집(CategoryEditSheet 의 유일한 진입점)과 내보내기에 아예 닿지 못한다
                — 이 프로젝트에서 세 번 재발한 '죽은 컨트롤' 유형이다.
              ★시각 크기와 터치 타깃을 분리한다 — 작게 그리되 hitSlop 으로 48dp 하한을 지킨다. */}
          <View style={styles.manageActions}>
            <Pressable
              onPress={() => setCatSheet(true)}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="카테고리 편집"
            >
              <Ionicons name="pricetags-outline" size={13} color={InkColors.ink2} />
              <Text style={styles.manageBtnText}>카테고리 편집</Text>
            </Pressable>
            {canCopyToClipboard() && exportCount > 0 && (
              <Pressable
                onPress={() => copy(manualToText(exportGroups, { storeName, date: new Date().toLocaleDateString('ko-KR') }))}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`지금 목록에 보이는 노하우 ${exportCount}개 내보내기`}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={InkColors.ink2} />
                <Text style={styles.manageBtnText} numberOfLines={1}>{copied ? '복사됐어요' : `내보내기 ${exportCount}개`}</Text>
              </Pressable>
            )}
          </View>

          {/* 찾기 바 — 검색·상태·카테고리·정렬을 한 블록(최대 2행)으로. 넷이 형제로 서 있을 때
              목록 위에 약 168px이 상시 깔려 있었다(같은 형태 4연속 = 이번 개편이 없애려던 증상). */}
          {showFindBar && (
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

              {/* 행2 — [정렬 고정] │ [상태·카테고리 가로 스크롤].
                  정렬만 왼쪽에 붙박이인 이유: 칩이 많아 오른쪽이 스크롤로 밀려도
                  "지금 어떤 순서로 보고 있는지"는 항상 보여야 한다. */}
              <View style={styles.findRow}>
                <Pressable
                  onPress={() => setSortOpen((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  accessibilityRole="button"
                  // accessibilityState 가 아니라 aria-expanded 인 이유: RNW 0.21은 View/Pressable의
                  // accessibilityState 를 무시한다(웹에서 펼침 상태가 아예 안 읽힌다). aria-expanded 는
                  // RN 쪽에서 accessibilityState.expanded 로 매핑되므로 네이티브도 같이 산다.
                  aria-expanded={sortOpen}
                  accessibilityLabel={`정렬 ${sortLabel}, 바꾸기`}
                  style={[styles.chip, styles.sortTrigger, sortOpen && styles.chipActive]}
                >
                  <Text style={styles.sortTriggerKey}>정렬</Text>
                  <Text style={styles.sortTriggerValue} numberOfLines={1}>{sortLabel}</Text>
                  <Ionicons name={sortOpen ? 'chevron-up' : 'chevron-down'} size={12} color={InkColors.ink2} />
                </Pressable>
                <View style={styles.findDivider} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.findScroll}
                  contentContainerStyle={styles.chipRow}
                >
                  {/* 미검증 상태 필터 — 카운트>0일 때만 노출되는 정식 토글. 탭하면 미검증만 남긴다. */}
                  {needsReview.length > 0 && (
                    <Pressable
                      onPress={toggleReview}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      style={[styles.statusChip, onlyNeedsReview && styles.statusReviewOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: onlyNeedsReview }}
                      accessibilityLabel={`확인 필요 ${needsReview.length}개만 보기`}
                    >
                      <Ionicons name="alert-circle" size={13} color={onlyNeedsReview ? InkColors.ink : BrandColors.warn} />
                      {/* ★개수를 쓰지 않는다 — 같은 화면 위 AlertRow가 이미 개수를 말한다(2026-08-06).
                          이 칩의 책임은 '거르기' 하나다. 개수는 스크린리더용 라벨에만 남긴다. */}
                      <Text style={[styles.statusChipText, onlyNeedsReview && styles.statusChipTextInk]}>확인 필요</Text>
                    </Pressable>
                  )}
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

              {/* 정렬 펼침 — 아래로. 시트로 만들지 않는다: 이 화면은 이미 CategoryEditSheet 를 띄우므로
                  시트 2개가 공존하게 된다(모달 위 모달 금지). */}
              {sortOpen && (
                <View style={styles.sortPanel}>
                  {SORTS.map((s, i) => {
                    const on = sort === s.key;
                    return (
                      <Pressable
                        key={s.key}
                        onPress={() => { setSort(s.key); setSortOpen(false); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={({ pressed }) => [styles.sortOption, i > 0 && styles.sortOptionDivider, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={[styles.sortOptionText, on && styles.sortOptionTextOn]}>{s.label}</Text>
                        {on ? <Ionicons name="checkmark" size={16} color={InkColors.ink} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* 목록 */}
          {listFiltered.length === 0 ? (
            <EmptyResult
              onReset={() => { setQuery(''); setActiveCat(null); setOnlyNeedsReview(false); }}
              onAsk={onlyNeedsReview ? undefined : goAsk}
              label={onlyNeedsReview ? '확인할 노하우가 없어요' : undefined}
            />
          ) : groups ? (
            groups.map((g) => {
              const m = getSectionMeta(g.cat);
              return (
                <View key={g.cat} style={{ gap: 8 }}>
                  <View style={styles.groupHead}>
                    <View style={[styles.dot, { backgroundColor: m.color }]} />
                    <Text style={styles.groupTitle}>{m.label}</Text>
                    <Text style={styles.groupCount}>{g.items.length}</Text>
                  </View>
                  <View style={styles.list}>{g.items.map(entryItem)}</View>
                </View>
              );
            })
          ) : (
            <View style={styles.list}>{listFiltered.map(entryItem)}</View>
          )}
        </>
      )}
      <View style={{ height: 16 }} />
      {catSheet && <CategoryEditSheet onClose={() => setCatSheet(false)} />}
    </ScrollView>
  );
}

function EmptyResult({ onReset, onAsk, label }: { onReset: () => void; onAsk?: () => void; label?: string }) {
  return (
    <View style={styles.emptyResult}>
      {/* 그림 이모지 금지(워딩 §1) — 같은 뜻을 Ionicons 로. 2026-08-07 QA #5-2. */}
      <Ionicons name={label ? 'checkmark-circle-outline' : 'search-outline'} size={30} color={InkColors.ink3} />
      <Text style={styles.emptyResultText}>{label ?? '조건에 맞는 노하우가 없어요'}</Text>
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
  scroll: { padding: Space.gutter, gap: Space.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48 },
  loadingText: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },

  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // "총 N개 · 탭하면 수정" = 카운트+힌트라 **보조**다(본문 아님).
  // 15sp였던 건 크기가 틀린 것이지 색이 틀린 게 아니다 — ink3는 보조의 정당한 색이고,
  // 보조는 15sp 하한 대상이 아니다(simplicity-voice §4). 12sp로 내린다. (2026-08-06)
  subline: { flexShrink: 1, fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  // 주 CTA — 검정 헤더 요소들 사이에서 묻혀서 노랑 액센트로(2026-07-31 사용자 요청).
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.pill },
  addBtnText: { color: InkColors.ink, fontSize: 13, fontWeight: '800' },

  // 템플릿 둘러보기 진입 링크(홈에서 이관)
  // '한 번에 늘리기' — 두 진입을 한 카드 안 2행으로. 카드 1장 = 블록 1개(2026-08-06).
  growSection: { gap: Space.sm },
  growCard: {
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.md, ...Elevation.e1,
  },
  growRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    paddingVertical: Space.md, paddingHorizontal: Space.md,
  },
  growRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  templateLinkTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  templateLinkSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },

  // 미검증 배너는 공용 <AlertRow>(블록 X2)로 대체됨. 아래 둘은 검토 대기(draft) 배너가 계속 쓴다.
  bannerTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
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
  findDivider: { width: 1, alignSelf: 'stretch', minHeight: 18, backgroundColor: InkColors.line },

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

  // 미검증 상태 필터 칩 — 카테고리 칩과 같은 형태의 정식 토글.
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill,
  },
  statusReviewOn: { backgroundColor: BrandColors.warnSoft, borderColor: BrandColors.warnBorder },
  statusChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  statusChipTextInk: { color: InkColors.ink },

  // 정렬 — 라벨은 '정렬'(무엇을) + 현재값(어떻게) 두 토막. 현재값을 감추면 무슨 순서인지 모른다.
  sortTrigger: { gap: Space.xs, maxWidth: 150 },
  // ★줄어드는 쪽은 값이지 '정렬'이 아니다 — flexShrink를 안 정하면 배율 ×1.18에서 '정렬'이
  //   두 글자로 세로로 쪼개진다(실측). 값은 numberOfLines=1로 말줄임되고 전체 라벨은 패널이 보여준다.
  sortTriggerKey: { flexShrink: 0, fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  sortTriggerValue: { flexShrink: 1, fontSize: 12.5, fontWeight: '800', color: InkColors.ink },
  chipActive: { backgroundColor: InkColors.bgSoft, borderColor: InkColors.ink3 },

  sortPanel: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    backgroundColor: InkColors.bg, overflow: 'hidden', ...Elevation.e1,
  },
  // ★고정 height 금지 → minHeight. 배율 ×1.18에서는 글자가 아니라 상자가 터진다.
  sortOption: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: Space.lg,
  },
  sortOptionDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  sortOptionText: { fontSize: 15, fontWeight: '600', color: InkColors.ink2 },
  sortOptionTextOn: { fontWeight: '800', color: InkColors.ink },

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

  // 목록 관리 액션(카테고리 편집 · 내보내기) — 2칸 행
  // 관리 액션 — 찾기 바 위 오른쪽의 작은 버튼. 시각은 칩 크기, 터치 타깃은 hitSlop 이 48dp까지 넓힌다.
  manageActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Space.sm },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 180,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  manageBtnText: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  // 그룹(목록·카테고리별)
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingHorizontal: 2 },
  groupTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  groupCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  // 리스트/행
  list: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
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
  emptyResultEmoji: { fontSize: 34 },
  emptyResultText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  resetLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, marginTop: 4, textDecorationLine: 'underline' },
});
