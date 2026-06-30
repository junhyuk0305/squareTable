import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { UserBubble } from '@/components/UserBubble';
import { Appear } from '@/components/Appear';
import { structureSquare, type ScalePrompt, type StructuredSegment } from '@/lib/ai';
import { type CellPath } from '@/lib/ai/categoryGuide';
import { EXTRACTION_MASTER } from '@/data/extraction-master';
import { computeFollowups, applyFollowupAnswer } from '@/lib/utils/followups';
import { buildPlaybookEntryFromSquare, isSquarePublishable } from '@/lib/utils/buildEntry';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { uploadPhoto } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';

import { MiniSquareCard } from './coach/MiniSquareCard';
import { SplitProposal } from './coach/SplitProposal';
import { ScaleBubble } from './coach/ScaleBubble';
import { styles } from './coach/coachStyles';
import { formatRelative, pickImageWeb } from './coach/coachUtils';

import type { Category, PlaybookEntry, SquareBlock, UnknownQuery } from '@/types';

/* ───────────────────────────────────────────────────────────
 * 대화형 노하우 입력 (chat-first). 두 진입점이 같은 컴포넌트를 공유:
 *   · 직접 등록   — 사장이 채팅에 바로 발화
 *   · 인박스 답변 — 알바 질문(uq)이 첫 말풍선으로 열림 → 사장이 답
 * 흐름: 자유발화 → structureSquare(AI 1콜) → 미니 SQUARE 카드[맞아요/고칠래요]
 *       → 빈 required 칸이면 규칙기반 꼬리질문(최대 2, AI 0콜) → 발행
 * 발행 결과(addEntry/resolve/네비)는 화면이 onPublished에서 처리(스토어 의존성 분리).
 * ─────────────────────────────────────────────────────────── */

export type OwnerCoachChatProps = {
  uq: UnknownQuery;             // 실제(인박스) 또는 합성(직접등록) 질문 컨텍스트
  isInboxAnswer: boolean;       // true면 발행 시 화면이 resolve(uq) 처리
  initialCategory: Category;
  seedText?: string;            // 프리필(콜드스타트 제목·회고 초안)
  onPublished: (entry: PlaybookEntry) => void;
  onPublishedMany?: (entries: PlaybookEntry[]) => void; // 다중 분리 발행(없으면 첫 건만)
};

type MsgInput =
  | { kind: 'alba'; text: string; meta?: string }   // 알바 질문(인박스)
  | { kind: 'owner'; text: string }                  // 사장 발화
  | { kind: 'ai'; text: string }                     // 점장AI 안내/꼬리질문
  | { kind: 'card' }                                 // 미니 SQUARE 카드(라이브 square 렌더)
  | { kind: 'scale' }                                // 정도 척도 입력(라이브 square.standard)
  | { kind: 'split' };                               // 다중 노하우 분리 제안
type Msg = MsgInput & { id: string };

let _mid = 0;
const nextId = () => `m${++_mid}`;

