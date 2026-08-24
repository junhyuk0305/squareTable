import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { EmptyState } from '@/components/EmptyState';
import { Appear } from '@/components/Appear';
import { StepProgress } from '@/components/blocks/StepProgress';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

/**
 * 매장 용어 연습 — 탭해서 답을 보고 스스로 채점하는 **비공식 연습**.
 *
 * ★★이 화면은 퀴즈가 아니다. 채점 파이프라인 **밖**이다.
 *   · `FORMATS`(lib/quiz/formats)·`QUIZ_RENDERERS`(components/work/quiz)에 등록하지 않는다.
 *   · `quiz_attempts`·`quiz_attempt_items` 에 아무것도 쓰지 않는다 — 서버 왕복이 0인 읽기 전용 화면이다.
 *   · 통과 판정(`knowhow_understanding`)에 영향을 주지 않는다.
 *   같은 스키마에 억지로 얹으면 `quiz_attempts` 의 "본인만 읽음" RLS 와 정답 유출 차단 전제가 흔들린다.
 *   점수가 남지 않는 연습이라 성격 자체가 다르다 → 별도 화면으로 분리한다.
 *
 * 자가 채점(알았어요/헷갈려요) 결과는 **이 화면의 state 로만** 산다. 화면을 나가면 사라진다 —
 * 남기면 그 순간 "기록되는 평가"가 되어 부담 0 이라는 이 화면의 유일한 존재 이유가 사라진다.
 *
 * 07-29 게임 설계 규칙: 설명 0줄 · 탭만 한 손 · 즉시 판정 · 틀려도 진행 · 소리 없음.
 * 화면 유형 C(몰입형) — 블록 ≤3(진행 표시 · 카드 · 자가 채점 행) · 한 화면 한 항목 · 상단 n/m.
 */

/** 카드 한 장. 앞면 = 무엇에 대한 값인가, 뒷면 = 그 값. */
type TermCard = {
  id: string;
  /** 앞면 질문 — 노하우 제목(= 매장이 부르는 이름) */
  clue: string;
  /** 무슨 값인지(예: "시럽 양"). standard 로 구조화돼 있을 때만 있다. */
  label: string | null;
  /** 뒷면 답 — 예: "3펌프" */
  answer: string;
};

/**
 * 발행된 노하우에서 카드를 뽑는다.
 *
 * 앞/뒷면을 가르는 규칙은 하나다 — **제목 ↔ 그 노하우가 말하는 값 하나**.
 *
 * ★★카드의 답은 **반드시 하나**여야 하고, **무엇에 대한 값인지 말할 수 있어야** 한다.
 *   자가 채점("알았어요")은 그 둘이 다 될 때만 뜻이 있다 — 뒷면이 "30분 · 45분 · 15분"이면
 *   무엇을 알았다는 건지 스스로도 판정할 수 없고, 뒷면이 그냥 "1회"면 **무엇이 1회인지**를 모른다.
 *   그래서 `standard`(사장이 등록 화면에서 구조로 넣은 값)만 카드로 만든다 — 그것만이
 *   "무슨 값인지"를 라벨로 같이 들고 온다. 그 밖은 **조용히 건너뛴다.**
 *
 *   ⛔본문에서 숫자 하나를 뽑아 쓰던 갈래를 지웠다(2026-08-25 실측). 제목이 곧 질문인데 본문
 *   숫자에는 이름이 없어서 `취객·고성·난동 → 1회` 같은 뜻 없는 카드가 실제로 나왔다.
 *   숫자가 하나뿐이라는 사실은 그 숫자가 그 노하우의 **핵심 값**이라는 뜻이 아니다.
 *
 *   재료가 이렇게 얇으면 화면은 빈 상태로 떨어지고, 그 빈 상태가 이유를 말한다 —
 *   억지 카드를 내는 것보다 "아직 연습할 용어가 없어요"가 정직하다.
 */
