import { Children, isValidElement, type ReactNode } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';

import { useShell } from '@/components/shell/shellContext';
import { OWNER_WEB_MAX_WIDTH, SIDE_NAV_WIDTH, Space } from '@/lib/theme/layout';

/**
 * 넓은 웹에서만 서는 두 단 배치(구현계획 P7) — **기능 변경 0. 배치만 바뀐다.**
 *
 * ★폰 폭에서는 한 줄도 달라지면 안 된다. 그래서 좁을 때는 감싼 조각들을 **원래 순서 그대로**
 *   그리고(Fragment — 호스트 노드를 하나도 더하지 않는다), 넓을 때만 두 컬럼으로 나눈다.
 *   `main`/`rail` 을 각각 슬롯 prop 으로 받으면 좁은 폭에서 순서가 `main 전부 → rail 전부` 로
 *   섞인다 — 그러면 "폰 스냅샷 diff 0" 이 바로 깨진다. 조각마다 `<Pane side>` 를 달아 **소스 순서가
 *   곧 폰 순서**가 되게 한 이유다.
 *
 * ★화면을 복제하지 않는다. `.web` 확장자 쌍도, 두 벌 컴포넌트도 만들지 않는다 — 같은 JSX 가
 *   폭에 따라 다르게 담길 뿐이다(지시서 P7 ⛔ 첫 줄).
 *
 * 좌우 배분: **왼쪽 = 목록·본문(유동) · 오른쪽 = 보조 레일(고정 `RAIL_WIDTH`).**
 *   지시서 권고는 `/hq/stores` 처럼 "왼쪽 고정 · 오른쪽 유동"이었지만, 그 화면은 표+드로어고
 *   여기 네 화면은 **460 프레임 전제로 만든 카드 묶음**이다. 본문 쪽을 고정 폭으로 좁히면 카드가
 *   줄바꿈·넘침으로 깨져 "배치만 바꾼다"는 전제가 무너진다. 그래서 본문이 유동이다.
 */

/** 두 단이 서는 최소 창 폭 — 사이드바 + 본문 컬럼이 온전히 들어오는 지점. */
export const TWO_PANE_MIN_WIDTH = SIDE_NAV_WIDTH + OWNER_WEB_MAX_WIDTH;

/** 오른쪽 보조 레일 폭. 카드 한 장(아이콘 + 두 줄)이 줄바꿈 없이 들어가는 최소값. */
export const RAIL_WIDTH = 264;

export function useTwoPane(): boolean {
  const { width } = useWindowDimensions();
  // 셸이 넓은 사장 웹일 때만. 네이티브·직원·본사 셸에서는 언제나 false 라 지금과 같은 화면이 나온다.
  return useShell() === 'owner-web' && width >= TWO_PANE_MIN_WIDTH;
}

type Side = 'main' | 'rail';

/** 두 단일 때 어느 쪽에 담길지 표시만 한다 — 스스로는 아무것도 그리지 않는다. */
export function Pane({ children }: { side: Side; children: ReactNode }) {
  return <>{children}</>;
}

export function TwoPane({ children, gap = Space.lg }: { children: ReactNode; gap?: number }) {
  const two = useTwoPane();
  if (!two) return <>{children}</>;

  const main: ReactNode[] = [];
  const rail: ReactNode[] = [];
  Children.toArray(children).forEach((child) => {
    // Pane 이 아닌 조각(조건부 렌더의 false·null 등)은 본문에 둔다 — 조용히 버리지 않는다.
    const side: Side = isValidElement<{ side?: Side }>(child) ? (child.props.side ?? 'main') : 'main';
    (side === 'rail' ? rail : main).push(child);
  });

  return (
    <View style={[styles.row, { columnGap: Space.xl }]}>
      <View style={[styles.main, { rowGap: gap }]}>{main}</View>
      {rail.length > 0 ? <View style={[styles.rail, { rowGap: gap }]}>{rail}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0 },
  rail: { width: RAIL_WIDTH, flexShrink: 0 },
});
