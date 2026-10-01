// /hq/stores — 매장(정본 §5-2): 왼쪽 목록(필터 → 표(이름순) → 대기 초대 → "매장 추가") + 오른쪽 <Slot/>(상세 `[id]` · 빈 자리 `index`).
//
// ★목록을 레이아웃에 두는 이유: 상세를 갈아 끼워도 목록의 필터·검색·정렬·스크롤이 그대로 남는다(2단의 핵심).
//   `[id]` 가 목록을 다시 그리면 상태가 날아간다. 좁은 창에서도 목록은 **숨기기만** 하고 내리지 않는다.
// 재료 = useBrandUnitsPageStore(brand_overview_page 한 쪽 · brand_invites_list). 검색·필터·정렬·쪽은 서버가 한다(0228).
// 상세는 `[id].tsx` — 매장 주소(`/hq/stores/<unit_id>`)가 공유·새로고침·뒤로가기의 SSOT 다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Slot, useFocusEffect, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqPill, HqCard, HqSlab, HqNotice, HqSegment, HqEmpty, HqLoadError } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn, type HqSort } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useStoresTwoPane, HQ_STORE_DETAIL_WIDTH } from '@/components/hq/storesPane';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsPageStore, HQ_STORES_PAGE_SIZE } from '@/lib/store/useBrandUnitsPageStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  inviteStore,
  connectOwnUnit,
  revokeInvite,
  fetchBrandOverviewPage,
  type BrandOverviewRow,
  type BrandOverviewSort,
  type BrandPayer,
  type BrandRelation,
  type BrandVisibility,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { visibilityLabel, payerLabel, relationLabel, RELATIONS, VISIBILITY_LEVELS } from '@/lib/brand/visibility';
import { formatPhone, isValidPhone, normalizePhone } from '@/lib/utils/validation';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const STORES_PATH = '/hq/stores';
/** 표 바닥줄의 순서 이름 — [오름차순, 내림차순]. */
const SORT_LABEL: Record<BrandOverviewSort, [string, string]> = {
  name: ['이름순', '이름 역순'],
  relation: ['관계순', '관계 역순'],
  staff: ['직원 적은 순', '직원 많은 순'],
  pending_q: ['미해결 질문 적은 순', '미해결 질문 많은 순'],
  mastery: ['숙지율 낮은 순', '숙지율 높은 순'],
};
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const VIS_TONE: Record<BrandVisibility, 'n' | 'i' | 'g'> = { summary: 'n', knowhow: 'i', ops: 'g' };
// 관계 배지(0223) — 직영만 색을 준다. 가맹이 기본값이고 대부분이라, 둘 다 물들이면 표가 시끄럽다.
const REL_TONE: Record<BrandRelation, 'i' | 'n'> = { direct: 'i', franchise: 'n' };

