import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { SquareCard } from '@/components/SquareCard';
import { DeflectCard } from '@/components/DeflectCard';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { UserBubble } from '@/components/UserBubble';
import { RoleTabBar } from '@/components/RoleTabBar';
import { KnowhowSegment } from '@/components/KnowhowSegment';
import { BrowseList } from '@/components/BrowseList';

import { useChatStore } from '@/lib/store/useChatStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { HAS_SUPABASE } from '@/lib/supabase';

import { useStaffStore } from '@/lib/store/useStaffStore';

import { SEED_QUERIES } from '@/lib/demo/seedQueries';
import { BrandColors, InkColors } from '@/lib/theme/colors';

import type { Category, ChatQuery, PlaybookEntry } from '@/types';

// 빈 채팅 추천 질문 — 업종(요식업) 일반. 데모 매장(노하우 보유)은 데모 시드 칩을 쓴다.
// 첫인상은 '사소한 것도 편하게'가 되도록 저부담 질문부터 — 위기 시나리오를 앞세우지 않는다.
const GENERIC_SUGGESTIONS = [
  '앞치마는 어디 있어요?',
  '마감 몇 시예요?',
  '마감 청소 어디까지 해요?',
  '재료 떨어지면 어떻게 해요?',
];

/**
 * 노하우 탭(주니어) — KnowhowSegment 컨테이너.
 *  · 둘러보기: 발행된 노하우를 BrowseList로 (주니어·시니어 공용)
 *  · 물어보기: 기존 AI 어시스턴트 챗(RAG·useChatStore·만족도 100% 보존)
 *
 * 크롬(SafeArea·헤더·탭바) 소유권은 이 컨테이너가 가진다 — 임베드된 챗(JuniorAsk)은
 * 자체 SafeAreaView/RoleTabBar를 갖지 않는다(중복 방지).
 */
export default function JuniorChatScreen() {
  const entries = usePlaybookStore((s) => s.entries);
  const submit = useChatStore((s) => s.submit);

  // 둘러보기에 노출할 발행 노하우. status 없는 시드도 안전하게 통과(published 우선, 미정이면 노출).
  const publishedEntries = useMemo(
    () => entries.filter((e) => e.status === 'published' || !e.status),
    [entries],
  );

  // 주니어가 카드를 탭하면 그 노하우를 질문으로 띄워 RAG가 같은 카드를 채팅에 보여준다.
  const handleBrowseSelect = (entry: PlaybookEntry) => {
    void submit(entry.title, { anonymous: false });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '물어보기' }} />
      <KnowhowSegment
        role="junior"
        initial="ask"
        browse={
          <BrowseList
            entries={publishedEntries}
            onSelect={handleBrowseSelect}
            emptyHint="아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요."
            showCategory={false}
          />
        }
        ask={<JuniorAsk />}
      />
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────────────────
 * JuniorAsk — '물어보기' 슬롯. 기존 챗 UI를 그대로 임베드.
 * 크롬(SafeArea/탭바/헤더)은 컨테이너가 소유하므로 여기선 KeyboardAvoidingView부터.
 * RAG·useChatStore·만족도·익명·시드칩 동작은 기존과 100% 동일.
 * ───────────────────────────────────────────────────────── */