export function OwnerCoachChat({
  uq,
  isInboxAnswer,
  initialCategory,
  seedText,
  onPublished,
  onPublishedMany,
}: OwnerCoachChatProps) {
  const [messages, setMessages] = useState<Msg[]>(() => {
    const init: Msg[] = [];
    if (isInboxAnswer) {
      const who = uq.anonymous ? '익명' : uq.junior_name;
      init.push({
        id: nextId(),
        kind: 'alba',
        text: uq.query_text,
        meta: `${who} · ${formatRelative(uq.asked_at)}`,
      });
      init.push({ id: nextId(), kind: 'ai', text: '이 질문에 사장님이 평소 하시던 대로 답해 주세요. 제가 노하우로 정리할게요.' });
    } else {
      init.push({ id: nextId(), kind: 'ai', text: '알바한테 알려주듯 편하게 적어주세요. 상황·방법을 한 번에 말해도 돼요 — 정리는 제가 할게요.' });
    }
    return init;
  });

  const [input, setInput] = useState(typeof seedText === 'string' ? seedText : '');
  const [category, setCategory] = useState<Category>(initialCategory);
  const [square, setSquare] = useState<SquareBlock | null>(null);
  const [title, setTitle] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [pending, setPending] = useState<{ cell: CellPath; ask: string; hint: string }[]>([]);
  const [scalePrompt, setScalePrompt] = useState<ScalePrompt | null>(null); // 정도 척도질문(AI 감지)
  const [segments, setSegments] = useState<StructuredSegment[] | null>(null); // 다중 분리 제안(≥2)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reStructure, setReStructure] = useState(false); // "다시 말하기" — 다음 발화는 재정리

  const lastRawRef = useRef('');     // 카테고리 변경 시 재정리에 쓸 원문
  const publishedRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const unitId = useSessionStore.getState().unitId;
  const storeId = unitId || 'store_001';

  // 척도질문이 있고 아직 답 안 했으면(=square.standard 미설정) 리뷰 진입을 미룬다.
  const awaitingScale = scalePrompt !== null && !square?.standard;
  const awaitingSplit = segments !== null; // 분리 제안 결정 전엔 단일 리뷰 진입 막음
  const inReview = square !== null && pending.length === 0 && !awaitingScale && !awaitingSplit;

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, busy, pending.length, editing]);

  const pushMsg = useCallback((m: MsgInput) => {
    setMessages((prev) => [...prev, { ...m, id: nextId() }]);
  }, []);

  // 정리 결과(단일) 제시: 카드 → 빈칸이면 꼬리질문 → 정도성이면 척도 → 준비.
  const presentSingle = useCallback((sq: SquareBlock, scaleP: ScalePrompt | null, cat: Category) => {
    const followups = computeFollowups(sq, cat);
    setPending(followups);
    setMessages((prev) => {
      const withCard: Msg[] = [...prev, { id: nextId(), kind: 'card' }];
      if (followups.length > 0) return [...withCard, { id: nextId(), kind: 'ai', text: followups[0].ask }];
      if (scaleP) return [...withCard, { id: nextId(), kind: 'ai', text: scaleP.ask }, { id: nextId(), kind: 'scale' }];
      return [...withCard, { id: nextId(), kind: 'ai', text: '이대로 등록할까요? 맞으면 ✅, 고칠 게 있으면 ✏️ 눌러주세요.' }];
    });
  }, []);

  // ── AI 1콜: 원문 → SQUARE. 다중이면 분리 제안, 단일이면 바로 제시. ──
  const runStructure = useCallback(
    async (rawText: string, cat: Category) => {
      setBusy(true);
      setError(null);
      try {
        const out = await structureSquare({
          storeId,
          rawText,
          category: cat,
          categoryGuide: EXTRACTION_MASTER, // 단일 마스터 지침 주입(카테고리 무관). 분류는 AI가 내부 판단.
        });
        lastRawRef.current = rawText;
        setSegments(null);

        // 빈 응답 가드 — Gemini가 가끔 빈/깨진 결과를 반환(원두분쇄 등 간헐). 빈 카드 대신 재시도 유도.
        const sq0 = out.square;
        const isEmpty = !out.title && !sq0?.situation && !(sq0?.action?.steps?.length);
        if (isEmpty) {
          setError('정리가 잘 안 됐어요 — 한 번 더 또박또박 적어주세요.');
          return;
        }

        // AI 서버 실패로 기본(mock) 정리로 폴백된 경우 — 점주가 '자동 정리본'임을 알고 검토하도록 고지.
        if (out.degraded) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), kind: 'ai', text: '지금은 AI 정리가 어려워 기본 형태로 정리했어요. 내용을 확인하고 고쳐서 저장해 주세요.' },
          ]);
        }

        // 기준 폴백 — AI가 scale_prompt를 빠뜨리면 규칙으로 보강(결정적). 양(개수) 우선, 아니면 정도(스펙트럼).
        const countM = rawText.match(/펌프|샷|스쿱|바퀴|장|번/);
        const degreeRe = /적당|곱게|노릇|깨끗|진하|연하|바삭|은은|되직|묽|알맞/;
        const scaleP: ScalePrompt | null = out.scalePrompt ?? (countM
          ? { kind: 'count', label: '양', ask: `몇 ${countM[0]}가 기준이에요?`, unit: countM[0] }
          : degreeRe.test(rawText)
            ? { kind: 'spectrum', label: '완성 기준', ask: '어느 정도가 기준이에요?', ends: ['약함', '강함'] }
            : null);

        // top-level = segments[0] — 단일 흐름은 이걸 그대로 씀.
        setSquare(out.square); // 재정리면 standard도 초기화됨(새 square엔 없음)
        setTitle(out.title || rawText.slice(0, 30));
        setKeywords(out.keywords || []);
        setScalePrompt(scaleP);

        // 다중 노하우 감지(직접 등록에서만; 인박스 답변은 단일 유지) → 분리 제안.
        if (!isInboxAnswer && out.segments && out.segments.length >= 2) {
          setSegments(out.segments);
          setPending([]);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), kind: 'ai', text: `노하우 ${out.segments!.length}개가 보여요. 나눠서 등록할까요?` },
            { id: nextId(), kind: 'split' },
          ]);
          return;
        }

        // AI가 분류한 카테고리를 채택(진입점에서 잘못 고른 분류 자동 교정).
        const aiCat = out.segments?.[0]?.category ?? cat;
        if (aiCat !== cat) setCategory(aiCat);
        presentSingle(out.square, scaleP, aiCat);
      } catch (e) {
        console.warn('[coach] structure failed', e);
        setError('정리 중 문제가 생겼어요 — 다시 한 번 보내주세요.');
      } finally {
        setBusy(false);
      }
    },
    [storeId, isInboxAnswer, presentSingle],
  );

  // ── 입력 전송: 상태에 따라 (1)첫 정리 (2)꼬리질문 답 (3)재정리 ──
  const handleSend = useCallback(
    (override?: string) => {
      const value = (override ?? input).trim();
      if (!value || busy || editing) return; // 편집 중엔 카드 인라인 입력만(전송으로 정리 덮어쓰기 방지)
      setInput('');
      pushMsg({ kind: 'owner', text: value });

      // (2) 꼬리질문 답변 — AI 재호출 없이 해당 칸에 그대로 반영
      if (square && pending.length > 0 && !reStructure) {
        const [cur, ...rest] = pending;
        setSquare((sq) => (sq ? applyFollowupAnswer(sq, cur.cell, value) : sq));
        setPending(rest);
        if (rest.length > 0) {
          pushMsg({ kind: 'ai', text: rest[0].ask });
        } else if (scalePrompt) {
          // 텍스트 꼬리질문 끝 → 정도 척도질문으로
          pushMsg({ kind: 'card' });
          pushMsg({ kind: 'ai', text: scalePrompt.ask });
          pushMsg({ kind: 'scale' });
        } else {
          pushMsg({ kind: 'card' });
          pushMsg({ kind: 'ai', text: '채웠어요! 이대로 등록할까요? ✅ / ✏️' });
        }
        return;
      }

      // (1) 첫 정리  또는  (3) "다시 말하기" 후 재정리
      setReStructure(false);
      void runStructure(value, category);
    },
    [input, busy, editing, square, pending, scalePrompt, reStructure, category, runStructure, pushMsg],
  );

  // ── 기준 답변 → square.standard 에 반영(AI 재호출 0). kind별(스펙트럼 위치 / 개수) ──
  const confirmScale = useCallback(
    (value: number) => {
      const sp = scalePrompt;
      const kind = sp?.kind === 'count' ? 'count' : 'spectrum';
      setSquare((sq) =>
        sq
          ? {
              ...sq,
              standard: {
                kind,
                label: sp?.label ?? '기준',
                value,
                ...(kind === 'count'
                  ? { unit: sp?.unit ?? '개' }
                  : { ends: sp?.ends ?? ['약함', '강함'], max: 100 }),
              },
            }
          : sq,
      );
      pushMsg({ kind: 'card' });
      pushMsg({ kind: 'ai', text: '기준을 정했어요! 이대로 등록할까요? ✅ / ✏️' });
    },
    [scalePrompt, pushMsg],
  );

  const skipScale = useCallback(() => {
    setScalePrompt(null); // 기준 없음 — 척도 없이 진행
    pushMsg({ kind: 'card' });
    pushMsg({ kind: 'ai', text: '이대로 등록할까요? ✅ / ✏️' });
  }, [pushMsg]);

  // ── 분리 제안: 각각 등록 ──
  const publishEach = useCallback(() => {
    if (publishedRef.current || !segments) return;
    const entries = segments
      .filter((s) => isSquarePublishable(s.square))
      .map((s) => buildPlaybookEntryFromSquare({ ...uq, presumed_category: s.category }, s.square, { title: s.title, keywords: s.keywords }));
    if (entries.length === 0) {
      setError('등록할 내용이 부족해요. 🔁 다시 말하기로 보완해 주세요.');
      return;
    }
    publishedRef.current = true;
    if (onPublishedMany) onPublishedMany(entries);
    else entries.forEach((e) => onPublished(e));
  }, [segments, uq, onPublishedMany, onPublished]);

  // ── 분리 제안: 하나로 합치기(steps·멘트 결합 후 단일 흐름으로) ──
  const mergeOne = useCallback(() => {
    if (!segments) return;
    const steps: string[] = [];
    const scripts: string[] = [];
    const sits: string[] = [];
    const kw = new Set<string>();
    let dnt = '';
    let dOk = '';
    let unc = '';
    for (const s of segments) {
      steps.push(...s.square.action.steps);
      scripts.push(...s.square.action.scripts);
      if (s.square.situation) sits.push(s.square.situation);
      if (!dnt && s.square.extract.dont) dnt = s.square.extract.dont;
      if (!dOk && s.square.extract.do) dOk = s.square.extract.do;
      if (!unc && s.square.uncover) unc = s.square.uncover;
      s.keywords.forEach((k) => kw.add(k));
    }
    const merged: SquareBlock = {
      situation: sits.join(' / '),
      quagmire: '',
      uncover: unc,
      action: { steps: steps.slice(0, 5), scripts: scripts.slice(0, 3) },
      result: { before: '', after: '', metric: '' },
      extract: { do: dOk, dont: dnt },
    };
    const cat = segments[0].category;
    const sp = segments.find((s) => s.scalePrompt)?.scalePrompt ?? null;
    setSegments(null);
    setCategory(cat);
    setSquare(merged);
    setTitle(segments[0].title);
    setKeywords([...kw].slice(0, 8));
    setScalePrompt(sp);
    pushMsg({ kind: 'ai', text: '하나로 합쳐서 정리했어요.' });
    presentSingle(merged, sp, cat);
  }, [segments, presentSingle, pushMsg]);

  // 카테고리는 AI가 내부 판단(사용자 비노출). 사용자가 직접 바꾸는 UI 없음.

  // ── 발행 ──
  const handlePublish = useCallback(() => {
    if (publishedRef.current || !square) return;
    if (!isSquarePublishable(square)) {
      setError('할 행동이나 멘트가 하나는 있어야 등록돼요. ✏️로 한 줄만 더 채워주세요.');
      return;
    }
    publishedRef.current = true;
    // 사장이 카테고리 칩으로 바꾼 분류(category)를 발행 엔트리에 반영(D8 오분류 복구).
    // uq.presumed_category가 아니라 라이브 category로 저장 — 안 그러면 칩 변경이 무시됨.
    const entry = buildPlaybookEntryFromSquare(
      { ...uq, presumed_category: category },
      square,
      { title, keywords, photos },
    );
    onPublished(entry);
  }, [square, uq, category, title, keywords, photos, onPublished]);

  const startRetalk = useCallback(() => {
    setReStructure(true);
    setEditing(false);
    pushMsg({ kind: 'ai', text: '다시 말씀해 주세요. 방금 내용에 덧붙이거나 새로 적어도 돼요.' });
  }, [pushMsg]);

  const attachPhoto = useCallback(() => {
    pickImageWeb(async (file) => {
      setBusy(true);
      const url = await uploadPhoto(file);
      setBusy(false);
      if (url) {
        setPhotos((p) => [...p, url]);
        pushMsg({ kind: 'ai', text: '사진을 첨부했어요. 📎' });
      } else {
        setError('사진 업로드에 실패했어요 — 다시 시도해 주세요.');
      }
    });
  }, [pushMsg]);

  // 입력바는 하단에 상시 유지한다 — 리뷰 상태에서도 사장이 바로 덧붙여 말할 수 있게.
  // (리뷰 중 전송 = '다시 말하기'와 동일하게 재정리된다 → handleSend 참고.)
  // 단, 전용 입력 UI를 띄우는 동안엔 숨긴다: 카드 인라인 편집·정도 척도·분리 제안.
  const showInput = !editing && !awaitingScale && !awaitingSplit;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      {/* N명이 같은 질문 — 한 번 답하면 모두에게 반영(사회적 증거 + 효율) */}
      {isInboxAnswer && uq.similar_queries_count > 0 && (
        <View style={styles.similarBanner}>
          <Text style={styles.similarText}>
            {uq.similar_queries_count + 1}명이 같은 걸 물었어요 — 한 번만 답하면 모두에게 반영돼요
          </Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m) => {
          if (m.kind === 'owner') {
            return (
              <Appear key={m.id}>
                <UserBubble text={m.text} />
              </Appear>
            );
          }
          if (m.kind === 'alba') {
            return (
              <Appear key={m.id} style={styles.albaWrap}>
                <Text style={styles.albaLabel}>받은 질문</Text>
                <View style={styles.albaBubble}>
                  <Text style={styles.albaText}>“{m.text}”</Text>
                </View>
                {!!m.meta && <Text style={styles.albaMeta}>{m.meta}</Text>}
              </Appear>
            );
          }
          if (m.kind === 'ai') {
            return (
              <Appear key={m.id} style={styles.aiBubble}>
                <Text style={styles.aiText}>{m.text}</Text>
              </Appear>
            );
          }
          // split — 다중 노하우 분리 제안(결정하면 사라짐)
          if (m.kind === 'split') {
            if (!segments) return null;
            return (
              <Appear key={m.id} offsetY={14} duration={340}>
                <SplitProposal segments={segments} onEach={publishEach} onMerge={mergeOne} />
              </Appear>
            );
          }
          // scale — 기준 입력(답하면 정적 요약으로 굳음)
          if (m.kind === 'scale') {
            if (square?.standard) {
              const st = square.standard;
              const summary = st.kind === 'count'
                ? `${st.value}${st.unit ?? ''}`
                : st.ends
                  ? `${st.ends[0]}↔${st.ends[1]} 중 ${Math.round((st.value / (st.max || 100)) * 100)}%`
                  : `${st.value}/${st.max ?? 100}`;
              return (
                <Appear key={m.id} style={styles.aiBubble}>
                  <Text style={styles.aiText}>✅ {st.label}: {summary}</Text>
                </Appear>
              );
            }
            if (!scalePrompt) return null;
            return (
              <Appear key={m.id} offsetY={14} duration={340}>
                <ScaleBubble prompt={scalePrompt} onConfirm={confirmScale} onSkip={skipScale} />
              </Appear>
            );
          }
          // card — 항상 라이브 square를 렌더(최신 1장만 인터랙티브; 과거 카드는 동일 참조)
          if (!square) return null;
          return (
            <Appear key={m.id} offsetY={14} duration={340}>
              <MiniSquareCard
                square={square}
                title={title}
                category={category}
                editable={inReview && editing}
                showActions={inReview && !editing}
                onEdit={() => setEditing(true)}
                onDoneEditing={() => setEditing(false)}
                onRetalk={startRetalk}
                onPublish={handlePublish}
                onPatch={(sq) => setSquare(sq)}
                onTitle={setTitle}
                publishLabel={isInboxAnswer ? '이 답변 보내기' : '노하우로 저장'}
              />
            </Appear>
          );
        })}

        {busy && (
          <View style={styles.loading}>
            <ActivityIndicator color={BrandColors.brand} />
            <Text style={styles.loadingText}>AI가 정리하고 있어요...</Text>
          </View>
        )}

        {photos.length > 0 && (
          <Text style={styles.photoTag}>📎 사진 {photos.length}장 첨부됨</Text>
        )}

        <View style={{ height: 8 }} />
      </ScrollView>

      {/* 오류 배너 — 조용히 사라지지 않게, 재시도 경로 제공 */}
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => setError(null)} hitSlop={8}>
            <Text style={styles.errorClose}>✕</Text>
          </Pressable>
        </View>
      )}

      {showInput && (
        <View style={styles.inputBar}>
          <Pressable
            onPress={attachPhoto}
            hitSlop={8}
            style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="사진 첨부"
          >
            <Ionicons name="add" size={26} color={InkColors.ink2} />
          </Pressable>
          <View style={styles.inputWrap}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={pending.length > 0 ? pending[0].hint || '답을 적어주세요' : '편하게 적어주세요'}
              placeholderTextColor={InkColors.ink3}
              style={styles.input}
              editable={!busy}
              multiline
              maxLength={1000}
            />
          </View>
          <Pressable
            onPress={() => handleSend()}
            disabled={!input.trim() || busy}
            style={({ pressed }) => [
              styles.sendBtn,
              (!input.trim() || busy) && styles.sendBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
