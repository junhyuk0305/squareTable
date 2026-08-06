import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { QUIZ_RENDERERS } from '@/components/work/quiz';
import { generateQuiz } from '@/lib/ai/client';
import { fetchQuizItemsForAttempt, gradeQuiz, recordQuizStats, insertQuizAttempts } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizInput, QuizQuestion } from '@/lib/ai/types';
import type { QuizGrade, QuizItem, QuizResponse } from '@/lib/quiz/types';

type Phase = 'loading' | 'quiz' | 'result' | 'empty' | 'quota';

/**
 * 저장된 문항이 0개일 때 AI 즉석 생성으로 폴백할지 — **끈다**(2026-08-04 결정: 검수된 문항만 내보낸다).
 * 즉석 생성은 사장이 검수한 적 없는 문제가 직원에게 나가는 유일한 경로였다. 이제 낼 문항이 있는
 * 업무만 카드에 오르므로(0109) 여기 도달하는 건 "있다고 봤는데 실제로는 못 쓴다"는 예외 상황뿐이고,
 * 그 자리에서 문제를 지어내는 것보다 준비 중이라고 말하는 편이 정직하다.
 * 아래 LegacyQuizBody 는 남겨 둔다 — 되돌릴 땐 이 값 하나만 true 로.
 */
const ALLOW_AI_FALLBACK: boolean = false;

/**
 * UnderstandingCheckSheet — "이 업무 혼자 할 수 있어요" 자청 시 뜨는 이해 확인 퀴즈(S1 ④).
 * 자발·페널티 0·재시도 자유·실패는 사장에게 안 감.
 *
 * 경로가 둘이다.
 *  ① 저장된 문항(0107 quiz_items) — 형태별 렌더러로 풀고 **채점은 서버**(grade_quiz).
 *     응시용 payload 에는 정답이 없다. AI 호출도 0이라 월 한도를 안 먹는다.
 *  ② 폴백: 저장된 문항이 0개인 경우. 예전엔 AI 즉석 생성이었으나 지금은 안내만 한다(아래 상수).
 */
export function UnderstandingCheckSheet({
  title,
  sops,
  onPass,
  onClose,
}: {
  /** 무엇에 대한 확인인가 — 카드에서 오면 노하우 제목, 할일에서 오면 업무 이름. */
  title: string;
  sops: QuizInput['sops'];
  /** 실제로 푼 문항이 근거한 **노하우 id 들**만 통과 처리한다(0111). */
  onPass: (entryIds: string[]) => void;
  onClose: () => void;
}) {
  // 재시도 = QuizBody 리마운트(key) → 새 문제·초기상태. 이펙트에서 동기 리셋(set-state-in-effect) 회피.
  const [round, setRound] = useState(0);
  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '84%' }}>
      <View style={s.head}>
        <Text style={s.kicker}>이해 확인 · {title}</Text>
        <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={20} color={InkColors.ink2} /></Pressable>
      </View>
      <QuizBody key={round} taskText={title} sops={sops} onPass={onPass} onClose={onClose} onRetry={() => setRound((r) => r + 1)} />
    </BottomSheet>
  );
}

/** 시작 전 분량·소요 시간 고지(레퍼런스 home_05) — 부담을 미리 계산할 수 있게 한다.
 *  추정은 문항당 20초(설계 07-29 §04 "30초 안에 끝난다"보다 보수적으로 잡되 올림). */
function minutesFor(n: number): number {
  return Math.max(1, Math.ceil((n * 20) / 60));
}

