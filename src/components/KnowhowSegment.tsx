import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SegmentTabs, type SegmentItem } from './SegmentTabs';
import type { Role } from '@/types';

export type KnowhowSegmentKey = 'browse' | 'ask' | 'mine';

export type KnowhowSegmentProps = {
  /** owner·junior 모두 2칸: [둘러보기 | 물어보기] */
  role: Role;
  /** '둘러보기' 슬롯 (사장=OwnerKnowhowBrowse, 직원=JuniorBrowseDashboard) */
  browse: React.ReactNode;
  /** '물어보기' 슬롯 (챗봇/검색/안내) */
  ask: React.ReactNode;
  /** '내 공간' 슬롯 (직원 전용, S1 ③) — 있으면 3번째 칸이 뜬다. */
  mine?: React.ReactNode;
  /** '내 공간' 탭 배지(답할 매장 질문 수 등). 0/undefined면 숨김. */
  mineCount?: number;
  /** 최초 선택 세그먼트 키(기본 'browse'). 없는 키면 'browse'로 폴백. */
  initial?: KnowhowSegmentKey;
};

const LABELS: Record<KnowhowSegmentKey, string> = {
  browse: '둘러보기',
  ask: '물어보기',
  mine: '내 공간',
};

/**
 * KnowhowSegment — 노하우 탭의 세그먼트 컨테이너.
 * owner·junior 모두 2칸(둘러보기/물어보기). 사장 '둘러보기'가 곧 매장 노하우 관리화면(=옛 내 노하우)이라
 * 별도 '내 노하우' 칸은 폐지됐다. 슬롯 기반으로 화면을 디커플링한다 — 활성 세그먼트만 렌더.
 * 모바일 프레임 안에서만 그린다(부모 폭 상속, flex:1).
 */
export function KnowhowSegment({ role, browse, ask, mine, mineCount, initial }: KnowhowSegmentProps) {
  void role; // 역할은 슬롯 콘텐츠로만 분기(현재 탭 구성은 역할 동일).
  // '내 공간'(mine 슬롯)은 직원 전용 — 넘어올 때만 3번째 칸으로 추가한다.
  const keys: KnowhowSegmentKey[] = mine != null ? ['browse', 'ask', 'mine'] : ['browse', 'ask'];

  const fallback: KnowhowSegmentKey = initial && keys.includes(initial) ? initial : 'browse';
  const [active, setActive] = useState<KnowhowSegmentKey>(fallback);

  const selected: KnowhowSegmentKey = keys.includes(active) ? active : 'browse';

  const items: SegmentItem[] = keys.map((k) => ({
    key: k,
    label: LABELS[k],
    ...(k === 'mine' && mineCount ? { count: mineCount } : null),
  }));

  const slots: Record<KnowhowSegmentKey, React.ReactNode> = { browse, ask, mine };

  return (
    <View style={styles.wrap}>
      <SegmentTabs items={items} value={selected} onChange={(k) => setActive(k as KnowhowSegmentKey)} />
      <View style={styles.body}>{slots[selected]}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%' },
  body: { flex: 1 },
});
