import { useState, type ReactNode } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';

import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { frameCapStyle } from '@/lib/theme/layout';

/**
 * WorkSegment — 업무 탭의 [채팅 | 공지 | 할일] 세그먼트 컨테이너(컴포지션).
 *
 * 02 컴포넌트계약 §2(SegmentedControl)의 동작 계약을 따른다:
 *  - SegmentTabs(기존 프리미티브) 위에 3개 세그먼트(chat/notice/todo)를 올리고,
 *  - 선택 세그먼트는 내부 useState로 관리(uncontrolled, 초기값 props),
 *  - dot(새 항목 알림 점) / count(숫자 배지, 99+ 캡은 SegmentTabs가 처리)를 props로 받는다.
 *
 * **슬롯 기반** — WorkBoard 재작성과 디커플하기 위해 각 세그먼트의 내용을
 * chat/notice/todo 노드로 주입받아, 활성 세그먼트만 세그먼트 바 아래 렌더한다.
 * 모든 것은 모바일 프레임 폭 안에 머문다(frameCapStyle).
 */

export type WorkSegmentKey = 'chat' | 'notice' | 'todo';

export interface WorkSegmentProps {
  chat: ReactNode;
  notice: ReactNode;
  todo: ReactNode;
  /** 세그먼트별 숫자 배지(0/undefined면 숨김). */
  counts?: { chat?: number; notice?: number; todo?: number };
  /** 세그먼트별 새 항목 알림 점(count가 있으면 숫자 배지가 우선). */
  dots?: { chat?: boolean; notice?: boolean; todo?: boolean };
  /** 초기 선택 세그먼트(기본 chat). */
  initial?: WorkSegmentKey;
  /** 세그먼트 전환 시 부모 알림(읽음 처리 등). */
  onChange?: (key: WorkSegmentKey) => void;
  style?: ViewStyle;
}

const LABELS: Record<WorkSegmentKey, string> = {
  chat: '채팅',
  notice: '공지',
  todo: '할일',
};

const ORDER: WorkSegmentKey[] = ['chat', 'notice', 'todo'];

export function WorkSegment({
  chat,
  notice,
  todo,
  counts,
  dots,
  initial = 'chat',
  onChange,
  style,
}: WorkSegmentProps) {
  const [value, setValue] = useState<WorkSegmentKey>(initial);

  const items: SegmentItem[] = ORDER.map((key) => ({
    key,
    label: LABELS[key],
    count: counts?.[key],
    dot: dots?.[key],
  }));

  const slots: Record<WorkSegmentKey, ReactNode> = { chat, notice, todo };

  return (
    <View style={[styles.wrap, frameCapStyle, style]}>
      <SegmentTabs
        items={items}
        value={value}
        onChange={(k) => {
          const next = k as WorkSegmentKey;
          setValue(next);
          onChange?.(next);
        }}
      />
      <View style={styles.body}>{slots[value]}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { flex: 1 },
});