/** 어느 경로로 갈지 한 번만 정한다 — 저장된 문항이 있으면 ①, 없으면 ②(AI 즉석 생성). */
function QuizBody(props: {
  taskText: string;
  sops: QuizInput['sops'];
  onPass: (entryIds: string[]) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { sops } = props;
  // 근거 노하우 id 가 하나도 없으면 조회할 게 없다 → 처음부터 폴백으로 시작(이펙트에서 동기 setState 회피).
  const entryIds = useMemo(() => sops.map((sop) => sop.id).filter((id): id is string => !!id), [sops]);
  const [route, setRoute] = useState<'probe' | 'saved' | 'legacy'>(entryIds.length > 0 ? 'probe' : 'legacy');
  const [items, setItems] = useState<QuizItem[]>([]);
  // 시작 고지를 본 뒤에만 문제로 넘어간다 — 분량·시간을 모른 채 시작하게 두지 않는다.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let alive = true;
    if (entryIds.length === 0) return;
    fetchQuizItemsForAttempt(entryIds, 3)
      .then(({ data }) => {
        if (!alive) return;
        // 아직 렌더러가 없는 형태(레지스트리 미등록)는 거른다 — 빈 화면 대신 폴백으로 간다.
        const usable = (data ?? []).filter((it) => !!QUIZ_RENDERERS[it.format]);
        if (usable.length > 0) {
          setItems(usable);
          setRoute('saved');
        } else {
          setRoute('legacy');
        }
      })
      .catch(() => {
        if (alive) setRoute('legacy');
      });
    return () => {
      alive = false;
    };
  }, [entryIds]);

  if (route === 'probe') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={s.centerText}>문제를 가져오는 중...</Text>
      </View>
    );
  }
  if (route === 'saved') {
    if (!started) {
      return (
        <>
          <View style={s.center}>
            <Text style={s.startLead}>문제 {items.length}개 · {minutesFor(items.length)}분 정도</Text>
            <Text style={s.centerText}>틀려도 괜찮아요. 언제든 다시 할 수 있어요.</Text>
          </View>
          <View style={s.foot}>
            <Pressable onPress={() => setStarted(true)} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Text style={s.ctaText}>퀴즈 시작하기</Text>
            </Pressable>
          </View>
        </>
      );
    }
    return <SavedQuizBody items={items} onPass={props.onPass} onClose={props.onClose} onRetry={props.onRetry} />;
  }
  return ALLOW_AI_FALLBACK ? <LegacyQuizBody {...props} /> : <NotReadyBody onClose={props.onClose} />;
}

/** 낼 문항이 없어 응시가 성립하지 않을 때 — 지어내지 않고 그대로 말한다. */
function NotReadyBody({ onClose }: { onClose: () => void }) {
  return (
    <View style={s.center}>
      <Text style={s.noticeText}>아직 이 업무의 퀴즈가 준비되지 않았어요.{'\n'}사장님이 문제를 만들면 여기에 떠요.</Text>
      <Pressable onPress={onClose} style={s.softBtn}><Text style={s.softBtnText}>닫기</Text></Pressable>
    </View>
  );
}

// ── ① 저장된 문항 경로 ────────────────────────────────────────────────────────
/**
 * 한 번에 한 문항. 답을 내면 즉시 서버가 채점하고 그 자리에서 결과가 보인다(설계 07-29 §04 규칙 4).
 * 채점이 실패하면 오답으로 치지 않는다 — 답을 들고 있다가 다시 보낸다(규칙 6: 막지 않는다).
 */
