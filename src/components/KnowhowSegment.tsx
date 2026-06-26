import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SegmentTabs, type SegmentItem } from './SegmentTabs';
import type { Role } from '@/types';

export type KnowhowSegmentKey = 'browse' | 'ask' | 'mine';

export type KnowhowSegmentProps = {
  /** owner = [둘러보기 | 물어보기 | 내 노하우], junior = [둘러보기 | 물어보기] */
  role: Role;
  /** '둘러보기' 슬롯 (보통 <BrowseList />) */
  browse: React.ReactNode;
  /** '물어보기' 슬롯 (챗봇/검색) */
  ask: React.ReactNode;
  /** '내 노하우' 슬롯 — owner 전용. junior면 무시된다. */
  mine?: React.ReactNode;
  /** 최초 선택 세그먼트 키(기본 'browse'). 역할에 없는 키면 'browse'로 폴백. */
  initial?: KnowhowSegmentKey;
};

const LABELS: Record<KnowhowSegmentKey, string> = {
  browse: '둘러보기',
  ask: '물어보기',
  mine: '내 노하우',
};

/**
 * KnowhowSegment — 노하우 탭의 세그먼트 컨테이너.
 * 역할별 가시성: owner는 3칸(둘러보기/물어보기/내 노하우), junior는 2칸(내 노하우 없음).
 * 슬롯 기반으로 데이터/화면을 디커플링한다 — 활성 세그먼트만 렌더.
 * 모바일 프레임 안에서만 그린다(부모 폭 상속, flex:1).
 */
export function KnowhowSegment({ role, browse, ask, mine, initial }: KnowhowSegmentProps) {
  // owner만 'mine' 노출.
  const keys: KnowhowSegmentKey[] = role === 'owner' ? ['browse', 'ask', 'mine'] : ['browse', 'ask'];

  const fallback: KnowhowSegmentKey = initial && keys.includes(initial) ? initial : 'browse';
  const [active, setActive] = useState<KnowhowSegmentKey>(fallback);

  // 역할 변경 등으로 active가 현재 키 집합에 없으면 안전 폴백.
  const selected: KnowhowSegmentKey = keys.includes(active) ? active : 'browse';

  const items: SegmentItem[] = keys.map((k) => ({ key: k, label: LABELS[k] }));

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
