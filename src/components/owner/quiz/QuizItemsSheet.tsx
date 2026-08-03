/**
 * 한 업무의 문항 목록 — 저장된 문항을 보고 수정·보관·삭제하고, 새 문항을 만들 진입점을 준다.
 * 문항이 0개면 그게 곧 "훈련이 실제로 작동 안 하는 구멍"이므로 빈 화면에 다음 행동 버튼을 둔다.
 *
 * 행 자체는 Pressable 이 아니다 — 행 안의 액션(수정·보관·삭제)이 형제 버튼이어야
 * RNW 에서 role=button 중첩이 생기지 않는다.
 */

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

import type { QuizItem } from '@/lib/quiz/types';
import { FORMATS } from '@/lib/quiz/formats';
import { fetchQuizItems, updateQuizItem, deleteQuizItem } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { SheetHead, GhostButton, qst } from './kit';
import { answerTextOf } from './PayloadForm';

export function QuizItemsSheet({
  task,
  entryIds,
  reloadKey,
  onClose,
  onCompose,
  onEdit,
  onChanged,
}: {
  task: { templateId: string; text: string };
  entryIds: string[];
  /** 편집 시트가 저장하면 올라간다 — 목록을 다시 읽는 신호. */
  reloadKey: number;
  onClose: () => void;
  onCompose: (mode: 'ai' | 'manual') => void;
  onEdit: (item: QuizItem) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<QuizItem[]>([]);
  // 붙은 노하우가 없으면 읽을 것도 없다 → 처음부터 로딩이 아니다(빈 상태 문구를 바로 보여준다).
  const [loading, setLoading] = useState(entryIds.length > 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entryIds.length === 0) return;
    let alive = true;
    void fetchQuizItems(entryIds).then(({ data }) => {
      if (!alive) return;
      setItems(data ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [entryIds, reloadKey]);

  const setStatus = async (item: QuizItem, status: 'active' | 'archived') => {
    if (busy) return;
    setBusy(true);
    const ok = await guardWrite(updateQuizItem(item.id, { status }), () => {}, '문제 상태 변경에 실패했어요.');
    setBusy(false);
    if (ok) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status } : x)));
      showToast(status === 'archived' ? '문제를 보관했어요 · 이제 안 나와요' : '문제를 다시 쓰기로 했어요', 'good');
      onChanged();
    }
  };

  const remove = async (item: QuizItem) => {
    if (busy) return;
    setBusy(true);
    const ok = await guardWrite(deleteQuizItem(item.id), () => {}, '문제 삭제에 실패했어요.');
    setBusy(false);
    if (ok) {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      showToast('문제를 삭제했어요', 'good');
      onChanged();
    }
  };

  const active = items.filter((i) => i.status === 'active');

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '82%' }}>
      <SheetHead title={`문제 · ${task.text}`} onClose={onClose} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} showsVerticalScrollIndicator={false}>
        {loading ? (
          <Text style={qst.emptyText}>문제를 불러오는 중이에요</Text>
        ) : items.length === 0 ? (
          <Text style={qst.emptyText}>
            {entryIds.length === 0
              ? '이 업무에 붙은 노하우가 없어요. 직접 쓰면서 노하우까지 같이 만들 수 있어요.'
              : '아직 문제가 없어요. 이대로면 직원에게 퀴즈가 안 나가요.'}
          </Text>
        ) : (
          items.map((it) => (
            <View key={it.id} style={[ist.row, it.status === 'archived' && { opacity: 0.55 }]}>
              <View style={ist.rowHead}>
                <Text style={ist.format} numberOfLines={1}>{FORMATS[it.format]?.label ?? it.format}</Text>
                <Text style={ist.badge}>{it.source === 'ai' ? '만들어 준 문제' : '직접 쓴 문제'}</Text>
                {it.status === 'archived' ? <Text style={[ist.badge, { color: BrandColors.warn }]}>보관됨</Text> : null}
              </View>
              <Text style={ist.ask} numberOfLines={3}>{String(it.payload?.ask ?? '')}</Text>
              <Text style={ist.answer} numberOfLines={2}>정답 · {answerTextOf(it.format, it.payload ?? {}) || '없음'}</Text>
              <View style={ist.actions}>
                <GhostButton icon="create-outline" label="고치기" fill disabled={busy} onPress={() => onEdit(it)} />
                <GhostButton
                  icon={it.status === 'archived' ? 'refresh-outline' : 'archive-outline'}
                  label={it.status === 'archived' ? '다시 쓰기' : '보관'}
                  fill
                  disabled={busy}
                  onPress={() => void setStatus(it, it.status === 'archived' ? 'active' : 'archived')}
                />
                {/* 삭제는 보관한 뒤에만 — 확인 모달을 새로 만들지 않으면서 한 번의 오탭으로 사라지는 걸 막는다. */}
                {it.status === 'archived' ? (
                  <GhostButton icon="trash-outline" label="삭제" danger fill disabled={busy} onPress={() => void remove(it)} />
                ) : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={qst.foot}>
        <Text style={ist.count}>{loading ? ' ' : `나가는 문제 ${active.length}개`}</Text>
        <View style={ist.footRow}>
          <GhostButton icon="sparkles-outline" label="AI가 만들어 주기" fill disabled={entryIds.length === 0} onPress={() => onCompose('ai')} />
          <GhostButton icon="create-outline" label="직접 쓰기" fill onPress={() => onCompose('manual')} />
        </View>
      </View>
    </BottomSheet>
  );
}

const ist = StyleSheet.create({
  row: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, gap: Space.xs, marginTop: Space.sm,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  format: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  badge: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink3 },
  ask: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  answer: { fontSize: 15, fontWeight: '700', color: BrandColors.good, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  count: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, textAlign: 'center' },
  footRow: { flexDirection: 'row', gap: Space.sm },
});
