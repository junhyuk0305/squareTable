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
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { SquareCard } from '@/components/SquareCard';
import { DeflectCard } from '@/components/DeflectCard';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { UserBubble } from '@/components/UserBubble';
import { RoleTabBar } from '@/components/RoleTabBar';
import { KnowhowSegment } from '@/components/KnowhowSegment';
import { JuniorBrowseDashboard } from '@/components/JuniorBrowseDashboard';
import { Appear } from '@/components/Appear';

import { useChatStore } from '@/lib/store/useChatStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { HAS_SUPABASE } from '@/lib/supabase';

import { useStaffStore } from '@/lib/store/useStaffStore';

import { SEED_QUERIES } from '@/lib/demo/seedQueries';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

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
          <JuniorBrowseDashboard
            entries={publishedEntries}
            onSelect={handleBrowseSelect}
            emptyHint="아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요."
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
  const submit = useChatStore((s) => s.submit);
  const rate = useChatStore((s) => s.rate);
  const error = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const retryLast = useChatStore((s) => s.retryLast);
  const deflectStatus = useChatStore((s) => s.deflectStatus);
  const pendingDeflects = useChatStore((s) => s.pendingDeflects);
  const registerToOwner = useChatStore((s) => s.registerToOwner);
  const declineDeflect = useChatStore((s) => s.declineDeflect);

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

  const router = useRouter();
  const [input, setInput] = useState('');
  const [anon, setAnon] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  // 보낼 수 있는 상태 = 입력값 있음 + 로딩 아님 → 전송 버튼이 노랑으로 '켜짐'(active 액센트).
  const canSend = !!input.trim() && !isLoading;

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
      {/* 상단 안내 + 노하우 제안 진입(새 노하우 등록 신청) */}
      <View style={styles.identityBar}>
        <Text style={styles.identityText} numberOfLines={1}>{identity}</Text>
        <Pressable
          onPress={() => router.push('/junior/suggest')}
          hitSlop={6}
          style={({ pressed }) => [styles.suggestEntry, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="bulb" size={13} color={BrandColors.yellowDeep} />
          <Text style={styles.suggestEntryText}>노하우 제안</Text>
        </Pressable>
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
            {/* 브랜드 시그니처 = 노란 마커 하이라이트. 핵심 단어 '무엇이든'만 한 번 강조(절제). */}
            <View style={styles.emptyTitleRow}>
              <View style={styles.markerWrap}>
                <View style={styles.markerBar} />
                <Text style={styles.emptyTitle}>무엇이든</Text>
              </View>
              <Text style={styles.emptyTitle}> 물어보세요</Text>
            </View>
            <Text style={styles.emptySub}>
              매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.
            </Text>
            <Text style={styles.suggestLabel}>이런 걸 물어볼 수 있어요</Text>
            <View style={styles.suggestList}>
              {suggestions.map((text, i) => (
                <Appear key={`${i}-${text}`} delay={120 + i * 70}>
                  <Pressable
                    onPress={() => handleSeedTap(text)}
                    style={({ pressed }) => [styles.suggest, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.suggestText}>{text}</Text>
                    <Text style={styles.suggestArrow}>↗</Text>
                  </Pressable>
                </Appear>
              ))}
            </View>
          </View>
        )}

        {history.map((q) => (
          <ChatTurn
            key={q.id}
            query={q}
            onThumbsUp={() => rate(q.id, 'up')}
            onThumbsDown={() => rate(q.id, 'down')}
            deflectState={
              // 명시적 선택이 우선 → 등록 대기(pending) 있으면 물어봄 → 둘 다 없으면(과거 라우팅된 질문) 안내만
              deflectStatus[q.id] ?? (pendingDeflects[q.id] ? 'asking' : 'registered')
            }
            onRegister={() => registerToOwner(q.id)}
            onDecline={() => declineDeflect(q.id)}
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
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendBtn,
            canSend ? styles.sendBtnOn : styles.sendBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.sendBtnIcon, !canSend && styles.sendBtnIconOff]}>↑</Text>
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
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  deflectState: 'asking' | 'registered' | 'declined';
  onRegister: () => void;
  onDecline: () => void;
  resolveCategory: (entryId: string) => Category;
  findUQ: (queryText: string) => { presumed_category: Category; ai_general_answer: string; similar_queries_count?: number } | undefined;
};

function ChatTurn({
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
  const [detailOpen, setDetailOpen] = useState(false);

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

      <Appear style={turnStyles.assistant}>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  identityText: {
    flex: 1,
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '500',
  },
  suggestEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  suggestEntryText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },

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
  emptyTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' },
  // 노란 마커 = 글자 '뒤'에 깔리는 형광펜. Wordmark와 동일한 격리/zIndex 패턴.
  markerWrap: { position: 'relative', isolation: 'isolate' },
  markerBar: {
    position: 'absolute',
    left: -2,
    right: -2,
    bottom: 3,
    height: 11,
    backgroundColor: BrandColors.yellow,
    borderRadius: Radius.tail,
    zIndex: 0,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: InkColors.ink,
    letterSpacing: -0.3,
    zIndex: 1,
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
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
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
    color: BrandColors.yellowDeep, // 추천 질문 진입 화살표에 노란 포인트
    fontWeight: '900',
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
    color: BrandColors.yellowDeep, // 검색 중 반짝임에 노란 포인트
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
    borderRadius: Radius.md,
    backgroundColor: BrandColors.accentSoft,
    borderWidth: 1,
    borderColor: BrandColors.accent,
  },
  errorText: { flex: 1, fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  retryBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: Radius.pill, backgroundColor: BrandColors.accent },
  retryText: { fontSize: 12, fontWeight: '800', color: InkColors.bubbleText },
  errorClose: { fontSize: 14, fontWeight: '800', color: BrandColors.accent },

  // 추천 질문 상시 스트립 (대화 시작 후)
  chipStrip: { maxHeight: 44, backgroundColor: InkColors.bg },
  chipStripContent: { paddingHorizontal: 12, paddingTop: 8, gap: 8, alignItems: 'center' },
  chip: {
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
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
    backgroundColor: InkColors.bg,
  },
  anonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  anonChipOn: {
    backgroundColor: InkColors.ink,
    borderColor: InkColors.ink,
  },
  anonChipText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  anonChipTextOn: { color: InkColors.bubbleText },
  anonHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '500' },

  // 입력바
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingLeft: 16,
    paddingRight: 6,
    backgroundColor: InkColors.bg,
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
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 켜짐 = 브랜드 옐로 + 옐로 글로우(보낼 준비됨). 검정 화살표로 대비 확보.
  sendBtnOn: {
    backgroundColor: BrandColors.yellow,
    ...Elevation.ey,
  },
  sendBtnDisabled: {
    backgroundColor: InkColors.bgSoft,
  },
  sendBtnIcon: {
    fontSize: 22,
    color: InkColors.ink,
    fontWeight: '900',
    lineHeight: 24,
  },
  sendBtnIconOff: { color: InkColors.ink3 },
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
    borderRadius: Radius.sm,
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