function JuniorAsk() {
  const history = useChatStore((s) => s.history);
  const isLoading = useChatStore((s) => s.isLoading);
  const lastSubmittedId = useChatStore((s) => s.lastSubmittedId);
  const submit = useChatStore((s) => s.submit);
  const rate = useChatStore((s) => s.rate);
  const error = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const retryLast = useChatStore((s) => s.retryLast);

  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const sessionStore = useSessionStore((s) => s.storeName);
  const getStaff = useStaffStore((s) => s.getStaff);
  const getEntryById = usePlaybookStore((s) => s.getById);
  const entryCount = usePlaybookStore((s) => s.entries.length);
  // 데모(mock) 매장에서만 시연용 시드 질문을 노출한다. 실서비스 계정은 항상 업종 일반 추천
  // → 실계정 알바가 남의 매장 데모 질문('수저통 빨대…')을 보는 목업 데이터 누출 방지.
  const suggestions = !HAS_SUPABASE && entryCount > 0 ? SEED_QUERIES.slice(0, 4).map((s) => s.text) : GENERIC_SUGGESTIONS;

  const identity = useMemo(() => {
    // 매장 이름은 세션에서. 입사일차는 명부에 있을 때만 표시(신규 사용자엔 없음).
    const me = getStaff(userId);
    const career = me?.career_days ? ` · 입사 ${me.career_days}일차` : '';
    const store = sessionStore ? ` · ${sessionStore}` : '';
    return `${userName}${career}${store}`;
  }, [userId, userName, sessionStore, getStaff]);
  const unknownQueue = useUnknownQueueStore((s) => s.queue);

  const [input, setInput] = useState('');
  const [anon, setAnon] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // 신규 메시지가 들어오면 자동으로 바닥까지 스크롤
  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [history.length, isLoading]);

  function handleSend(text?: string) {
    const value = (text ?? input).trim();
    if (!value) return;
    setInput('');
    void submit(value, { anonymous: anon });
  }

  // 추천 칩 1탭 → 바로 전송 (입력칸을 잠깐 채웠다 지우는 깜빡임 없이 질문 버블로 즉시 노출)
  function handleSeedTap(text: string) {
    handleSend(text);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      {/* 상단 안내 */}
      <View style={styles.identityBar}>
        <Text style={styles.identityText}>{identity}</Text>
      </View>

      {/* 대화 히스토리 */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {history.length === 0 && !isLoading && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>무엇이든 물어보세요</Text>
            <Text style={styles.emptySub}>
              매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.
            </Text>
            <Text style={styles.suggestLabel}>이런 걸 물어볼 수 있어요</Text>
            <View style={styles.suggestList}>
              {suggestions.map((text, i) => (
                <Pressable
                  key={`${i}-${text}`}
                  onPress={() => handleSeedTap(text)}
                  style={({ pressed }) => [styles.suggest, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.suggestText}>{text}</Text>
                  <Text style={styles.suggestArrow}>↗</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {history.map((q, idx) => (
          <ChatTurn
            key={q.id}
            query={q}
            isLatest={idx === history.length - 1 && q.id === lastSubmittedId}
            onThumbsUp={() => rate(q.id, 'up')}
            onThumbsDown={() => rate(q.id, 'down')}
            resolveCategory={(entryId) =>
              (getEntryById(entryId)?.category as Category) ?? 'Event'
            }
            findUQ={(queryText) =>
              unknownQueue.find((u) => u.query_text === queryText)
            }
          />
        ))}

        {isLoading && (
          <View style={styles.loading}>
            <Text style={styles.loadingDot}>✦</Text>
            <Text style={styles.loadingText}>
              매장 가이드를 찾아보는 중…
            </Text>
          </View>
        )}

        <View style={{ height: 8 }} />
      </ScrollView>

      {/* 전송 실패 알림 — 조용히 사라지지 않게, 다시 시도 경로 제공 */}
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void retryLast()} hitSlop={6} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
          <Pressable onPress={dismissError} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text style={styles.errorClose}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* 추천 질문 상시 노출 — 대화가 시작된 뒤에도 다음 질문을 한 탭으로(빈 상태 안내와 중복 방지) */}
      {history.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipStrip}
          contentContainerStyle={styles.chipStripContent}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map((text, i) => (
            <Pressable
              key={`chip-${i}`}
              onPress={() => handleSeedTap(text)}
              disabled={isLoading}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }, isLoading && { opacity: 0.5 }]}
            >
              <Text style={styles.chipText} numberOfLines={1}>{text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 익명 토글 — 묻기 어려운 질문(권리·인간관계·실수)을 부담 없이 */}
      <View style={styles.anonRow}>
        <Pressable
          onPress={() => setAnon((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: anon }}
          style={({ pressed }) => [
            styles.anonChip,
            anon && styles.anonChipOn,
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={[styles.anonChipText, anon && styles.anonChipTextOn]}>
            {anon ? '🔒 익명으로 묻는 중' : '🔓 익명으로 묻기'}
          </Text>
        </Pressable>
        {anon && <Text style={styles.anonHint}>사장님께 이름이 안 보여요</Text>}
      </View>

      {/* 입력바 */}
      <View style={styles.inputBar}>
        <View style={styles.inputWrap}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="궁금한 걸 물어보세요"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            editable={!isLoading}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => handleSend()}
            blurOnSubmit={false}
          />
        </View>
        <Pressable
          onPress={() => handleSend()}
          disabled={!input.trim() || isLoading}
          style={({ pressed }) => [
            styles.sendBtn,
            (!input.trim() || isLoading) && styles.sendBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.sendBtnIcon}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ─────────────────────────────────────────────────────────
 * 한 턴: 사용자 질문 + AI 응답(SquareCard | DeflectCard)
 * ───────────────────────────────────────────────────────── */
type ChatTurnProps = {
  query: ChatQuery;
  isLatest: boolean;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  resolveCategory: (entryId: string) => Category;
  findUQ: (queryText: string) => { presumed_category: Category; ai_general_answer: string; similar_queries_count?: number } | undefined;
};

function ChatTurn({
  query,
  isLatest,
  onThumbsUp,
  onThumbsDown,
  resolveCategory,
  findUQ,
}: ChatTurnProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  // 마지막 신규 응답에만 살짝 fade-in. useMemo로 1회 생성(refs 룰 회피).
  const opacity = useMemo(() => new Animated.Value(isLatest ? 0 : 1), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLatest) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [isLatest, opacity]);

  const block = query.response_block;
  const matchedEntry = usePlaybookStore((s) =>
    query.matched_entry_ids[0] ? s.getById(query.matched_entry_ids[0]) : undefined,
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

      <Animated.View style={[turnStyles.assistant, { opacity }]}>
        {block?.degraded && (
          <View style={turnStyles.degradedNote}>
            <Ionicons name="cloud-offline-outline" size={13} color={InkColors.ink3} />
            <Text style={turnStyles.degradedText}>
              지금은 기본 안내로 답했어요. 잠시 후 다시 물으면 매장에 맞춰 더 정확히 알려드려요.
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
            verification={matchedEntry?.verification?.state}
            resolutionRate={matchedEntry?.stats?.resolution_rate}
            doText={matchedEntry?.square?.extract?.do}
            dontText={matchedEntry?.square?.extract?.dont}
            standard={matchedEntry?.square?.standard}
            feedback={query.satisfaction}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
            onSourcePress={matchedEntry ? () => setDetailOpen(true) : undefined}
          />
        ) : (
          deflectMeta && (
            <DeflectCard
              aiGeneralAnswer={deflectMeta.general}
              similarCount={deflectMeta.similar}
            />
          )
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
      </Animated.View>

      {/* 출처 → 원본 노하우 상세(읽기 전용) */}
      <EntryDetailModal entry={matchedEntry} visible={detailOpen} onClose={() => setDetailOpen(false)} />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────
 * Styles
 * ───────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  // 상단 신원 바
  identityBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  identityText: {
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '500',
  },

  // 대화 영역
  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 4,
    gap: 18,
  },

  // 빈 상태 — 첫 진입 시 안내 + 추천 질문
  empty: {
    paddingTop: 28,
    paddingHorizontal: 4,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: InkColors.ink,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: 14,
    color: InkColors.ink3,
    lineHeight: 20,
    marginBottom: 8,
  },
  suggestLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0.3, marginBottom: 2 },
  suggestList: { gap: 10 },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  suggestText: {
    flex: 1,
    fontSize: 15,
    color: InkColors.ink2,
    fontWeight: '600',
  },
  suggestArrow: {
    fontSize: 15,
    color: InkColors.ink3,
    fontWeight: '700',
    marginLeft: 10,
  },

  // 로딩
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  loadingDot: {
    fontSize: 14,
    color: BrandColors.brand,
    fontWeight: '800',
  },
  loadingText: {
    fontSize: 13,
    color: InkColors.ink2,
    fontWeight: '600',
  },

  // 전송 실패 배너
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: BrandColors.accentSoft,
    borderWidth: 1,
    borderColor: BrandColors.accent,
  },
  errorText: { flex: 1, fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  retryBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: BrandColors.accent },
  retryText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  errorClose: { fontSize: 14, fontWeight: '800', color: BrandColors.accent },

  // 추천 질문 상시 스트립 (대화 시작 후)
  chipStrip: { maxHeight: 44, backgroundColor: '#FFFFFF' },
  chipStripContent: { paddingHorizontal: 12, paddingTop: 8, gap: 8, alignItems: 'center' },
  chip: {
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  // 익명 토글
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
  },
  anonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: '#FFFFFF',
  },
  anonChipOn: {
    backgroundColor: InkColors.ink,
    borderColor: InkColors.ink,
  },
  anonChipText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  anonChipTextOn: { color: '#FFFFFF' },
  anonHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '500' },

  // 입력바
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 999,
    paddingLeft: 16,
    paddingRight: 6,
    backgroundColor: '#FFFFFF',
    minHeight: 46,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: InkColors.ink,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BrandColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: InkColors.line,
  },
  sendBtnIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '900',
    lineHeight: 24,
  },
});

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
    borderRadius: 10,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  degradedText: { flex: 1, fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17 },
  downHelp: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  downHelpText: { flex: 1, fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17 },
});
