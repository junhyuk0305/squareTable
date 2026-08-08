/**
 * 풀어보기 — 사장이 자기가 만든 문항을 **직원이 보는 화면 그대로** 직접 풀어본다.
 * 문항 목록(저장된 것)과 편집 시트(저장 전 초안) 두 곳에서 연다. 새 라우트는 만들지 않는다.
 *
 * ★ 여기서는 클라 채점(FORMATS[f].grade)이 정당하다 — 사장 화면의 payload 는 정답이 붙은 원본이고
 *   사장은 그 정답을 이미 안다(formats/spec.ts grade 주석 (a)). 직원 응시 경로는 서버 채점 그대로다.
 *
 * 저장·통계·AI 호출 0건. 여기서 푼 것은 어디에도 기록되지 않는다.
 */

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

import type { QuizFormat, QuizResponse } from '@/lib/quiz/types';
import { FORMATS } from '@/lib/quiz/formats';
import { previewAnswer } from '@/lib/quiz/preview';
import { QUIZ_RENDERERS } from '@/components/work/quiz';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { SheetHead, GhostButton, qst } from './kit';

/** 저장 전 초안도 그대로 풀어볼 수 있게 QuizItem 이 아니라 필요한 세 가지만 받는다. */
export type QuizPreviewTarget = {
  /** 있으면 좌우 배치의 씨앗이 된다(같은 문항 = 같은 배치). 저장 전 초안은 없을 수 있다. */
  id?: string;
  format: QuizFormat;
  payload: Record<string, any>;
};

export function QuizPreviewSheet({ quiz, onClose }: { quiz: QuizPreviewTarget; onClose: () => void }) {
  // 다시 풀기 = 렌더러 리마운트(key). 렌더러가 고른 답을 자기 안에 들고 있어 상태 리셋이 그 방법뿐이다.
  const [round, setRound] = useState(0);
  const [res, setRes] = useState<QuizResponse | null>(null);

  const spec = FORMATS[quiz.format];
  const Renderer = QUIZ_RENDERERS[quiz.format];
  const payload = useMemo(() => quiz.payload ?? {}, [quiz.payload]);

  // DB의 format 은 자유 text 라 레지스트리에 없는 값이 올 수 있다 — 빈 화면 대신 안내로 떨어뜨린다.
  const usable = !!Renderer && !!spec;
  const correct = res === null || !usable ? null : spec.grade(payload, res);
  // 서버 grade_quiz 와 같은 모양 — 맞았으면 answer 를 주지 않는다(렌더러가 내 답을 정답으로 그린다).
  const result = correct === null ? null : { correct, answer: correct ? null : previewAnswer(quiz.format, payload) };

  const explain = String(quiz.payload?.explain ?? '').trim();
  const ask = String(quiz.payload?.ask ?? '').trim();

  const retry = () => {
    setRes(null);
    setRound((r) => r + 1);
  };

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '84%' }}>
      <SheetHead title="풀어보기" onClose={onClose} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} showsVerticalScrollIndicator={false}>
        <Text style={pst.kicker}>{spec?.label ?? quiz.format} · 직원에게 이렇게 보여요</Text>
        {ask ? <Text style={pst.ask}>{ask}</Text> : null}

        {usable ? (
          <Renderer
            key={round}
            payload={payload}
            disabled={res !== null}
            result={result}
            onAnswer={setRes}
          />
        ) : (
          <Text style={qst.emptyText}>이 형태는 아직 미리보기를 지원하지 않아요.</Text>
        )}

        {result ? (
          <View style={pst.gradeBox}>
            <Text style={[pst.gradeTitle, { color: result.correct ? BrandColors.goodText : BrandColors.badText }]}>
              {result.correct ? '맞았어요' : '아쉬워요'}
            </Text>
            {explain ? <Text style={pst.gradeText}>{explain}</Text> : null}
          </View>
        ) : null}
      </ScrollView>

      {usable ? (
        <View style={qst.foot}>
          <GhostButton icon="refresh-outline" label="다시 풀기" onPress={retry} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const pst = StyleSheet.create({
  kicker: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3, marginTop: Space.xs },
  ask: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 24, marginBottom: Space.xs },
  gradeBox: {
    borderRadius: Radius.md, backgroundColor: InkColors.bgSoft,
    padding: Space.lg, marginTop: Space.lg, gap: Space.xs,
  },
  gradeTitle: { fontSize: 15, fontWeight: '800', lineHeight: 22 },
  gradeText: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },
});
