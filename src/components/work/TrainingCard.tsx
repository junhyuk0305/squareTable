import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 직원 훈련 카드의 항목 상태 — passed=통과 · next=다음 차례 · todo=대기 · due=다시 확인할 때. */
export type TrainingCardItem = {
  id: string;
  text: string;
  state: 'passed' | 'next' | 'todo' | 'due';
  hasKnowhow: boolean;
};

const STATE_CHIP: Record<TrainingCardItem['state'], { label: string; color: string; bg: string }> = {
  passed: { label: '통과', color: BrandColors.good, bg: '#E6F1EA' },
  next: { label: '다음', color: InkColors.ink, bg: InkColors.cream },
  todo: { label: '대기', color: InkColors.ink3, bg: InkColors.bgSoft },
  due: { label: '다시 확인', color: '#8a5a12', bg: BrandColors.warnSoft },
};

/**
 * TrainingCard — 직원 업무 채팅 상단의 훈련 카드(첫 훈련 / 정기 훈련 공용).
 * 위에는 "다음 한 개"(순서의 외부화), 펼치면 전체 항목과 상태가 보인다(색+텍스트 병기).
 * 문제 풀이는 자발 — 페널티 없음. 첫 훈련은 전부 통과하면, 정기 훈련은 다시 확인할 게 없으면 사라진다.
 */
export function TrainingCard({
  kind,
  items,
  onOpenKnowhow,
  onStartCheck,
}: {
  kind: 'first' | 'regular';
  items: TrainingCardItem[];
  onOpenKnowhow: (templateId: string) => void;
  onStartCheck: (templateId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const next = items.find((it) => it.state === 'next' || it.state === 'due');
  if (!next) return null;

  const passedCount = items.filter((it) => it.state === 'passed').length;
  const dueCount = items.filter((it) => it.state === 'due').length;
  const title = kind === 'first' ? '첫 훈련' : '정기 훈련';
  const badge = kind === 'first' ? `${passedCount}/${items.length}` : `다시 확인 ${dueCount}개`;
  const ctaLabel = kind === 'first' ? '혼자 할 수 있어요' : '다시 확인하기';

  return (
    <View style={st.card}>
      <View style={st.head}>
        <Ionicons name={kind === 'first' ? 'school-outline' : 'refresh-outline'} size={16} color={InkColors.ink} />
        <Text style={st.title}>{title}</Text>
        <Text style={[st.progress, kind === 'regular' && { color: '#8a5a12' }]}>{badge}</Text>
      </View>

      <Text style={st.next} numberOfLines={2}>
        {kind === 'first' ? '다음 훈련' : '다시 확인할 업무'} · {next.text}
      </Text>

      <View style={st.btnRow}>
        {next.hasKnowhow && (
          <Pressable
            onPress={() => onOpenKnowhow(next.id)}
            style={({ pressed }) => [st.softBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="노하우 읽기"
          >
            <Ionicons name="book-outline" size={15} color={InkColors.ink} />
            <Text style={st.softBtnText}>노하우 읽기</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onStartCheck(next.id)}
          style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Ionicons name="ribbon-outline" size={15} color="#FFFFFF" />
          <Text style={st.ctaText}>{ctaLabel}</Text>
        </Pressable>
      </View>

      {/* 전체 항목 — 펼침은 아래로(Reveal 규칙). 행 탭 = 그 항목의 노하우 읽기. */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [st.expandRow, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={expanded ? '전체 항목 접기' : '전체 항목 보기'}
      >
        <Text style={st.expandText}>{expanded ? '접기' : `전체 ${items.length}개 보기`}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={InkColors.ink2} />
      </Pressable>
      {expanded &&
        items.map((it, i) => {
          const chip = STATE_CHIP[it.state];
          return (
            <Pressable
              key={it.id}
              onPress={() => it.hasKnowhow && onOpenKnowhow(it.id)}
              disabled={!it.hasKnowhow}
              style={({ pressed }) => [st.itemRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`${it.text} 노하우 읽기`}
            >
              <Text style={st.itemNum}>{i + 1}</Text>
              <Text style={st.itemText} numberOfLines={1}>{it.text}</Text>
              <Text style={[st.chip, { color: chip.color, backgroundColor: chip.bg }]}>{chip.label}</Text>
            </Pressable>
          );
        })}
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    marginHorizontal: Space.gutter, marginTop: Space.sm, marginBottom: Space.xs,
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.md, gap: Space.xs, ...Elevation.e2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  title: { flex: 1, fontSize: 13, fontWeight: '800', color: InkColors.ink },
  progress: { fontSize: 12, fontWeight: '800', color: BrandColors.good },
  next: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
  btnRow: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  softBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 48,
    paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  softBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  cta: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 48,
    borderRadius: Radius.md, backgroundColor: InkColors.ink,
  },
  ctaText: { fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' },

  expandRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: Space.xs, paddingVertical: Space.sm, minHeight: 40,
  },
  expandText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.xs + 2, minHeight: 36 },
  itemNum: { width: 18, fontSize: 12, fontWeight: '800', color: InkColors.ink3, textAlign: 'center' },
  itemText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink, minWidth: 0 },
  chip: {
    fontSize: 11, fontWeight: '900', paddingHorizontal: Space.xs + 2, paddingVertical: 2,
    borderRadius: Radius.pill, overflow: 'hidden',
  },
});