function SavedQuizBody({
  items,
  onPass,
  onClose,
  onRetry,
}: {
  items: QuizItem[];
  onPass: (entryIds: string[]) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [at, setAt] = useState(0);
  const [pending, setPending] = useState<QuizResponse | null>(null);
  const [grade, setGrade] = useState<QuizGrade | null>(null);
  const [grading, setGrading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);

  const item = items[at];

  const send = async (itemId: string, res: QuizResponse) => {
    setGrading(true);
    setFailed(false);
    const { data } = await gradeQuiz(itemId, res);
    setGrading(false);
    if (!data) {
      setFailed(true);
      return;
    }
    setGrade(data);
    setResults((prev) => [...prev, data.correct]);
  };

  const answer = (res: QuizResponse) => {
    setPending(res);
    void send(item.id, res);
  };

  const finish = (marks: boolean[]) => {
    // 문항이 근거한 노하우별로 집계한다(entry_ids 가 배열이라 한 문항이 여러 건에 걸린다).
    // 같은 집계가 두 곳으로 간다:
    //  ① 매장 오답 통계(0103) — 누가 틀렸는지는 안 남긴다. "노하우 글이 헷갈리나"의 신호.
    //  ② 응시 단위 점수(0112) — 누가 몇 개 중 몇 개인지. 문항별로 무엇을 틀렸는지는 안 남긴다.
    const byEntry = new Map<string, { attempts: number; misses: number }>();
    items.slice(0, marks.length).forEach((it, i) => {
      for (const entryId of it.entry_ids ?? []) {
        const cur = byEntry.get(entryId) ?? { attempts: 0, misses: 0 };
        cur.attempts += 1;
        if (!marks[i]) cur.misses += 1;
        byEntry.set(entryId, cur);
      }
    });
    const perEntry = [...byEntry].map(([entryId, v]) => ({ entryId, ...v }));
    void recordQuizStats(perEntry);
    void insertQuizAttempts(perEntry.map((e) => ({ entryId: e.entryId, total: e.attempts, correct: e.attempts - e.misses })));
    // 통과 기준은 그대로 — 전부 맞아야 통과. 통과 처리 대상은 **실제로 푼 문항의 근거 노하우**뿐이다
    // (0111: 다루지 않은 노하우까지 "안다"로 켜지 않는다).
    if (marks.length === items.length && marks.every(Boolean)) onPass(perEntry.map((e) => e.entryId));
    setDone(true);
  };

  const next = () => {
    if (at + 1 < items.length) {
      setAt(at + 1);
      setPending(null);
      setGrade(null);
      setFailed(false);
      return;
    }
    finish(results);
  };

  if (done) {
    const correctCount = results.filter(Boolean).length;
    const passed = correctCount === items.length;
    return (
      <>
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: Space.gutter }} showsVerticalScrollIndicator={false}>
          <View style={[s.resultBox, passed ? s.resultPass : s.resultFail]}>
            <Ionicons name={passed ? 'ribbon' : 'refresh-circle'} size={22} color={passed ? BrandColors.good : BrandColors.warn} />
            <Text style={s.resultText}>
              {passed ? '이해 확인이 끝났어요. 사장님께 전달됐어요.' : `${items.length}개 중 ${correctCount}개 맞았어요. 다시 해볼까요?`}
            </Text>
          </View>
        </ScrollView>
        <View style={s.foot}>
          {passed ? (
            <Pressable onPress={onClose} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}><Text style={s.ctaText}>닫기</Text></Pressable>
          ) : (
            <View style={s.footRow}>
              <Pressable onPress={onClose} style={({ pressed }) => [s.softBtnFlat, pressed && { opacity: 0.7 }]}><Text style={s.softBtnFlatText}>닫기</Text></Pressable>
              <Pressable onPress={onRetry} style={({ pressed }) => [s.cta, { flex: 1 }, pressed && { opacity: 0.85 }]}><Text style={s.ctaText}>다시 하기</Text></Pressable>
            </View>
          )}
        </View>
      </>
    );
  }

  if (!item) return null;
  const Renderer = QUIZ_RENDERERS[item.format];
  const ask = typeof item.payload?.ask === 'string' ? item.payload.ask : '';

  return (
    <>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: Space.gutter }} showsVerticalScrollIndicator={false}>
        {/* 완료가 아니라 잔여를 센다(레퍼런스 leveltest_05) — 0이 되는 순간 화면이 끝나므로 0 전시가 없다. */}
        <Text style={s.step}>{items.length - at}문제 남았어요</Text>
        {ask ? <Text style={s.ask}>{ask}</Text> : null}

        <Renderer
          key={item.id}
          payload={item.payload ?? {}}
          disabled={grading || pending !== null}
          result={grade ? { correct: grade.correct, answer: grade.answer } : null}
          onAnswer={answer}
        />

        {grade ? (
          <View style={[s.gradeBox, grade.correct ? s.resultPass : s.resultFail]}>
            <Text style={s.gradeTitle}>{grade.correct ? '맞았어요' : '이건 이렇게 해요'}</Text>
            {grade.explain ? <Text style={s.gradeText}>{grade.explain}</Text> : null}
          </View>
        ) : null}

        {failed ? (
          <View style={s.gradeBox}>
            <Text style={s.gradeTitle}>지금은 채점이 안 됐어요</Text>
            <Text style={s.gradeText}>답은 그대로 있어요. 잠시 후 다시 보내면 돼요.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={s.foot}>
        {grading ? (
          <View style={s.footWait}>
            <ActivityIndicator color={InkColors.ink3} />
            <Text style={s.footWaitText}>채점하는 중...</Text>
          </View>
        ) : failed ? (
          <Pressable
            onPress={() => pending !== null && void send(item.id, pending)}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.ctaText}>다시 보내기</Text>
          </Pressable>
        ) : grade ? (
          <Pressable onPress={next} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}>
            <Text style={s.ctaText}>{at + 1 < items.length ? '다음 문제' : '결과 보기'}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

// ── ② 폴백: AI 즉석 생성 경로(하위호환) ────────────────────────────────────────
/** 저장된 문항이 아직 없는 매장용. 붙은 노하우로 AI가 4지선다를 만들고 앱이 채점한다(기존 동작 그대로). */
function LegacyQuizBody({
  taskText,
  sops,
  onPass,
  onClose,
  onRetry,
}: {
  taskText: string;
  sops: QuizInput['sops'];
  onPass: (entryIds: string[]) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [picks, setPicks] = useState<Record<number, number>>({});

  useEffect(() => {
    let alive = true;
    generateQuiz({ taskText, sops }).then((out) => {
      if (!alive) return;
      if (out.quotaExceeded) { setPhase('quota'); return; }
      if (!out.questions.length) { setPhase('empty'); return; }
      setQuestions(out.questions);
      setPhase('quiz');
    });
    return () => { alive = false; };
  }, [taskText, sops]);

  const allAnswered = questions.length > 0 && questions.every((_, i) => picks[i] !== undefined);
  const correctCount = questions.reduce((n, q, i) => n + (picks[i] === q.answer_index ? 1 : 0), 0);
  const passed = questions.length > 0 && correctCount === questions.length;

  const submit = () => {
    if (!allAnswered) return;
    setPhase('result');
    // 오답의 문항 귀속(0103) — 어느 노하우 문항이 틀렸는지만 집계한다(누가 틀렸는지는 안 남김).
    const byEntry = new Map<string, { attempts: number; misses: number }>();
    questions.forEach((q, i) => {
      if (!q.entry_id) return;
      const cur = byEntry.get(q.entry_id) ?? { attempts: 0, misses: 0 };
      cur.attempts += 1;
      if (picks[i] !== q.answer_index) cur.misses += 1;
      byEntry.set(q.entry_id, cur);
    });
    void recordQuizStats([...byEntry].map(([entryId, v]) => ({ entryId, ...v })));
    // 통과 처리 대상은 실제로 푼 문항의 근거 노하우뿐(0111) — 저장된 문항 경로와 같은 규칙.
    if (correctCount === questions.length) onPass([...byEntry.keys()]);
  };
  const retry = () => onRetry();

  return (
    <>
      {phase === 'loading' && (
        <View style={s.center}><ActivityIndicator color={InkColors.ink3} /><Text style={s.centerText}>문제를 만드는 중...</Text></View>
      )}

      {phase === 'quota' && (
        <View style={s.center}>
          <Text style={s.centerEmoji}>🙂</Text>
          <Text style={s.centerText}>이번 달 AI를 많이 썼어요.{'\n'}다음에 다시 해봐요.</Text>
          <Pressable onPress={onClose} style={s.softBtn}><Text style={s.softBtnText}>닫기</Text></Pressable>
        </View>
      )}

      {phase === 'empty' && (
        <View style={s.center}>
          <Text style={s.centerEmoji}>📄</Text>
          <Text style={s.centerText}>아직 확인할 내용이 부족해요.{'\n'}이 업무에 노하우가 더 쌓이면 다시 해봐요.</Text>
          <Pressable onPress={onClose} style={s.softBtn}><Text style={s.softBtnText}>닫기</Text></Pressable>
        </View>
      )}

      {(phase === 'quiz' || phase === 'result') && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
          {phase === 'quiz' && <Text style={s.intro}>붙어 있는 노하우로 만든 상황 문제예요. 편하게 골라보세요 — 틀려도 괜찮고 언제든 다시 할 수 있어요.</Text>}

          {questions.map((q, qi) => {
            const picked = picks[qi];
            const revealed = phase === 'result';
            return (
              <View key={qi} style={s.qBlock}>
                <Text style={s.qAsk}>{qi + 1}. {q.ask}</Text>
                {q.choices.map((c, ci) => {
                  const isPicked = picked === ci;
                  const isAnswer = ci === q.answer_index;
                  const showRight = revealed && isAnswer;
                  const showWrong = revealed && isPicked && !isAnswer;
                  return (
                    <Pressable
                      key={ci}
                      disabled={revealed}
                      onPress={() => setPicks((p) => ({ ...p, [qi]: ci }))}
                      style={[s.choice, isPicked && !revealed && s.choiceOn, showRight && s.choiceRight, showWrong && s.choiceWrong]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isPicked }}
                    >
                      <Ionicons
                        name={showRight ? 'checkmark-circle' : showWrong ? 'close-circle' : isPicked ? 'radio-button-on' : 'radio-button-off'}
                        size={17}
                        color={showRight ? BrandColors.good : showWrong ? BrandColors.bad : isPicked ? InkColors.ink : InkColors.ink3}
                      />
                      <Text style={[s.choiceText, (showRight || (isPicked && !revealed)) && { fontWeight: '800', color: InkColors.ink }]}>{c}</Text>
                    </Pressable>
                  );
                })}
                {revealed && q.explain ? <Text style={s.explain}>{q.explain}</Text> : null}
              </View>
            );
          })}

          {phase === 'result' && (
            <View style={[s.resultBox, passed ? s.resultPass : s.resultFail]}>
              <Ionicons name={passed ? 'ribbon' : 'refresh-circle'} size={22} color={passed ? BrandColors.good : BrandColors.warn} />
              <Text style={s.resultText}>
                {passed ? '이해 확인이 끝났어요. 사장님께 전달됐어요.' : `${questions.length}개 중 ${correctCount}개 맞았어요. 다시 해볼까요?`}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {phase === 'quiz' && (
        <View style={s.foot}>
          <Pressable onPress={submit} disabled={!allAnswered} style={({ pressed }) => [s.cta, !allAnswered && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Text style={s.ctaText}>답 보내기</Text>
          </Pressable>
        </View>
      )}
      {phase === 'result' && (
        <View style={s.foot}>
          {passed ? (
            <Pressable onPress={onClose} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}><Text style={s.ctaText}>닫기</Text></Pressable>
          ) : (
            <View style={s.footRow}>
              <Pressable onPress={onClose} style={({ pressed }) => [s.softBtnFlat, pressed && { opacity: 0.7 }]}><Text style={s.softBtnFlatText}>닫기</Text></Pressable>
              <Pressable onPress={retry} style={({ pressed }) => [s.cta, { flex: 1 }, pressed && { opacity: 0.85 }]}><Text style={s.ctaText}>다시 하기</Text></Pressable>
            </View>
          )}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  kicker: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  centerEmoji: { fontSize: 34 },
  centerText: { fontSize: 14, color: InkColors.ink2, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  noticeText: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', textAlign: 'center', lineHeight: 23 },
  // 시작 고지 — 이 화면에서 유일하게 굵은 잉크(R4-1). 아래 안내 한 줄은 ink2.
  startLead: { fontSize: 17, fontWeight: '800', color: InkColors.ink, textAlign: 'center', lineHeight: 25 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  intro: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600', marginBottom: 14, lineHeight: 18 },

  // 저장된 문항 경로
  step: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, marginBottom: Space.xs },
  ask: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 24, marginBottom: Space.md },
  gradeBox: { borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, padding: Space.lg, marginTop: Space.lg, gap: Space.xs },
  gradeTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  gradeText: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },
  footWait: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, minHeight: 48 },
  footWaitText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },

  qBlock: { marginBottom: 18 },
  qAsk: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink, marginBottom: 9, lineHeight: 21 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 7, backgroundColor: InkColors.bg },
  choiceOn: { borderColor: InkColors.ink, backgroundColor: InkColors.cream },
  choiceRight: { borderColor: BrandColors.good, backgroundColor: '#E6F1EA' },
  choiceWrong: { borderColor: BrandColors.bad, backgroundColor: '#FBECEC' },
  choiceText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink2, lineHeight: 19 },
  explain: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 4, paddingHorizontal: 4, lineHeight: 17 },

  resultBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.md, padding: 14, marginTop: 4 },
  resultPass: { backgroundColor: '#E6F1EA' },
  resultFail: { backgroundColor: BrandColors.warnSoft },
  resultText: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  footRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  softBtn: { marginTop: 6, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 22, paddingVertical: 11, backgroundColor: InkColors.bg },
  softBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  softBtnFlat: { justifyContent: 'center', paddingHorizontal: 20, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  softBtnFlatText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
});
