// /hq/stores — 전체 매장(정본 §5-2): 도구 줄(검색 · 관계 · 공개 수준) → 전체 폭 표 → 쪽 넘김.
//
// 2026-10-02 개편: 목록 + 상세 2단을 접고 **목록은 전체 폭, 상세는 별도 페이지**(`[id]`)로 바꿨다(사용자 결정).
//   2단은 상세 칸(392)이 표 폭을 먹어 열을 늘릴 수 없었다('미해결 질문' 열을 뺀 이유 · 10-01).
//   매장 사이를 옮겨 다니는 일은 하위 메뉴의 매장 이름 트리가 맡는다. 초대 대기는 하위 메뉴의 자기 화면으로 갔다.
// 재료 = useBrandUnitsPageStore(brand_overview_page 한 쪽 — 검색·필터·정렬·쪽은 서버가 한다 · 0228)
//      + useBrandKnowhowStore(받은 노하우 수 = 배포 교차표에서 이 매장 칸 수).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqPill, HqSegment, HqEmpty, HqLoadError } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn, type HqSort } from '@/components/hq/HqTable';
import { AddStoreModal } from '@/components/hq/AddStoreModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear } from '@/components/Appear';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsPageStore, HQ_STORES_PAGE_SIZE } from '@/lib/store/useBrandUnitsPageStore';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import type { BrandOverviewRow, BrandOverviewSort, BrandRelation, BrandVisibility } from '@/lib/brand/brandDb';
import { visibilityLabel, payerLabel, relationLabel, RELATIONS, VISIBILITY_LEVELS, VIS_TONE, REL_TONE } from '@/lib/brand/visibility';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 표 바닥줄의 순서 이름 — [오름차순, 내림차순]. */
const SORT_LABEL: Record<BrandOverviewSort, [string, string]> = {
  name: ['이름순', '이름 역순'],
  relation: ['관계순', '관계 역순'],
  staff: ['직원 적은 순', '직원 많은 순'],
  pending_q: ['미해결 질문 적은 순', '미해결 질문 많은 순'],
  mastery: ['숙지율 낮은 순', '숙지율 높은 순'],
};

