// AddStoreModal.tsx — 매장 추가(전화번호 초대 + 담당자가 사장인 매장은 바로 직영 연결).
// 하위 메뉴의 + · 전체 매장 · 초대 대기 화면이 같이 연다(2026-10-02 하위 메뉴 개편 때 매장 화면에서 꺼냈다 · 내용 그대로).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import { HqButton, HqCard, HqSlab, HqSegment } from '@/components/hq/HqKit';
import { HqModal } from '@/components/hq/HqModal';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { inviteStore, connectOwnUnit, fetchBrandOverviewPage, type BrandPayer } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { formatPhone, isValidPhone, normalizePhone } from '@/lib/utils/validation';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// ── 매장 추가: 전화번호 초대 + (담당자가 사장인 매장) 직영 즉시 연결 ────────────
export function AddStoreModal({
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
    showToast('초대를 보냈어요. 점주가 앱에서 수락하면 전체 매장에 올라와요.', 'good');
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
  hint: { fontSize: 14, lineHeight: 20, color: InkColors.ink2, marginBottom: Space.md },
  label: { fontSize: 14, fontWeight: '700', color: InkColors.ink2, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, height: 44, fontSize: 15.5, color: InkColors.ink },
  err: { fontSize: 14, color: BrandColors.badText, marginTop: Space.sm },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 10, paddingHorizontal: 16 },
  ownName: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
});
