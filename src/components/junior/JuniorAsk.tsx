import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Appear, stagger } from '@/components/Appear';
import { KeyboardShift } from '@/components/KeyboardShift';
import { ChatComposerBar, PlusToggleIcon } from '@/components/ChatComposerBar';
import { ScreenLoading } from '@/components/ScreenLoading';
import { ChatTurn } from '@/components/junior/ChatTurn';

import { useChatStore } from '@/lib/store/useChatStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';

import { InkColors } from '@/lib/theme/colors';

import type { Category } from '@/types';

import { styles } from './askStyles';

// 빈 상태에서 보여줄 추천 수. (대화 중 상단 추천 칩 스트립은 2026-09-03 사용자 결정으로 뺐다.)
const EMPTY_SUGGEST_COUNT = 3;

// 히스토리 윈도잉 — 처음엔 최근 CHAT_WINDOW개만 렌더하고, 위로 스크롤하면 이전 대화를 CHAT_PAGE개씩 더 붙인다.
//  (질문이 많이 쌓여도 전부 렌더/스크롤하지 않게. 맨위→맨아래로 번쩍 이동하던 문제 해소.)
const CHAT_WINDOW = 20;
const CHAT_PAGE = 20;

/* ─────────────────────────────────────────────────────────
 * JuniorAsk — '물어보기' 슬롯. 기존 챗 UI를 그대로 임베드.
 * 크롬(SafeArea/탭바/헤더)은 컨테이너가 소유하므로 여기선 KeyboardAvoidingView부터.
 * RAG·useChatStore·만족도·익명·시드칩 동작은 기존과 100% 동일.
 * ───────────────────────────────────────────────────────── */
