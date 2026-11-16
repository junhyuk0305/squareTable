// StarterChecklist — 사장 "시작하기" 단계 카드. 사장 매장 홈과 사장 허브 '현황' 탭이 같이 쓴다(2026-11-17 화면 조립표 2차 0번).
//
// 신규 매장 첫날의 홈은 0뿐이라 죽은 화면이다. 이 카드가 "빈 → 씨앗 → 채워짐"의
// 안내자다: 4단계가 실데이터(owner_overview 0086 · 0840)에 반응하고, 전부 채워지면 사라진다.
// 판정은 starterProgress(SSOT)만 쓴다 — 여기서 재판정 금지.
// 버튼: 지금 할 단계 = 노란 주 버튼 하나(가로 꽉) · 남은 단계 = 보조 알약 · 끝낸 단계 = 체크만(버튼 없음).
// 단계마다 그 자리에서 할 수 있는 버튼이 있다(10절 5번). 허브는 이동만 한다 — 직원 초대는 복사하지 않고 직원 화면으로 간다.
// 콜드스타트 원칙: 0을 위험으로 표시하지 않는다(경고색 없음) · 책망 톤 금지("곧 채워질 자리").
import type { Ref } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { starterSteps, starterNextId, type StarterRow, type StarterStepId } from '@/lib/utils/starterProgress';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { useStoreInviteLink } from '@/components/owner/InviteBlock';
import { goToTab } from '@/components/RoleTabBar';
import { Section } from '@/components/Screen';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { CardStyles } from '@/lib/theme/card';
import { Type } from '@/lib/theme/type';
import { Space } from '@/lib/theme/layout';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

/** 단계 버튼 글. 직원 초대만 자리마다 다르다(홈 = 그 자리에서 복사 · 허브 = 직원 화면으로 이동). */
const STEP_CTA: Record<StarterStepId, string> = {
  knowhow: '추천 노하우 담기',
  invite: '초대 링크 복사',
  task: '할일 등록하기',
  quiz: '퀴즈 만들기',
};
const HUB_INVITE_CTA = '직원 초대하기';

/** 단계마다 가는 곳(홈·허브 같음 · 허브의 직원 초대만 아래에서 /owner/staff). */
const taskPath = (): Href => ({ pathname: '/owner/work', params: { view: 'todo', compose: String(Date.now()) } });
const STEP_PATH: Record<Exclude<StarterStepId, 'invite' | 'task'>, Href> = {
  knowhow: '/owner/onboarding',
  quiz: '/owner/quiz-new',
};

export function StarterChecklist({
  row,
  place,
  unitId,
  knowhowRef,
}: {
  row: StarterRow;
  /** 홈 = 이 매장 안 · 허브 = 매장 밖(goStore 로 들어간다). */
  place: 'home' | 'hub';
  /** 허브에서 들어갈 매장. 홈은 지금 매장이라 쓰지 않는다. */
  unitId?: string;
  /** 홈 첫 안내 말풍선이 비추는 자리(노하우 담기 버튼). */
  knowhowRef?: Ref<View>;
}) {
  const router = useRouter();
  const { goStore, switching } = useStoreNav();
  const invite = useStoreInviteLink('home');
  const steps = starterSteps(row);
  const doneCount = steps.filter((s) => s.done).length;
  const nextId = starterNextId(row);

  const onStep = (id: StarterStepId) => {
    if (place === 'hub') {
      if (!unitId || switching) return;
      const path: Href = id === 'invite' ? '/owner/staff' : id === 'task' ? taskPath() : STEP_PATH[id];
      void goStore(unitId, path);
      return;
    }
    if (id === 'invite') invite.copy();
    // 업무 채팅은 탭 화면이라 탭으로 간다(홈 '오늘'의 할일 등록하기와 같은 길).
    else if (id === 'task') goToTab(taskPath());
    else router.push(STEP_PATH[id]);
  };

  return (
    <Section title="시작하기">
      <View style={styles.card}>
        <View style={styles.headRow}>
          <Text style={styles.headText}>매장이 채워지는 중이에요</Text>
          <Text style={styles.headCount}>{doneCount}/{steps.length}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${(doneCount / steps.length) * 100}%` }]} />
        </View>

        {steps.map((s) => {
          const isNext = s.id === nextId;
          const label = place === 'hub' && s.id === 'invite' ? HUB_INVITE_CTA : STEP_CTA[s.id];
          const disabled = (place === 'home' && s.id === 'invite' && invite.disabled) || (place === 'hub' && !!switching);
          const button = s.done ? null : (
            <Pressable
              onPress={() => onStep(s.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled }}
              style={({ pressed }) => [
                isNext ? styles.nextBtn : ButtonStyles.secondary,
                disabled && styles.dim,
                pressed && { opacity: 0.85 },
              ]}
            >
              {isNext && s.id === 'invite' && place === 'home' && <Ionicons name="link-outline" size={16} color={InkColors.ink} />}
              <Text style={isNext ? ButtonTextStyles.primaryOnYellow : ButtonTextStyles.secondary}>{label}</Text>
            </Pressable>
          );
          return (
            <View key={s.id} style={styles.row}>
              <View style={styles.rowTop}>
                <View style={[styles.check, s.done && styles.checkOn]}>
                  {s.done && <Ionicons name="checkmark" size={13} color={InkColors.ink} />}
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, s.done && styles.rowTitleDone]} numberOfLines={1}>
                    {s.title}
                  </Text>
                  {/* 힌트는 다음 할 단계 하나에만 — 4줄 전부 설명을 달면 카드가 안내문이 된다. */}
                  {isNext && <Text style={styles.rowHint}>{s.hint}</Text>}
                </View>
                {!isNext && button}
              </View>
              {isNext && (
                <View ref={s.id === 'knowhow' ? knowhowRef : undefined} style={styles.nextWrap}>
                  {button}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  card: {
    ...CardStyles.rows,
    paddingVertical: Space.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Space.xs },
  headText: { ...Type.body, flex: 1, fontWeight: '800' },
  headCount: { fontSize: 13, fontWeight: '800', color: TextColor.secondary },
  barTrack: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft,
    overflow: 'hidden',
    marginBottom: Space.xs,
  },
  barFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },

  row: { paddingVertical: Space.sm, gap: Space.sm },
  // 큰 글씨에서 보조 알약이 제목을 밀지 않게 줄을 넘긴다.
  rowTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.sm },
  rowBody: { flex: 1, minWidth: 120 },
  check: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  rowTitle: { fontSize: Type.desc.fontSize, fontWeight: '700', color: InkColors.ink },
  rowTitleDone: { color: InkColors.ink3 },
  rowHint: { ...Type.desc, marginTop: 1 },
  nextWrap: { alignSelf: 'stretch' },
  nextBtn: { ...ButtonStyles.primaryYellow, flexDirection: 'row', gap: Space.xs },
  dim: { opacity: 0.4 },
});
