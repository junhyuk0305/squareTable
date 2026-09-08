/**
 * 외부 공유 응시 화면(0113, 기획 §4.2) — 이 앱에서 **로그인 없이 도는 유일한 라우트**다.
 *
 * 단기 직원용. 링크를 열면 이름·전화번호만 적고 바로 푼다. 사장은 그 이름으로 결과를 본다.
 *
 * 전화번호는 **식별키**다(0160, 기획 Q1) — 같은 사람의 재응시를 한 사람으로 묶고, 나중에 이 매장에
 * 실제로 합류하면 응시 이력이 직원 이력으로 이어진다. 인증(SMS)은 **선택**이다(기획 §6-B-8):
 * 안 해도 풀 수 있고, 하면 나중에 본인 계정에 붙일 때 확실해진다.
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
import { KeyboardShift } from '@/components/KeyboardShift';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { QUIZ_RENDERERS } from '@/components/work/quiz';
import { openQuizLink, fetchQuizLinkItems, gradeQuizLink, submitQuizLink, type QuizLinkInfo } from '@/lib/db';
import { usePhoneOtp } from '@/lib/otp';
import { HAS_SUPABASE } from '@/lib/supabase';
import { formatPhone, isValidPhone, normalizePhone } from '@/lib/utils/validation';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizGrade, QuizItem, QuizResponse } from '@/lib/quiz/types';

/** 응시자가 낸 답 한 건 — 서버가 이걸로 다시 채점한다(클라는 점수를 계산하지 않는다). */
type GivenAnswer = { itemId: string; response: QuizResponse };

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
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [items, setItems] = useState<QuizItem[]>([]);
  const [marks, setMarks] = useState<boolean[]>([]);
  /** 결과가 실제로 저장됐나 — 이 값으로만 "전달됐어요"를 말한다. */
  const [saved, setSaved] = useState(false);

  const router = useRouter();
  // 번호를 고치면 훅이 정규화 번호 비교로 sent/verified 를 자동으로 푼다(signup 과 같은 사용법).
  const otp = usePhoneOtp(normalizePhone(phone));
  const phoneOk = isValidPhone(phone);
  const canStart = !!name.trim() && phoneOk;

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
    if (!canStart) return;
    setPhase('loading');
    // 표본이 아니라 **코스 문항 전부**를 받는다(0188) — 몇 개를 낼지는 퀴즈를 만든 사장이 정한 것이다.
    const { data, error } = await fetchQuizLinkItems(tk);
    // 못 불러온 것(장애)과 낼 게 없는 것(닫힘)을 구분한다 — 뭉치면 장애가 "만료"로 보인다.
    if (error) { setPhase('failed'); return; }
    // 아직 렌더러가 없는 형태(레지스트리 미등록)는 거른다 — 빈 화면 대신 안 낸다.
    const usable = (data ?? []).filter((it) => !!QUIZ_RENDERERS[it.format]);
    if (usable.length === 0) { setPhase('closed'); return; }
    setItems(usable);
    setPhase('quiz');
  }, [canStart, tk]);

  const finish = useCallback(
    async (result: boolean[], answers: GivenAnswer[]) => {
      setMarks(result);
      setPhase('saving');
      // 노하우별 집계는 **서버가** 한다(0160) — 여기서는 낸 답을 그대로 넘긴다.
      // ★기다렸다가 결과를 말한다. fire-and-forget 으로 두면 저장이 실패해도 손님에게
      //   "사장님께 전달됐어요"라고 말하게 된다 — 손님은 다시 풀 방법이 없고 사장은 영원히 모른다.
      const ok = await submitQuizLink(
        tk,
        { name: name.trim(), phone: normalizePhone(phone), phoneVerified: otp.verified },
        answers,
      );
      setSaved(ok);
      setPhase('done');
    },
    [name, otp.verified, phone, tk],
  );

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {(phase === 'loading' || phase === 'saving') && (
        <ScreenLoading label={phase === 'saving' ? '결과를 보내고 있어요…' : '퀴즈를 불러오고 있어요…'} />
      )}

      {/* 만료·회수·오타는 서로 구분해 말하지 않는다 — 토큰이 있는지 떠보는 걸 막는다. */}
      {phase === 'closed' && (
        <Appear style={st.fill}>
          <View style={st.center}>
            <Ionicons name="lock-closed-outline" size={26} color={InkColors.ink3} />
            <Text style={st.centerText}>지금은 열 수 없는 링크예요.{'\n'}보내 주신 분께 다시 받아 주세요.</Text>
          </View>
        </Appear>
      )}

      {/* 우리 쪽 문제일 때는 링크 탓을 하지 않는다 — 손님이 멀쩡한 링크를 버리게 된다. */}
      {phase === 'failed' && (
        <Appear style={st.fill}>
          <View style={st.center}>
            <Ionicons name="cloud-offline-outline" size={26} color={InkColors.ink3} />
            <Text style={st.centerText}>지금은 불러오지 못했어요.{'\n'}연결을 확인하고 잠시 후 다시 열어 주세요.</Text>
          </View>
        </Appear>
      )}

      {phase === 'name' && info && (
        <KeyboardShift>
          <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
            {/* 등장은 **섹션 단위**다 — 문단·입력칸마다 감싸면 한 화면이 블록 8개로 읽힌다(C형 몰입형은 ≤3).
                안쪽 간격은 st.qWrap 의 gap 이 body 의 gap 을 대신한다(레이아웃 불변). */}
            <Appear delay={stagger(0)} style={st.qWrap}>
              <Text style={st.kicker}>{info.storeName}</Text>
              <Text style={st.title}>{info.courseName}</Text>
              {/* 시작 전에 분량과 걸리는 시간을 말한다(레퍼런스 home_05). */}
              <Text style={st.lead}>
                문제 {info.itemCount}개 · {minutesFor(info.itemCount)}분 정도
              </Text>
              <Text style={st.sub}>이름과 전화번호만 적으면 바로 시작해요. 가입은 없어요.</Text>
            </Appear>
            <Appear delay={stagger(1)} style={st.qWrap}>
            <TextInput
              style={st.input}
              value={name}
              onChangeText={setName}
              placeholder="예) 김민지"
              placeholderTextColor={InkColors.ink3}
              maxLength={20}
              returnKeyType="next"
              accessibilityLabel="이름 입력"
            />
            <TextInput
              style={st.input}
              value={phone}
              onChangeText={(v) => setPhone(formatPhone(v))}
              placeholder="010-1234-5678"
              placeholderTextColor={InkColors.ink3}
              keyboardType="phone-pad"
              maxLength={13}
              returnKeyType="done"
              onSubmitEditing={() => void start()}
              accessibilityLabel="전화번호 입력"
            />
            {/* 전화번호를 왜 받는지 말한다 — 안 말하면 "가입 없다면서 번호는 왜"가 된다. */}
            <Text style={st.hint}>사장님이 결과를 확인할 때 쓰고, 나중에 같은 곳에서 일하게 되면 이 결과가 이어져요.</Text>
            </Appear>

            {/* 인증은 선택이다(기획 §6-B-8). 안 해도 시작 버튼은 열려 있다. */}
            {HAS_SUPABASE && phoneOk && !otp.verified && (
              <View style={st.otpBox}>
                <Text style={st.hint}>나중에 내 계정에 이 결과를 붙이려면 번호를 확인해 두면 좋아요.</Text>
                <View style={st.otpRow}>
                  {otp.sent && (
                    <TextInput
                      style={[st.input, st.otpInput]}
                      value={otpCode}
                      onChangeText={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                      placeholder="인증번호 6자리"
                      placeholderTextColor={InkColors.ink3}
                      keyboardType="number-pad"
                      maxLength={6}
                      accessibilityLabel="인증번호 입력"
                    />
                  )}
                  <Pressable
                    onPress={() => (otp.sent ? void otp.verify(otpCode) : void otp.send())}
                    disabled={!!otp.busy || (otp.sent ? otpCode.length !== 6 : otp.countdown > 0)}
                    style={[
                      st.otpBtn,
                      (!!otp.busy || (otp.sent ? otpCode.length !== 6 : otp.countdown > 0)) && { opacity: 0.5 },
                      !otp.sent && { flex: 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={otp.sent ? '인증하기' : '인증번호 받기'}
                  >
                    {otp.busy ? (
                      <ActivityIndicator size="small" color={InkColors.ink2} />
                    ) : (
                      <Text style={st.otpBtnText}>
                        {otp.sent ? '인증하기' : otp.countdown > 0 ? `재발송 ${otp.countdown}초` : '인증번호 받기'}
                      </Text>
                    )}
                  </Pressable>
                </View>
                {otp.msg ? <Text style={st.otpMsg}>{otp.msg}</Text> : null}
              </View>
            )}
            {HAS_SUPABASE && otp.verified && <Text style={st.otpOk}>확인된 번호예요</Text>}
          </ScrollView>
          <View style={st.foot}>
            <Appear delay={stagger(2)}>
            <Pressable
              onPress={() => void start()}
              disabled={!canStart}
              style={({ pressed }) => [st.cta, !canStart && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="퀴즈 시작하기"
            >
              <Text style={st.ctaText}>퀴즈 시작하기</Text>
            </Pressable>
            </Appear>
          </View>
        </KeyboardShift>
      )}

      {phase === 'quiz' &&<LinkQuizBody token={tk} items={items} onFinish={finish} />}

      {phase === 'done' && (
        <>
          {/* 결과는 한 덩어리로 등장한다 — 아이콘·점수·안내를 따로 띄우면 읽는 순서가 셋으로 쪼개진다. */}
          <Appear delay={stagger(0)} style={st.fill}>
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
          </Appear>
          {/* 저장된 경우에만 권한다 — 못 보낸 결과를 "보러 가자"고 하면 빈손으로 보낸다.
              ★가입은 **직원 계정**으로만 연다(0157 로 같은 번호의 사장/직원 계정 분리가 가능해졌다). */}
          {saved && (
            <View style={st.foot}>
              <Appear delay={stagger(1)}>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/signup', params: { role: 'junior', phone: normalizePhone(phone) } })
                }
                style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="직원으로 가입하고 점수 보기"
              >
                <Text style={st.ctaText}>직원으로 가입하고 점수 보기</Text>
              </Pressable>
                <Text style={st.footHint}>가입하면 내가 푼 결과를 계속 볼 수 있어요.</Text>
              </Appear>
            </View>
          )}
        </>
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
  onFinish: (marks: boolean[], answers: GivenAnswer[]) => void | Promise<void>;
}) {
  const [at, setAt] = useState(0);
  const [pending, setPending] = useState<QuizResponse | null>(null);
  const [grade, setGrade] = useState<QuizGrade | null>(null);
  const [grading, setGrading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  /** 서버에 그대로 넘길 답. 채점이 성공한 문항만 쌓인다(results 와 항상 같은 길이). */
  const [answers, setAnswers] = useState<GivenAnswer[]>([]);

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
    setAnswers((prev) => [...prev, { itemId, response: res }]);
  };

  const next = () => {
    if (at + 1 < items.length) {
      setAt(at + 1);
      setPending(null);
      setGrade(null);
      setFailed(false);
      return;
    }
    void onFinish(results, answers);
  };

  if (!item || !Renderer) return null;
  const ask = typeof item.payload?.ask === 'string' ? item.payload.ask : '';

  return (
    <>
      <KeyboardShift>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={st.body}showsVerticalScrollIndicator={false}>
        {/* 완료가 아니라 잔여를 센다(레퍼런스 leveltest_05). */}
        <Text style={st.step}>{items.length - at}문제 남았어요</Text>
        {/* 문항이 넘어갈 때 통째로 한 번 올라온다 — key={item.id} 라 문항당 1회만 재생된다.
            ⛔ 넘김 전용 애니메이션(슬라이드·플립)을 새로 만들지 않는다(프리미티브 2개 규칙). */}
        <Appear key={item.id} style={st.qWrap}>
          {ask ? <Text style={st.ask}>{ask}</Text> : null}
          <Renderer
            payload={item.payload ?? {}}
            disabled={grading || pending !== null}
            result={grade ? { correct: grade.correct, answer: grade.answer } : null}
            onAnswer={(res) => { setPending(res); void send(item.id, res); }}
          />
        </Appear>

        {/* 채점 결과는 답을 낸 **뒤에** 나타난다 — 그 순간이 이 화면에서 제일 중요한 변화다. */}
        {grade ? (
          <Appear offsetY={6}>
            <View style={[st.gradeBox, grade.correct ? st.gradePass : st.gradeFail]}>
              <Text style={st.gradeTitle}>{grade.correct ? '맞았어요' : '이건 이렇게 해요'}</Text>
              {grade.explain ? <Text style={st.gradeText}>{grade.explain}</Text> : null}
            </View>
          </Appear>
        ) : null}

        {failed ? (
          <View style={st.gradeBox}>
            <Text style={st.gradeTitle}>지금은 채점이 안 됐어요</Text>
            <Text style={st.gradeText}>답은 그대로 있어요. 잠시 후 다시 보내면 돼요.</Text>
          </View>
        ) : null}
      </ScrollView>
      </KeyboardShift>

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
  // Appear 로 감싼 문항 묶음 — 바깥 gap 은 래퍼 하나에만 걸리므로 안쪽 간격을 여기서 준다.
  qWrap: { gap: Space.sm },
  // Appear 가 flex:1 자식(st.center)을 감쌀 때 높이를 넘겨주는 래퍼 — 도형·간격 값이 아니다.
  fill: { flex: 1 },
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
  hint: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, lineHeight: 20, marginTop: Space.sm },
  otpBox: { marginTop: Space.md, gap: Space.sm },
  otpRow: { flexDirection: 'row', gap: Space.sm },
  otpInput: { flex: 1, marginTop: 0 },
  otpBtn: {
    minWidth: 116, paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1,
    borderColor: InkColors.line, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    minHeight: 52,
  },
  otpBtnText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  otpMsg: { fontSize: 13, fontWeight: '600', color: BrandColors.warn, lineHeight: 20 },
  otpOk: { fontSize: 13, fontWeight: '700', color: BrandColors.good, lineHeight: 20, marginTop: Space.sm },
  footHint: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center', marginTop: Space.sm },

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
