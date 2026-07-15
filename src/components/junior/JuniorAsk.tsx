import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Appear } from '@/components/Appear';
import { ChatTurn } from '@/components/junior/ChatTurn';

import { useChatStore } from '@/lib/store/useChatStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { HAS_SUPABASE } from '@/lib/supabase';

import { useStaffStore } from '@/lib/store/useStaffStore';

import { SEED_QUERIES } from '@/lib/demo/seedQueries';
import { BrandColors, InkColors } from '@/lib/theme/colors';

import type { Category } from '@/types';

import { styles } from './askStyles';

// 추천 질문 풀 — 업종(요식업) 일반. 데모 매장(노하우 보유)은 데모 시드 칩을 쓴다.
// 첫인상은 '사소한 것도 편하게'가 되도록 저부담 질문부터 — 위기 시나리오를 앞세우지 않는다.
// 상단 상시 스트립이 매번 같은 질문만 반복하지 않도록 풀을 넉넉히 두고, '이미 물어본 질문'은 걸러낸다.
const GENERIC_SUGGESTIONS = [
  '앞치마는 어디 있어요?',
  '마감 몇 시예요?',
  '마감 청소 어디까지 해요?',
  '재료 떨어지면 어떻게 해요?',
  '포스기 에러 났어요',
  '휴게시간은 어떻게 써요?',
  '유니폼 세탁은 어떻게 해요?',
  '손님이 환불해달래요',
  '재고는 어디서 확인해요?',
  '지각하면 어디로 연락해요?',
];

// 빈 상태에서 보여줄 추천 수 / 대화 중 상단 스트립 최대 수.
const EMPTY_SUGGEST_COUNT = 4;
const STRIP_SUGGEST_COUNT = 6;

/* ─────────────────────────────────────────────────────────
 * JuniorAsk — '물어보기' 슬롯. 기존 챗 UI를 그대로 임베드.
 * 크롬(SafeArea/탭바/헤더)은 컨테이너가 소유하므로 여기선 KeyboardAvoidingView부터.
 * RAG·useChatStore·만족도·익명·시드칩 동작은 기존과 100% 동일.
 * ───────────────────────────────────────────────────────── */
export function JuniorAsk() {
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
  const pool = useMemo(
    () => (!HAS_SUPABASE && entryCount > 0 ? SEED_QUERIES.map((s) => s.text) : GENERIC_SUGGESTIONS),
    [entryCount],
  );
  // 이미 물어본 질문은 추천에서 제외 → 같은 추천 칩이 매번 반복되지 않고, 답할 때마다 다음 질문이 드러난다.
  const asked = useMemo(() => new Set(history.map((h) => h.query_text.trim())), [history]);
  // 빈 상태: 풀 앞쪽 몇 개(첫인상). 대화 중 스트립: 아직 안 물어본 것만, 상한까지.
  const emptySuggestions = useMemo(() => pool.slice(0, EMPTY_SUGGEST_COUNT), [pool]);
  const stripSuggestions = useMemo(
    () => pool.filter((t) => !asked.has(t.trim())).slice(0, STRIP_SUGGEST_COUNT),
    [pool, asked],
  );

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
  const [focused, setFocused] = useState(false);
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
    void submit(value);
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
              {emptySuggestions.map((text, i) => (
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

      {/* 추천 질문 상시 노출 — 대화 시작 후에도 '다음 질문'을 한 탭으로. 이미 물어본 건 빠지므로
          같은 추천이 반복되지 않는다. 물어볼 게 다 떨어지면 스트립 자체를 감춘다. */}
      {history.length > 0 && stripSuggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipStrip}
          contentContainerStyle={styles.chipStripContent}
          keyboardShouldPersistTaps="handled"
        >
          {stripSuggestions.map((text) => (
            <Pressable
              key={`chip-${text}`}
              onPress={() => handleSeedTap(text)}
              disabled={isLoading}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }, isLoading && { opacity: 0.5 }]}
            >
              <Text style={styles.chipText} numberOfLines={1}>{text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 입력바 */}
      <View style={styles.inputBar}>
        <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
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
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
