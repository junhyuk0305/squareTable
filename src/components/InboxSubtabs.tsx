import { Fragment, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { InkColors } from '@/lib/theme/colors';
import type { UnknownQuery } from '@/types';

type SubtabKey = 'pending' | 'auto' | 'archived';

export type InboxSubtabsProps = {
  /** 전체 받은 질문 큐. 내부에서 상태별로 파생 필터링한다. */
  queue: UnknownQuery[];
  /** 한 건을 행으로 그려주는 렌더 함수(예: SimilarGroupRow). */
  renderRow: (uq: UnknownQuery) => React.ReactNode;
  /** 최초 활성 세그먼트(기본 'pending'). */
  initial?: SubtabKey;
};

// 세그먼트 → status 매핑. (queue에서 파생 필터링)
const STATUS_OF: Record<SubtabKey, UnknownQuery['status']> = {
  pending: 'pending_owner_answer',
  auto: 'auto_answered',
  archived: 'archived',
};

// 세그먼트별 빈 상태 문구 — 03 카피 카탈로그(해요체 · 시니어=사장님).
const EMPTY_TEXT: Record<SubtabKey, { title: string; body: string }> = {
  pending: {
    title: '깔끔하네요!',
    body: '답할 질문이 하나도 없어요. 새 질문이 오면 여기로 알려드릴게요.',
  },
  auto: {
    title: '자동응답한 질문이 아직 없어요',
    body: '노하우가 쌓이면 챗봇이 알아서 답한 질문이 여기 모여요.',
  },
  archived: {
    title: '보관한 질문이 없어요',
    body: '지금 답하지 않을 질문은 보관해 두면 여기로 와요.',
  },
};

/**
 * 받은 질문 세그먼트 컨테이너 — [대기 | 자동응답 | 보관].
 * - queue에서 status로 파생 필터링하고, 각 세그먼트 카운트를 SegmentTabs 배지로 노출.
 * - 활성 세그먼트는 내부 state로 관리(controlled 아님), 필터된 행을 renderRow로 그린다.
 * - 빈 세그먼트는 03 카탈로그 문구로 안내(해요체).
 * 화면 내부 컴포넌트라 부모 프레임 폭을 상속 — 별도 캡 불필요.
 */
export function InboxSubtabs({ queue, renderRow, initial = 'pending' }: InboxSubtabsProps) {
  const [active, setActive] = useState<SubtabKey>(initial);

  const buckets = useMemo(() => {
    const b: Record<SubtabKey, UnknownQuery[]> = { pending: [], auto: [], archived: [] };
    for (const u of queue) {
      if (u.status === STATUS_OF.pending) b.pending.push(u);
      else if (u.status === STATUS_OF.auto) b.auto.push(u);
      else if (u.status === STATUS_OF.archived) b.archived.push(u);
    }
    return b;
  }, [queue]);

  const items: SegmentItem[] = [
    { key: 'pending', label: '대기', count: buckets.pending.length },
    { key: 'auto', label: '자동응답', count: buckets.auto.length },
    { key: 'archived', label: '보관', count: buckets.archived.length },
  ];

  const rows = buckets[active];
  const empty = EMPTY_TEXT[active];

  return (
    <View style={styles.wrap}>
      <SegmentTabs items={items} value={active} onChange={(k) => setActive(k as SubtabKey)} />

      {rows.length > 0 ? (
        <View style={styles.list}>
          {rows.map((uq) => (
            <Fragment key={uq.id}>{renderRow(uq)}</Fragment>
          ))}
        </View>
      ) : (
        <View style={styles.empty} accessibilityRole="summary">
          <Text style={styles.emptyTitle}>{empty.title}</Text>
          <Text style={styles.emptyBody}>{empty.body}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  list: {
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: InkColors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: InkColors.ink3,
    lineHeight: 20,
    textAlign: 'center',
  },
});
