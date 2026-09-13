/**
 * 외부 공유 응시 화면(0113, 기획 §4.2) — 이 앱에서 **로그인 없이 도는 유일한 라우트**다.
 *
 * 단기 직원용. 링크를 열면 이름만 적고 바로 푼다. 사장은 그 이름으로 결과를 본다.
 *
 * 전화번호는 **선택**이고(0195, 2026-09-13 최소수집), 적으면 **식별키**가 된다(0160, 기획 Q1) — 같은 사람의 재응시를 한 사람으로 묶고, 나중에 이 매장에
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { StepProgress } from '@/components/blocks/StepProgress';
import { QUIZ_RENDERERS } from '@/components/work/quiz';
import { openQuizLink, fetchQuizLinkItems, gradeQuizLink, submitQuizLink, type QuizLinkInfo } from '@/lib/db';
import { usePhoneOtp } from '@/lib/otp';
import { HAS_SUPABASE } from '@/lib/supabase';
import { formatPhone, isValidPhone, normalizePhone } from '@/lib/utils/validation';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizItem, QuizResponse } from '@/lib/quiz/types';

/** 화면에 점수를 띄우기 위한 채점을 **몇 개씩 끊어 보낼지**. 회선이 약한 휴대폰에서 한 번에
 *  수십 개를 쏘면 뒤쪽이 무더기로 실패한다. 기록 자체는 submitQuizLink 한 번에 전부 간다. */
