import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';

import {
  fetchGuestAttemptItems,
  fetchGuestQuizSubmissions,
  markGuestQuizSubmission,
  type GuestAttemptItemRow,
  type GuestSubmissionRow,
} from '@/lib/db';
import { showToast } from '@/lib/store/useToastStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { PrimaryButton, GhostButton, qst } from '@/components/owner/quiz/kit';
import { maskTail4, scoreText, takenDayLabel } from '@/lib/quiz/guestResult';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 링크 응시 한 건의 문항별 결과 — 사장 전용.
 *
 * ★ payload 는 **응시 시점 스냅샷**이라(0160 §2) quiz_items 를 조인하지 않는다. 사장이 그 뒤에
 *   문항을 고쳤거나 지웠어도 여기 보이는 것은 응시자가 실제로 본 그 문항이다.
 * ★ 여기는 게스트 전용이다. 직원 응시는 문항별 이력을 만들지 않는다(0103·0112 그대로).
 * ⛔ "이 사람 뽑기"·"합류 초대" 같은 채용 전환 액션을 두지 않는다 — 명시적으로 스코프 밖이다.
 *   이 화면은 결과를 보여주는 데서 끝나고, 판단은 사장이 한다.
 */
export default function GuestQuizResultScreen() {
  const router = useRouter();
  const { sub } = useLocalSearchParams<{ sub: string }>();
  const submissionId = String(sub ?? '');

  const [card, setCard] = useState<GuestSubmissionRow | null>(null);
  const [items, setItems] = useState<GuestAttemptItemRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchGuestQuizSubmissions(), fetchGuestAttemptItems(submissionId)]).then(([subs, rows]) => {
      if (!alive) return;
      setCard(subs.find((s) => s.submissionId === submissionId) ?? null);
      setItems(rows);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [submissionId]);

  const correctCount = useMemo(() => items.filter((i) => i.correct).length, [items]);

  const mark = useCallback(
    async (action: 'reviewed' | 'cleared') => {
      if (busy) return;
      setBusy(true);
      // 실패하면 배너가 뜬다 — 화면에서만 처리된 것처럼 보이는 상태를 만들지 않는다.
      const ok = await guardWrite(
        markGuestQuizSubmission(submissionId, action),
        () => {},
        '처리하지 못했어요. 잠시 뒤 다시 해 주세요.',
      );
      setBusy(false);
      if (!ok) return;
      showToast(action === 'reviewed' ? '확인했어요' : '정리했어요', 'good');
      router.back();
    },
    [busy, router, submissionId],
  );

  const who = card ? `${card.guestName} · ${maskTail4(card.guestPhone)}` : '';

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '링크 응시 결과' }} />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {!loaded ? null : (
          <>
            <Appear>
              <View style={st.head}>
                <Text style={st.headWho} numberOfLines={1}>{who || '이름 없음'}</Text>
                <Text style={st.headScore}>
                  {items.length > 0
                    ? scoreText(correctCount, items.length)
                    : card
                      ? scoreText(card.correct, card.total)
                      : ''}
                </Text>
                {card ? <Text style={st.headMeta}>{takenDayLabel(card.takenAt)} 응시</Text> : null}
              </View>
            </Appear>

            {items.length === 0 ? (
              <Text style={qst.emptyText}>{'문항별 기록이 없어요.\n예전 링크로 푼 결과는 점수만 남아 있어요.'}</Text>
            ) : (
              <>
                <SectionLabel title="문항별" hint={`${items.length}문제`} />
                <View style={st.list}>
                  {items.map((it, i) => (
                    <ItemBlock key={it.id} item={it} no={i + 1} divider={i > 0} />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {loaded ? (
        <View style={st.foot}>
          <PrimaryButton label="확인했어요" onPress={() => void mark('reviewed')} disabled={busy} />
          <GhostButton icon="archive-outline" label="정리하기" onPress={() => void mark('cleared')} disabled={busy} />
          <Text style={st.footNote}>정리하면 목록에서 빠져요. 기록은 그대로 남아요.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** 문항 하나 — 질문 + 응시자가 고른 답 vs 정답. */
function ItemBlock({ item, no, divider }: { item: GuestAttemptItemRow; no: number; divider: boolean }) {
  const view = useMemo(() => readItem(item), [item]);
  const tone = item.correct ? BrandColors.goodText : BrandColors.badText;

  return (
    <View style={[st.block, divider && st.blockTop]}>
      <View style={st.blockHead}>
        <Text style={st.blockNo}>{no}번</Text>
        <Text style={[st.blockMark, { color: tone }]}>{item.correct ? '맞음' : '틀림'}</Text>
      </View>
      {view.ask ? <Text style={st.ask}>{view.ask}</Text> : null}

      {view.mode === 'choices' ? (
        <View style={st.lines}>
          {view.lines.map((l, i) => (
            <View key={i} style={st.line}>
              <Text style={[st.lineText, l.answer && st.lineAnswer]} numberOfLines={3}>{l.text}</Text>
              {l.picked || l.answer ? (
                <Text style={[st.lineTag, { color: l.answer ? BrandColors.goodText : BrandColors.badText }]}>
                  {l.picked && l.answer ? '고름 · 정답' : l.picked ? '고름' : '정답'}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={st.lines}>
          {/* 짝 맞추기처럼 "고른 답"을 되살릴 수 없는 형태는 지어내지 않고 이유를 말한다. */}
          {view.note ? (
            <Text style={st.pairText}>
              <Text style={st.pairLabel}>고른 답 · </Text>
              {view.note}
            </Text>
          ) : (
            <Text style={st.pairText}>
              <Text style={st.pairLabel}>고른 답 · </Text>
              {view.picked || '안 골랐어요'}
            </Text>
          )}
          <Text style={st.pairText}>
            <Text style={[st.pairLabel, { color: BrandColors.goodText }]}>정답 · </Text>
            {view.answer || '표시할 수 없어요'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── 스냅샷 payload → 사람이 읽는 모양 ────────────────────────────────────────
// ★18종을 전부 그리지 않는다. 선택지형(payload.choices + answer_index)이 8종이라 그것을 제대로
//   그리고, 나머지는 "고른 답 / 정답"을 **이름으로** 옮겨 적는다. index 숫자를 그대로 두지 않는다 —
//   사장은 "2"가 무슨 답이었는지 알 방법이 없다.
// ★형태를 늘려도 여기는 안 깨진다(DB format 은 자유 text). 모르는 형태는 맞음/틀림만 남는다.
//
// ★★ 여기는 **형태 추가 시 같이 고쳐야 하는 자리**다(2026-08-25 실측에서 드러났다).
//   0168 이 numeric_entry·mark_paragraph 를 넣고 이 파일을 안 고쳐서, 맞힌 문항인데도 사장 화면에
//   "고른 답 · 안 골랐어요 / 정답 · 표시할 수 없어요"가 떴다. flip_match·link_match 도 같은 상태였다.
//
// ★응답 좌표계에 주의한다. 응시자가 보낸 index 가 **무엇의 index 인지**가 형태마다 다르다:
//   · 스냅샷 payload 와 좌표계가 같은 것 — choices·sequence·cards·parts·items (그대로 이름을 붙일 수 있다)
//   · **서버가 섞은 배열**의 좌표계인 것 — flip_match(cards)·link_match(오른쪽 자리).
//     그 순열은 quiz_shuffle_seed(문항id, created_at) 로만 복원되고 클라에는 없다.
//     → 고른 답을 지어내지 않고 "왜 못 보여주는지"를 말한다(note).

type Line = { text: string; picked: boolean; answer: boolean };
type ItemView =
  | { mode: 'choices'; ask: string; lines: Line[] }
  | { mode: 'text'; ask: string; picked: string; answer: string; note?: string };

const txt = (v: any) => String(v ?? '').trim();
const list = (v: any): string[] => (Array.isArray(v) ? v.map((x) => txt(x)) : []);
const nums = (v: any): number[] => (Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : []);
/** index → 그 자리의 이름. 이름이 없으면 자리 번호로 떨어뜨린다(빈 칸보다 낫다). */
const nameAt = (labels: string[], i: number) => labels[i] || (Number.isInteger(i) ? `${i + 1}번째` : '');

/** 질문 — 형태마다 문제의 일부인 칸이 다르다(상황·단위·초성은 stripKeys 대상이 아니라 응시자도 봤다). */
function askOf(p: Record<string, any>): string {
  return [txt(p.situation), txt(p.ask), txt(p.chosung) ? `초성 ${txt(p.chosung)}` : ''].filter(Boolean).join('\n');
}

function readItem(item: GuestAttemptItemRow): ItemView {
  const p = item.payload ?? {};
  const res = item.response;
  const ask = askOf(p);

  // ── 선택지형 8종 + 틀린 자리 찾기 — 한 자리를 고르는 형태 ──
  const single: { labels: string[]; answer: number } | null =
    Array.isArray(p.choices) && Number.isInteger(p.answer_index)
      ? { labels: list(p.choices), answer: p.answer_index }
      : Array.isArray(p.sequence) && Number.isInteger(p.wrong_index)
        ? { labels: list(p.sequence), answer: p.wrong_index }
        : null;
  if (single) {
    const picked = typeof res === 'number' ? res : -1;
    return {
      mode: 'choices',
      ask,
      lines: single.labels.map((t, i) => ({ text: t, picked: i === picked, answer: i === single.answer })),
    };
  }

  // ── 지뢰 밟기 — 누른 카드 집합이 답이다 ──
  if (item.format === 'mine_tap' && Array.isArray(p.cards)) {
    const tapped = new Set(nums(res));
    return {
      mode: 'choices',
      ask,
      lines: (p.cards as any[]).map((c, i) => ({
        text: txt(c?.text),
        picked: tapped.has(i),
        answer: c?.is_mine === true,
      })),
    };
  }

  // ── 순서대로 누르기 — 순서가 곧 답이라 집합으로 그리면 뜻이 사라진다 ──
  if (item.format === 'order_build') {
    const labels = list(p.items);
    return {
      mode: 'text',
      ask,
      picked: nums(res).map((i) => nameAt(labels, i)).join(' → '),
      answer: nums(p.answer_seq).map((i) => nameAt(labels, i)).join(' → '),
    };
  }

  // ── 갈래 따라가기 — 밟아 온 길이 답이다(예=0 · 아니요=1) ──
  if (item.format === 'branch_path') {
    const path = (v: any) => nums(v).map((i) => (i === 0 ? '예' : '아니요')).join(' → ');
    return { mode: 'text', ask, picked: path(res), answer: path(p.answer_path) };
  }

  // ── 채워 넣기 — 누른 횟수 ──
  if (item.format === 'fill_count') {
    const unit = txt(p.unit);
    const n = (v: any) => (Number.isInteger(v) ? `${v}${unit ? ` ${unit}` : ''}` : '');
    return { mode: 'text', ask, picked: n(res), answer: n(p.target) };
  }

  // ── 빠른 판별 — 카드마다 두 버튼 중 하나 ──
  if (item.format === 'quick_judge' && Array.isArray(p.cards)) {
    const labels = list(p.labels);
    const got = nums(res);
    const line = (cards: any[], pick: (c: any, i: number) => number) =>
      cards.map((c, i) => `${txt(c?.text)} · ${labels[pick(c, i)] ?? '안 함'}`).join('\n');
    return {
      mode: 'text',
      ask,
      picked: line(p.cards as any[], (_c, i) => got[i]),
      answer: line(p.cards as any[], (c) => c?.answer),
    };
  }

  // ── 숫자로 답하기 — 친 숫자 하나. 단위를 붙여야 "62"가 무엇인지 읽힌다 ──
  if (item.format === 'numeric_entry') {
    const unit = txt(p.unit);
    const n = (v: any) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? `${Number(v)}${unit ? ` ${unit}` : ''}` : '');
    return { mode: 'text', ask, picked: n(res), answer: n(p.answer_value) };
  }

  // ── 잘못된 곳 짚기 — 누른 조각 집합이 답이다. parts 는 섞이지 않아 좌표계가 그대로다 ──
  //    누를 수 있는 조각(tap)만 줄로 세운다. 잇는 글까지 세우면 문단이 목록으로 흩어진다.
  if (item.format === 'mark_paragraph' && Array.isArray(p.parts)) {
    const tapped = new Set(nums(res));
    return {
      mode: 'choices',
      ask,
      lines: (p.parts as any[])
        .map((part, i) => ({ part, i }))
        .filter(({ part }) => part?.tap === true)
        .map(({ part, i }) => ({
          text: txt(part?.text),
          picked: tapped.has(i),
          answer: part?.is_wrong === true,
        })),
    };
  }

  // ── 짝 맞추기 두 형태 — 응답이 **서버가 섞은 자리**라 이름으로 못 되돌린다 ──
  //    (섞는 순열은 quiz_shuffle_seed 로만 복원되고 클라에는 없다.)
  //    맞았는지는 위 "맞음/틀림"이 이미 말한다. 여기서는 **정답 짝**만 정직하게 보여준다.
  if ((item.format === 'flip_match' || item.format === 'link_match') && Array.isArray(p.pairs)) {
    const pairs = (p.pairs as any[]).map((x) => `${txt(x?.left)} ↔ ${txt(x?.right)}`).filter((s) => s !== ' ↔ ');
    return {
      mode: 'text',
      ask,
      picked: '',
      answer: pairs.join('\n'),
      note: item.correct ? '짝을 다 맞췄어요' : '짝을 다 맞추지 못했어요',
    };
  }

  // 모르는 형태 — 지어내지 않는다. 맞음/틀림 표시는 위에 이미 있다.
  return { mode: 'text', ask, picked: '', answer: '' };
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl, gap: Space.md, flexGrow: 1 },

  head: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.xs,
  },
  headWho: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  headScore: { fontSize: 22, lineHeight: 28, fontWeight: '900', color: InkColors.ink },
  headMeta: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },

  list: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
  },
  block: { paddingVertical: Space.md, gap: Space.xs },
  blockTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  blockNo: { fontSize: 13, fontWeight: '800', color: InkColors.ink3 },
  blockMark: { fontSize: 13, fontWeight: '800' },
  ask: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: InkColors.ink },

  lines: { gap: Space.xs, marginTop: Space.xs },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, minHeight: 24 },
  lineText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 22, color: InkColors.ink2, fontWeight: '600' },
  lineAnswer: { color: InkColors.ink, fontWeight: '800' },
  lineTag: { fontSize: 12, fontWeight: '800', paddingTop: 2 },

  pairText: { fontSize: 15, lineHeight: 22, color: InkColors.ink, fontWeight: '600' },
  pairLabel: { fontWeight: '800', color: InkColors.ink3 },

  foot: {
    paddingHorizontal: Space.gutter,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: InkColors.bg,
    gap: Space.sm,
  },
  footNote: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },
});
