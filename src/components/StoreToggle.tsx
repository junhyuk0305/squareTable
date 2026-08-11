import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreEntryStore } from '@/lib/store/useStoreEntryStore';
import { storeColor } from '@/lib/utils/storeColor';
import { Wordmark } from '@/components/Wordmark';
import { Appear, stagger } from '@/components/Appear';
import { Collapse } from '@/components/Collapse';
import { USE_NATIVE_DRIVER } from '@/lib/anim';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 상단바 좌상단 — **2칸 토글**(2026-08-08 상단바 C안). 허브 층·매장 층이 같은 것을 쓴다.
//   [ 매장의 정석 | 신촌점 ▾ ]  회색 트랙 안에 두 칸, **지금 있는 층의 칸에만 흰 면**이 깔린다.
//   · 로고 칸 = 허브(내 매장). 라벨 없는 ⌂ 아이콘 단독 버튼이던 것을 워드마크로 교체했다.
//   · 매장 칸 = 지금 매장(허브에선 '전체 매장'). 매장 수에 따라 동작이 다르다(T2, 2026-08-08 확정):
//       1곳   허브=그 매장 진입 · 매장=아무 일 없음(▾도 안 그린다)
//       2곳   허브=현재 매장 진입 · 매장=1탭으로 다른 매장 토글
//       3곳↑  아래로 펼치는 드롭다운에서 고른다(바닥 시트 폐기 — 누른 자리에서 열려야 인과가 분명하다)
//   · 폭: 매장명만 줄어든다. 트랙 상한 310px 에 닿으면 매장명이 …가 된다. 로고는 안 줄인다.
//
// 애니메이션(같은 감속 곡선 하나 — cubic-bezier(.32,.72,0,1)):
//   A1 흰 면 슬라이드(300ms) 선택이 이동했다는 것 · A9 비선택 칸 페이드(220ms) 지금 여기가 아니라는 것
//   A6 드롭다운 행 스태거(Appear+stagger) · A7 펼침(Collapse)
//   ※ A1 은 이 컴포넌트 안에만 있다. 다른 자리에서 재구현하지 말 것(프리미티브는 Appear·Collapse 둘뿐).
const TRACK_MAX = 310;
const SLIDE_MS = 300;
const FADE_MS = 220;
const EASE = Easing.bezier(0.32, 0.72, 0, 1);