function buildCards(entries: PlaybookEntry[]): TermCard[] {
  const out: TermCard[] = [];
  for (const e of entries) {
    const clue = String(e?.title ?? '').trim();
    if (!clue) continue;

    // 1) standard(count) — 라벨 + 값 + 단위가 구조로 들어와 있다.
    //    spectrum 은 "양끝 라벨 사이 위치"라 딱 떨어지는 답이 없어 카드로 만들지 않는다.
    const st = e?.square?.standard;
    const stUnit = st?.kind === 'count' ? String(st.unit ?? '').trim() : '';
    if (stUnit && Number.isFinite(Number(st?.value)) && Number(st?.value) > 0) {
      out.push({
        id: e.id,
        clue,
        label: String(st?.label ?? '').trim() || null,
        answer: `${Number(st?.value)}${stUnit}`,
      });
      continue;
    }
    // 라벨 없는 값은 카드가 되지 않는다 — 위 주석의 ⛔ 참조.
  }
  return out;
}

export default function JuniorTermPracticeScreen() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);
  // 읽기 실패를 "값이 없음"으로 위장하지 않는다 — 위장하면 백엔드 장애가
  // "사장님이 아직 값을 안 적었다"로 읽힌다(둘러보기와 같은 SSOT).
  const loadError = usePlaybookStore((s) => s.loadError);
  const hydrate = usePlaybookStore((s) => s.hydrate);

  // 발행된 노하우만. status 없는 시드도 통과시킨다(둘러보기와 같은 필터).
  const cards = useMemo(
    () => buildCards(entries.filter((e) => e.status === 'published' || !e.status)),
    [entries],
  );

  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  /** 이번 판에서 "헷갈려요"를 누른 카드 id — 다시 보기 덱의 재료. 서버에 남기지 않는다. */
  const [unsure, setUnsure] = useState<string[]>([]);
  /** 다시 보기 판이면 그 덱. null 이면 첫 판(전체 덱). */
  const [reviewDeck, setReviewDeck] = useState<TermCard[] | null>(null);

  const deck = reviewDeck ?? cards;
  const card = deck[idx];

  const restart = (next: TermCard[] | null) => {
    setReviewDeck(next);
    setIdx(0);
    setFlipped(false);
    setUnsure([]);
  };

  // 즉시 판정 · 틀려도 진행 — 어느 쪽을 눌러도 다음 장으로 넘어간다. 되묻지 않는다.
  const grade = (knew: boolean) => {
    if (!card) return;
    if (!knew) setUnsure((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    setFlipped(false);
    setIdx((i) => i + 1);
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={InkColors.ink3} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 재료가 없다 — 빈 화면 대신 이유 + 다음 행동 ──
  if (cards.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {loadError ? (
          <EmptyState
            title="노하우를 불러오지 못했어요"
            body="연결을 확인하고 다시 시도해 주세요."
            cta={{ label: '다시 시도', onPress: () => hydrate() }}
          />
        ) : (
          <EmptyState
            title="아직 연습할 값이 없어요"
            body="노하우에 '무엇이 몇 개인지' 같은 기준 값이 적혀 있어야 카드를 만들 수 있어요. 지금은 그런 노하우가 없어요."
            cta={{ label: '노하우 둘러보기', onPress: () => router.replace('/junior/chat') }}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── 한 판 끝 ──
  if (!card) {
    const again = deck.filter((c) => unsure.includes(c.id));
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.body}>
          <Appear>
            <View style={styles.doneCard}>
              <Text style={styles.doneTitle}>{`${deck.length}장 다 봤어요`}</Text>
              <Text style={styles.doneBody}>
                {again.length > 0
                  ? `헷갈린다고 표시한 건 ${again.length}장이에요. 이 기록은 저장되지 않아요.`
                  : '전부 알았다고 표시했어요. 이 기록은 저장되지 않아요.'}
              </Text>
            </View>
          </Appear>
          {again.length > 0 ? (
            <Pressable
              onPress={() => restart(again)}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="헷갈린 것 다시 보기"
            >
              <Text style={styles.primaryText}>{`헷갈린 것 ${again.length}장 다시 보기`}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => restart(null)}
            style={({ pressed }) => [styles.softBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="처음부터 다시 보기"
          >
            <Text style={styles.softText}>처음부터 다시 보기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.body}>
        {/* 1) 진행 표시 — C형 필수. 제목은 지금 몇 번째 판인지를 말한다. */}
        <StepProgress
          step={idx + 1}
          total={deck.length}
          title={reviewDeck ? '헷갈린 것 다시 보기' : '매장 용어 연습'}
        />

        {/* 2) 카드 — 탭 한 번에 답이 열린다. 열린 뒤로는 탭이 아무 일도 하지 않는다. */}
        <Pressable
          onPress={() => setFlipped(true)}
          disabled={flipped}
          style={({ pressed }) => [styles.card, !flipped && pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={flipped ? `${card.clue} 답 ${card.answer}` : `${card.clue} 답 보기`}
        >
          {flipped ? (
            <>
              <Text style={styles.backClue}>{card.label ? `${card.clue} · ${card.label}` : card.clue}</Text>
              {/* 애니메이션은 프리미티브 2개만 쓴다 — 뒤집기 효과를 새로 만들지 않고 Appear 로 답만 올린다.
                  key 에 카드 id 를 넣어 다음 장에서도 다시 재생되게 한다. */}
              <Appear key={card.id} offsetY={6}>
                <Text style={styles.answer}>{card.answer}</Text>
              </Appear>
            </>
          ) : (
            <>
              <Text style={styles.clue}>{card.clue}</Text>
              {card.label ? <Text style={styles.label}>{card.label}</Text> : null}
              <Text style={styles.hint}>탭해서 답 보기</Text>
            </>
          )}
        </Pressable>

        {/* 3) 자가 채점 — 답을 본 뒤에만 나온다. 어느 쪽이든 다음 장으로 간다. */}
        {flipped ? (
          <View style={styles.selfRow}>
            <Pressable
              onPress={() => grade(false)}
              style={({ pressed }) => [styles.softBtn, styles.selfBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="헷갈려요"
            >
              <Text style={styles.softText}>헷갈려요</Text>
            </Pressable>
            <Pressable
              onPress={() => grade(true)}
              style={({ pressed }) => [styles.primaryBtn, styles.selfBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="알았어요"
            >
              <Text style={styles.primaryText}>알았어요</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: Space.gutter, paddingTop: Space.lg, gap: Space.lg },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
    // 앞뒤 내용 길이가 달라도 카드가 튀지 않게 바닥을 잡는다. 글자 배율이 올라가면 늘어나야 하므로 minHeight.
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    ...Elevation.e2,
  },
  clue: { fontSize: 17, lineHeight: 25, fontWeight: '800', color: InkColors.ink, textAlign: 'center' },
  label: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, textAlign: 'center' },
  hint: { fontSize: 12.5, color: InkColors.ink3, marginTop: Space.sm },
  backClue: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, textAlign: 'center' },
  answer: { fontSize: 26, lineHeight: 34, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },

  selfRow: { flexDirection: 'row', gap: Space.sm },
  selfBtn: { flex: 1 },

  // 화면의 유일한 '채운' 버튼 — Primary 1개 규칙.
  primaryBtn: {
    backgroundColor: BrandColors.brand,
    borderRadius: Radius.md,
    paddingVertical: Space.lg,
    alignItems: 'center',
  },
  primaryText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
  softBtn: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: Space.lg,
    alignItems: 'center',
  },
  softText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  pressed: { opacity: 0.85 },

  doneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.lg,
    gap: Space.xs,
    ...Elevation.e2,
  },
  doneTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink },
  doneBody: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
});
