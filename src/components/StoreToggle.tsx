import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { storeColor } from '@/lib/utils/storeColor';
import { StorePickerSheet, type StorePickerRow } from '@/components/hub/StorePickerSheet';
import { Wordmark } from '@/components/Wordmark';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 매장 진입 후 헤더의 좌상단 — **2칸 토글**(2026-08-08 상단바 C안).
//   [ 매장의 정석 | 신촌점 ▾ ]  회색 트랙 안에 두 칸, 지금 있는 층의 칸에만 흰 면이 깔린다.
//   · 로고 칸 = 허브(내 매장)로. 라벨 없는 ⌂ 아이콘 단독 버튼이던 것을 워드마크로 교체했다
//     (아이콘 단독 버튼 금지 규칙 위반이기도 했다). 로고는 안 줄인다 — 홈 버튼이라 항상 온전해야 한다.
//   · 매장 칸 = 지금 매장. 매장 수에 따라 동작이 다르다(T2, 2026-08-08 확정):
//       1곳   ▾ 없음 · 누를 데가 없다        2곳   1탭으로 다른 매장 토글
//       3곳↑  목록에서 고른다
//   · 폭: 매장명만 줄어든다. 트랙 상한 310px 에 닿으면 매장명이 …가 된다.
//
// ※ 아직 C안대로가 아닌 것(다음 작업): ① 허브 층 상단바는 워드마크 단독이라 두 층이 아직 다르다
//    — 허브에서 매장 칸을 누르는 동작은 stores.tsx 의 매장 진입(switchUnit+prefetch)과 같은 것이라
//    그 로직을 공용으로 꺼내는 게 선행이다(복제 금지). ② 목록은 아직 바닥 시트다 — C안은 누른 자리
//    바로 아래로 펼치는 드롭다운(Collapse)이고, 그러려면 직원 홈의 네이티브 Stack 헤더를 먼저
//    커스텀 헤더로 바꿔야 한다(네이티브 헤더 안에서는 아래로 펼칠 자리가 없다).
export function StoreToggle() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // 시트의 매장 색·닉네임을 허브와 일치시킨다(TTL 내 재호출은 스킵).
  useEffect(() => {
    void hydratePrefs();
  }, [hydratePrefs]);

  // 목록이 비면(직원·로드 중) 활성 매장 1개로. Phase 0에서 직원 다매장이 열리면 stores로 통일.
  const list =
    stores.length > 0
      ? stores.map((s) => ({ id: s.unit_id, name: s.store_name }))
      : unitId
        ? [{ id: unitId, name: storeName || '내 매장' }]
        : [];
  const labelOf = (id: string, name: string) => prefFor(id).nickname || name;
  const current = list.find((s) => s.id === unitId);
  const other = list.find((s) => s.id !== unitId); // 2곳일 때의 '다른 한 곳'

  const goHub = () => {
    setOpen(false);
    router.replace('/stores');
  };
  const pick = async (id: string) => {
    setOpen(false);
    if (id === unitId || busy) return;
    setBusy(true);
    await switchUnit(id);
    setBusy(false);
  };
  // 2곳이면 1탭 토글, 3곳↑이면 목록. 1곳이면 누를 것이 없다.
  const onScope = () => {
    if (busy) return;
    if (list.length === 2 && other) void pick(other.id);
    else if (list.length > 2) setOpen(true);
  };

  return (
    <View style={styles.track}>
      <Pressable
        onPress={goHub}
        style={styles.logoCell}
        accessibilityRole="button"
        accessibilityLabel="내 매장(허브)으로"
      >
        {/* 지금 여기가 아니다 — 색면 없이도 읽히도록 글자 농도를 낮춘다(색만으로 구분하지 않는다). */}
        <Wordmark size="xs" style={styles.logoDim} />
      </Pressable>
      <Pressable
        onPress={onScope}
        disabled={list.length < 2 || busy}
        style={styles.scopeCell}
        accessibilityRole="button"
        accessibilityLabel={
          list.length === 2
            ? `현재 매장 ${current?.name ?? ''}, 다른 매장으로 전환`
            : list.length > 2
              ? `현재 매장 ${current?.name ?? ''}, 매장 전환`
              : '현재 매장'
        }
      >
        {busy ? (
          <ActivityIndicator size="small" color={InkColors.ink} />
        ) : (
          <>
            <Text style={styles.scopeText} numberOfLines={1}>
              {current ? shortName(labelOf(current.id, current.name)) : '내 매장'}
            </Text>
            {list.length > 1 && <Ionicons name="chevron-down" size={12} color={InkColors.ink2} />}
          </>
        )}
      </Pressable>
      <StorePickerSheet
        visible={open}
        title="매장 전환"
        hint="이동할 매장을 골라 주세요"
        // 현 매장도 목록에 넣고 '현재 매장'으로 표시 — 지금 어디인지 시트 안에서 바로 보이게(2026-07-31).
        rows={list.map(
          (s): StorePickerRow => ({
            uid: s.id,
            label: labelOf(s.id, s.name),
            color: storeColor(s.id, prefFor(s.id).color),
          }),
        )}
        currentUid={unitId ?? undefined}
        onPick={(uid) => void pick(uid)}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

// "스퀘어 카페 · 신촌점" → "신촌점"(지점명 우선). 구분자 없으면 전체.
function shortName(n: string): string {
  return n.includes('·') ? (n.split('·').pop() || n).trim() : n;
}

const styles = StyleSheet.create({
  // 회색 트랙 — 두 칸이 한 컨트롤이라는 신호. 내용만큼만 차지하고 310px 에서 멈춘다.
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    padding: Space.xs,
    flexShrink: 1,
    maxWidth: 310,
    ...Elevation.e1,
  },
  logoCell: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    flexShrink: 0, // 로고는 안 줄인다 — 홈 버튼이라 항상 온전해야 한다.
  },
  logoDim: { opacity: 0.55 },
  // 선택된 칸 = 흰 면. 지금 매장 층에 있으므로 매장 칸에 깔린다.
  scopeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    backgroundColor: '#FFFFFF',
    flexShrink: 1,
    ...Elevation.e1,
  },
  scopeText: { fontSize: 13, fontWeight: '900', color: InkColors.ink, flexShrink: 1 },
});