export default function HqStoresLayout() {
  const router = useRouter();
  const twoPane = useStoresTwoPane();
  // 지금 열린 상세 = 실제 주소에서 읽는다(URL 이 SSOT).
  // ★`useGlobalSearchParams()` 를 쓰지 않는다 — 대시보드에서 상세로 push 하면 부모 스택의 'stores' 칸에 id 가 붙고,
  //   안쪽에서 목록으로 replace 해도 그 id 가 남아 "주소는 목록인데 상세가 열린 것"으로 읽혔다(2026-10-01 실측).
  const pathname = usePathname();
  const detailId = pathname.startsWith(`${STORES_PATH}/`) ? decodeURIComponent(pathname.slice(STORES_PATH.length + 1)) : null;

  // 한 쪽(0228) — 검색·필터·정렬·쪽은 서버가 한다. 표는 받은 순서 그대로 그린다.
  const rows = useBrandUnitsPageStore((s) => s.rows);
  const total = useBrandUnitsPageStore((s) => s.total);
  const totalAll = useBrandUnitsPageStore((s) => s.totalAll);
  const invites = useBrandUnitsPageStore((s) => s.invites);
  const query = useBrandUnitsPageStore((s) => s.query);
  const setQuery = useBrandUnitsPageStore((s) => s.setQuery);
  const refresh = useBrandUnitsPageStore((s) => s.refresh);
  const reset = useBrandUnitsPageStore((s) => s.reset);
  const brand = useBrandStore((s) => s.brand);
  // 목록 칸의 ready 게이트(ui.md) — 표·초대는 쪽 스토어, '매장 추가' 기본 요금 부담은 brand 에서 온다.
  // 상세 칸은 자기 게이트를 따로 갖는다(상세를 기다리느라 목록이 사라지면 안 된다).
  const pageLoaded = useBrandUnitsPageStore((s) => s.loaded);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const ready = pageLoaded && brandLoaded;
  const error = useBrandUnitsPageStore((s) => s.error);

  // 포커스마다 재조회(정본 §6-3) — 점주가 수준을 내리면 돌아왔을 때 사라져 있어야 한다.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  // 화면을 떠나면 조건을 처음으로(예전처럼 떠났다 오면 필터가 풀린다).
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

  // 표 머리글 정렬 ↔ 서버 정렬. 기본(이름 오름차순)은 머리글에 화살표가 없다.
  const tableSort: HqSort | null =
    query.sort === 'name' && !query.desc ? null : { key: query.sort, dir: query.desc ? 'desc' : 'asc' };
  const onSortChange = (s: HqSort | null) =>
    setQuery(s ? { sort: s.key as BrandOverviewSort, desc: s.dir === 'desc' } : { sort: 'name', desc: false });
  const page = Math.floor(query.offset / HQ_STORES_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / HQ_STORES_PAGE_SIZE));

  const pendingInvites = useMemo(() => invites.filter((i) => i.kind === 'store' && i.status === 'pending'), [invites]);

  /**
   * 목록 → 첫 상세 = push, 상세를 다른 매장으로 갈아 끼울 때 = replace.
   * 뒤로가기 한 번이 늘 목록으로 돌아가게 하려는 것이다 — 매장 10곳을 비교해 본 뒤 뒤로가기가
   * 10번 거슬러 올라가면 '목록으로'가 아니다. 비교는 왼쪽 목록이 늘 보이므로 히스토리가 없어도 된다.
   * (좁은 창에서는 상세가 열려 있으면 목록이 안 보이므로 이 갈래는 넓은 창에서만 탄다.)
   */
  const openDetail = (unitId: string) => {
    if (unitId === detailId) return;
    const href = { pathname: '/hq/stores/[id]', params: { id: unitId } } as const;
    if (detailId) router.replace(href);
    else router.push(href);
  };

  // 표는 '누가 어떤 조건으로 연결돼 있나'까지만 — 나머지 지표는 행을 누르면 상세에 전부 있다.
  // 열 key = 서버 정렬 키(0228). sortValue 는 '머리글을 누를 수 있다'는 표시로만 쓰인다(제어 정렬이라 표가 다시 정렬하지 않는다).
  const columns: HqColumn<BrandOverviewRow>[] = [
    {
      key: 'name',
      label: '매장',
      width: 220,
      render: (r) => (
        <View>
          <Cell kind="name">{r.store_name}</Cell>
          {r.industry ? <Text style={styles.sub}>{r.industry}</Text> : null}
        </View>
      ),
      sortValue: (r) => r.store_name,
    },
    // 관계(0223) — 이름 바로 옆. 아래 열들의 뜻이 관계마다 다르므로(누가 정하나) 먼저 읽혀야 한다.
    { key: 'relation', label: '관계', width: 80, render: (r) => <HqPill tone={REL_TONE[r.relation]} label={relationLabel(r.relation)} />, sortValue: (r) => r.relation },
    {
      key: 'vis',
      label: '공개 수준',
      width: 150,
      render: (r) => (
        <View style={{ gap: 3 }}>
          <HqPill tone={VIS_TONE[r.visibility]} label={visibilityLabel(r.visibility)} />
          {r.visibility_requested ? <Text style={styles.sub}>{visibilityLabel(r.visibility_requested)} 요청 중</Text> : null}
        </View>
      ),
    },
    { key: 'staff', label: '직원', align: 'right', render: (r) => <Cell kind="num">{r.staff}</Cell>, sortValue: (r) => r.staff },
    // '미해결 질문'은 목록에 두지 않는다(사용자 결정 10-01) — 머리글이 가장 넓어 이 열 하나 때문에 1366·1440
    // 노트북에서 2단이 안 섰다. 값은 상세와 대시보드 표에 그대로 있다.
    // 숙지율은 사본(P4)이 생기기 전엔 재료가 없다 — 0 이 아니라 '—'(HqStrip 과 같은 규칙).
    { key: 'mastery', label: '숙지율', align: 'right', render: (r) => <Cell kind={r.mastery === null ? 'muted' : 'num'}>{r.mastery === null ? '—' : `${Math.round(r.mastery * 100)}%`}</Cell>, sortValue: (r) => r.mastery },
  ];

  // 표 바닥줄 — 몇 곳 중 어디부터 어디까지인가 + 지금 순서. 쪽이 하나면 범위는 말하지 않는다.
  const from = query.offset + 1;
  const to = query.offset + rows.length;
  const footer = `${pages > 1 ? `${from}–${to} / ` : ''}${total}곳 · ${SORT_LABEL[query.sort][query.desc ? 1 : 0]}`;

  // 좁은 창: 상세가 열려 있으면 상세만, 아니면 목록만. 숨긴 쪽도 **마운트는 유지**한다(필터·스크롤 보존).
  const showList = twoPane || !detailId;
  const showDetail = twoPane || !!detailId;

  return (
    <View style={styles.panes}>
      <View style={[styles.listPane, !showList && styles.hidden]}>
        <HqPage
          title="매장"
          sub={ready ? `연결된 매장 ${totalAll}곳 · 초대 대기 ${pendingInvites.length}건` : undefined}
          actions={
            <>
              <HqButton label="새로고침" icon="refresh-outline" onPress={() => void refresh()} />
              <HqButton label="매장 추가" icon="add" variant="pri" testID="hq-add-store" onPress={() => setAddOpen(true)} />
            </>
          }
          testID="hq-stores"
        >
          {/* 머리(제목·버튼)는 게이트 밖. 본문은 다 온 뒤에 — '아직 연결된 매장이 없어요'가 로딩 중에 스치지 않는다. */}
          {/* 실패하면 표를 그리지 않는다 — 첫 조회 실패가 '아직 연결된 매장이 없어요'로 위장된다. */}
          {!ready ? (
            <ScreenLoading label="매장 목록을 불러오고 있어요…" />
          ) : error ? (
            <HqLoadError title="매장 목록을 불러오지 못했어요" onRetry={refresh} testID="hq-stores-error" />
          ) : (
            <>
              {/* 필터 바 */}
              <View style={styles.fbar}>
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
                selectedKey={detailId}
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
                  <HqButton
                    label="이전"
                    icon="chevron-back"
                    disabled={page === 0}
                    testID="hq-stores-prev"
                    onPress={() => setQuery({ offset: (page - 1) * HQ_STORES_PAGE_SIZE })}
                  />
                  <Text style={styles.pagerText}>{page + 1} / {pages}쪽</Text>
                  <HqButton
                    label="다음"
                    icon="chevron-forward"
                    disabled={page + 1 >= pages}
                    testID="hq-stores-next"
                    onPress={() => setQuery({ offset: (page + 1) * HQ_STORES_PAGE_SIZE })}
                  />
                </View>
              ) : null}

              {/* 대기 초대 — 수락 전엔 매장명이 없다(번호만). 만료는 서버가 status 로 준다. */}
              <HqSlab title="초대 대기" hint="점주가 앱에서 수락하면 위 표로 올라와요. 14일이 지나면 만료돼요." />
              <HqTable
                columns={[
                  { key: 'phone', label: '점주 전화번호', width: 170, render: (i) => <Cell kind="name">{formatPhone(i.phone ?? '')}</Cell> },
                  { key: 'payer', label: '요금 부담', width: 110, render: (i) => <HqPill tone={i.payer === 'brand' ? 'y' : 'n'} label={i.payer ? payerLabel(i.payer) : '—'} /> },
                  { key: 'status', label: '상태', width: 110, render: () => <HqPill tone="w" label="대기" /> },
                  { key: 'sent', label: '보낸 날', render: (i) => <Cell kind="muted">{fmtDay(i.created_at)}</Cell> },
                  { key: 'exp', label: '만료', render: (i) => <Cell kind="muted">{fmtDay(i.expires_at)}</Cell> },
                  {
                    key: 'act',
                    label: '',
                    width: 110,
                    align: 'right',
                    // 취소(0214) — 점주 카드는 즉시 사라진다. 잘못 보낸 번호를 14일 동안 못 거두던 것(사용자 결정 09-23).
                    render: (i) => (
                      <HqButton
                        label="초대 취소"
                        testID={`hq-invite-revoke-${i.id}`}
                        onPress={() => {
                          void (async () => {
                            const ok = await confirmAction('초대 취소', `${formatPhone(i.phone ?? '')} 번호로 보낸 초대를 거둘까요? 점주 앱의 요청 카드가 바로 사라져요.`, '취소하기', { destructive: true, icon: 'close-circle-outline' });
                            if (!ok) return;
                            const err = await revokeInvite(i.id);
                            if (err) showToast(brandErrorMessage(err), 'warn');
                            else {
                              showToast('초대를 취소했어요.', 'good');
                              void refresh();
                            }
                          })();
                        }}
                      />
                    ),
                  },
                ]}
                rows={pendingInvites}
                rowKey={(i) => i.id}
                empty={<HqEmpty text="기다리는 초대가 없어요." />}
                testID="hq-invites-table"
              />

              <HqNotice>
                매장 삭제·직원 임면은 이 화면에 없어요. 매장의 존재와 사람의 지위는 점주만 정해요. 공개 수준도 점주가 고르고, 본사는 올려 달라고 요청만 할 수 있어요.
              </HqNotice>
            </>
          )}
        </HqPage>
      </View>

      <View style={[twoPane ? styles.detailPane : styles.fullPane, !showDetail && styles.hidden]}>
        <Slot />
      </View>

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
    </View>
  );
}