// suggestEntry: '노하우 제안' 진입(/junior/suggest) 노출 여부 — 매니저(owner/ask 재사용)는
// 제안 경로 대신 직접 발행 권한이 있으므로 숨긴다.
// seed: 홈에서 탭한 예시 질문 문구. **입력칸을 채우기만 하고 보내지는 않는다** —
//   자동 전송하면 오탭이 곧 질문 전송이 되고, 직원은 자기가 안 쓴 질문이 올라간 걸 보게 된다.
//   (사장 쪽 씨앗 칩 dashboard.tsx→/owner/coach 와 같은 params 패턴)
export function JuniorAsk({ suggestEntry = true, seed }: { suggestEntry?: boolean; seed?: string } = {}) {
  const history = useChatStore((s) => s.history);
  const isLoading = useChatStore((s) => s.isLoading);
  const submit = useChatStore((s) => s.submit);
  const rate = useChatStore((s) => s.rate);
  const error = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const retryLast = useChatStore((s) => s.retryLast);
  const lastSubmittedId = useChatStore((s) => s.lastSubmittedId);
  const deflectStatus = useChatStore((s) => s.deflectStatus);
  const pendingDeflects = useChatStore((s) => s.pendingDeflects);
  const registerToOwner = useChatStore((s) => s.registerToOwner);
  const declineDeflect = useChatStore((s) => s.declineDeflect);
  // ★본문이 읽는 원격 소스 둘 — 지난 대화(chat)와 그라운딩 노하우(playbook).
  //  ★훅을 각각 먼저 부르고 그 다음에 AND 한다(&& 안에서 훅 호출 금지).
  //  이 컴포넌트는 부모가 둘(junior/chat·owner/ask)이라 자기 게이트를 스스로 갖는다.
  const historyLoaded = useChatStore((s) => s.loaded);

  const getEntryById = usePlaybookStore((s) => s.getById);
  const entries = usePlaybookStore((s) => s.entries);
  const entriesLoaded = usePlaybookStore((s) => s.loaded);
  // ★그라운딩 범위 — **AI가 실제로 보는 것과 같은 집합**을 센다.
  //  match_playbook(0012_pgvector_search.sql)의 조건은 이 매장의 `status='published'` 하나뿐이다.
  //  needs_review·is_template 로 더 좁혀 세면 화면의 'n개'와 AI가 쓰는 노하우가 어긋난다 —
  //  업종팩을 fork한 매장(전부 needs_review=true)은 화면이 칩을 아예 안 그리는데
  //  AI는 그 노하우들로 답했다. 개수는 여기서, 문장도 이 값으로 말한다.
  const grounded = useMemo(
    () => entries.filter((e) => (e.status ?? 'published') === 'published'),
    [entries],
  );
  // 그중 사장님이 아직 확인 안 한 것 — 안내 문장이 이 수를 그대로 밝힌다(숨기지 않는다).
  const unreviewedCount = useMemo(() => grounded.filter((e) => e.needs_review === true).length, [grounded]);
  // ★추천 칩도 **같은 풀**에서 뽑는다(정본 §13: 그 매장에 실제로 있는 노하우만).
  //  다만 순서는 사장님이 확인한 것 → 많이 물어본 것 순. 안내 문장이 그렇게 말한다.
  const askable = useMemo(
    () =>
      [...grounded].sort(
        (a, b) =>
          Number(a.needs_review === true) - Number(b.needs_review === true) ||
          (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0),
      ),
    [grounded],
  );
  // 칩 문구 = 노하우 제목 그대로. 문장을 지어내면 원문과 어긋나 매칭이 빗나간다.
  const pool = useMemo(() => askable.map((e) => e.title).filter(Boolean), [askable]);
  // 빈 상태: 풀 앞쪽 몇 개(첫인상).
  const emptySuggestions = useMemo(() => pool.slice(0, EMPTY_SUGGEST_COUNT), [pool]);
  const unknownQueue = useUnknownQueueStore((s) => s.queue);
  // 실제로 사장에게 등록된 질문 문장 집합 — 재기동 후 '보냈음' 표시의 **유일한 근거**(#25).
  // enqueue 의 중복 판정과 같은 잣대(trim 비교)를 쓴다 — 두 곳이 다르면 표시와 실제가 또 어긋난다.
  const registeredTexts = useMemo(
    () => new Set(unknownQueue.map((u) => u.query_text.trim())),
    [unknownQueue],
  );

  const router = useRouter();
  // 홈 예시 칩이 넘긴 문구로 입력칸을 시작한다. effect가 아니라 **초기값**인 이유 —
  // 홈 칩 → goToTab(replace)은 이 화면을 새로 마운트하므로 초기값이면 충분하고,
  // effect로 하면 사용자가 타이핑한 뒤 리렌더에서 덮어쓸 위험만 생긴다.
  const [input, setInput] = useState(seed ?? '');
  // ＋ 메뉴(노하우 제안) — 업무 채팅 입력바와 같은 형태.
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  // 첫 진입(마운트·기존 기록 hydrate)은 애니 없이 바닥으로 '점프' → 히스토리를 위에서부터 스크롤해 내려오는
  // 잔상 없이 최신 대화가 바로 보인다. 이후 새 메시지부터만 부드럽게 스크롤한다.
  const didInitialScroll = useRef(false);

  // 윈도잉 상태 — 최근 visibleCount개만 렌더. 위로 스크롤(또는 상단 '이전 대화' 탭)하면 페이지 단위로 더 붙인다.
  const [visibleCount, setVisibleCount] = useState(CHAT_WINDOW);
  const contentH = useRef(0);
  const scrollY = useRef(0);
  const loadingOlder = useRef(false); // 이전 대화를 붙이는 중(스크롤 위치 보정 대기)
  const visibleHistory = history.length > visibleCount ? history.slice(history.length - visibleCount) : history;
  const hasMoreOlder = history.length > visibleHistory.length;

  const loadOlder = () => {
    if (loadingOlder.current || !hasMoreOlder) return;
    loadingOlder.current = true; // 다음 onContentSizeChange에서 늘어난 높이만큼 아래로 밀어 같은 위치 유지
    setVisibleCount((c) => Math.min(history.length, c + CHAT_PAGE));
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.current = y;
    if (y <= 48) loadOlder(); // 상단 근처로 끌어올리면 이전 대화 로드
  };
  const onContentSize = (_w: number, h: number) => {
    if (loadingOlder.current) {
      // 위에 콘텐츠가 붙어 전체가 아래로 밀렸으니, 늘어난 만큼 스크롤을 내려 보던 메시지를 그대로 둔다.
      const delta = h - contentH.current;
      if (delta > 0) scrollRef.current?.scrollTo({ y: scrollY.current + delta, animated: false });
      loadingOlder.current = false;
    }
    contentH.current = h;
  };
  // 보낼 수 있는 상태 = 입력값 있음 + 로딩 아님 → 전송 버튼이 노랑으로 '켜짐'(active 액센트).
  const canSend = !!input.trim() && !isLoading;

  // 신규 메시지가 들어오면 자동으로 바닥까지 스크롤
  useEffect(() => {
    const isFirst = !didInitialScroll.current;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: !isFirst });
      if (history.length > 0) didInitialScroll.current = true;
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

  // 지난 대화와 노하우가 **둘 다** 와야 본문을 그린다. 하나라도 기다리면
  //  ① 기존 대화가 있는 사람도 "무엇이든 물어보세요" 빈 화면을 먼저 보고
  //  ② "우리 매장 노하우 0개를 보고 답해요"라고 아직 안 온 것을 없는 것처럼 말한다.
  const ready = historyLoaded && entriesLoaded;

  return (
    // 키보드 회피는 공용 KeyboardShift — 헤더·세그먼트 아래에 놓여도 창 기준 오프셋을 스스로 잰다.
    <KeyboardShift>
      {/* 옛 상단 신원 줄(이름·입사일차·매장 + '노하우 제안' 칩)은 2026-09-03 뺐다 —
          노하우 제안 진입은 아래 입력바 ＋ 메뉴로 옮겼다. */}

      {/* 대화 히스토리 — 게이트 밖은 입력바(세션값)뿐이다. */}
      {!ready ? (
        <View style={styles.scroll}>
          <ScreenLoading label="지난 대화를 불러오고 있어요…" />
        </View>
      ) : (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSize}
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
            {/* ★노하우가 하나도 없으면 안내도 칩도 그리지 않는다 — 빈 칩·가짜 예시를 누르면
                "물어봐도 답이 없다"가 첫 인상이 된다. 이때는 위 두 줄만 남는다. */}
            {emptySuggestions.length > 0 && (
              <>
                {/* ★"사장님이 확인한 것만 씁니다"는 사실이 아니었다 — match_playbook은 published 전부를 본다.
                    확인 안 한 것도 답에 쓰이므로 그 수를 그대로 밝히고, 추천 순서만 확인한 것을 앞에 둔다. */}
                <Text style={styles.groundingText}>
                  {unreviewedCount > 0
                    ? `우리 매장 노하우 ${grounded.length}개를 보고 답해요. 그중 ${unreviewedCount}개는 사장님이 아직 확인 안 했어요. 아래 추천은 확인한 것부터 보여드려요.`
                    : `우리 매장 노하우 ${grounded.length}개를 보고 답해요. 아래 추천은 많이 물어본 것부터 보여드려요.`}
                </Text>
                <View style={styles.suggestList}>
                  {emptySuggestions.map((text, i) => (
                    <Appear key={`${i}-${text}`} delay={stagger(i)}>
                      <Pressable
                        onPress={() => handleSeedTap(text)}
                        accessibilityRole="button"
                        accessibilityLabel={`${text} 물어보기`}
                        style={({ pressed }) => [styles.suggest, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.suggestText}>{text}</Text>
                        <Text style={styles.suggestArrow}>↗</Text>
                      </Pressable>
                    </Appear>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* 이전 대화가 더 있으면 상단에 안내 — 위로 끌어올리거나 탭하면 더 불러온다. */}
        {hasMoreOlder && (
          <Pressable
            onPress={loadOlder}
            style={({ pressed }) => [{ alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 14, marginBottom: 4 }, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="이전 대화 더 보기"
          >
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 }}>⌃ 이전 대화 더 보기</Text>
          </Pressable>
        )}

        {visibleHistory.map((q) => (
          <ChatTurn
            key={q.id}
            query={q}
            animateIn={q.id === lastSubmittedId}
            onThumbsUp={() => rate(q.id, 'up')}
            onThumbsDown={() => rate(q.id, 'down')}
            deflectState={
              // 명시적 선택이 우선 → 등록 대기(pending) 있으면 물어봄 →
              // 둘 다 없으면(앱을 다시 켠 뒤) **실제로 등록됐는지**를 보고 판정한다.
              // ★2026-08-25 감사 #25: 예전엔 이 자리의 폴백이 무조건 'registered' 였다.
              //   deflectStatus·pendingDeflects 는 메모리라 재기동 시 비는데 history 는 DB 에서
              //   되살아난다 → **보낸 적 없는 질문까지 전부 "사장님께 보냈어요"** 로 보였다.
              //   실재 판정은 미답질문 큐에 같은 문장이 있는지로 한다(enqueue 의 중복 판정과 같은 잣대).
              deflectStatus[q.id] ?? (pendingDeflects[q.id] ? 'asking' : (registeredTexts.has(q.query_text.trim()) ? 'registered' : 'asking'))
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
      )}

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

      {/* ＋ 메뉴 — 업무 채팅(WorkChat)과 같은 형태·같은 위치. 항목은 '노하우 제안' 하나다. */}
      {menu && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenu(false)} accessibilityLabel="메뉴 닫기" />
          <Appear style={styles.menu}>
            <Pressable
              onPress={() => { setMenu(false); router.push('/junior/suggest'); }}
              accessibilityRole="button"
              accessibilityLabel="노하우 제안"
              style={({ pressed }) => [styles.mi, pressed && { backgroundColor: InkColors.paper }]}
            >
              <View style={styles.miIc}>
                <Ionicons name="bulb-outline" size={16} color={InkColors.ink} />
              </View>
              <View>
                <Text style={styles.miLabel}>노하우 제안</Text>
                <Text style={styles.miSub}>사장님 확인 뒤 매장 노하우가 돼요</Text>
              </View>
            </Pressable>
          </Appear>
        </>
      )}

      {/* 입력바 — 떠 있는 알약. ＋ · 입력칸 · 보내기 = 업무 채팅 입력바와 같은 구성(2026-09-03). */}
      <ChatComposerBar>
        {suggestEntry && (
          <Pressable
            onPress={() => setMenu((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={menu ? '추가 메뉴 닫기' : '추가 메뉴 열기'}
            style={({ pressed }) => [styles.plus, pressed && { opacity: 0.85 }]}
          >
            <PlusToggleIcon open={menu} color={InkColors.bubbleText} />
          </Pressable>
        )}
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
        <Pressable
          onPress={() => handleSend()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="질문 보내기"
          style={({ pressed }) => [styles.send, !canSend && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="arrow-up" size={20} color={InkColors.ink} />
        </Pressable>
      </ChatComposerBar>
    </KeyboardShift>
  );
}
