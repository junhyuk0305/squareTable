// /hq/stores — 매장(정본 §5-2): 왼쪽 목록(필터 → 표(이름순) → 대기 초대 → "매장 추가") + 오른쪽 <Slot/>(상세 `[id]` · 빈 자리 `index`).
//
// ★목록을 레이아웃에 두는 이유: 상세를 갈아 끼워도 목록의 필터·검색·정렬·스크롤이 그대로 남는다(2단의 핵심).
//   `[id]` 가 목록을 다시 그리면 상태가 날아간다. 좁은 창에서도 목록은 **숨기기만** 하고 내리지 않는다.
// 재료 = useBrandUnitsStore(brand_overview · brand_invites_list). 표는 행 배열만 받는다.
// 상세는 `[id].tsx` — 매장 주소(`/hq/stores/<unit_id>`)가 공유·새로고침·뒤로가기의 SSOT 다.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Slot, useFocusEffect, useGlobalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqPill, HqCard, HqSlab, HqNotice, HqSegment, HqEmpty } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useStoresTwoPane, HQ_STORE_DETAIL_WIDTH } from '@/components/hq/storesPane';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  inviteStore,
  connectOwnUnit,
  revokeInvite,
  type BrandOverviewRow,
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

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const VIS_TONE: Record<BrandVisibility, 'n' | 'i' | 'g'> = { summary: 'n', knowhow: 'i', ops: 'g' };
// 관계 배지(0223) — 직영만 색을 준다. 가맹이 기본값이고 대부분이라, 둘 다 물들이면 표가 시끄럽다.
const REL_TONE: Record<BrandRelation, 'i' | 'n'> = { direct: 'i', franchise: 'n' };