export default function HqStoresScreen() {
  const router = useRouter();
  const rows = useBrandUnitsPageStore((s) => s.rows);
  const total = useBrandUnitsPageStore((s) => s.total);
  const totalAll = useBrandUnitsPageStore((s) => s.totalAll);
  const query = useBrandUnitsPageStore((s) => s.query);
  const setQuery = useBrandUnitsPageStore((s) => s.setQuery);
  const refreshPage = useBrandUnitsPageStore((s) => s.refresh);
  const reset = useBrandUnitsPageStore((s) => s.reset);
  const pageLoaded = useBrandUnitsPageStore((s) => s.loaded);
  const error = useBrandUnitsPageStore((s) => s.error);
  const brand = useBrandStore((s) => s.brand);
  const brandLoaded = useBrandStore((s) => s.loaded);
  // 받은 노하우 수 — 배포 교차표(사본이 있는 칸)를 매장별로 센다. 노하우 화면과 같은 재료라 두 숫자가 어긋나지 않는다.
  const matrix = useBrandKnowhowStore((s) => s.matrix);
  const knowhowLoaded = useBrandKnowhowStore((s) => s.loaded);
  const knowhowError = useBrandKnowhowStore((s) => s.error);
  const hydrateKnowhow = useBrandKnowhowStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 표 · '매장 추가' 기본 요금 부담 · 받은 노하우 열이 다 와야 그린다.
  const ready = pageLoaded && brandLoaded && knowhowLoaded;

  const refresh = useCallback(() => Promise.all([refreshPage(), hydrateKnowhow()]), [refreshPage, hydrateKnowhow]);
  // 포커스마다 재조회(정본 §6-3) — 점주가 수준을 내리면 돌아왔을 때 사라져 있어야 한다.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  // 화면을 떠나면 조건을 처음으로.
  useEffect(() => reset, [reset]);

  // 검색은 타자를 칠 때마다 보내지 않는다 — 멈추고 0.3초 뒤 한 번.
  const [qInput, setQInput] = useState(query.q ?? '');
  useEffect(() => {
    const next = qInput.trim() || null;
    if (next === (query.q ?? null)) return;
    const t = setTimeout(() => setQuery({ q: next }), 300);
    return () => clearTimeout(t);
  }, [qInput, query.q, setQuery]);
  const [addOpen, setAddOpen] = useState(false);

  const received = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of matrix) m.set(c.unit_id, (m.get(c.unit_id) ?? 0) + 1);
    return m;
  }, [matrix]);

  // 표 머리글 정렬 ↔ 서버 정렬. 기본(이름 오름차순)은 머리글에 화살표가 없다.
  const tableSort: HqSort | null =
    query.sort === 'name' && !query.desc ? null : { key: query.sort, dir: query.desc ? 'desc' : 'asc' };
  const onSortChange = (s: HqSort | null) =>
    setQuery(s ? { sort: s.key as BrandOverviewSort, desc: s.dir === 'desc' } : { sort: 'name', desc: false });
  const page = Math.floor(query.offset / HQ_STORES_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / HQ_STORES_PAGE_SIZE));

  // 행 = 매장 상세 페이지(push — 뒤로가기가 이 목록으로 돌아온다. 검색어·쪽은 스택에 남아 있다).
  const openDetail = (unitId: string) => router.push({ pathname: '/hq/stores/[id]', params: { id: unitId } });

  // 열 key = 서버 정렬 키(0228)인 열만 sortValue 를 준다 — 머리글을 누를 수 있다는 표시다(제어 정렬).
  // 노하우 두 열은 서버 정렬 키가 없어 정렬을 달지 않는다.
  // ★폭: 이름 열만 남는 폭을 받고 나머지는 고정이다. 전부 나눠 갖게 두면 1440 에서 '미해결 질문' 머리글과
  //   '본사 부담' 배지가 두 줄로 접혔다(2026-10-02 실측). 창이 더 좁으면 표만 가로로 스크롤한다(HqTable).
  const columns: HqColumn<BrandOverviewRow>[] = [
    {
      key: 'name',
      label: '매장',
      render: (r) => (
        <View>
          <Cell kind="name">{r.store_name}</Cell>
          {r.industry ? <Text style={styles.sub} numberOfLines={1}>{r.industry}</Text> : null}
        </View>
      ),
      sortValue: (r) => r.store_name,
    },
    { key: 'relation', label: '관계', width: 92, render: (r) => <HqPill tone={REL_TONE[r.relation]} label={relationLabel(r.relation)} />, sortValue: (r) => r.relation },
    {
      key: 'vis',
      label: '공개 수준',
      width: 132,
      render: (r) => (
        <View style={{ gap: 3 }}>
          <HqPill tone={VIS_TONE[r.visibility]} label={visibilityLabel(r.visibility)} />
          {r.visibility_requested ? <Text style={styles.sub}>{visibilityLabel(r.visibility_requested)} 요청 중</Text> : null}
        </View>
      ),
    },
    { key: 'staff', label: '직원', width: 84, align: 'right', render: (r) => <Cell kind="num">{r.staff}</Cell>, sortValue: (r) => r.staff },
    // 매장이 직접 쓴 노하우(사본 제외 · 0226) / 본사가 보내 이 매장에 있는 노하우(교차표 칸 수).
    { key: 'own', label: '자체 노하우', width: 112, align: 'right', render: (r) => <Cell kind="num">{r.knowhow_own}</Cell> },
    {
      key: 'recv',
      label: '받은 노하우',
      width: 112,
      align: 'right',
      render: (r) => (knowhowError ? <Cell kind="muted">—</Cell> : <Cell kind="num">{received.get(r.unit_id) ?? 0}</Cell>),
    },
    // 숙지율은 사본이 생기기 전엔 재료가 없다 — 0 이 아니라 '—'(HqStrip 과 같은 규칙).
    { key: 'mastery', label: '숙지율', width: 96, align: 'right', render: (r) => <Cell kind={r.mastery === null ? 'muted' : 'num'}>{r.mastery === null ? '—' : `${Math.round(r.mastery * 100)}%`}</Cell>, sortValue: (r) => r.mastery },
    { key: 'pending_q', label: '미해결 질문', width: 124, align: 'right', render: (r) => <Cell kind="num">{r.pending_q}</Cell>, sortValue: (r) => r.pending_q },
    { key: 'payer', label: '요금 부담', width: 124, render: (r) => <HqPill tone={r.payer === 'brand' ? 'y' : 'n'} label={payerLabel(r.payer)} /> },
  ];

  const from = query.offset + 1;
  const to = query.offset + rows.length;
  const footer = `${pages > 1 ? `${from}–${to} / ` : ''}${total}곳 · ${SORT_LABEL[query.sort][query.desc ? 1 : 0]}`;

  return (
    <HqPage
      title="전체 매장"
      count={ready && !error ? totalAll : undefined}
      sub="점주가 고른 공개 수준만큼만 보여요. 행을 누르면 매장 상세가 열려요."
      actions={
        <>
          <HqButton label="매장 추가" icon="add" variant="pri" testID="hq-add-store" onPress={() => setAddOpen(true)} />
        </>
      }
      testID="hq-stores"
    >
      {/* 머리(제목·버튼)는 게이트 밖. 실패하면 표를 그리지 않는다 — 첫 조회 실패가 '아직 연결된 매장이 없어요'로 위장된다. */}
      {!ready ? (
        <ScreenLoading label="매장 목록을 불러오고 있어요…" />
      ) : error ? (
        <HqLoadError title="매장 목록을 불러오지 못했어요" onRetry={refresh} testID="hq-stores-error" />
      ) : (
        // ★쪽·정렬을 바꿀 때는 다시 재생하지 않는다 — Appear 는 마운트 1회이고 표는 같은 자리에서 행만 바뀐다.
        <Appear>
          <View style={styles.tool}>
            <View style={styles.search}>
              <Ionicons name="search-outline" size={15} color={InkColors.ink3} />
              <TextInput
                value={qInput}
                onChangeText={setQInput}
                placeholder="매장 이름으로 찾기"
                placeholderTextColor={InkColors.ink3}
                style={styles.searchInput}
                accessibilityLabel="매장 이름으로 찾기"
              />
            </View>
            <HqSegment
              items={[{ key: 'all', label: '관계 전체' }, ...RELATIONS.map((r) => ({ key: r.key, label: r.label }))]}
              value={query.relation ?? 'all'}
              onChange={(v: 'all' | BrandRelation) => setQuery({ relation: v === 'all' ? null : v })}
            />
            <HqSegment
              items={[{ key: 'all', label: '수준 전체' }, ...VISIBILITY_LEVELS.map((l) => ({ key: l.key, label: l.label }))]}
              value={query.visibility ?? 'all'}
              onChange={(v: 'all' | BrandVisibility) => setQuery({ visibility: v === 'all' ? null : v })}
            />
          </View>

          <HqTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.unit_id}
            onRowPress={(r) => openDetail(r.unit_id)}
            sort={tableSort}
            onSortChange={onSortChange}
            footer={footer}
            empty={
              <HqEmpty
                text={totalAll === 0 ? '아직 연결된 매장이 없어요. 점주 전화번호로 초대하면 점주가 앱에서 수락해요.' : '조건에 맞는 매장이 없어요.'}
                action={totalAll === 0 ? <HqButton label="매장 추가" variant="pri" onPress={() => setAddOpen(true)} /> : undefined}
              />
            }
            testID="hq-stores-table"
          />

          {/* 쪽 넘김 — 쪽이 하나면 그리지 않는다(파일럿 규모에선 보이지 않는 게 정상). */}
          {pages > 1 ? (
            <View style={styles.pager} testID="hq-stores-pager">
              <HqButton label="이전" icon="chevron-back" disabled={page === 0} testID="hq-stores-prev" onPress={() => setQuery({ offset: (page - 1) * HQ_STORES_PAGE_SIZE })} />
              <Text style={styles.pagerText}>{page + 1} / {pages}쪽</Text>
              <HqButton label="다음" icon="chevron-forward" disabled={page + 1 >= pages} testID="hq-stores-next" onPress={() => setQuery({ offset: (page + 1) * HQ_STORES_PAGE_SIZE })} />
            </View>
          ) : null}

          <Text style={styles.note}>
            매장 삭제와 직원 임면은 본사 화면에 없어요. 매장과 사람은 점주가 정해요.
          </Text>
        </Appear>
      )}

      {/* 열 때마다 새로 마운트 — 입력값이 이전 초대의 것으로 남지 않는다. */}
      {addOpen ? (
        <AddStoreModal
          defaultPayer={brand?.default_payer ?? 'brand'}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            void refresh();
          }}
        />
      ) : null}
    </HqPage>
  );
}

const styles = StyleSheet.create({
  tool: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.md, flexWrap: 'wrap' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, width: 260, height: 40, backgroundColor: InkColors.bg },
  searchInput: { flex: 1, fontSize: 14.5, color: InkColors.ink, paddingVertical: 0, minWidth: 0 },
  sub: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.md, marginTop: -Space.sm, marginBottom: Space.xl },
  pagerText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2, fontVariant: ['tabular-nums'] },
  note: { fontSize: 13.5, color: InkColors.ink3 },
});
