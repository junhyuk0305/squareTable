import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { UserBubble } from '@/components/UserBubble';
import { Appear } from '@/components/Appear';
import { structureSquare, type ScalePrompt, type StructuredSegment } from '@/lib/ai';
import { type CellPath } from '@/lib/ai/categoryGuide';
import { EXTRACTION_MASTER } from '@/data/extraction-master';
import { computeFollowups, applyFollowupAnswer } from '@/lib/utils/followups';
import { buildPlaybookEntryFromSquare, isSquarePublishable } from '@/lib/utils/buildEntry';
import { getCategoryMeta } from '@/lib/utils/category';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { uploadPhoto } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

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

function formatRelative(iso: string): string {
  try {
    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    return d === 1 ? '어제' : `${d}일 전`;
  } catch {
    return '방금 전';
  }
}

/** 웹 파일 선택 → File. 네이티브는 추후 image-picker. */
function pickImageWeb(onPick: (file: File) => void) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as any).document;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}

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

  // 입력바: 리뷰 상태(꼬리질문 없음)에서는 숨기고 카드 액션으로 진행.
  // 편집 중엔 카드 인라인 입력만 쓰므로 하단 입력바도 숨긴다(정리 덮어쓰기 footgun 차단).
  const showInput = (!inReview || reStructure) && !editing && !awaitingScale && !awaitingSplit;

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
          <Pressable onPress={attachPhoto} hitSlop={8} style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}>
            <Text style={styles.attachIcon}>📎</Text>
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
      {/* 리뷰 상태에서 입력바를 숨겼을 때 하단 안내(카테고리 비노출) */}
      {!showInput && !editing && !awaitingScale && !awaitingSplit && (
        <View style={styles.reviewFootHint}>
          <Text style={styles.reviewFootSub}>카드에서 맞으면 ✅ · 고칠 건 ✏️</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/* ───────────────────────── 미니 SQUARE 카드 ───────────────────────── */
type MiniProps = {
  square: SquareBlock;
  title: string;
  category: Category;          // 내부 비계(카드 액센트 색만 사용, 라벨 비노출)
  editable: boolean;
  showActions: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
  onRetalk: () => void;
  onPublish: () => void;
  onPatch: (sq: SquareBlock) => void;
  onTitle: (t: string) => void;
  publishLabel: string;        // 발행 결과를 명시 — 인박스='이 답변 보내기' / 직접='노하우로 저장'
};

// 사용자 표면 = 상황 / 할 일 / 금지 3핵심 (+ 멘트·기준 옵션). SQUARE 글자·카테고리 칩 비노출.
function MiniSquareCard({
  square,
  title,
  category,
  editable,
  showActions,
  onEdit,
  onDoneEditing,
  onRetalk,
  onPublish,
  onPatch,
  onTitle,
  publishLabel,
}: MiniProps) {
  const meta = getCategoryMeta(category); // 액센트 색 전용(라벨 노출 안 함)
  const publishable = isSquarePublishable(square);

  const setStep = (i: number, v: string) =>
    onPatch({ ...square, action: { ...square.action, steps: square.action.steps.map((s, idx) => (idx === i ? v : s)) } });
  const setField = (patch: Partial<SquareBlock>) => onPatch({ ...square, ...patch });

  return (
    <View style={[cardStyles.card, { borderTopColor: meta.color }]}>
      {editable ? (
        <TextInput value={title} onChangeText={onTitle} style={cardStyles.titleEdit} placeholder="제목" placeholderTextColor={InkColors.ink3} />
      ) : (
        <Text style={cardStyles.title}>{title}</Text>
      )}

      {/* 상황 */}
      {(editable || !!square.situation) && (
        <Cell name="상황" color={meta.color} text={square.situation}
          editable={editable} onChange={(v) => setField({ situation: v })} />
      )}

      {/* 할 일 (+ 멘트) */}
      {(square.action.steps.length > 0 || square.action.scripts.length > 0 || editable) && (
        <View style={[cardStyles.cell, { borderLeftColor: meta.color }]}>
          <View style={cardStyles.cellHead}>
            <Text style={cardStyles.cellName}>할 일</Text>
          </View>
          {square.action.steps.map((s, i) => (
            <View key={`st-${i}`} style={cardStyles.stepRow}>
              <Text style={[cardStyles.stepNum, { color: meta.color }]}>{i + 1}</Text>
              {editable ? (
                <TextInput value={s} onChangeText={(v) => setStep(i, v)} style={cardStyles.stepEdit} multiline />
              ) : (
                <Text style={cardStyles.stepText}>{s}</Text>
              )}
            </View>
          ))}
          {square.action.scripts.map((s, i) => (
            <View key={`sc-${i}`} style={[cardStyles.scriptBox, { borderColor: meta.color }]}>
              <Text style={cardStyles.scriptMark}>💬</Text>
              <Text style={cardStyles.scriptText}>“{s}”</Text>
            </View>
          ))}
        </View>
      )}

      {/* 금지 (있을 때만 / 편집 중엔 항상) */}
      {(editable || !!square.extract.dont) && (
        <View style={[cardStyles.cell, { borderLeftColor: BrandColors.bad }]}>
          <View style={cardStyles.cellHead}>
            <Text style={[cardStyles.cellName, { color: BrandColors.bad }]}>금지</Text>
          </View>
          {editable ? (
            <TextInput value={square.extract.dont} onChangeText={(v) => setField({ extract: { ...square.extract, dont: v } })}
              style={cardStyles.stepEdit} placeholder="절대 하면 안 되는 것 (선택)" placeholderTextColor={InkColors.ink3} />
          ) : (
            <Text style={cardStyles.cellText}>{square.extract.dont}</Text>
          )}
        </View>
      )}

      {/* 기준 — square.standard 있을 때만. count=개수칩 / spectrum=위치바 / 구형=게이지 */}
      {square.standard && (() => {
        const st = square.standard;
        if (st.kind === 'count') {
          return (
            <View style={cardStyles.gaugeBox}>
              <View style={cardStyles.gaugeHead}>
                <Text style={cardStyles.gaugeLabel}>{st.label}</Text>
                <Text style={cardStyles.gaugeVal}>{st.value}{st.unit ?? ''}</Text>
              </View>
            </View>
          );
        }
        const pct = Math.max(0, Math.min(100, Math.round((st.value / (st.max || 100)) * 100)));
        return (
          <View style={cardStyles.gaugeBox}>
            <Text style={cardStyles.gaugeLabel}>{st.label}</Text>
            <View style={cardStyles.gaugeTrack}>
              <View style={[cardStyles.gaugeFill, { width: `${pct}%` }]} />
              {st.ends ? <View style={[cardStyles.gaugeKnob, { left: `${pct}%` }]} /> : null}
            </View>
            {st.ends ? (
              <View style={cardStyles.gaugeEnds}>
                <Text style={cardStyles.gaugeEndTxt}>{st.ends[0]}</Text>
                <Text style={cardStyles.gaugeEndTxt}>{st.ends[1]}</Text>
              </View>
            ) : (
              <Text style={cardStyles.gaugeVal}>{st.value}/{st.max ?? 100}</Text>
            )}
          </View>
        );
      })()}

      {/* 액션 행 */}
      {showActions && (
        <View style={cardStyles.actionRow}>
          <Pressable onPress={onEdit} style={({ pressed }) => [cardStyles.editBtn, pressed && { opacity: 0.7 }]}>
            <Text style={cardStyles.editText}>✏️ 고칠래요</Text>
          </Pressable>
          <Pressable onPress={onRetalk} style={({ pressed }) => [cardStyles.editBtn, pressed && { opacity: 0.7 }]}>
            <Text style={cardStyles.editText}>🔁 다시 말하기</Text>
          </Pressable>
          <Pressable
            onPress={onPublish}
            disabled={!publishable}
            style={({ pressed }) => [cardStyles.okBtn, { backgroundColor: meta.color, opacity: !publishable ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            <Text style={cardStyles.okText}>✅ {publishLabel}</Text>
          </Pressable>
        </View>
      )}

      {editable && (
        <Pressable onPress={onDoneEditing} style={({ pressed }) => [cardStyles.doneBtn, { backgroundColor: meta.color }, pressed && { opacity: 0.85 }]}>
          <Text style={cardStyles.okText}>수정 완료</Text>
        </Pressable>
      )}
    </View>
  );
}

function Cell({ name, color, text, editable, onChange }: {
  name: string; color: string; text: string;
  editable?: boolean; onChange?: (v: string) => void;
}) {
  return (
    <View style={[cardStyles.cell, { borderLeftColor: color }]}>
      <View style={cardStyles.cellHead}>
        <Text style={cardStyles.cellName}>{name}</Text>
      </View>
      {editable ? (
        <TextInput value={text} onChangeText={onChange} style={cardStyles.stepEdit} multiline placeholder="(비워둬도 돼요)" placeholderTextColor={InkColors.ink3} />
      ) : (
        <Text style={cardStyles.cellText}>{text}</Text>
      )}
    </View>
  );
}

/* ───────────────────────── 다중 노하우 분리 제안 ───────────────────────── */
function SplitProposal({ segments, onEach, onMerge }: { segments: StructuredSegment[]; onEach: () => void; onMerge: () => void }) {
  return (
    <View style={splitStyles.box}>
      <Text style={splitStyles.head}>이렇게 {segments.length}개로 나눌 수 있어요</Text>
      <View style={{ gap: 8 }}>
        {segments.map((s, i) => {
          const m = getCategoryMeta(s.category);
          return (
            <View key={i} style={[splitStyles.item, { borderLeftColor: m.color }]}>
              <View style={[splitStyles.itemChip, { backgroundColor: m.color }]}>
                <Text style={splitStyles.itemChipText}>{m.emoji} {m.label}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={splitStyles.itemTitle} numberOfLines={1}>{s.title || `노하우 ${i + 1}`}</Text>
                <Text style={splitStyles.itemSub} numberOfLines={1}>
                  {s.square.action.steps.length > 0 ? `${s.square.action.steps.length}단계` : s.square.situation || '내용'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={splitStyles.actions}>
        <Pressable onPress={onMerge} style={({ pressed }) => [splitStyles.mergeBtn, pressed && { opacity: 0.7 }]}>
          <Text style={splitStyles.mergeTxt}>하나로 합치기</Text>
        </Pressable>
        <Pressable onPress={onEach} style={({ pressed }) => [splitStyles.eachBtn, pressed && { opacity: 0.85 }]}>
          <Text style={splitStyles.eachTxt}>각각 등록 ({segments.length}개)</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ───────────────────────── 기준 입력 (스펙트럼 / 개수) ───────────────────────── */
// kind=count: 단위(unit) 개수 스테퍼. kind=spectrum(기본): 양끝(ends) 사이 위치 슬라이더(0~100).
function ScaleBubble({ prompt, onConfirm, onSkip }: { prompt: ScalePrompt; onConfirm: (v: number) => void; onSkip: () => void }) {
  const isCount = prompt.kind === 'count';
  const ends = prompt.ends ?? ['약함', '강함'];
  const unit = prompt.unit ?? '개';
  const [val, setVal] = useState<number>(isCount ? 1 : 50);
  const pct = Math.max(0, Math.min(100, val));

  return (
    <View style={scaleStyles.box}>
      {isCount ? (
        <>
          <View style={scaleStyles.stepRow}>
            <Pressable onPress={() => setVal((v) => Math.max(0, v - 1))} style={({ pressed }) => [scaleStyles.stepBtnLg, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxtLg}>−</Text>
            </Pressable>
            <Text style={scaleStyles.countVal}>{val}<Text style={scaleStyles.countUnit}> {unit}</Text></Text>
            <Pressable onPress={() => setVal((v) => Math.min(99, v + 1))} style={({ pressed }) => [scaleStyles.stepBtnLg, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxtLg}>＋</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={scaleStyles.track}>
            <View style={[scaleStyles.fill, { width: `${pct}%` }]} />
            <View style={[scaleStyles.knob, { left: `${pct}%` }]} />
          </View>
          <View style={scaleStyles.endsRow}>
            <Text style={scaleStyles.endTxt}>{ends[0]}</Text>
            <Text style={scaleStyles.endTxt}>{ends[1]}</Text>
          </View>
          <View style={scaleStyles.stepRow}>
            <Pressable onPress={() => setVal((v) => Math.max(0, v - 10))} style={({ pressed }) => [scaleStyles.stepBtn, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxt}>◀ {ends[0]} 쪽</Text>
            </Pressable>
            <Pressable onPress={() => setVal((v) => Math.min(100, v + 10))} style={({ pressed }) => [scaleStyles.stepBtn, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxt}>{ends[1]} 쪽 ▶</Text>
            </Pressable>
          </View>
        </>
      )}
      <View style={scaleStyles.actions}>
        <Pressable onPress={onSkip} style={({ pressed }) => [scaleStyles.skipBtn, pressed && { opacity: 0.7 }]}>
          <Text style={scaleStyles.skipTxt}>기준 없음</Text>
        </Pressable>
        <Pressable onPress={() => onConfirm(val)} style={({ pressed }) => [scaleStyles.okBtn, pressed && { opacity: 0.85 }]}>
          <Text style={scaleStyles.okTxt}>이 기준으로 ✅</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 4, gap: 14 },

  similarBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
  },
  similarText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  albaWrap: { gap: 4, alignItems: 'flex-start', maxWidth: '90%' },
  albaLabel: { fontSize: 11, fontWeight: '800', color: BrandColors.accent, letterSpacing: 0.5 },
  albaBubble: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    borderTopLeftRadius: Radius.tail,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...Elevation.e1,
  },
  albaText: { fontSize: 15, color: InkColors.ink, fontStyle: 'italic', lineHeight: 22 },
  albaMeta: { fontSize: 11, color: InkColors.ink3, fontWeight: '500' },

  aiBubble: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderTopLeftRadius: Radius.tail,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  aiText: { fontSize: 14.5, color: InkColors.ink2, lineHeight: 21, fontWeight: '500' },

  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4 },
  loadingText: { fontSize: 13, color: InkColors.ink2, fontWeight: '600' },

  photoTag: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', paddingHorizontal: 4 },

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
  errorClose: { fontSize: 14, fontWeight: '800', color: BrandColors.accent },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  attachBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  attachIcon: { fontSize: 20 },
  inputWrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    backgroundColor: InkColors.bg,
    minHeight: 44,
    maxHeight: 120,
    justifyContent: 'center',
  },
  input: { fontSize: 15, color: InkColors.ink, paddingVertical: Platform.OS === 'ios' ? 10 : 6 },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: InkColors.line },
  sendIcon: { fontSize: 22, color: InkColors.bubbleText, fontWeight: '900', lineHeight: 24 },

  reviewFootHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  reviewFootText: { fontSize: 14, fontWeight: '800' },
  reviewFootSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderTopWidth: 4,
    padding: 14,
    gap: 10,
    ...Elevation.e1,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink2 },

  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },
  titleEdit: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, fontWeight: '700', color: InkColors.ink, backgroundColor: InkColors.bg,
  },

  cell: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cellLetter: { fontSize: 15, fontWeight: '900' },
  cellName: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 },
  cellText: { fontSize: 14.5, color: InkColors.ink, lineHeight: 21 },

  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: { fontSize: 15, fontWeight: '900', minWidth: 16 },
  stepText: { flex: 1, fontSize: 14.5, color: InkColors.ink, lineHeight: 21 },
  stepEdit: {
    flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 6, fontSize: 14.5, color: InkColors.ink, backgroundColor: InkColors.bg,
  },
  scriptBox: {
    flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 2, backgroundColor: InkColors.bg,
  },
  scriptMark: { fontSize: 14 },
  scriptText: { flex: 1, fontSize: 14, color: InkColors.ink, fontStyle: 'italic', lineHeight: 20 },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  editBtn: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  editText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  okBtn: { flex: 1, minWidth: 96, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  okText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
  doneBtn: { paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },

  // 정도 기준 게이지(노란 바)
  gaugeBox: { gap: 6, paddingVertical: 2 },
  gaugeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  gaugeLabel: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  gaugeVal: { fontSize: 14, fontWeight: '900', color: InkColors.ink },
  gaugeTrack: { height: 10, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, position: 'relative', justifyContent: 'center' },
  gaugeFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  gaugeKnob: { position: 'absolute', top: -4, width: 18, height: 18, borderRadius: Radius.pill, backgroundColor: InkColors.ink, borderWidth: 3, borderColor: BrandColors.yellow, marginLeft: -9 },
  gaugeEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  gaugeEndTxt: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink3 },
});

const splitStyles = StyleSheet.create({
  box: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderTopWidth: 4,
    borderTopColor: BrandColors.yellowDeep,
    padding: 16,
    gap: 12,
    ...Elevation.e1,
  },
  head: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 4,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: InkColors.bg,
  },
  itemChip: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.pill },
  itemChipText: { fontSize: 10.5, fontWeight: '800', color: InkColors.bubbleText },
  itemTitle: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  itemSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  mergeBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  mergeTxt: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  eachBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.ink },
  eachTxt: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});

const scaleStyles = StyleSheet.create({
  box: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderTopWidth: 4,
    borderTopColor: BrandColors.yellowDeep,
    padding: 16,
    gap: 12,
    ...Elevation.e1,
  },
  // 스펙트럼
  track: { height: 14, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, position: 'relative', justifyContent: 'center' },
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  knob: { position: 'absolute', top: -5, width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: InkColors.ink, borderWidth: 3, borderColor: BrandColors.yellow, marginLeft: -12 },
  endsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  endTxt: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stepBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  stepTxt: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  // 개수
  stepBtnLg: { width: 48, height: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  stepTxtLg: { fontSize: 24, fontWeight: '900', color: InkColors.ink },
  countVal: { fontSize: 34, fontWeight: '900', color: InkColors.ink, minWidth: 96, textAlign: 'center' },
  countUnit: { fontSize: 15, fontWeight: '700', color: InkColors.ink3 },
  actions: { flexDirection: 'row', gap: 8 },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  skipTxt: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  okBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.ink },
  okTxt: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