export default function HqStoresLayout() {
  const router = useRouter();
  const twoPane = useStoresTwoPane();
  // 지금 열린 상세 — 레이아웃은 자식의 동적 파라미터를 전역 파라미터로만 본다.
  const { id } = useGlobalSearchParams<{ id?: string }>();
  const detailId = typeof id === 'string' && id ? id : null;

  const overview = useBrandUnitsStore((s) => s.overview);
  const invites = useBrandUnitsStore((s) => s.invites);
  const brand = useBrandStore((s) => s.brand);
  // 목록 칸의 ready 게이트(ui.md) — 표·초대는 units, '매장 추가' 기본 요금 부담은 brand 에서 온다.
  // 상세 칸은 자기 게이트를 따로 갖는다(상세를 기다리느라 목록이 사라지면 안 된다).
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const ready = unitsLoaded && brandLoaded;
  const error = useBrandUnitsStore((s) => s.error);
  const hydrate = useBrandUnitsStore((s) => s.hydrate);
  const refresh = useBrandUnitsStore((s) => s.refresh);

  // 포커스마다 재조회(정본 §6-3) — 점주가 수준을 내리면 돌아왔을 때 사라져 있어야 한다.
  useFocusEffect(useCallback(() => { void hydrate(); }, [hydrate]));

  const [q, setQ] = useState('');
  const [relF, setRelF] = useState<'all' | BrandRelation>('all');
  const [visF, setVisF] = useState<'all' | BrandVisibility>('all');
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim();
    return overview.filter(
      (r) =>
        (!needle || r.store_name.includes(needle)) &&
        (relF === 'all' || r.relation === relF) &&
        (visF === 'all' || r.visibility === visF),
    );
  }, [overview, q, relF, visF]);

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
    { key: 'rel', label: '관계', width: 80, render: (r) => <HqPill tone={REL_TONE[r.relation]} label={relationLabel(r.relation)} />, sortValue: (r) => r.relation },
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
    { key: 'pq', label: '미해결 질문', align: 'right', render: (r) => <Cell kind="num">{r.pending_q}</Cell>, sortValue: (r) => r.pending_q },
    // 숙지율은 사본(P4)이 생기기 전엔 재료가 없다 — 0 이 아니라 '—'(HqStrip 과 같은 규칙).
    { key: 'mastery', label: '숙지율', align: 'right', render: (r) => <Cell kind={r.mastery === null ? 'muted' : 'num'}>{r.mastery === null ? '—' : `${Math.round(r.mastery * 100)}%`}</Cell>, sortValue: (r) => r.mastery },
  ];

  // 좁은 창: 상세가 열려 있으면 상세만, 아니면 목록만. 숨긴 쪽도 **마운트는 유지**한다(필터·스크롤 보존).
  const showList = twoPane || !detailId;
  const showDetail = twoPane || !!detailId;

  return (
    <View style={styles.panes}>
      <View style={[styles.listPane, !showList && styles.hidden]}>
        <HqPage
          title="매장"
          sub={ready ? `연결된 매장 ${overview.length}곳 · 초대 대기 ${pendingInvites.length}건` : undefined}
          actions={
            <>
              <HqButton label="새로고침" icon="refresh-outline" onPress={() => void refresh()} />
              <HqButton label="매장 추가" icon="add" variant="pri" testID="hq-add-store" onPress={() => setAddOpen(true)} />
            </>
          }
          testID="hq-stores"
        >
          {/* 머리(제목·버튼)는 게이트 밖. 본문은 다 온 뒤에 — '아직 연결된 매장이 없어요'가 로딩 중에 스치지 않는다. */}
          {!ready ? (
            <ScreenLoading label="매장 목록을 불러오고 있어요…" />
          ) : (
            <>
              {error ? (
                <HqNotice tone="warn">매장 목록을 불러오지 못했어요. 새로고침을 눌러 다시 시도해 주세요. ({error})</HqNotice>
              ) : null}

              {/* 필터 바 */}
              <View style={styles.fbar}>
                <View style={styles.search}>
                  <Ionicons name="search-outline" size={15} color={InkColors.ink3} />
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="매장 이름으로 찾기"
                    placeholderTextColor={InkColors.ink3}
                    style={styles.searchInput}
                    accessibilityLabel="매장 이름으로 찾기"
                  />
                </View>
                <HqSegment
                  items={[{ key: 'all', label: '관계 전체' }, ...RELATIONS.map((r) => ({ key: r.key, label: r.label }))]}
                  value={relF}
                  onChange={setRelF}
                />
                <HqSegment
                  items={[{ key: 'all', label: '수준 전체' }, ...VISIBILITY_LEVELS.map((l) => ({ key: l.key, label: l.label }))]}
                  value={visF}
                  onChange={setVisF}
                />
              </View>

              <HqTable
                columns={columns}
                rows={rows}
                rowKey={(r) => r.unit_id}
                onRowPress={(r) => openDetail(r.unit_id)}
                selectedKey={detailId}
                footer={`${rows.length}곳 · 이름순`}
                empty={
                  <HqEmpty
                    text={overview.length === 0 ? '아직 연결된 매장이 없어요. 점주 전화번호로 초대하면 점주가 앱에서 수락해요.' : '조건에 맞는 매장이 없어요.'}
                    action={overview.length === 0 ? <HqButton label="매장 추가" variant="pri" onPress={() => setAddOpen(true)} /> : undefined}
                  />
                }
                testID="hq-stores-table"
              />

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
          connectedIds={overview.map((r) => r.unit_id)}
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
  connectedIds,
  onClose,
  onDone,
}: {
  defaultPayer: BrandPayer;
  connectedIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const stores = useSessionStore((s) => s.stores);
  const [phone, setPhone] = useState('');
  const [payer, setPayer] = useState<BrandPayer>(defaultPayer);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 직영(§3-5 C): 담당자가 그 매장 사장이면 초대 없이 바로 active(자기 동의). 이미 연결된 매장은 뺀다.
  const own = stores.filter((s) => s.role === 'owner' && !connectedIds.includes(s.unit_id));

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
