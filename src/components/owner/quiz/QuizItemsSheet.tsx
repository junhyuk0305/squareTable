/**
 * 한 **노하우**의 문항 목록(0111) — 저장된 문항을 보고 수정·보관·삭제하고, 새 문항을 만들 진입점을 준다.
 * 문항이 0개면 그게 곧 "퀴즈가 실제로 작동 안 하는 구멍"이므로 빈 화면은 결핍이 아니라 **할 것**으로 연다.
 *
 * 낡음(0114): 문항을 만든 뒤 근거 노하우가 바뀌었으면 배지 + [다시 만들기]. 자동 재생성은 하지 않는다
 * — 검수 없이 나가면 안 되고 AI 사용량이 예측 불가해진다(기획 §4.3).
 *
 * 행 자체는 Pressable 이 아니다 — 행 안의 액션(수정·보관·삭제)이 형제 버튼이어야
 * RNW 에서 role=button 중첩이 생기지 않는다.
 */

import { useEffect, useMemo, useState } from 'react';
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

import { SheetHead, GhostButton, AnswerReveal, qst } from './kit';
import { answerTextOf } from './PayloadForm';
import { QuizPreviewSheet } from './QuizPreviewSheet';

export function QuizItemsSheet({
  subject,
  sourceUpdatedAt,
  reloadKey,
  onClose,
  onCompose,
  onEdit,
  onRegenerate,
  onChanged,
}: {
  /** 0111: 문항이 붙는 대상은 노하우 하나다. */
  subject: { entryId: string; title: string };
  /** 지금 노하우의 updated_at — 문항 스냅샷(0114)과 비교해 낡음을 판정한다. */
  sourceUpdatedAt: string | null;
  /** 편집 시트가 저장하면 올라간다 — 목록을 다시 읽는 신호. */
  reloadKey: number;
  onClose: () => void;
  onCompose: (mode: 'ai' | 'manual') => void;
  onEdit: (item: QuizItem) => void;
  /** 낡은 문항을 새로 만든다 — 승인하면 옛 문항은 보관된다(호출부 처리). */
  onRegenerate: (item: QuizItem) => void;
  onChanged: () => void;
}) {
  const entryIds = useMemo(() => [subject.entryId], [subject.entryId]);
  const [items, setItems] = useState<QuizItem[]>([]);
  // 풀어보기 — 모달 위 모달 금지라 목록 시트를 감추고 미리보기 시트를 연다.
  // 이 컴포넌트는 그대로 마운트돼 있어 목록 상태는 남는다(닫으면 그 자리로 돌아온다).
  const [preview, setPreview] = useState<QuizItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchQuizItems(entryIds).then(({ data }) => {
      if (!alive) return;
      setItems(data ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [entryIds, reloadKey]);

  /** 만들 때 본 노하우가 그 뒤로 바뀌었나. 스냅샷이 없는 옛 행은 판정하지 않는다. */
  const isStale = (it: QuizItem) =>
    !!sourceUpdatedAt && !!it.source_updated_at && Date.parse(it.source_updated_at) < Date.parse(sourceUpdatedAt);

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
    <>
    <BottomSheet visible={!preview} onClose={onClose} sheetStyle={{ height: '82%' }}>
      <SheetHead title={`문제 · ${subject.title}`} onClose={onClose} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} showsVerticalScrollIndicator={false}>
        {loading ? (
          <Text style={qst.emptyText}>문제를 불러오는 중이에요</Text>
        ) : items.length === 0 ? (
          // 빈 화면은 결핍이 아니라 **할 것**으로 시작한다(R1-4 · 레퍼런스 leveltest_01).
          // 아래 하단 바에 이미 다음 행동 버튼 2개가 고정돼 있으므로 여기서 버튼을 또 만들지 않는다.
          <Text style={qst.emptyText}>
            이 노하우로 문제를 만들면 직원 퀴즈에 나가요.{'\n'}아래에서 시작해 보세요.
          </Text>
        ) : (
          // 반복되는 동종 항목이라 문항마다 카드를 만들지 않고 한 카드 안의 행으로 쌓는다(R3-1·R3-3).
          <View style={ist.list}>
            {items.map((it, i) => (
              <View key={it.id} style={[ist.row, i > 0 && ist.rowTop, it.status === 'archived' && { opacity: 0.55 }]}>
                <View style={ist.rowHead}>
                  <Text style={ist.format} numberOfLines={1}>{FORMATS[it.format]?.label ?? it.format}</Text>
                  <Text style={ist.badge}>{it.source === 'ai' ? '만들어 준 문제' : '직접 쓴 문제'}</Text>
                  {it.status === 'archived' ? <Text style={[ist.badge, { color: BrandColors.warn }]}>보관됨</Text> : null}
                  {isStale(it) && it.status === 'active' ? (
                    <Text style={[ist.badge, { color: BrandColors.warn }]}>노하우가 바뀌었어요</Text>
                  ) : null}
                </View>
                <Text style={ist.ask} numberOfLines={3}>{String(it.payload?.ask ?? '')}</Text>
                <AnswerReveal text={answerTextOf(it.format, it.payload ?? {})} />
                {/* 보관된 문항도 풀어볼 수 있다 — 다시 쓸지 정하려면 직접 풀어보는 게 가장 빠르다. */}
                <View style={ist.actions}>
                  <GhostButton icon="play-outline" label="풀어보기" fill onPress={() => setPreview(it)} />
                  {isStale(it) && it.status === 'active' ? (
                    <GhostButton icon="refresh-outline" label="다시 만들기" fill disabled={busy} onPress={() => onRegenerate(it)} />
                  ) : null}
                </View>
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
            ))}
          </View>
        )}
      </ScrollView>

      <View style={qst.foot}>
        <Text style={ist.count}>{loading ? ' ' : `나가는 문제 ${active.length}개`}</Text>
        <View style={ist.footRow}>
          <GhostButton icon="help-circle-outline" label="AI가 만들어 주기" fill onPress={() => onCompose('ai')} />
          <GhostButton icon="create-outline" label="직접 쓰기" fill onPress={() => onCompose('manual')} />
        </View>
      </View>
    </BottomSheet>

    {preview ? (
      <QuizPreviewSheet quiz={preview} onClose={() => setPreview(null)} />
    ) : null}
    </>
  );
}

const ist = StyleSheet.create({
  // 문항 여러 건 = 카드 1개 안의 행(R3-3). 예전엔 문항마다 카드라 3개째부터 R3-1 위반이었다.
  list: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, marginTop: Space.sm,
  },
  row: { paddingVertical: Space.lg, gap: Space.xs },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  format: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  badge: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink3 },
  ask: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  answer: { fontSize: 15, fontWeight: '700', color: BrandColors.good, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  count: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, textAlign: 'center' },
  footRow: { flexDirection: 'row', gap: Space.sm },
});
