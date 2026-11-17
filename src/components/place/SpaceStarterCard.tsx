import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Section } from '@/components/Screen';
import { SPACE_KNOWHOW, SPACE_SCREEN } from '@/lib/place/words';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { Type } from '@/lib/theme/type';

type Step = { key: 'write' | 'link' | 'answer'; title: string; hint: string; done: boolean };

/**
 * 공간 홈의 시작 카드(화면조립표 2026-11-17 5절) — 노하우 쓰기 → 교육 링크 만들기 → 질문에 답하기.
 * 2026-11-17 교육 탭(`space/teach.tsx`)의 처음 순서 안내를 옮겼다. 시작 안내는 홈 한 곳에만 둔다.
 *   진행 막대(매장 `hub/StarterChecklist` 의 barTrack·barFill 모양)와 제목 옆 n/단계 수를 더했다.
 * 지금 할 단계 하나만 주 버튼(노랑 · 화면조립표 10절 7번)이다. 교육 링크 스위치가 꺼져 있으면 2단계 줄을 뺀다.
 * 노하우와 링크가 둘 다 있으면 홈이 이 카드를 그리지 않는다(spaceHomeStage).
 */
export function SpaceStarterCard({
  knowhowCount,
  linkCount,
  linksOn,
  onWrite,
  onNewLink,
}: {
  knowhowCount: number;
  linkCount: number;
  linksOn: boolean;
  onWrite: () => void;
  onNewLink: () => void;
}) {
  const steps: Step[] = [
    { key: 'write', title: SPACE_KNOWHOW.guideWrite, hint: SPACE_KNOWHOW.guideWriteHint, done: knowhowCount > 0 },
    ...(linksOn ? [{ key: 'link' as const, title: SPACE_KNOWHOW.guideLink, hint: SPACE_KNOWHOW.guideLinkHint, done: linkCount > 0 }] : []),
    { key: 'answer', title: SPACE_KNOWHOW.guideAnswer, hint: SPACE_KNOWHOW.guideAnswerHint, done: false },
  ];
  const now = steps.find((s) => !s.done)?.key;
  const doneCount = steps.filter((s) => s.done).length;
  const primary = now === 'write' ? { label: SPACE_KNOWHOW.guideWrite, onPress: onWrite } : now === 'link' ? { label: SPACE_KNOWHOW.guideLink, onPress: onNewLink } : null;

  return (
    <Section title={SPACE_SCREEN.firstTitle} hint={SPACE_SCREEN.starterProgress(doneCount, steps.length)}>
      <View style={styles.card}>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${(doneCount / steps.length) * 100}%` }]} />
        </View>
        {steps.map((s, i) => (
          <View key={s.key} style={[styles.step, i > 0 && styles.rowLine]}>
            <View style={[styles.stepNo, s.done && styles.stepNoDone, s.key === now && styles.stepNoNow]}>
              {s.done ? (
                <Ionicons name="checkmark" size={Type.desc.fontSize} color={InkColors.bubbleText} />
              ) : (
                <Text style={[styles.stepNoText, s.key === now && styles.stepNoTextNow]}>{i + 1}</Text>
              )}
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, s.done && styles.doneTitle]}>{s.title}</Text>
              <Text style={styles.rowSub}>{s.hint}</Text>
            </View>
            {s.done ? <Text style={styles.doneTag}>{SPACE_KNOWHOW.guideDone}</Text> : null}
          </View>
        ))}
        {/* 지금 할 단계 버튼은 카드 안 맨 아래(R-14 · 버튼도 흰 카드 위). */}
        {primary ? (
          <Pressable
            onPress={primary.onPress}
            accessibilityRole="button"
            accessibilityLabel={primary.label}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>{primary.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Section>
  );
}

const STEP_DOT = TouchSize.inlineFace - Space.sm;

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: { ...CardStyles.rows },
  // 진행 막대 = 매장 시작 카드(hub/StarterChecklist)와 같은 모양.
  barTrack: { height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden', marginTop: Space.lg, marginBottom: Space.xs },
  barFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowText: { flex: 1, gap: Space.xs },
  rowTitle: { ...Type.body, fontWeight: '700' },
  rowSub: { ...Type.desc },
  // 순서 안내 한 줄 = 번호 원 + 제목·설명 + 끝난 단계면 "완료"(색만으로 구분하지 않는다).
  step: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md },
  stepNo: {
    width: STEP_DOT, height: STEP_DOT, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: InkColors.line,
  },
  stepNoNow: { borderColor: InkColors.ink },
  stepNoDone: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  stepNoText: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  stepNoTextNow: { color: InkColors.ink },
  doneTitle: { color: TextColor.secondary },
  doneTag: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  primary: { ...ButtonStyles.primaryYellow, marginBottom: Space.lg },
  primaryText: ButtonTextStyles.primaryOnYellow,
});
