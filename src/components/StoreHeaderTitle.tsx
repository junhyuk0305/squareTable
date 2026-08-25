import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { storeColor } from '@/lib/utils/storeColor';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/**
 * 매장 표시(이름·색) SSOT — 상단바(StoreToggle)와 탭 헤더(StoreHeaderTitle)가 **같은 판정을 공유**한다.
 * 두 곳에 복제하면 한쪽만 고쳐지는 무음 드리프트가 난다(둘 다 상시 노출이라 티가 늦게 난다).
 *
 * 상단바는 화면 골격이라 통째로 로딩으로 대체하지 않는다 → 정본 §0-1 ③ "일부만 늦게 오는 곳은
 * **미리 자리를 잡고 내용만 채운다**"를 쓴다. 핵심은 **뜻이 바뀌는 라벨을 단정하지 않는 것**이다:
 * prefs 도착 전에 원본명을 그리면 `내 매장 → 신촌점(원본명) → 본점(닉네임)`으로 라벨이 두 번 바뀌고,
 * 색점도 자동색 → 지정색으로 한 번 더 바뀐다.
 */
export function useStoreDisplay() {
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const prefsLoaded = useMemberPrefsStore((s) => s.loaded);
  const hydrate = useMemberPrefsStore((s) => s.hydrate);
  // 사장 레이아웃은 member prefs 를 안 당길 수 있어 여기서 보강 — TTL 가드로 중복 진입에도 안전.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return {
    prefsLoaded,
    /** 표시용 이름 — 확정 전에는 null. 호출부는 **자리만 유지하고 비워 둔다**. */
    nameOf: (unitId: string, fallback?: string | null): string | null =>
      prefsLoaded ? resolveStoreName(prefFor(unitId).nickname, fallback) : null,
    /** 데이터로 넘길 이름(매장 진입 커버 등) — 표시 지연과 무관하게 지금 아는 최선값. */
    nameNow: (unitId: string, fallback?: string | null): string =>
      resolveStoreName(prefFor(unitId).nickname, fallback),
    /** 표시용 색점 — 확정 전에는 투명. 자리·크기는 그대로라 자동색→지정색 점프가 없다. */
    dotColorOf: (unitId: string): string =>
      prefsLoaded ? storeColor(unitId, prefFor(unitId).color) : 'transparent',
  };
}

function resolveStoreName(nickname: string | null, fallback?: string | null): string {
  return nickname || fallback || '내 매장';
}

/**
 * 매장 앱 탭 헤더 타이틀 — 화면 이름 아래 지금 보고 있는 매장(색점+이름)을 상시 표시.
 * 홈 탭의 StoreToggle(전환기)과 달리 표시 전용 — "어느 매장의 내용인가"를 모든 탭에서 답한다.
 * 이름·색은 허브와 같은 규칙: 매장별 개인 설정(닉네임·색) 우선, 없으면 매장명·자동색.
 */
export function StoreHeaderTitle({ title }: { title: string }) {
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const { nameOf, dotColorOf } = useStoreDisplay();

  if (!unitId) return <Text style={styles.title}>{title}</Text>;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.storeLine}>
        <View style={[styles.dot, { backgroundColor: dotColorOf(unitId) }]} />
        {/* 확정 전에는 자리(줄 높이)만 잡는다 — 원본명이라는 중간 단계를 거치지 않게. */}
        <Text style={styles.storeName} numberOfLines={1}>
          {nameOf(unitId, storeName) ?? ' '}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  storeLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  storeName: { fontSize: 11.5, fontWeight: '600', color: InkColors.ink3, maxWidth: 220 },
});
