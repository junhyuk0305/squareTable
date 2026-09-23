// /hq/stores — 매장(정본 §5-2): 필터 → 표(이름순) → 우측 드로어(연결 정보·상향 요청·payer 제안·해제) → "매장 추가"(전화번호 + payer) · 대기 초대.
//
// 재료는 useBrandStore 한 곳(brand_overview · brand_invites_list). 표는 행 배열만 받는다.
// 초대 취소(revoke)는 없다 — 14일 만료만(P3 지시서 §1 #10, 확인 대기).
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqPill, HqCard, HqRow, HqSlab, HqNotice, HqSegment, HqEmpty } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn } from '@/components/hq/HqTable';
import { HqDrawer } from '@/components/hq/HqDrawer';
import { HqModal } from '@/components/hq/HqModal';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  inviteStore,
  connectOwnUnit,
  requestVisibility,
  proposePayer,
  acceptPayer,
  endBrandUnit,
  revokeInvite,
  type BrandOverviewRow,
  type BrandPayer,
  type BrandVisibility,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { visibilityLabel, payerLabel, VISIBILITY_LEVELS } from '@/lib/brand/visibility';
import { formatPhone, isValidPhone, normalizePhone } from '@/lib/utils/validation';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const VIS_TONE: Record<BrandVisibility, 'n' | 'i' | 'g'> = { summary: 'n', knowhow: 'i', ops: 'g' };