const GRADE_CHUNK = 4;

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
  /** 낸 답 원문. 저장이 실패해도 **들고 있는다** — 그래야 '다시 보내기'가 가능하다. */
  const [given, setGiven] = useState<GivenAnswer[]>([]);
  /** 화면에서 점수를 못 잰 문항 수. 0 이 아니면 **분모가 사장 화면과 다르다**고 말한다. */
  const [missed, setMissed] = useState(0);

  const router = useRouter();
  // 번호를 고치면 훅이 정규화 번호 비교로 sent/verified 를 자동으로 푼다(signup 과 같은 사용법).
  const otp = usePhoneOtp(normalizePhone(phone));
  const phoneOk = isValidPhone(phone);
  // 이름만 필수. 번호는 비워도 되고, 적었으면 휴대폰 형식이어야 한다(잘못 적은 번호가 식별키가 되면 남의 이력에 붙는다).
  const canStart = !!name.trim() && (phone.trim() === '' || phoneOk);

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

  /**
   * 낸 답을 서버로 보낸다. **다시 보내기가 이 함수를 그대로 다시 부른다** —
   * ★한 번 실패하면 손님의 답이 통째로 사라졌다(2026-09-14 발견). 풀이 본체가 언마운트되면서
   *   고른 값이 같이 없어지고, 결과 화면에는 "보내지 못했어요"만 있고 버튼이 없었다.
   *   연결이 잠깐 끊긴 것만으로 20분을 잃는다 — 손님은 링크를 다시 열어 처음부터 풀어야 한다.
   *   그래서 낸 답을 부모가 들고 있다가(given) 그대로 다시 보낸다.
   */
  const send = useCallback(
    async (answers: GivenAnswer[]) => {
      setPhase('saving');
      // 노하우별 집계는 **서버가** 한다(0160) — 여기서는 낸 답을 그대로 넘긴다.
      // ★기다렸다가 결과를 말한다. fire-and-forget 으로 두면 저장이 실패해도 손님에게
      //   "사장님께 전달됐어요"라고 말하게 된다 — 손님은 다시 풀 방법이 없고 사장은 영원히 모른다.
      const ok = await submitQuizLink(
        tk,
        { name: name.trim(), phone: phoneOk ? normalizePhone(phone) : null, phoneVerified: phoneOk && otp.verified },
        answers,
      );
      setSaved(ok);
      setPhase('done');
    },
    [name, otp.verified, phone, phoneOk, tk],
  );

  const finish = useCallback(
    async (answers: GivenAnswer[]) => {
      setPhase('saving');
      setGiven(answers);
      // 점수는 **다 낸 뒤에** 한 번에 받는다(2026-09-13) — 풀이 중에 문항마다 채점하면 답을 고치러
      // 앞으로 돌아갈 수 없고, 시험이 아니라 정답 맞히기 연습이 된다.
      // ★채점이 안 된 문항은 세지 않는다 — 못 잰 것을 오답으로 치면 화면이 거짓말을 한다.
      //   기록 자체는 아래 submitQuizLink 가 낸 답 원문을 보내 서버가 다시 채점한다.
      // ★한 번에 다 쏘지 않는다(2026-09-14). 0188 이 출제 상한을 없애 문항이 수십 개일 수 있는데
      //   Promise.all 로 전부 동시에 보내면 휴대폰 회선에서 뒤쪽이 무더기로 실패한다. 그러면
      //   채점 못 한 문항이 조용히 빠져 **손님이 보는 분모(marks.length)와 사장이 보는 분모가
      //   달라진다** — 같은 응시인데 숫자가 둘이 된다. 네 개씩 끊어 보낸다.
      const graded: boolean[] = [];
      let ungraded = 0;
      for (let i = 0; i < answers.length; i += GRADE_CHUNK) {
        const part = await Promise.all(
          answers.slice(i, i + GRADE_CHUNK).map((a) => gradeQuizLink(tk, a.itemId, a.response)),
        );
        for (const g of part) {
          if (g.data) graded.push(!!g.data.correct);
          else ungraded++;
        }
      }
      setMarks(graded);
      setMissed(ungraded);
      await send(answers);
    },
    [send, tk],
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
              <Text style={st.sub}>이름만 적으면 바로 시작해요. 가입은 없어요.</Text>
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
              placeholder="전화번호 (선택)"
              placeholderTextColor={InkColors.ink3}
              keyboardType="phone-pad"
              maxLength={13}
              returnKeyType="done"
              onSubmitEditing={() => void start()}
              accessibilityLabel="전화번호 입력"
            />
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
            {/* 로그인이 없으니 가입 때의 동의가 여기엔 없다 — 시작 버튼이 곧 동의다(별도 체크박스 없음, 시장 표준).
                ★말하는 것은 **수집 항목**뿐이다 — 목적·보관기간까지 여기 적으면 시작 버튼 위가 약관이 된다.
                  정본은 처리방침 "퀴즈 링크 참여자" 항목이고 바로 아래 링크가 거기로 간다. */}
            <Text style={st.consent}>
              시작하면 이름 · 전화번호(선택) 수집에 동의하는 거예요.
            </Text>
            <Pressable onPress={() => router.push('/privacy')} accessibilityRole="link" hitSlop={8} style={st.consentLinkHit}>
              <Text style={st.consentLink}>개인정보처리방침 보기</Text>
            </Pressable>
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

      {phase === 'quiz' && info && <LinkQuizBody info={info} items={items} onFinish={finish} />}

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
              {/* 채점된 문항만 분모다 — 안 푼 문항·채점이 안 된 문항을 섞으면 점수가 사실과 달라진다. */}
              {marks.length > 0 ? (
                <Text style={st.doneText}>{marks.length}문제 중 {marks.filter(Boolean).length}개 맞았어요</Text>
              ) : null}
              {/* 못 잰 문항이 있으면 **여기 숫자가 전부가 아니라고 말한다** — 안 말하면 손님과
                  사장이 서로 다른 점수를 보면서 둘 다 맞다고 믿는다. 기록은 낸 답 전부로 남는다. */}
              {missed > 0 ? (
                <Text style={st.doneNote}>{missed}문제는 여기서 점수를 못 쟀어요. 사장님께는 푼 것 전부가 갔어요.</Text>
              ) : null}
              {/* 저장이 실패했으면 "전달됐어요"라고 말하지 않는다 — 손님은 다시 풀 방법이 없고
                  사장은 영원히 모른다. 무엇이 됐고 무엇이 안 됐는지 그대로 말한다. */}
              <Text style={st.centerText}>
                {saved
                  ? '결과는 사장님께 전달됐어요. 이 창은 닫으셔도 돼요.'
                  : '결과를 보내지 못했어요. 답은 그대로 있으니 다시 보내 주세요.'}
              </Text>
            </View>
          </Appear>
          {/* 저장된 경우에만 권한다 — 못 보낸 결과를 "보러 가자"고 하면 빈손으로 보낸다.
              ★가입은 **직원 계정**으로만 연다(0157 로 같은 번호의 사장/직원 계정 분리가 가능해졌다). */}
          {/* 못 보냈으면 **다시 보내기**가 먼저다(2026-09-14). 낸 답은 given 에 그대로 있다 —
              연결이 잠깐 끊긴 것만으로 손님이 처음부터 다시 풀게 하지 않는다. */}
          {!saved && given.length > 0 && (
            <View style={st.foot}>
              <Appear delay={stagger(1)}>
              <Pressable
                onPress={() => void send(given)}
                style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="결과 다시 보내기"
              >
                <Text style={st.ctaText}>다시 보내기</Text>
              </Pressable>
              <Text style={st.footHint}>계속 안 되면 이 화면을 사장님께 보여 주세요.</Text>
              </Appear>
            </View>
          )}

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
 * 풀이 본체 — 한 번에 한 문항이되 **답은 다 낸 뒤에 한꺼번에** 낸다(2026-09-13 사용자 결정).
 *
 * 옛 판은 답을 낼 때마다 서버가 즉시 채점하고 정답·해설을 그 자리에서 폈다(설계 07-29 §04 규칙 4).
 * 그러면 앞 문항으로 돌아갈 수 없고 — 이미 정답을 봤으니 돌아가는 것이 의미가 없다 — 시험이 아니라
 * 한 문제씩 답을 확인하는 연습이 된다. 여기서는 낸 답을 들고만 있다가 마지막에 제출한다.
 *
 * ★문항을 **전부 마운트해 두고 현재 것만 보인다.** 렌더러 17종은 고른 값을 각자 안에 들고 있어서
 *   (QuizRendererProps 에 초기값이 없다) 언마운트하면 앞으로 돌아갔을 때 고른 답이 사라진다.
 * ★그 대가로 문항 넘김 애니메이션이 없다 — 마운트가 한 번뿐이라 Appear 가 문항마다 재생되지 않는다.
 *   넘김 전용 애니메이션을 새로 만들지 않는다(프리미티브 2개 규칙). 움직이는 것은 진행 막대다.
 */
function LinkQuizBody({
  info,
  items,
  onFinish,
}: {
  info: QuizLinkInfo;
  items: QuizItem[];
  onFinish: (answers: GivenAnswer[]) => void | Promise<void>;
}) {
  const [at, setAt] = useState(0);
  /** 문항 순서 그대로의 답 칸. null = 아직 안 풂(건너뛴 문항도 나중에 돌아와 채울 수 있다). */
  const [answers, setAnswers] = useState<(QuizResponse | null)[]>(() => items.map(() => null));
  const scroller = useRef<ScrollView>(null);

  const unanswered = answers.filter((a) => a === null).length;
  const last = at === items.length - 1;

  /** 문항을 바꾸면 위에서부터 읽는다 — 앞 문항이 길었으면 새 문항이 화면 밖에서 시작한다. */
  const move = (to: number) => {
    setAt(to);
    scroller.current?.scrollTo({ y: 0, animated: false });
  };

  const submit = () => {
    const given: GivenAnswer[] = [];
    answers.forEach((res, i) => {
      if (res !== null) given.push({ itemId: items[i].id, response: res });
    });
    void onFinish(given);
  };

  return (
    <>
      {/* 어디서 온 퀴즈인지·몇 번째인지는 스크롤 밖에 붙어 있다 — 문항이 길어도 사라지지 않는다. */}
      <View style={st.qHead}>
        <Text style={st.qHeadStore} numberOfLines={1}>{info.storeName}</Text>
        <StepProgress step={at + 1} total={items.length} title={info.courseName} />
      </View>

      <KeyboardShift>
        <ScrollView
          ref={scroller}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={st.body}
          showsVerticalScrollIndicator={false}
        >
          <Appear style={st.qWrap}>
            {items.map((it, i) => {
              const Renderer = QUIZ_RENDERERS[it.format];
              const ask = typeof it.payload?.ask === 'string' ? it.payload.ask : '';
              const on = i === at;
              return (
                <View
                  key={it.id}
                  style={[st.qWrap, !on && st.hidden]}
                  pointerEvents={on ? 'auto' : 'none'}
                  accessibilityElementsHidden={!on}
                  importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
                >
                  {ask ? <Text style={st.ask}>{ask}</Text> : null}
                  <Renderer
                    payload={it.payload ?? {}}
                    disabled={false}
                    result={null}
                    onAnswer={(res) => setAnswers((prev) => prev.map((v, j) => (j === i ? res : v)))}
                  />
                </View>
              );
            })}
          </Appear>
        </ScrollView>
      </KeyboardShift>

      <View style={st.foot}>
        {/* 안 푼 문항이 있다는 것은 **낼 때** 말한다 — 문항마다 말하면 잔소리가 된다. */}
        {last && unanswered > 0 ? (
          <Text style={st.footNote}>아직 {unanswered}문제 안 풀었어요</Text>
        ) : null}
        <View style={st.navRow}>
          <Pressable
            onPress={() => move(at - 1)}
            disabled={at === 0}
            style={({ pressed }) => [st.navBack, at === 0 && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="이전 문제"
          >
            <Text style={st.navBackText}>이전</Text>
          </Pressable>
          <Pressable
            onPress={() => (last ? submit() : move(at + 1))}
            disabled={last && unanswered === items.length}
            style={({ pressed }) => [
              st.cta, st.navNext,
              last && unanswered === items.length && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={last ? '답 제출하기' : '다음 문제'}
          >
            <Text style={st.ctaText}>{last ? '제출하기' : '다음 문제'}</Text>
          </Pressable>
        </View>
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
  consent: { fontSize: 12, fontWeight: '600', color: InkColors.ink3, lineHeight: 18, textAlign: 'center' },
  // 링크는 글자만이지만 터치 타깃은 hitSlop 으로 넓힌다 — RN-web 이 hitSlop 을 무시하므로 minHeight 도 같이.
  consentLinkHit: { alignSelf: 'center', minHeight: 32, justifyContent: 'center', marginBottom: Space.xs },
  consentLink: { fontSize: 12, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },

  // 응시 중 상단 고정 머리 — 스크롤 밖이라 문항이 길어도 매장·진행이 남는다.
  qHead: {
    paddingHorizontal: Space.gutter, paddingTop: Space.md, paddingBottom: Space.sm,
    gap: Space.sm, borderBottomWidth: 1, borderBottomColor: InkColors.line,
  },
  qHeadStore: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  // 지금 문항이 아닌 것은 자리도 차지하지 않는다(마운트는 유지 — 고른 답을 들고 있어야 한다).
  hidden: { display: 'none' },
  ask: { fontSize: 17, fontWeight: '800', color: InkColors.ink, lineHeight: 25, marginBottom: Space.sm },
  doneNote: { fontSize: 13, fontWeight: '700', color: BrandColors.warnText, textAlign: 'center', lineHeight: 19 },

  foot: { paddingHorizontal: Space.gutter, paddingTop: Space.sm, paddingBottom: Space.lg, borderTopWidth: 1, borderTopColor: InkColors.line },
  footNote: { fontSize: 13, fontWeight: '700', color: BrandColors.warnText, textAlign: 'center', marginBottom: Space.sm },
  navRow: { flexDirection: 'row', alignItems: 'stretch', gap: Space.sm },
  // 되돌아가기는 보조 동작이라 흰 버튼이다 — Primary 는 화면당 하나(오른쪽)다.
  navBack: {
    minWidth: 92, minHeight: 56, paddingHorizontal: Space.lg, borderRadius: Radius.md, borderWidth: 1,
    borderColor: InkColors.line, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  navBackText: { fontSize: 16, fontWeight: '800', color: InkColors.ink2 },
  navNext: { flex: 1 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
