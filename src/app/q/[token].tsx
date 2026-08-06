/**
 * 외부 공유 응시 화면(0113, 기획 §4.2) — 이 앱에서 **로그인 없이 도는 유일한 라우트**다.
 *
 * 단기 직원용. 링크를 열면 이름만 적고 바로 푼다. 사장은 이름으로 결과를 본다.
 *
 * 보안 경계(전부 서버가 지킨다 — 이 화면은 아무것도 판정하지 않는다):
 *  · 접근은 토큰 검증 definer RPC 4개뿐. 기존 인증 경로(auth_unit_id 기반 RLS)를 열지 않는다.
 *  · 문항은 정답 제거본만 내려온다(0107 quiz_strip_payload). 채점은 quiz_link_grade(서버).
 *  · 만료·회수된 링크는 문항을 한 건도 내주지 않는다.
 *
 * 화면은 세 걸음뿐이다: 이름 적기 → 풀기 → 결과. 뒤로 가기·저장·재시도 같은 곁가지를 만들지 않는다
 * (한 번 쓰고 마는 사람에게 배울 것을 주지 않는다).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { QUIZ_RENDERERS } from '@/components/work/quiz';
import { openQuizLink, fetchQuizLinkItems, gradeQuizLink, submitQuizLink, type QuizLinkInfo } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizGrade, QuizItem, QuizResponse } from '@/lib/quiz/types';

/** 한 번에 내는 문항 수 — 코스 전체가 아니라 표본이다(단기 직원에게 30문제를 내지 않는다). */
const ITEM_LIMIT = 5;
/** 문항당 20초로 잡은 소요 시간(분). 응시 화면과 같은 기준. */
const minutesFor = (n: number) => Math.max(1, Math.ceil((n * 20) / 60));

// closed = 링크가 닫힘(만료·회수·오타) · failed = 우리 쪽 문제(네트워크·서버).
// 이 둘을 한 화면으로 뭉치면 장애가 "만료"로 위장되고, 손님은 멀쩡한 링크를 버리게 된다.
type Phase = 'loading' | 'closed' | 'failed' | 'name' | 'quiz' | 'saving' | 'done';