// ── 매장 추가: 전화번호 초대 + (담당자가 사장인 매장) 직영 즉시 연결 ────────────
function AddStoreModal({
  defaultPayer,
  onClose,
  onDone,
}: {
  defaultPayer: BrandPayer;
  onClose: () => void;
  onDone: () => void;
}) {
  const stores = useSessionStore((s) => s.stores);
  const [phone, setPhone] = useState('');
  const [payer, setPayer] = useState<BrandPayer>(defaultPayer);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 직영(§3-5 C): 담당자가 그 매장 사장이면 초대 없이 바로 active(자기 동의). 이미 연결된 매장은 뺀다.
  // 목록이 쪽으로 나뉘어 '연결된 매장 전부'가 화면에 없다 — 내 매장 id 만 넘겨 그중 연결된 것을 받는다(0228 p_units).
  // 받기 전(null)에는 이 구역을 그리지 않는다 — 이미 연결된 매장이 '바로 연결'로 스치면 안 된다.
  const ownIds = useMemo(() => stores.filter((s) => s.role === 'owner').map((s) => s.unit_id), [stores]);
  const [connected, setConnected] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (ownIds.length === 0) return; // 내 매장이 없으면 바로 연결 구역 자체가 없다
    let alive = true;
    void fetchBrandOverviewPage({ limit: ownIds.length, offset: 0, sort: 'name', desc: false, units: ownIds }).then((r) => {
      if (!alive) return;
      // 못 읽으면 바로 연결 구역을 숨긴다(전화번호 초대는 그대로 된다). 서버도 이미 연결된 매장은 거부한다.
      setConnected(r.error ? null : new Set((r.data ?? []).map((x) => x.unit_id)));
    });
    return () => { alive = false; };
  }, [ownIds]);
  const own = ownIds.length && connected ? stores.filter((s) => s.role === 'owner' && !connected.has(s.unit_id)) : [];

  const submit = async () => {
    if (!isValidPhone(phone)) {
      setErr('휴대폰 번호 형식을 확인해 주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const e = await inviteStore(normalizePhone(phone), payer);
    setBusy(false);
    if (e) {
      setErr(brandErrorMessage(e));
      return;
    }
    showToast('초대를 보냈어요. 점주가 앱에서 수락하면 표에 올라와요.', 'good');
    onDone();
  };

  const connect = async (unitId: string, name: string) => {
    setBusy(true);
    const e = await connectOwnUnit(unitId, payer);
    setBusy(false);
    if (e) {
      setErr(brandErrorMessage(e));
      return;
    }
    showToast(`${name}을 연결했어요.`, 'good');
    onDone();
  };

  return (
    <HqModal open title="매장 추가" sub="점주 전화번호로 초대해요. 점주가 앱에서 본사가 보게 되는 범위를 확인하고 매장과 공개 수준을 골라 수락해요." onClose={onClose}>
      <Text style={styles.label}>점주 휴대폰 번호</Text>
      <TextInput
        value={phone}
        onChangeText={(t) => setPhone(formatPhone(t))}
        placeholder="010-0000-0000"
        placeholderTextColor={InkColors.ink3}
        keyboardType="phone-pad"
        style={styles.input}
        accessibilityLabel="점주 휴대폰 번호"
        testID="hq-invite-phone"
      />
      <Text style={[styles.label, { marginTop: Space.md }]}>요금 부담</Text>
      <HqSegment
        items={[{ key: 'brand', label: '본사 부담' }, { key: 'store', label: '매장 부담' }]}
        value={payer}
        onChange={setPayer}
      />
      <Text style={styles.hint}>
        {payer === 'brand' ? '이 매장 요금이 본사 청구에 더해져요(계약가 × 매장 수).' : '매장이 자기 요금제를 써요. 본사에 추가 요금이 없어요.'}
      </Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <View style={{ flexDirection: 'row', gap: Space.sm, marginTop: Space.lg }}>
        <HqButton label="초대 보내기" variant="pri" disabled={busy} testID="hq-invite-send" onPress={() => void submit()} />
        <HqButton label="취소" disabled={busy} onPress={onClose} />
      </View>

      {own.length > 0 ? (
        <View style={{ marginTop: Space.xl }}>
          <HqSlab title="내가 사장인 매장은 바로 연결" hint="초대 없이 지금 연결돼요(운영 공개)." />
          <HqCard flush style={{ marginBottom: 0 }}>
            {own.map((s, i) => (
              <View key={s.unit_id} style={[styles.ownRow, i > 0 && { borderTopWidth: 1, borderTopColor: InkColors.line }]}>
                <Text style={styles.ownName} numberOfLines={1}>{s.store_name}</Text>
                <HqButton label="연결" variant="dark" disabled={busy} onPress={() => void connect(s.unit_id, s.store_name)} />
              </View>
            ))}
          </HqCard>
        </View>
      ) : null}
    </HqModal>
  );
}

const styles = StyleSheet.create({
  panes: { flex: 1, flexDirection: 'row' },
  listPane: { flex: 1, minWidth: 0 },
  // 상세 칸 — 예전 드로어와 같은 폭·같은 왼쪽 경계선. 딤 없이 목록 옆에 붙는다.
  detailPane: { width: HQ_STORE_DETAIL_WIDTH, borderLeftWidth: 1, borderLeftColor: InkColors.line, backgroundColor: InkColors.bg },
  fullPane: { flex: 1, minWidth: 0, backgroundColor: InkColors.bg },
  hidden: { display: 'none' },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.md, marginTop: -Space.sm, marginBottom: Space.xl },
  pagerText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },
  fbar: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 12, flexWrap: 'wrap' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, minWidth: 220, height: 40, backgroundColor: InkColors.bg },
  searchInput: { flex: 1, fontSize: 14.5, color: InkColors.ink, paddingVertical: 0 },
  hint: { fontSize: 14, lineHeight: 20, color: InkColors.ink2, marginBottom: Space.md },
  label: { fontSize: 14, fontWeight: '700', color: InkColors.ink2, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, height: 44, fontSize: 15.5, color: InkColors.ink },
  err: { fontSize: 14, color: BrandColors.badText, marginTop: Space.sm },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 10, paddingHorizontal: 16 },
  ownName: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
});
