import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';
import { useUnknownQueueStore, answerableQuestions } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { searchPlaybook } from '@/lib/rag';
import { useCopyToClipboard, canCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, PlaybookSuggestion, UnknownQuery } from '@/types';

/**
 * JuniorMySpace — 노하우 탭 '내 공간'(직원 전용, S1 ③).
 * ① 도와줄 수 있는 매장 질문(D4: 누가 답하든 됨) → 답하기 시트(기존 노하우 지정=즉시 해결 / 새 답=사장 승인)
 * ② 내가 보낸 제안 · ③ 내가 답한 질문 · ④ 내 질문 이력 · ⑤ 내 기여 요약(자기 목록, 랭킹 아님=D5).
 * 사장 화면엔 세그먼트가 없으므로 직원 전용. 크레딧/기여는 '스스로 쌓는' 자기 뷰로만.
 */
export function JuniorMySpace({ me }: { me: string }) {
  const queue = useUnknownQueueStore((s) => s.queue);
  const resolveUq = useUnknownQueueStore((s) => s.resolve);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const submitSuggestion = useSuggestionStore((s) => s.submit);
  const history = useChatStore((s) => s.history);
  const entries = usePlaybookStore((s) => s.entries);
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName);
  const { copied, copy } = useCopyToClipboard();

  // 제안·내 채팅을 로드·구독한다(미답질문 큐는 컨테이너 junior/chat 가 배지용으로 이미 hydrate·subscribe 중).
  useEffect(() => {
    const sg = useSuggestionStore.getState();
    void sg.hydrate();
    const offSg = sg.subscribe();
    if (me) void useChatStore.getState().hydrate(me);
    return offSg;
  }, [me]);

  const [answerFor, setAnswerFor] = useState<UnknownQuery | null>(null);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const publishedEntries = useMemo(() => entries.filter((e) => e.status === 'published'), [entries]);

  // 도와줄 수 있는 질문 — 배지와 동일한 SSOT 판정(answerableQuestions).
  const answerable = useMemo(() => answerableQuestions(queue, me), [queue, me]);
  const myProposals = useMemo(
    () => suggestions.filter((s) => s.proposer_id === me).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [suggestions, me],
  );
  const myAnswered = useMemo(
    () => queue.filter((u) => u.answered_by === me).sort((a, b) => (b.asked_at ?? '').localeCompare(a.asked_at ?? '')),
    [queue, me],
  );
  const myQuestions = useMemo(
    () => [...history].sort((a, b) => (b.asked_at ?? '').localeCompare(a.asked_at ?? '')),
    [history],
  );
  const approvedCount = myProposals.filter((s) => s.status === 'approved').length;
  const contribCount = approvedCount + myAnswered.length;

  const onResolveWith = async (uqId: string, entryId: string) => {
    setAnswerFor(null);
    const ok = await resolveUq(uqId, entryId);
    if (ok) showToast('답으로 등록했어요 · 다음 사람은 바로 봐요', 'good');
  };
  const onNewAnswer = async (uqId: string, text: string) => {
    setAnswerFor(null);
    const ok = await submitSuggestion({ kind: 'new', text, sourceUqId: uqId });
    if (ok) showToast('사장님이 확인하면 노하우로 등록돼요', 'good');
  };

  // 내 기여 내보내기 — 화면에 쌓인 내 노하우·답한 질문·제안을 텍스트로 직렬화해 클립보드로.
  // (웹 우선 = OwnerKnowhowBrowse '매뉴얼 내보내기'와 동일 패턴. 네이티브는 canCopy=false라 버튼 숨김.)
  const onExport = () => {
    void copy(
      buildMyContributionText({
        userName: userName || '나',
        storeName: storeName || '우리 매장',
        date: new Date().toLocaleDateString('ko-KR'),
        proposals: myProposals,
        answered: myAnswered,
        entryById,
      }),
    );
  };

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      {/* ① 도와줄 수 있는 질문 (D4) */}
      <SectionLabel icon="hand-left-outline" title="도와줄 수 있는 질문" hint={answerable.length ? `${answerable.length}건` : undefined} />
      {answerable.length === 0 ? (
        <Text style={s.empty}>지금은 도와줄 질문이 없어요.</Text>
      ) : (
        <View style={s.list}>
          {answerable.map((u, i) => (
            <Appear key={u.id} delay={i * 50}>
              <Pressable onPress={() => setAnswerFor(u)} style={({ pressed }) => [s.qCard, pressed && { opacity: 0.85 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.qText} numberOfLines={2}>{u.query_text}</Text>
                  <Text style={s.qMeta}>{u.anonymous ? '익명' : u.junior_name}님이 물었어요{u.similar_queries_count > 0 ? ` · 같은 질문 ${u.similar_queries_count + 1}회` : ''}</Text>
                </View>
                <View style={s.qCta}><Text style={s.qCtaText}>답하기</Text></View>
              </Pressable>
            </Appear>
          ))}
        </View>
      )}

      {/* ⑤ 내 기여 요약 (자기 뷰 — 랭킹 아님) */}
      {contribCount > 0 && (
        <View style={s.contrib}>
          <Ionicons name="sparkles" size={14} color={BrandColors.yellowDeep} />
          <Text style={s.contribText}>내가 쌓은 노하우 <Text style={s.contribNum}>{approvedCount}</Text> · 답한 질문 <Text style={s.contribNum}>{myAnswered.length}</Text></Text>
        </View>
      )}

      {/* 내 기여 내보내기 — 내보낼 게 있고 복사가 되는 환경(웹)에서만 노출. */}
      {canCopyToClipboard() && (myProposals.length > 0 || myAnswered.length > 0) && (
        <Pressable
          onPress={onExport}
          style={({ pressed }) => [s.exportBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="내 기여 내보내기"
        >
          <Ionicons name={copied ? 'checkmark' : 'download-outline'} size={14} color={copied ? BrandColors.good : InkColors.ink2} />
          <Text style={[s.exportBtnText, copied && { color: BrandColors.good }]}>{copied ? '복사됐어요' : '내 기여 내보내기'}</Text>
        </Pressable>
      )}

      {/* ③ 내가 답한 질문 */}
      {myAnswered.length > 0 && (
        <>
          <SectionLabel icon="checkmark-done-outline" title="내가 답한 질문" />
          <View style={s.list}>
            {myAnswered.map((u) => {
              const e = u.resolved_with_entry_id ? entryById.get(u.resolved_with_entry_id) : undefined;
              return (
                <Pressable key={u.id} disabled={!e} onPress={() => e && setDetailEntry(e)} style={({ pressed }) => [s.rowCard, pressed && e && { opacity: 0.7 }]}>
                  <Ionicons name="checkmark-circle" size={16} color={BrandColors.good} />
                  <Text style={s.rowText} numberOfLines={1}>{u.query_text}</Text>
                  {e ? <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} /> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ② 내가 보낸 제안 */}
      {myProposals.length > 0 && (
        <>
          <SectionLabel icon="paper-plane-outline" title="내가 보낸 제안" />
          <View style={s.list}>
            {myProposals.map((sug) => (
              <View key={sug.id} style={[s.rowCard, s.rowCardCol]}>
                <View style={s.rowLine}>
                  <Ionicons name={sug.status === 'approved' ? 'checkmark-circle' : sug.status === 'rejected' ? 'close-circle' : 'time-outline'} size={16} color={sug.status === 'approved' ? BrandColors.good : sug.status === 'rejected' ? BrandColors.bad : InkColors.ink3} />
                  <Text style={s.rowText} numberOfLines={1}>{sug.text}</Text>
                  <Text style={[s.statusTag, sug.status === 'approved' && { color: BrandColors.good }, sug.status === 'rejected' && { color: BrandColors.bad }]}>
                    {sug.status === 'approved' ? '등록됨' : sug.status === 'rejected' ? '반려' : '검토 중'}
                  </Text>
                </View>
                {sug.status === 'rejected' && !!sug.owner_note && (
                  <Text style={s.rejectNote}>사장님 메모 · {sug.owner_note}</Text>
                )}
              </View>
            ))}
          </View>
        </>
      )}

      {/* ④ 내 질문 이력 */}
      {myQuestions.length > 0 && (
        <>
          <SectionLabel icon="chatbubble-ellipses-outline" title="내가 물어본 것" />
          <View style={s.list}>
            {myQuestions.slice(0, 20).map((q) => (
              <View key={q.id} style={s.rowCard}>
                <Ionicons name="help-circle-outline" size={16} color={InkColors.ink3} />
                <Text style={s.rowText} numberOfLines={1}>{q.query_text}</Text>
                {q.resolved_at || (q.matched_entry_ids?.length ?? 0) > 0 ? <Text style={s.answeredTag}>답 받음</Text> : null}
              </View>
            ))}
          </View>
        </>
      )}

      <View style={{ height: 24 }} />

      {answerFor && (
        <AnswerSheet
          uq={answerFor}
          entries={publishedEntries}
          onResolve={onResolveWith}
          onNewAnswer={onNewAnswer}
          onClose={() => setAnswerFor(null)}
        />
      )}
      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />
    </ScrollView>
  );
}

/** 내 기여를 사람이 읽는 텍스트로 직렬화 — 승인된 노하우·답한 질문·검토 중 제안 순. */
function buildMyContributionText(args: {
  userName: string;
  storeName: string;
  date: string;
  proposals: PlaybookSuggestion[];
  answered: UnknownQuery[];
  entryById: Map<string, PlaybookEntry>;
}): string {
  const { userName, storeName, date, proposals, answered, entryById } = args;
  const lines: string[] = [`${userName}님의 노하우 기여`, `${storeName} · ${date}`, ''];

  const approved = proposals.filter((p) => p.status === 'approved');
  if (approved.length) {
    lines.push(`■ 내가 쌓은 노하우 (${approved.length})`);
    approved.forEach((p, i) => lines.push(`${i + 1}. ${p.text}`));
    lines.push('');
  }
  if (answered.length) {
    lines.push(`■ 내가 답한 질문 (${answered.length})`);
    answered.forEach((u, i) => {
      const e = u.resolved_with_entry_id ? entryById.get(u.resolved_with_entry_id) : undefined;
      lines.push(`${i + 1}. ${u.query_text}${e ? ` → ${e.title}` : ''}`);
    });
    lines.push('');
  }
  const pending = proposals.filter((p) => p.status === 'pending');
  if (pending.length) {
    lines.push(`■ 검토 중인 제안 (${pending.length})`);
    pending.forEach((p, i) => lines.push(`${i + 1}. ${p.text}`));
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** 질문 답하기 시트 — 기존 노하우에서 찾아 지정(즉시 해결) 또는 새로 답 남기기(사장 승인). */
function AnswerSheet({
  uq,
  entries,
  onResolve,
  onNewAnswer,
  onClose,
}: {
  uq: UnknownQuery;
  entries: PlaybookEntry[];
  onResolve: (uqId: string, entryId: string) => void;
  onNewAnswer: (uqId: string, text: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [line, setLine] = useState('');
  const results = useMemo(
    () => (q.trim() ? searchPlaybook(q, entries, { topK: 5, threshold: 0 }).candidates.map((c) => c.entry) : []),
    [q, entries],
  );

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '82%' }}>
      <View style={s.sheetHead}>
        <Text style={s.sheetKicker}>이 질문에 답하기</Text>
        <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={20} color={InkColors.ink2} /></Pressable>
      </View>
      <ScrollView style={s.sheetScroll} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.qBox}><Text style={s.qBoxText}>{uq.query_text}</Text></View>

        <Text style={s.sheetLabel}>이미 있는 노하우에서 찾기</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="노하우 검색" placeholderTextColor={InkColors.ink3} style={s.inp} />
        {q.trim().length > 0 && (
          <View style={s.results}>
            {results.length === 0 ? (
              <Text style={s.resultEmpty}>맞는 노하우가 없어요 — 아래에 새로 답을 남겨주세요</Text>
            ) : (
              results.map((e) => (
                <Pressable key={e.id} onPress={() => onResolve(uq.id, e.id)} style={({ pressed }) => [s.resultRow, pressed && { backgroundColor: InkColors.paper }]} accessibilityRole="button" accessibilityLabel={`${e.title} 이 노하우로 답하기`}>
                  <Ionicons name="checkmark-circle-outline" size={17} color={BrandColors.good} />
                  <Text style={s.resultText} numberOfLines={1}>{e.title}</Text>
                  <Text style={s.resultPick}>이걸로 답</Text>
                </Pressable>
              ))
            )}
          </View>
        )}

        <View style={s.divider} />

        <Text style={s.sheetLabel}>찾는 답이 없으면 — 새로 남기기</Text>
        <TextInput value={line} onChangeText={setLine} placeholder="한 줄로 답을 적어주세요" placeholderTextColor={InkColors.ink3} style={[s.inp, s.inpMulti]} multiline />
        <Text style={s.sheetHint}>사장님이 확인하면 노하우로 등록돼 다음 사람이 바로 봐요.</Text>
        <Pressable
          onPress={() => onNewAnswer(uq.id, line.trim())}
          disabled={!line.trim()}
          style={({ pressed }) => [s.cta, !line.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="사장님께 답 보내기"
        >
          <Text style={s.ctaText}>사장님께 답 보내기</Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.sm },
  empty: { fontSize: 13, color: InkColors.ink3, paddingVertical: 14, textAlign: 'center' },
  list: { gap: Space.sm, marginBottom: Space.sm },

  qCard: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: Space.md, ...Elevation.e1 },
  qText: { fontSize: 14, fontWeight: '700', color: InkColors.ink, lineHeight: 20 },
  qMeta: { fontSize: 11.5, color: InkColors.ink3, marginTop: 3, fontWeight: '600' },
  qCta: { backgroundColor: InkColors.ink, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  qCtaText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },

  contrib: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BrandColors.yellowSoft, borderRadius: Radius.md, paddingVertical: 10, paddingHorizontal: 12, marginBottom: Space.xs },
  contribText: { fontSize: 12.5, color: InkColors.ink2, fontWeight: '700' },
  contribNum: { color: InkColors.ink, fontWeight: '800' },

  exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginBottom: Space.xs },
  exportBtnText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },

  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 11 },
  // 반려 사유가 붙는 제안 행 — 카드 자체는 세로 스택, 첫 줄(rowLine)이 기존 가로 행.
  rowCardCol: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rejectNote: { fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17, backgroundColor: InkColors.cream, borderRadius: Radius.sm, paddingHorizontal: 9, paddingVertical: 7 },
  rowText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink },
  statusTag: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  answeredTag: { fontSize: 10.5, fontWeight: '800', color: BrandColors.good, backgroundColor: '#E6F1EA', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },

  // 답변 시트
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  sheetKicker: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sheetScroll: { flex: 1, paddingHorizontal: 16 },
  qBox: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 13, marginBottom: 14 },
  qBoxText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
  sheetLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 7 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: InkColors.ink, backgroundColor: InkColors.bg },
  inpMulti: { minHeight: 68, textAlignVertical: 'top', lineHeight: 20 },
  results: { marginTop: 6, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: InkColors.paper },
  resultText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink },
  resultPick: { fontSize: 11.5, fontWeight: '800', color: BrandColors.good },
  resultEmpty: { fontSize: 12.5, color: InkColors.ink3, paddingHorizontal: 12, paddingVertical: 12 },
  divider: { height: 1, backgroundColor: InkColors.line, marginVertical: 18 },
  sheetHint: { fontSize: 11.5, color: InkColors.ink3, marginTop: 7 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