export default function QuizLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const tk = typeof token === 'string' ? token : '';

  // 토큰이 아예 없으면 조회할 것도 없다 → 초기값으로 정한다(이펙트에서 동기 setState 회피).
  const [phase, setPhase] = useState<Phase>(tk ? 'loading' : 'closed');
  const [info, setInfo] = useState<QuizLinkInfo | null>(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<QuizItem[]>([]);
  const [marks, setMarks] = useState<boolean[]>([]);
  /** 결과가 실제로 저장됐나 — 이 값으로만 "전달됐어요"를 말한다. */
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tk) return;
    let alive = true;
    void openQuizLink(tk).then((v) => {
      if (!alive) return;
      setInfo(v);
      if (v.failed) { setPhase('failed'); return; }
      // 낼 문항이 0건이면 열어도 풀 게 없다 — 빈 화면 대신 닫힌 것으로 말한다.
      setPhase(v.ok && v.itemCount > 0 ? 'name' : 'closed');
    });
    return () => { alive = false; };
  }, [tk]);

  const start = useCallback(async () => {
    if (!name.trim()) return;
    setPhase('loading');
    const { data, error } = await fetchQuizLinkItems(tk, ITEM_LIMIT);
    // 못 불러온 것(장애)과 낼 게 없는 것(닫힘)을 구분한다 — 뭉치면 장애가 "만료"로 보인다.
    if (error) { setPhase('failed'); return; }
    // 아직 렌더러가 없는 형태(레지스트리 미등록)는 거른다 — 빈 화면 대신 안 낸다.
    const usable = (data ?? []).filter((it) => !!QUIZ_RENDERERS[it.format]);
    if (usable.length === 0) { setPhase('closed'); return; }
    setItems(usable);
    setPhase('quiz');
  }, [name, tk]);

  const finish = useCallback(
    async (result: boolean[]) => {
      setMarks(result);
      setPhase('saving');
      // 노하우별로 나눠 적는다(0112) — 문항이 근거한 노하우에 귀속시키는 방식이 매장 통계와 같다.
      const byEntry = new Map<string, { total: number; correct: number }>();
      items.slice(0, result.length).forEach((it, i) => {
        for (const entryId of it.entry_ids ?? []) {
          const cur = byEntry.get(entryId) ?? { total: 0, correct: 0 };
          cur.total += 1;
          if (result[i]) cur.correct += 1;
          byEntry.set(entryId, cur);
        }
      });
      // ★기다렸다가 결과를 말한다. fire-and-forget 으로 두면 저장이 실패해도 손님에게
      //   "사장님께 전달됐어요"라고 말하게 된다 — 손님은 다시 풀 방법이 없고 사장은 영원히 모른다.
      const ok = await submitQuizLink(tk, name.trim(), [...byEntry].map(([entryId, v]) => ({ entryId, ...v })));
      setSaved(ok);
      setPhase('done');
    },
    [items, name, tk],
  );

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {(phase === 'loading' || phase === 'saving') && (
        <View style={st.center}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={st.centerText}>{phase === 'saving' ? '결과를 보내는 중...' : '불러오는 중...'}</Text>
        </View>
      )}

      {/* 만료·회수·오타는 서로 구분해 말하지 않는다 — 토큰이 있는지 떠보는 걸 막는다. */}
      {phase === 'closed' && (
        <View style={st.center}>
          <Ionicons name="lock-closed-outline" size={26} color={InkColors.ink3} />
          <Text style={st.centerText}>지금은 열 수 없는 링크예요.{'\n'}보내 주신 분께 다시 받아 주세요.</Text>
        </View>
      )}

      {/* 우리 쪽 문제일 때는 링크 탓을 하지 않는다 — 손님이 멀쩡한 링크를 버리게 된다. */}
      {phase === 'failed' && (
        <View style={st.center}>
          <Ionicons name="cloud-offline-outline" size={26} color={InkColors.ink3} />
          <Text style={st.centerText}>지금은 불러오지 못했어요.{'\n'}연결을 확인하고 잠시 후 다시 열어 주세요.</Text>
        </View>
      )}

      {phase === 'name' && info && (
        <>
          <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
            <Text style={st.kicker}>{info.storeName}</Text>
            <Text style={st.title}>{info.courseName}</Text>
            {/* 시작 전에 분량과 걸리는 시간을 말한다(레퍼런스 home_05). */}
            <Text style={st.lead}>
              문제 {Math.min(info.itemCount, ITEM_LIMIT)}개 · {minutesFor(Math.min(info.itemCount, ITEM_LIMIT))}분 정도
            </Text>
            <Text style={st.sub}>이름만 적으면 바로 시작해요. 가입은 없어요.</Text>
            <TextInput
              style={st.input}
              value={name}
              onChangeText={setName}
              placeholder="예) 김민지"
              placeholderTextColor={InkColors.ink3}
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={() => void start()}
              accessibilityLabel="이름 입력"
            />
          </ScrollView>
          <View style={st.foot}>
            <Pressable
              onPress={() => void start()}
              disabled={!name.trim()}
              style={({ pressed }) => [st.cta, !name.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="퀴즈 시작하기"
            >
              <Text style={st.ctaText}>퀴즈 시작하기</Text>
            </Pressable>
          </View>
        </>
      )}

      {phase === 'quiz' && <LinkQuizBody token={tk} items={items} onFinish={finish} />}

      {phase === 'done' && (
        <View style={st.center}>
          <Ionicons
            name={saved ? 'ribbon-outline' : 'alert-circle-outline'}
            size={26}
            color={saved ? BrandColors.good : BrandColors.warn}
          />
          <Text style={st.doneText}>{items.length}문제 중 {marks.filter(Boolean).length}개 맞았어요</Text>
          {/* 저장이 실패했으면 "전달됐어요"라고 말하지 않는다 — 손님은 다시 풀 방법이 없고
              사장은 영원히 모른다. 무엇이 됐고 무엇이 안 됐는지 그대로 말한다. */}
          <Text style={st.centerText}>
            {saved
              ? '결과는 사장님께 전달됐어요. 이 창은 닫으셔도 돼요.'
              : '결과를 보내지 못했어요. 이 화면을 사장님께 보여 주세요.'}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/**
 * 풀이 본체 — 한 번에 한 문항, 답을 내면 서버가 즉시 채점한다(설계 07-29 §04 규칙 4).
 * 채점이 실패하면 오답으로 치지 않는다 — 답을 들고 있다가 다시 보낸다(규칙 6: 막지 않는다).
 * 로그인 응시(UnderstandingCheckSheet)와 같은 규칙이지만 호출하는 RPC 만 토큰판이다.
 */
function LinkQuizBody({
  token,
  items,
  onFinish,
}: {
  token: string;
  items: QuizItem[];
  onFinish: (marks: boolean[]) => void | Promise<void>;
}) {
  const [at, setAt] = useState(0);
  const [pending, setPending] = useState<QuizResponse | null>(null);
  const [grade, setGrade] = useState<QuizGrade | null>(null);
  const [grading, setGrading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  const item = items[at];
  const Renderer = useMemo(() => (item ? QUIZ_RENDERERS[item.format] : null), [item]);

  const send = async (itemId: string, res: QuizResponse) => {
    setGrading(true);
    setFailed(false);
    const { data } = await gradeQuizLink(token, itemId, res);
    setGrading(false);
    if (!data) { setFailed(true); return; }
    setGrade(data);
    setResults((prev) => [...prev, data.correct]);
  };

  const next = () => {
    if (at + 1 < items.length) {
      setAt(at + 1);
      setPending(null);
      setGrade(null);
      setFailed(false);
      return;
    }
    void onFinish(results);
  };

  if (!item || !Renderer) return null;
  const ask = typeof item.payload?.ask === 'string' ? item.payload.ask : '';

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        {/* 완료가 아니라 잔여를 센다(레퍼런스 leveltest_05). */}
        <Text style={st.step}>{items.length - at}문제 남았어요</Text>
        {ask ? <Text style={st.ask}>{ask}</Text> : null}

        <Renderer
          key={item.id}
          payload={item.payload ?? {}}
          disabled={grading || pending !== null}
          result={grade ? { correct: grade.correct, answer: grade.answer } : null}
          onAnswer={(res) => { setPending(res); void send(item.id, res); }}
        />

        {grade ? (
          <View style={[st.gradeBox, grade.correct ? st.gradePass : st.gradeFail]}>
            <Text style={st.gradeTitle}>{grade.correct ? '맞았어요' : '이건 이렇게 해요'}</Text>
            {grade.explain ? <Text style={st.gradeText}>{grade.explain}</Text> : null}
          </View>
        ) : null}

        {failed ? (
          <View style={st.gradeBox}>
            <Text style={st.gradeTitle}>지금은 채점이 안 됐어요</Text>
            <Text style={st.gradeText}>답은 그대로 있어요. 잠시 후 다시 보내면 돼요.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={st.foot}>
        {grading ? (
          <View style={st.footWait}>
            <ActivityIndicator color={InkColors.ink3} />
            <Text style={st.footWaitText}>채점하는 중...</Text>
          </View>
        ) : failed ? (
          <Pressable
            onPress={() => pending !== null && void send(item.id, pending)}
            style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Text style={st.ctaText}>다시 보내기</Text>
          </Pressable>
        ) : grade ? (
          <Pressable onPress={next} style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            <Text style={st.ctaText}>{at + 1 < items.length ? '다음 문제' : '결과 보기'}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  body: { padding: Space.gutter, paddingBottom: Space.xl, gap: Space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, paddingHorizontal: Space.xl },
  centerText: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', textAlign: 'center', lineHeight: 23 },
  doneText: { fontSize: 17, fontWeight: '800', color: InkColors.ink, textAlign: 'center', lineHeight: 25 },

  kicker: { fontSize: 13, fontWeight: '800', color: InkColors.ink3 },
  // 화면당 굵은 잉크는 하나(R4-1) — 제목만 잉크, 나머지는 ink2/ink3.
  title: { fontSize: 24, fontWeight: '900', color: InkColors.ink, lineHeight: 34 },
  lead: { fontSize: 17, fontWeight: '700', color: InkColors.ink2, lineHeight: 25, marginTop: Space.sm },
  sub: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },
  input: {
    marginTop: Space.lg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    backgroundColor: InkColors.bg, paddingHorizontal: Space.md, paddingVertical: Space.md,
    fontSize: 17, color: InkColors.ink, minHeight: 52,
  },

  step: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  ask: { fontSize: 17, fontWeight: '800', color: InkColors.ink, lineHeight: 25, marginBottom: Space.sm },
  gradeBox: { borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, padding: Space.lg, marginTop: Space.lg, gap: Space.xs },
  gradePass: { backgroundColor: '#E6F1EA' },
  gradeFail: { backgroundColor: BrandColors.warnSoft },
  gradeTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  gradeText: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },

  foot: { paddingHorizontal: Space.gutter, paddingTop: Space.sm, paddingBottom: Space.lg, borderTopWidth: 1, borderTopColor: InkColors.line },
  footWait: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, minHeight: 56 },
  footWaitText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