export default function HqStoresScreen() {
  const params = useLocalSearchParams<{ unit?: string }>();
  const overview = useBrandStore((s) => s.overview);
  const invites = useBrandStore((s) => s.invites);
  const brand = useBrandStore((s) => s.brand);
  const loaded = useBrandStore((s) => s.loaded);
  const error = useBrandStore((s) => s.error);
  const hydrate = useBrandStore((s) => s.hydrate);
  const refresh = useBrandStore((s) => s.refresh);

  // 포커스마다 재조회(정본 §6-3) — 점주가 수준을 내리면 돌아왔을 때 사라져 있어야 한다.
  useFocusEffect(useCallback(() => { void hydrate(); }, [hydrate]));

  const [q, setQ] = useState('');
  const [payerF, setPayerF] = useState<'all' | BrandPayer>('all');
  const [visF, setVisF] = useState<'all' | BrandVisibility>('all');
  // 대시보드에서 행을 눌러 왔을 때(`?unit=`) 드로어를 바로 연다(첫 렌더 초기값).
  const [selected, setSelected] = useState<string | null>(() => (typeof params.unit === 'string' && params.unit ? params.unit : null));
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim();
    return overview.filter(
      (r) =>
        (!needle || r.store_name.includes(needle)) &&
        (payerF === 'all' || r.payer === payerF) &&
        (visF === 'all' || r.visibility === visF),
    );
  }, [overview, q, payerF, visF]);

  const pendingInvites = useMemo(() => invites.filter((i) => i.kind === 'store' && i.status === 'pending'), [invites]);
  const selectedRow = overview.find((r) => r.unit_id === selected) ?? null;

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
    { key: 'payer', label: '요금 부담', width: 110, render: (r) => <HqPill tone={r.payer === 'brand' ? 'y' : 'n'} label={payerLabel(r.payer)} /> },
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
    { key: 'knowhow', label: '자체 노하우', align: 'right', render: (r) => <Cell kind="num">{r.knowhow_own}</Cell>, sortValue: (r) => r.knowhow_own },
    { key: 'pq', label: '미해결 질문', align: 'right', render: (r) => <Cell kind="num">{r.pending_q}</Cell>, sortValue: (r) => r.pending_q },
    { key: 'ai', label: 'AI 사용(월)', align: 'right', render: (r) => <Cell kind="num">{r.ai_used}</Cell>, sortValue: (r) => r.ai_used },
    // 숙지율은 사본(P4)이 생기기 전엔 재료가 없다 — 0 이 아니라 '—'(HqStrip 과 같은 규칙).
    { key: 'mastery', label: '숙지율', align: 'right', render: (r) => <Cell kind={r.mastery === null ? 'muted' : 'num'}>{r.mastery === null ? '—' : `${Math.round(r.mastery * 100)}%`}</Cell>, sortValue: (r) => r.mastery },
    { key: 'since', label: '연결일', width: 110, render: (r) => <Cell kind="muted">{fmtDay(r.accepted_at)}</Cell>, sortValue: (r) => r.accepted_at },
  ];

  return (
    <View style={{ flex: 1 }}>
      <HqPage
        title="매장"
        sub={loaded ? `연결된 매장 ${overview.length}곳 · 초대 대기 ${pendingInvites.length}건. 행을 누르면 오른쪽에 연결 정보가 열려요.` : '불러오는 중…'}
        actions={
          <>
            <HqButton label="새로고침" icon="refresh-outline" onPress={() => void refresh()} />
            <HqButton label="매장 추가" icon="add" variant="pri" testID="hq-add-store" onPress={() => setAddOpen(true)} />
          </>
        }
        testID="hq-stores"
      >
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
            items={[{ key: 'all', label: '요금 전체' }, { key: 'brand', label: '본사 부담' }, { key: 'store', label: '매장 부담' }]}
            value={payerF}
            onChange={setPayerF}
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
          onRowPress={(r) => setSelected(r.unit_id)}
          selectedKey={selected}
          footer={loaded ? `${rows.length}곳 표시 · 이름순. 점수·등급·순위는 만들지 않아요.` : undefined}
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
      </HqPage>

      {/* key = 매장 — 행이 바뀌면 드로어를 새로 마운트해 로컬 상태(요청 수준 기본값)가 그 매장으로 선다. */}
      <StoreDrawer key={selectedRow?.unit_id ?? 'none'} row={selectedRow} onClose={() => setSelected(null)} onChanged={() => void refresh()} />

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

// ── 드로어: 연결 정보 · 상향 요청 · payer 제안/응답 · 해제 ─────────────────────
function StoreDrawer({ row, onClose, onChanged }: { row: BrandOverviewRow | null; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  // 지금 수준보다 높은 첫 수준을 기본으로(부모가 key 로 매장마다 새로 마운트한다).
  const [reqLevel, setReqLevel] = useState<'knowhow' | 'ops'>(() => (row?.visibility === 'summary' ? 'knowhow' : 'ops'));

  if (!row) return null;
  const canRequest = row.visibility !== 'ops' && !row.visibility_requested;
  const otherPayer: BrandPayer = row.payer === 'brand' ? 'store' : 'brand';

  const run = async (fn: () => Promise<{ message: string } | null>, okMsg: string) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) {
      showToast(brandErrorMessage(err), 'warn');
      return;
    }
    showToast(okMsg, 'good');
    onChanged();
  };

  return (
    <HqDrawer open title={row.store_name} sub={row.industry ?? undefined} onClose={onClose}>
      <View style={styles.kv}>
        <HqRow first k="연결일" v={fmtDay(row.accepted_at)} />
        <HqRow k="요금 부담" v={<HqPill tone={row.payer === 'brand' ? 'y' : 'n'} label={payerLabel(row.payer)} />} />
        <HqRow k="공개 수준" v={<HqPill tone={VIS_TONE[row.visibility]} label={visibilityLabel(row.visibility)} />} />
        <HqRow k="직원" v={`${row.staff}명`} />
        <HqRow k="자체 노하우" v={`${row.knowhow_own}건`} />
        <HqRow k="미해결 질문" v={`${row.pending_q}건`} />
        <HqRow k="AI 사용(월)" v={`${row.ai_used}건`} />
        {row.tasks_done_30d !== null ? <HqRow k="업무 완료(30일)" v={`${row.tasks_done_30d}건`} /> : null}
        {row.quiz_courses !== null ? <HqRow k="매장 퀴즈" v={`${row.quiz_courses}개`} /> : null}
      </View>

      {/* 공개 수준 상향 요청 — 본사는 요청만(§3-4). 점주가 앱에서 수락하거나 유지한다. */}
      <View style={styles.section}>
      <HqSlab title="공개 수준 올려 달라고 요청" />
      {row.visibility === 'ops' ? (
        <Text style={styles.hint}>가장 넓은 수준(운영 공개)이에요.</Text>
      ) : row.visibility_requested ? (
        <Text style={styles.hint}>{visibilityLabel(row.visibility_requested)} 요청을 점주가 보고 있어요. 점주가 답하면 표에 반영돼요.</Text>
      ) : (
        <View style={{ gap: Space.sm }}>
          <HqSegment
            items={VISIBILITY_LEVELS.filter((l) => l.key !== 'summary' && l.key !== row.visibility).map((l) => ({ key: l.key as 'knowhow' | 'ops', label: l.label }))}
            value={reqLevel}
            onChange={setReqLevel}
          />
          <HqButton
            label="요청 보내기"
            variant="dark"
            disabled={busy || !canRequest}
            testID="hq-request-visibility"
            onPress={() => void run(() => requestVisibility(row.unit_id, reqLevel), '점주에게 요청을 보냈어요.')}
          />
        </View>
      )}

      </View>

      {/* payer — 제안 → 상대 수락(§3-5 D). 반영 시점·정산은 P6. */}
      <View style={styles.section}>
      <HqSlab title="요금 부담 변경" />
      {row.payer_proposed ? (
        row.payer_proposed_by_brand ? (
          <Text style={styles.hint}>{payerLabel(row.payer_proposed)}으로 바꾸자는 제안을 점주가 보고 있어요.</Text>
        ) : (
          <View style={{ gap: Space.sm }}>
            <Text style={styles.hint}>점주가 {payerLabel(row.payer_proposed)}으로 바꾸자고 제안했어요.</Text>
            <View style={{ flexDirection: 'row', gap: Space.sm }}>
              <HqButton label="수락" variant="pri" disabled={busy} onPress={() => void run(() => acceptPayer(row.unit_id, true), '요금 부담이 바뀌었어요.')} />
              <HqButton label="거절" disabled={busy} onPress={() => void run(() => acceptPayer(row.unit_id, false), '제안을 거절했어요.')} />
            </View>
          </View>
        )
      ) : (
        <View style={{ gap: Space.sm }}>
          <Text style={styles.hint}>지금은 {payerLabel(row.payer)}이에요. 바꾸려면 점주가 수락해야 해요.</Text>
          <HqButton
            label={`${payerLabel(otherPayer)}으로 제안`}
            disabled={busy}
            onPress={() => void run(() => proposePayer(row.unit_id, otherPayer), '점주에게 제안을 보냈어요.')}
          />
        </View>
      )}

      </View>

      <View style={styles.section}>
      <HqSlab title="연결 해제" />
      <Text style={styles.hint}>해제하면 이 매장을 더 보지 못해요. 매장이 받은 노하우는 매장에 남아요.</Text>
      <HqButton
        label="연결 해제"
        variant="danger"
        disabled={busy}
        onPress={() => {
          void (async () => {
            const ok = await confirmAction('연결 해제', `${row.store_name}과의 연결을 끝낼까요? 되돌리려면 다시 초대해야 해요.`, '해제', { destructive: true, icon: 'unlink-outline' });
            if (!ok) return;
            await run(() => endBrandUnit(row.unit_id, 'brand'), '연결을 끝냈어요.');
            onClose();
          })();
        }}
      />
      </View>
    </HqDrawer>
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
  sub: { fontSize: 11.5, color: InkColors.ink3, marginTop: 2 },
  fbar: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 12, flexWrap: 'wrap' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, minWidth: 220, height: 36, backgroundColor: InkColors.bg },
  searchInput: { flex: 1, fontSize: 13, color: InkColors.ink, paddingVertical: 0 },
  kv: { borderTopWidth: 1, borderTopColor: InkColors.line, marginBottom: Space.lg },
  section: { marginBottom: Space.xl },
  hint: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink2, marginBottom: Space.md },
  label: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, height: 40, fontSize: 14, color: InkColors.ink },
  err: { fontSize: 12.5, color: BrandColors.badText, marginTop: Space.sm },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 10, paddingHorizontal: 16 },
  ownName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink },
});
