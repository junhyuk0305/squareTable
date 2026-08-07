import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { AiAnswerRow as AiAnswer } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 'AI가 답함' 한 줄(2026-08-07) — 받은질문 세그먼트 ②.
 *
 * 이 화면은 지금까지 **답을 기다리는 질문**만 다뤘다. 즉 "노하우가 없어서 막힌 것"만 보이고
 * "노하우가 일을 해낸 것"은 앱 어디에도 없었다. 같은 파이프라인의 반대쪽 끝이라 같은 화면이 맞다.
 *
 * ★숫자가 아니라 **목록**이 가치 증명을 맡는다(2026-08-07 확정) — 그래서 답에 쓰인 노하우 제목을
 *  그대로 보여주고, 누르면 그 노하우로 간다. "무엇으로 답했는지"가 안 보이면 증명이 아니다.
 */
export function AiAnswerRow({
  row,
  titleOf,
  onOpenEntry,
}: {
  row: AiAnswer;
  /** 노하우 id → 제목. 이미 지워졌으면 undefined — 그 칩은 안 그린다. */
  titleOf: (entryId: string) => string | undefined;
  onOpenEntry: (entryId: string) => void;
}) {
  const used = row.matched_entry_ids
    .map((id) => ({ id, title: titleOf(id) }))
    .filter((x): x is { id: string; title: string } => !!x.title);

  return (
    <View style={st.row}>
      <Text style={st.query} numberOfLines={2}>{row.query_text}</Text>
      {used.length > 0 ? (
        <View style={st.chipWrap}>
          {used.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => onOpenEntry(u.id)}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
              style={({ pressed }) => [st.chip, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`${u.title} 노하우 보기`}
            >
              <Ionicons name="book-outline" size={12} color={InkColors.ink2} />
              <Text style={st.chipText} numberOfLines={1}>{u.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        // 노하우가 지워졌어도 "무엇으로 답했는지 모른다"를 숨기지 않는다(무음 위장 금지).
        <Text style={st.gone}>답에 쓴 노하우는 지워졌어요</Text>
      )}
      <Text style={st.meta} numberOfLines={1}>
        {row.junior_name || '직원'} · {shortWhen(row.asked_at)}
        {row.satisfaction === 'up' ? ' · 도움 됐대요' : row.satisfaction === 'down' ? ' · 도움 안 됐대요' : ''}
      </Text>
    </View>
  );
}

/** `8월 4일 09:00` — 질문 시각은 날짜+시각까지. 답변 순서를 사장이 따라갈 수 있어야 한다. */
function shortWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
}

const st = StyleSheet.create({
  row: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.md, gap: Space.xs, marginBottom: Space.sm,
  },
  query: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%',
    backgroundColor: InkColors.paper, borderWidth: 1, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingVertical: 5, paddingHorizontal: 10,
  },
  chipText: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  gone: { fontSize: 12.5, fontWeight: '600', color: BrandColors.warnText },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
});
