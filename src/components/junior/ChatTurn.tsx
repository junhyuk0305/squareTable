import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { SquareCard } from '@/components/SquareCard';
import { DeflectCard } from '@/components/DeflectCard';
import { CandidateCard } from '@/components/junior/CandidateCard';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { UserBubble } from '@/components/UserBubble';
import { Appear } from '@/components/Appear';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

import type { Category, ChatQuery, PlaybookEntry } from '@/types';

/* ─────────────────────────────────────────────────────────
 * 한 턴: 사용자 질문 + AI 응답(SquareCard | DeflectCard)
 * ───────────────────────────────────────────────────────── */
export type ChatTurnProps = {
  query: ChatQuery;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  deflectState: 'asking' | 'registered' | 'declined';
  onRegister: () => void;
  onDecline: () => void;
  resolveCategory: (entryId: string) => Category;
  findUQ: (queryText: string) => { presumed_category: Category; ai_general_answer: string; similar_queries_count?: number } | undefined;
};

export function ChatTurn({
  query,
  onThumbsUp,
  onThumbsDown,
  deflectState,
  onRegister,
  onDecline,
  resolveCategory,
  findUQ,
}: ChatTurnProps) {
  const router = useRouter();
  // 상세 모달은 출처(matched) 또는 후보(candidate) 어느 쪽이든 띄운다 — 단일 상태로 통일.
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | undefined>(undefined);

  const block = query.response_block;
  const matchedEntry = usePlaybookStore((s) =>
    query.matched_entry_ids[0] ? s.getById(query.matched_entry_ids[0]) : undefined,
  );
  // 후보 노하우(매칭 애매 시 "혹시 이거?") — id → 엔트리. 발행/삭제로 entries 바뀌면 재계산.
  const allEntries = usePlaybookStore((s) => s.entries);
  const candidateEntries = useMemo(
    () =>
      (query.candidate_entry_ids ?? [])
        .map((cid) => allEntries.find((e) => e.id === cid))
        .filter((e): e is PlaybookEntry => !!e),
    [query.candidate_entry_ids, allEntries],
  );

  // DeflectCard 보조 데이터(일반 답변·중복수). 카테고리는 노출 안 함(프레임 v2).
  const deflectMeta = useMemo(() => {
    if (block) return null;
    const uq = findUQ(query.query_text);
    const general = uq?.ai_general_answer;
    const similar = uq?.similar_queries_count;
    return { general, similar };
  }, [block, findUQ, query.query_text]);

  return (
    <View style={turnStyles.turn}>
      <UserBubble text={query.query_text} />

      <Appear style={turnStyles.assistant}>
        {block?.degraded && (
          <View style={turnStyles.degradedNote}>
            <Ionicons name="cloud-offline-outline" size={13} color={InkColors.ink3} />
            <Text style={turnStyles.degradedText}>
              지금은 기본 안내로 답했어요. 잠시 후 다시 물으면 매장에 맞춰 더 정확히 알려드려요.
            </Text>
          </View>
        )}
        {/* AI 합성 답(generated): 저장된 매장 노하우 "그대로"가 아니라 여러 노하우를 모아 정리한 것.
            검증 배지를 달지 않고(아래 SquareCard verification 비노출) 정직하게 고지 → 신뢰 오인 방지. */}
        {block?.mode === 'generated' && !block?.degraded && (
          <View style={turnStyles.composedNote}>
            <Ionicons name="sparkles-outline" size={13} color={InkColors.ink3} />
            <Text style={turnStyles.composedText}>
              매장 노하우들을 모아 AI가 정리한 답이에요. 확실하지 않으면 사장님께 확인하세요.
            </Text>
          </View>
        )}
        {block ? (
          <SquareCard
            summary={block.summary}
            actions={block.actions}
            donts={block.donts}
            source={{
              entryId: block.source.entry_id,
              creatorName: block.source.creator_name,
              title: block.source.title,
              version: block.source.version,
              updatedAt: block.source.updated_at,
              label: matchedEntry?.source?.label,
            }}
            category={
              query.matched_entry_ids[0]
                ? resolveCategory(query.matched_entry_ids[0])
                : 'Event'
            }
            confidence={query.match_confidence}
            // AI 합성 답은 검증 배지를 달지 않는다(저장된 답이 아니므로) → 대신 '매칭 NN%'로 표시되고 위에 'AI 정리' 고지가 뜬다.
            verification={block?.mode === 'generated' ? undefined : matchedEntry?.verification?.state}
            resolutionRate={matchedEntry?.stats?.resolution_rate}
            doText={matchedEntry?.square?.extract?.do}
            dontText={matchedEntry?.square?.extract?.dont}
            standard={matchedEntry?.square?.standard}
            feedback={query.satisfaction}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
            onSourcePress={matchedEntry ? () => setDetailEntry(matchedEntry) : undefined}
          />
        ) : candidateEntries.length > 0 && deflectState === 'asking' ? (
          // 매칭 애매 → 후보 노하우 먼저 제시. '사장님께 물어보기'를 누르면 등록(deflectState=registered)으로 전환.
          <CandidateCard
            entries={candidateEntries}
            onPick={(e) => setDetailEntry(e)}
            onRegister={onRegister}
          />
        ) : (
          deflectMeta && (
            <DeflectCard
              aiGeneralAnswer={deflectMeta.general}
              similarCount={deflectMeta.similar}
              status={deflectState}
              onRegister={onRegister}
              onDecline={onDecline}
            />
          )
        )}

        {/* 더 나은 방법을 아는 알바 → 이 노하우 개선 제안(사장 검토 후 반영) */}
        {block && matchedEntry && (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/junior/suggest', params: { entryId: matchedEntry.id, title: matchedEntry.title } })
            }
            style={({ pressed }) => [turnStyles.improveLink, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="sparkles-outline" size={13} color={InkColors.ink3} />
            <Text style={turnStyles.improveText}>더 좋은 방법이 있나요? 개선 제안하기</Text>
          </Pressable>
        )}

        {/* 👎 직후 데드엔드 방지 — 다음 행동(재질문·직접 문의)을 안내 */}
        {block && query.satisfaction === 'down' && (
          <View style={turnStyles.downHelp}>
            <Ionicons name="bulb-outline" size={14} color={InkColors.ink3} />
            <Text style={turnStyles.downHelpText}>
              알려줘서 고마워요. 답이 안 맞으면 다르게 한 번 더 물어보거나, 사장님께 직접 여쭤보면 정확해요.
            </Text>
          </View>
        )}
      </Appear>

      {/* 출처·후보 → 원본 노하우 상세(읽기 전용) */}
      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(undefined)} />
    </View>
  );
}

const turnStyles = StyleSheet.create({
  turn: { gap: 10 },
  assistant: {
    width: '100%',
    alignItems: 'stretch',
  },
  degradedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: Radius.sm,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  degradedText: { flex: 1, fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17 },
  composedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: Radius.sm,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  composedText: { flex: 1, fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17 },
  downHelp: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: Radius.sm,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  downHelpText: { flex: 1, fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17 },
  improveLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  improveText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
});
