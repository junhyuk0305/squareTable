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
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { SquareCard } from '@/components/SquareCard';
import { VoiceButton } from '@/components/VoiceButton';
import { DeflectCard } from '@/components/DeflectCard';
import { UserBubble } from '@/components/UserBubble';
import { RoleTabBar } from '@/components/RoleTabBar';

import { useChatStore } from '@/lib/store/useChatStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';

import { SEED_QUERIES } from '@/lib/demo/seedQueries';
import { inferCategoryFromQuery } from '@/lib/utils/inferCategory';
import { BrandColors, InkColors } from '@/lib/theme/colors';

// 빈 채팅 추천 질문 — 업종(요식업) 일반. 데모 매장(노하우 보유)은 데모 시드 칩을 쓴다.
const GENERIC_SUGGESTIONS = [
  '마감 청소 어디까지 해요?',
  '포스기 에러 났어요',
  '재료 떨어지면 어떻게 해요?',
  '진상 손님은 어떻게 응대해요?',
];

import { useStaffStore } from '@/lib/store/useStaffStore';

import type { Category, ChatQuery } from '@/types';

/**
 * 알바 챗봇 화면 — D안 AI 어시스턴트 클린형.
 * 좌측: assistant (SquareCard | DeflectCard)
 * 우측: user bubble
 * 하단: 시드 쿼리 칩(6개) + 입력바 + 음성 버튼
 */
export default function JuniorChatScreen() {
  const router = useRouter();

  const history = useChatStore((s) => s.history);
  const isLoading = useChatStore((s) => s.isLoading);
  const lastSubmittedId = useChatStore((s) => s.lastSubmittedId);
  const submit = useChatStore((s) => s.submit);
  const rate = useChatStore((s) => s.rate);

  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const sessionStore = useSessionStore((s) => s.storeName);
  const getStaff = useStaffStore((s) => s.getStaff);
  const getEntryById = usePlaybookStore((s) => s.getById);
  const entryCount = usePlaybookStore((s) => s.entries.length);
  // 노하우가 있는 매장(데모 포함)은 데모 시드 질문, 신규 빈 매장은 업종 일반 추천.
  const suggestions = entryCount > 0 ? SEED_QUERIES.slice(0, 4).map((s) => s.text) : GENERIC_SUGGESTIONS;

  const identity = useMemo(() => {
    // 매장 이름은 세션에서. 입사일차는 명부에 있을 때만 표시(신규 사용자엔 없음).
    const me = getStaff(userId);
    const career = me?.career_days ? ` · 입사 ${me.career_days}일차` : '';
    const store = sessionStore ? ` · ${sessionStore}` : '';
    return `${userName}${career}${store}`;
  }, [userId, userName, sessionStore, getStaff]);
  const unknownQueue = useUnknownQueueStore((s) => s.queue);

  const [input, setInput] = useState('');
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
    void submit(value);
  }

  // 시드 칩 1탭 — 발표자 시연 흐름
  function handleSeedTap(text: string) {
    setInput(text);
    setTimeout(() => {
      setInput('');
      void submit(text);
    }, 300);
  }

  function handleSettings() {
    router.push('/junior/settings');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '스퀘어 어시스턴트',
          headerRight: () => (
            <Pressable
              onPress={handleSettings}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="설정"
              style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="settings-outline" size={22} color={InkColors.ink2} />
            </Pressable>
          ),
        }}
      />

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
        >
          {history.length === 0 && !isLoading && (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>무엇이든 물어보세요</Text>
              <Text style={styles.emptySub}>
                매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.
              </Text>
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
                스퀘어 어시스턴트가 매장 가이드를 보고 있어요...
              </Text>
            </View>
          )}

          <View style={{ height: 8 }} />
        </ScrollView>

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
              returnKeyType="send"
              onSubmitEditing={() => handleSend()}
              blurOnSubmit={false}
            />
            <View style={styles.micWrap}>
              <VoiceButton
                size="sm"
                mockText="포스기 에러 떴어요 결제가 안 돼요"
                onResult={(text) => {
                  setInput(text);
                  setTimeout(() => handleSend(text), 250);
                }}
              />
            </View>
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
      <RoleTabBar role="junior" />
    </SafeAreaView>
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
  findUQ: (queryText: string) => { presumed_category: Category; ai_general_answer: string } | undefined;
};

function ChatTurn({
  query,
  isLatest,
  onThumbsUp,
  onThumbsDown,
  resolveCategory,
  findUQ,
}: ChatTurnProps) {
  // 마지막 신규 응답에만 살짝 fade-in
  const opacity = useRef(new Animated.Value(isLatest ? 0 : 1)).current;

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

  // DeflectCard 라우팅용 카테고리/일반 답변
  const deflectMeta = useMemo(() => {
    if (block) return null;
    const uq = findUQ(query.query_text);
    const presumed: Category = uq?.presumed_category ?? inferCategoryFromQuery(query.query_text);
    const general = uq?.ai_general_answer;
    return { presumed, general };
  }, [block, findUQ, query.query_text]);

  return (
    <View style={turnStyles.turn}>
      <UserBubble text={query.query_text} />

      <Animated.View style={[turnStyles.assistant, { opacity }]}>
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
            }}
            category={
              query.matched_entry_ids[0]
                ? resolveCategory(query.matched_entry_ids[0])
                : 'Event'
            }
            confidence={query.match_confidence}
            feedback={query.satisfaction}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
          />
        ) : (
          deflectMeta && (
            <DeflectCard
              presumedCategory={deflectMeta.presumed}
              aiGeneralAnswer={deflectMeta.general}
            />
          )
        )}
      </Animated.View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────
 * Styles
 * ───────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  // 헤더 우측 '사장으로 전환'
  switchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    marginRight: 4,
  },
  switchBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: InkColors.ink2,
  },

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
  micWrap: {
    marginLeft: 6,
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
});
