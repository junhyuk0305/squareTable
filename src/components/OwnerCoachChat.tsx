import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { UserBubble } from '@/components/UserBubble';
import { Appear } from '@/components/Appear';
import { structureSquare } from '@/lib/ai';
import { getCategoryGuide, type CellPath } from '@/lib/ai/categoryGuide';
import { computeFollowups, applyFollowupAnswer } from '@/lib/utils/followups';
import { buildPlaybookEntryFromSquare, isSquarePublishable } from '@/lib/utils/buildEntry';
import { getCategoryMeta, ALL_CATEGORIES } from '@/lib/utils/category';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { uploadPhoto } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';

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
};

type MsgInput =
  | { kind: 'alba'; text: string; meta?: string }   // 알바 질문(인박스)
  | { kind: 'owner'; text: string }                  // 사장 발화
  | { kind: 'ai'; text: string }                     // 점장AI 안내/꼬리질문
  | { kind: 'card' };                                // 미니 SQUARE 카드(라이브 square 렌더)
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
}: OwnerCoachChatProps) {
  const userName = useSessionStore((s) => s.userName);

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reStructure, setReStructure] = useState(false); // "다시 말하기" — 다음 발화는 재정리

  const lastRawRef = useRef('');     // 카테고리 변경 시 재정리에 쓸 원문
  const publishedRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const unitId = useSessionStore.getState().unitId;
  const storeId = unitId || 'store_001';

  const inReview = square !== null && pending.length === 0;

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, busy, pending.length, editing]);

  const pushMsg = useCallback((m: MsgInput) => {
    setMessages((prev) => [...prev, { ...m, id: nextId() }]);
  }, []);

  // ── AI 1콜: 원문 → SQUARE 6칸. 실패해도 mock 폴백(client.ts) → error는 드묾. ──
  const runStructure = useCallback(
    async (rawText: string, cat: Category) => {
      setBusy(true);
      setError(null);
      try {
        const out = await structureSquare({
          storeId,
          rawText,
          category: cat,
          categoryGuide: getCategoryGuide(cat).extractionGuide,
        });
        lastRawRef.current = rawText;
        setSquare(out.square);
        setTitle(out.title || rawText.slice(0, 30));
        setKeywords(out.keywords || []);

        const followups = computeFollowups(out.square, cat);
        // 카드 먼저 보여주고, 빈 칸이 있으면 꼬리질문 1개씩 띄운다.
        setMessages((prev) => {
          const withCard: Msg[] = [...prev, { id: nextId(), kind: 'card' }];
          if (followups.length > 0) {
            return [...withCard, { id: nextId(), kind: 'ai', text: followups[0].ask }];
          }
          return [...withCard, { id: nextId(), kind: 'ai', text: '이대로 등록할까요? 맞으면 ✅, 고칠 게 있으면 ✏️ 눌러주세요.' }];
        });
        setPending(followups);
      } catch (e) {
        console.warn('[coach] structure failed', e);
        setError('정리 중 문제가 생겼어요 — 다시 한 번 보내주세요.');
      } finally {
        setBusy(false);
      }
    },
    [storeId],
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
    [input, busy, editing, square, pending, reStructure, category, runStructure, pushMsg],
  );

  // ── 카테고리 변경 → 같은 원문을 새 가이드로 재정리(AI 1콜). (설계 D8) ──
  const changeCategory = useCallback(
    (cat: Category) => {
      if (cat === category) return;
      setCategory(cat);
      setEditing(false);
      if (lastRawRef.current) {
        pushMsg({ kind: 'ai', text: `'${getCategoryMeta(cat).label}'(으)로 다시 정리할게요.` });
        void runStructure(lastRawRef.current, cat);
      }
    },
    [category, runStructure, pushMsg],
  );

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

  const meta = getCategoryMeta(category);
  // 입력바: 리뷰 상태(꼬리질문 없음)에서는 숨기고 카드 액션으로 진행.
  // 편집 중엔 카드 인라인 입력만 쓰므로 하단 입력바도 숨긴다(정리 덮어쓰기 footgun 차단).
  const showInput = (!inReview || reStructure) && !editing;

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
              categoryLocked={!inReview || editing}
              onChangeCategory={changeCategory}
              onEdit={() => setEditing(true)}
              onDoneEditing={() => setEditing(false)}
              onRetalk={startRetalk}
              onPublish={handlePublish}
                onPatch={(sq) => setSquare(sq)}
                onTitle={setTitle}
              />
            </Appear>
          );
        })}

        {busy && (
          <View style={styles.loading}>
            <ActivityIndicator color={BrandColors.brand} />
            <Text style={styles.loadingText}>점장 AI가 정리하고 있어요...</Text>
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
      {/* 리뷰 상태에서 입력바를 숨겼을 때, 카테고리 라벨을 하단에 슬쩍 노출(맥락 유지) */}
      {!showInput && !editing && (
        <View style={styles.reviewFootHint}>
          <Text style={[styles.reviewFootText, { color: meta.color }]}>{meta.emoji} {meta.label}</Text>
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
  category: Category;
  editable: boolean;
  showActions: boolean;
  categoryLocked: boolean;
  onChangeCategory: (c: Category) => void;
  onEdit: () => void;
  onDoneEditing: () => void;
  onRetalk: () => void;
  onPublish: () => void;
  onPatch: (sq: SquareBlock) => void;
  onTitle: (t: string) => void;
};

function MiniSquareCard({
  square,
  title,
  category,
  editable,
  showActions,
  categoryLocked,
  onChangeCategory,
  onEdit,
  onDoneEditing,
  onRetalk,
  onPublish,
  onPatch,
  onTitle,
}: MiniProps) {
  const meta = getCategoryMeta(category);
  const hasResult = !!(square.result.before || square.result.after || square.result.metric);
  const hasExtract = !!(square.extract.do || square.extract.dont || square.extract.template);
  const publishable = isSquarePublishable(square);

  const setStep = (i: number, v: string) =>
    onPatch({ ...square, action: { ...square.action, steps: square.action.steps.map((s, idx) => (idx === i ? v : s)) } });
  const setField = (patch: Partial<SquareBlock>) => onPatch({ ...square, ...patch });

  return (
    <View style={[cardStyles.card, { borderTopColor: meta.color }]}>
      {/* 카테고리 칩 행 — 오분류 1탭 변경(D8). 정리 완료(리뷰) 상태에서만 변경 허용. */}
      <View style={cardStyles.chipRow}>
        {ALL_CATEGORIES.map((c) => {
          const m = getCategoryMeta(c);
          const on = c === category;
          const dim = categoryLocked && !on;
          return (
            <Pressable
              key={c}
              disabled={categoryLocked}
              onPress={() => onChangeCategory(c)}
              style={[cardStyles.chip, on && { backgroundColor: m.color, borderColor: m.color }, dim && { opacity: 0.45 }]}
            >
              <Text style={[cardStyles.chipText, on && { color: '#FFFFFF' }]}>{m.emoji} {m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {editable ? (
        <TextInput value={title} onChangeText={onTitle} style={cardStyles.titleEdit} placeholder="제목" placeholderTextColor={InkColors.ink3} />
      ) : (
        <Text style={cardStyles.title}>{title}</Text>
      )}

      {/* S 상황 */}
      <Cell letter="S" name="상황" color={meta.color} text={square.situation}
        editable={editable} onChange={(v) => setField({ situation: v })} />

      {/* Q 곤란(있을 때만 / 편집 중엔 항상) */}
      {(editable || !!square.quagmire) && (
        <Cell letter="Q" name="이런 게 어려워요" color={meta.color} text={square.quagmire}
          editable={editable} onChange={(v) => setField({ quagmire: v })} />
      )}

      {/* U 진짜 이유 */}
      {(editable || !!square.uncover) && (
        <Cell letter="U" name="진짜 이유" color={meta.color} text={square.uncover}
          editable={editable} onChange={(v) => setField({ uncover: v })} />
      )}

      {/* A 행동 + 멘트 */}
      {(square.action.steps.length > 0 || square.action.scripts.length > 0 || editable) && (
        <View style={[cardStyles.cell, { borderLeftColor: meta.color }]}>
          <View style={cardStyles.cellHead}>
            <Text style={[cardStyles.cellLetter, { color: meta.color }]}>A</Text>
            <Text style={cardStyles.cellName}>이렇게 하세요</Text>
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

      {/* R 결과 */}
      {hasResult && !editable && (
        <Cell letter="R" name="결과" color={meta.color}
          text={[square.result.before && `전: ${square.result.before}`, square.result.after && `후: ${square.result.after}`, square.result.metric].filter(Boolean).join(' · ')} />
      )}

      {/* E 핵심 */}
      {(hasExtract || editable) && (
        <View style={[cardStyles.cell, { borderLeftColor: meta.color }]}>
          <View style={cardStyles.cellHead}>
            <Text style={[cardStyles.cellLetter, { color: meta.color }]}>E</Text>
            <Text style={cardStyles.cellName}>핵심 O / X</Text>
          </View>
          {editable ? (
            <>
              <TextInput value={square.extract.do} onChangeText={(v) => setField({ extract: { ...square.extract, do: v } })}
                style={cardStyles.stepEdit} placeholder="O 꼭 이것 (선택)" placeholderTextColor={InkColors.ink3} />
              <TextInput value={square.extract.dont} onChangeText={(v) => setField({ extract: { ...square.extract, dont: v } })}
                style={cardStyles.stepEdit} placeholder="X 하지 말 것 (선택)" placeholderTextColor={InkColors.ink3} />
            </>
          ) : (
            <Text style={cardStyles.cellText}>
              {[square.extract.do && `O ${square.extract.do}`, square.extract.dont && `X ${square.extract.dont}`, square.extract.template].filter(Boolean).join('\n')}
            </Text>
          )}
        </View>
      )}

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
            <Text style={cardStyles.okText}>✅ 맞아요</Text>
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

function Cell({ letter, name, color, text, editable, onChange }: {
  letter: string; name: string; color: string; text: string;
  editable?: boolean; onChange?: (v: string) => void;
}) {
  return (
    <View style={[cardStyles.cell, { borderLeftColor: color }]}>
      <View style={cardStyles.cellHead}>
        <Text style={[cardStyles.cellLetter, { color }]}>{letter}</Text>
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

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 4, gap: 14 },

  similarBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
  },
  similarText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  albaWrap: { gap: 4, alignItems: 'flex-start', maxWidth: '90%' },
  albaLabel: { fontSize: 11, fontWeight: '800', color: BrandColors.accent, letterSpacing: 0.5 },
  albaBubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  albaText: { fontSize: 15, color: InkColors.ink, fontStyle: 'italic', lineHeight: 22 },
  albaMeta: { fontSize: 11, color: InkColors.ink3, fontWeight: '500' },

  aiBubble: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: InkColors.bgSoft,
    borderRadius: 14,
    borderTopLeftRadius: 4,
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
    borderRadius: 12,
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  attachBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  attachIcon: { fontSize: 20 },
  inputWrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    minHeight: 44,
    maxHeight: 120,
    justifyContent: 'center',
  },
  input: { fontSize: 15, color: InkColors.ink, paddingVertical: Platform.OS === 'ios' ? 10 : 6 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: InkColors.line },
  sendIcon: { fontSize: 22, color: '#FFFFFF', fontWeight: '900', lineHeight: 24 },

  reviewFootHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  reviewFootText: { fontSize: 14, fontWeight: '800' },
  reviewFootSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderTopWidth: 4,
    padding: 14,
    gap: 10,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: '#FFFFFF',
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink2 },

  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },
  titleEdit: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, fontWeight: '700', color: InkColors.ink, backgroundColor: '#FFFFFF',
  },

  cell: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
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
    flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, fontSize: 14.5, color: InkColors.ink, backgroundColor: '#FFFFFF',
  },
  scriptBox: {
    flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 2, backgroundColor: '#FFFFFF',
  },
  scriptMark: { fontSize: 14 },
  scriptText: { flex: 1, fontSize: 14, color: InkColors.ink, fontStyle: 'italic', lineHeight: 20 },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  editBtn: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  editText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  okBtn: { flex: 1, minWidth: 96, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  okText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  doneBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