export function StoreToggle({ scope = 'store' }: { scope?: 'hub' | 'store' }) {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const enterStore = useStoreEntryStore((s) => s.enter);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // 두 칸의 실제 폭·위치(onLayout) — 흰 면이 그 자리로 미끄러진다.
  const [cells, setCells] = useState<{ x: number; w: number }[]>([]);

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
  const onHub = scope === 'hub';
  // 허브에선 스코프가 '전체 매장'이다 — 지금 보고 있는 범위를 그대로 쓴다.
  const scopeLabel = onHub ? '전체 매장' : current ? shortName(labelOf(current.id, current.name)) : '내 매장';
  // 매장 층에서 1곳이면 갈 데가 없다(C안 동작표). 허브에선 1곳이어도 '들어가기'가 있다.
  const hasMove = onHub ? list.length >= 1 : list.length >= 2;

  // ── A1 흰 면 슬라이드 ─────────────────────────────────────────
  const sel = useMemo(() => new Animated.Value(onHub ? 0 : 1), [onHub]);
  useEffect(() => {
    const a = Animated.timing(sel, {
      toValue: onHub ? 0 : 1,
      duration: SLIDE_MS,
      easing: EASE,
      useNativeDriver: false, // left/width 는 레이아웃 값이라 네이티브 드라이버 불가(Collapse 와 같은 이유)
    });
    a.start();
    return () => a.stop();
  }, [sel, onHub]);
  const measured = cells.length === 2;
  const face = measured
    ? {
        left: sel.interpolate({ inputRange: [0, 1], outputRange: [cells[0].x, cells[1].x] }),
        width: sel.interpolate({ inputRange: [0, 1], outputRange: [cells[0].w, cells[1].w] }),
      }
    : null;
  const onCellLayout = (i: number) => (e: { nativeEvent: { layout: { x: number; width: number } } }) => {
    const { x, width } = e.nativeEvent.layout;
    setCells((prev) => {
      if (prev[i] && Math.abs(prev[i].x - x) < 0.5 && Math.abs(prev[i].w - width) < 0.5) return prev;
      const next = [...prev];
      next[i] = { x, w: width };
      return next;
    });
  };

  const goHub = () => {
    setOpen(false);
    if (onHub) return; // 이미 허브다 — 같은 곳으로 다시 보내지 않는다.
    router.replace('/stores');
  };
  /** 매장을 골랐다. 허브에선 '들어가기'(전역 커버), 매장 층에선 '전환'이다. */
  const pick = async (id: string) => {
    setOpen(false);
    if (busy) return;
    if (onHub) {
      const row = list.find((s) => s.id === id);
      return void enterStore({ uid: id, name: row ? labelOf(row.id, row.name) : '내 매장' });
    }
    if (id === unitId) return;
    setBusy(true);
    await switchUnit(id);
    setBusy(false);
  };
  // 2곳이면 1탭, 3곳↑이면 드롭다운. 허브에서 1곳이면 그 매장으로 바로 들어간다.
  const onScope = () => {
    if (busy || !hasMove) return;
    if (list.length > 2) return setOpen((v) => !v);
    if (onHub) return void pick(current?.id ?? list[0].id);
    if (other) void pick(other.id);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {/* 흰 면 — 선택된 칸 아래에 깔리고 칸 사이를 미끄러진다(A1). 잴 수 없으면 그냥 안 그린다(fail-open). */}
        {face && <Animated.View pointerEvents="none" style={[styles.face, face]} />}
        <Pressable
          onPress={goHub}
          onLayout={onCellLayout(0)}
          style={styles.logoCell}
          accessibilityRole="button"
          accessibilityLabel={onHub ? '내 매장(허브)' : '내 매장(허브)으로'}
        >
          {/* 지금 여기가 아니다 — 색면 없이도 읽히도록 글자 농도를 낮춘다(색만으로 구분하지 않는다). */}
          <FadeCell dim={!onHub}>
            <Wordmark size="xs" />
          </FadeCell>
        </Pressable>
        <Pressable
          onPress={onScope}
          onLayout={onCellLayout(1)}
          disabled={!hasMove || busy}
          style={styles.scopeCell}
          accessibilityRole="button"
          accessibilityLabel={
            onHub
              ? list.length > 2 ? '매장 골라 들어가기' : `${scopeLabel}, 매장 들어가기`
              : list.length === 2
                ? `현재 매장 ${scopeLabel}, 다른 매장으로 전환`
                : list.length > 2
                  ? `현재 매장 ${scopeLabel}, 매장 전환`
                  : '현재 매장'
          }
        >
          {busy ? (
            <ActivityIndicator size="small" color={InkColors.ink} />
          ) : (
            <FadeCell dim={onHub}>
              <View style={styles.scopeInner}>
                <Text style={styles.scopeText} numberOfLines={1}>
                  {scopeLabel}
                </Text>
                {hasMove && list.length > 1 && (
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={InkColors.ink2} />
                )}
              </View>
            </FadeCell>
          )}
        </Pressable>
      </View>

      {/* A7 — 누른 그 자리 바로 아래에서 열린다(바닥 시트 폐기). A6 — 행이 순서대로 쏟아진다. */}
      {open && (
        <View style={styles.menuAnchor}>
        <Collapse style={styles.menu}>
          {list.map((s, i) => {
            const isCurrent = s.id === unitId;
            return (
              <Appear key={s.id} delay={stagger(i)} offsetY={7}>
                <Pressable
                  onPress={() => void pick(s.id)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: InkColors.bgSoft }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${labelOf(s.id, s.name)}${isCurrent ? ' (현재 매장)' : ''}`}
                >
                  <View style={[styles.dot, { backgroundColor: storeColor(s.id, prefFor(s.id).color) }]} />
                  <Text style={styles.rowText} numberOfLines={1}>
                    {labelOf(s.id, s.name)}
                  </Text>
                  {/* 색만으로 구분하지 않는다 — 지금 매장은 글자로도 말한다. */}
                  {isCurrent && <Text style={styles.rowNow}>현재 매장</Text>}
                </Pressable>
              </Appear>
            );
          })}
        </Collapse>
        </View>
      )}
    </View>
  );
}

/** A9 — 지금 층이 아닌 칸을 220ms 로 흐린다. 값이 점프하면 "왜 흐려졌는지"가 안 읽힌다. */
function FadeCell({ dim, children }: { dim: boolean; children: React.ReactNode }) {
  const v = useMemo(() => new Animated.Value(dim ? 0.55 : 1), [dim]);
  useEffect(() => {
    const a = Animated.timing(v, { toValue: dim ? 0.55 : 1, duration: FADE_MS, easing: EASE, useNativeDriver: USE_NATIVE_DRIVER });
    a.start();
    return () => a.stop();
  }, [v, dim]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

// "스퀘어 카페 · 신촌점" → "신촌점"(지점명 우선). 구분자 없으면 전체.
function shortName(n: string): string {
  return n.includes('·') ? (n.split('·').pop() || n).trim() : n;
}

const styles = StyleSheet.create({
  // 드롭다운은 트랙 바로 아래에 **겹쳐** 연다(absolute). 흐름에 넣으면 상단바 높이가 커져
  // 벨·아바타가 같이 내려가고 아래 화면이 통째로 밀린다 — 여는 동작이 화면을 흔들면 안 된다.
  wrap: { flexShrink: 1, maxWidth: TRACK_MAX, position: 'relative', zIndex: 20 },
  // 회색 트랙 — 두 칸이 한 컨트롤이라는 신호. 내용만큼만 차지하고 상한에서 멈춘다.
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    padding: Space.xs,
    flexShrink: 1,
    ...Elevation.e1,
  },
  face: {
    position: 'absolute',
    top: Space.xs,
    bottom: Space.xs,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.pill,
    ...Elevation.e1,
  },
  logoCell: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    flexShrink: 0, // 로고는 안 줄인다 — 홈 버튼이라 항상 온전해야 한다.
  },
  scopeCell: { paddingHorizontal: Space.md, paddingVertical: Space.sm, flexShrink: 1 },
  scopeInner: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  scopeText: { fontSize: 13, fontWeight: '900', color: InkColors.ink, flexShrink: 1 },

  // Collapse 의 style 은 **안쪽 내용 View** 로 간다(바깥은 높이를 재는 클리핑 박스) —
  // 그래서 '겹쳐 열기'는 Collapse 를 감싸는 이 앵커가 맡는다.
  menuAnchor: { position: 'absolute', top: '100%', left: 0, minWidth: 200, maxWidth: TRACK_MAX, zIndex: 30, marginTop: Space.xs },
  menu: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: Space.xs,
    ...Elevation.e2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flexShrink: 1, fontSize: 14, fontWeight: '800', color: InkColors.ink },
  rowNow: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
});
