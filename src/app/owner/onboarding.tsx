import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { templatesForIndustry, forkTemplate, type PlaybookTemplate } from '@/data/knowhowPacks';
import { getCategoryMeta, ALL_CATEGORIES } from '@/lib/utils/category';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { PressableScale } from '@/components/PressableScale';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Space, SCREEN_GUTTER, CONTENT_MAX_WIDTH, frameCapStyle } from '@/lib/theme/layout';
import { Radius, Elevation } from '@/lib/theme/elevation';
import type { Category } from '@/types';

// 사장 온보딩 — 업종 표준 노하우 팩에서 '선택 → 자동등록'. 빈 매장(노하우 0건) 죽음의 나선 차단.
// 레이아웃: ① 추천 묶음 한 번에 담기(결정 최소화) → ② '직접 고르기' 접이식 카테고리 섹션(미세조정).
// 추천 항목 프리체크(기본 ≥5) → 매장 노하우로 fork(needs_review 배지). [[project_squaretable_onboarding]]
const MIN_RECOMMENDED = 5;

export default function OwnerOnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; industry?: string }>();
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const unitId = useSessionStore((s) => s.unitId);
  const sessionIndustry = useSessionStore((s) => s.industry);
  const sessionInvite = useSessionStore((s) => s.inviteCode);
  const addEntry = usePlaybookStore((s) => s.add);

  const industry = (params.industry as string) || sessionIndustry;
  const inviteCode = (params.code as string) || sessionInvite || '------';

  const templates = useMemo(() => templatesForIndustry(industry), [industry]);
  const recommended = useMemo(() => templates.filter((t) => t.recommended), [templates]);

  // 카테고리별 묶음(직접 고르기 섹션) — SQUARE 4분류 순서, 비어있는 카테고리는 제외.
  const byCategory = useMemo(
    () =>
      ALL_CATEGORIES.map((cat) => ({ cat, items: templates.filter((t) => t.category === cat) })).filter(
        (g) => g.items.length > 0,
      ),
    [templates],
  );
  // 추천 묶음 카테고리 분해(돌발 3·루틴 2 …) — 히어로 카드 칩.
  const recByCat = useMemo(() => {
    const m = new Map<Category, number>();
    recommended.forEach((t) => m.set(t.category, (m.get(t.category) ?? 0) + 1));
    return ALL_CATEGORIES.filter((c) => m.has(c)).map((c) => ({ cat: c, count: m.get(c) as number }));
  }, [recommended]);

  // 추천은 미리 체크 — 기본값만으로 목표(≥5)를 충족시킨다.
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(templates.map((t) => [t.id, Boolean(t.recommended)])),
  );
  const [expanded, setExpanded] = useState(false); // '직접 고르기' 펼침
  const [step, setStep] = useState<'pick' | 'done'>('pick');
  const [registeredCount, setRegisteredCount] = useState(0);
  // 더블탭으로 onRegister가 두 번 돌아 중복 적재되는 걸 막는다(setStep 반영 전 재호출 가드).
  const committed = useRef(false);

  const selectedCount = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);
  const toggle = (id: string) => setChecked((p) => ({ ...p, [id]: !p[id] }));

  const allRecommendedOn = recommended.length > 0 && recommended.every((t) => checked[t.id]);
  // 추천 묶음 토글 — 전부 켜져 있으면 빼고, 아니면 추천 전체를 담는다.
  const toggleBundle = () =>
    setChecked((p) => {
      const target = !allRecommendedOn;
      const next = { ...p };
      recommended.forEach((t) => {
        next[t.id] = target;
      });
      return next;
    });
  // 카테고리 '전체' 토글.
  const toggleCategory = (items: PlaybookTemplate[]) =>
    setChecked((p) => {
      const target = !items.every((t) => p[t.id]);
      const next = { ...p };
      items.forEach((t) => {
        next[t.id] = target;
      });
      return next;
    });

  const onRegister = () => {
    if (committed.current) return;
    const picks = templates.filter((t) => checked[t.id]);
    if (picks.length === 0) return;
    committed.current = true;
    picks.forEach((t) => addEntry(forkTemplate(t, { unitId, creatorId: userId, creatorName: userName })));
    setRegisteredCount(picks.length);
    showToast(`노하우 ${picks.length}개를 등록했어요`, 'good');
    setStep('done');
  };

  // 건너뛰기도 완료 화면을 거친다 — 초대코드를 한 번은 보여주기 위함(0건으로 done 진입).
  const onSkip = () => setStep('done');
  const goDashboard = () => router.replace('/owner/dashboard');

  // ── 완료 화면 ──
  if (step === 'done') {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.doneWrap, frameCapStyle]}>
          <Text style={styles.doneEmoji}>🎉</Text>
          {registeredCount > 0 ? (
            <>
              <Text style={styles.doneTitle}>노하우 {registeredCount}개로 시작해요</Text>
              <Text style={styles.doneSub}>
                이제 알바가 물어보면 AI가 이 노하우로 대신 답해줘요.{'\n'}
                <Text style={styles.doneStrong}>‘미확인’ 표시</Text>가 붙은 건 나중에 우리 매장에 맞게 다듬어 주세요.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.doneTitle}>가게가 만들어졌어요</Text>
              <Text style={styles.doneSub}>
                지금은 건너뛰었어요. 대시보드의 <Text style={styles.doneStrong}>‘추천 노하우 깔기’</Text>로{'\n'}
                언제든 노하우를 한 번에 추가할 수 있어요.
              </Text>
            </>
          )}

          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>직원 초대코드</Text>
            <Text style={styles.codeText}>{inviteCode}</Text>
            <Text style={styles.codeHint}>직원이 회원가입에서 이 코드를 넣으면 바로 합류돼요.</Text>
          </View>

          <PressableScale onPress={goDashboard} scaleTo={0.97} style={styles.primary}>
            <Text style={styles.primaryText}>대시보드로 들어가기</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  // ── 선택 화면 ──
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Appear delay={0} style={styles.intro}>
          <Text style={styles.introEmoji}>👋</Text>
          <Text style={styles.introTitle}>알바가 물어볼 걸,{'\n'}미리 답을 깔아둘게요</Text>
          <Text style={styles.introBody}>
            {industry ? `${industry} ` : ''}매장에서 자주 생기는 일을 모아뒀어요. 추천 묶음으로 바로 시작하거나,
            직접 골라 담을 수 있어요.
          </Text>
        </Appear>

        {/* ① 추천 묶음 — 결정 최소화. 한 번에 담기(추천 전체 토글) */}
        {recommended.length > 0 && (
          <Appear delay={60}>
            <Pressable
              onPress={toggleBundle}
              style={({ pressed }) => [styles.bundle, allRecommendedOn && styles.bundleOn, pressed && { opacity: 0.95 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allRecommendedOn }}
              accessibilityLabel={`도입 1일차 필수 ${recommended.length}개 한 번에 담기`}
            >
              <View style={styles.bundleHead}>
                <View style={styles.bundleIcon}>
                  <Ionicons name="sparkles" size={16} color={InkColors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bundleKicker}>도입 1일차 필수</Text>
                  <Text style={styles.bundleTitle}>{recommended.length}개 한 번에 담기</Text>
                </View>
                <View style={[styles.bundleCheck, allRecommendedOn && styles.bundleCheckOn]}>
                  {allRecommendedOn && <Ionicons name="checkmark" size={18} color={InkColors.bubbleText} />}
                </View>
              </View>

              {/* 카테고리 분해 칩 */}
              <View style={styles.chipRow}>
                {recByCat.map(({ cat, count }) => {
                  const cm = getCategoryMeta(cat);
                  return (
                    <View key={cat} style={styles.chip}>
                      <View style={[styles.chipDot, { backgroundColor: cm.color }]} />
                      <Text style={styles.chipText}>
                        {cm.label} {count}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* 예시 미리보기 — 추상적이지 않게 첫 3개 제목 */}
              <Text style={styles.bundlePreview} numberOfLines={1}>
                {recommended.slice(0, 3).map((t) => t.title).join('  ·  ')}
                {recommended.length > 3 ? ' …' : ''}
              </Text>
            </Pressable>
          </Appear>
        )}

        {/* ② 직접 고르기 — 접이식 카테고리 섹션(미세조정) */}
        <Appear delay={120} style={styles.pickerWrap}>
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={({ pressed }) => [styles.discloseRow, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.discloseTitle}>직접 고르기</Text>
              <Text style={styles.discloseSub}>필요한 것만 더하거나 빼요 · 지금 {selectedCount}개</Text>
            </View>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={InkColors.ink3} />
          </Pressable>

          {expanded && (
            <Appear delay={0} style={styles.groups}>
              {byCategory.map(({ cat, items }) => {
                const cm = getCategoryMeta(cat);
                const allOn = items.every((t) => checked[t.id]);
                return (
                  <View key={cat} style={styles.group}>
                    <SectionLabel
                      title={`${cm.emoji} ${cm.label}`}
                      trailing={
                        <Pressable onPress={() => toggleCategory(items)} hitSlop={8} style={styles.catAll}>
                          <Text style={styles.catAllText}>{allOn ? '전체 해제' : '전체 선택'}</Text>
                        </Pressable>
                      }
                    />
                    <View style={styles.rows}>
                      {items.map((t) => (
                        <TemplateRow key={t.id} tpl={t} on={!!checked[t.id]} onToggle={() => toggle(t.id)} />
                      ))}
                    </View>
                  </View>
                );
              })}
            </Appear>
          )}
        </Appear>

        <View style={{ height: 168 }} />
      </ScrollView>

      {/* 하단 고정 액션 바 — 풀폭 1차 CTA + 그 아래 중앙 '건너뛰기' 고스트(계층 분리) */}
      <View style={styles.barWrap}>
        <View style={[styles.bar, frameCapStyle]}>
          {selectedCount < MIN_RECOMMENDED && (
            <Text style={styles.barNudge}>최소 {MIN_RECOMMENDED}개는 등록하길 권해요 (지금 {selectedCount}개)</Text>
          )}
          <PressableScale
            onPress={onRegister}
            scaleTo={0.98}
            disabled={selectedCount === 0}
            style={[styles.cta, selectedCount === 0 && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel={selectedCount > 0 ? `${selectedCount}개 우리 매장에 담기` : '노하우를 골라주세요'}
          >
            <Text style={[styles.ctaText, selectedCount === 0 && styles.ctaTextOff]}>
              {selectedCount > 0 ? `우리 매장에 담기 · ${selectedCount}개` : '노하우를 골라주세요'}
            </Text>
          </PressableScale>
          <Pressable onPress={onSkip} hitSlop={8} style={styles.skip}>
            <Text style={styles.skipText}>건너뛰기</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function TemplateRow({ tpl, on, onToggle }: { tpl: PlaybookTemplate; on: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.9 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={tpl.title}
    >
      <View style={[styles.check, on && styles.checkOn]}>
        {on && <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {tpl.title}
        </Text>
        <Text style={styles.rowSit} numberOfLines={1}>
          {tpl.square.situation}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bgSoft },
  scroll: {
    padding: SCREEN_GUTTER,
    paddingTop: Space.lg,
    gap: Space.lg,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
  },

  intro: { gap: Space.sm, paddingTop: Space.sm },
  introEmoji: { fontSize: 34 },
  introTitle: { fontSize: 24, fontWeight: '900', color: InkColors.ink, lineHeight: 32 },
  introBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },

  // ① 추천 묶음 카드
  bundle: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e2,
  },
  bundleOn: { borderColor: InkColors.ink },
  bundleHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  bundleIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bundleKicker: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  bundleTitle: { fontSize: 18, fontWeight: '900', color: InkColors.ink, marginTop: 1 },
  bundleCheck: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bundleCheckOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: Space.md,
  },
  chipDot: { width: 7, height: 7, borderRadius: Radius.pill },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  bundlePreview: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600' },

  // ② 직접 고르기(접이식)
  pickerWrap: { gap: Space.md },
  discloseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    ...Elevation.e1,
  },
  discloseTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  discloseSub: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },

  groups: { gap: Space.lg, marginTop: Space.xs },
  group: { gap: Space.sm },
  catAll: { paddingVertical: 2, paddingHorizontal: Space.sm },
  catAllText: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },

  rows: { gap: Space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    ...Elevation.e1,
  },
  rowOn: { borderColor: InkColors.ink },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  rowTitle: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink },
  rowSit: { fontSize: 12.5, color: InkColors.ink3, lineHeight: 17, marginTop: 1 },

  // 하단 고정 바
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
    gap: Space.sm,
    ...Elevation.e2,
  },
  barNudge: { fontSize: 12, color: BrandColors.warn, fontWeight: '700', textAlign: 'center' },
  cta: {
    backgroundColor: InkColors.ink,
    paddingVertical: Space.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    ...Elevation.e2,
  },
  ctaOff: { backgroundColor: InkColors.line, ...Elevation.e1 },
  ctaText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
  ctaTextOff: { color: InkColors.ink3 },
  skip: { alignSelf: 'center', paddingVertical: Space.sm, paddingHorizontal: Space.lg },
  skipText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },

  // 완료 화면
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.md },
  doneEmoji: { fontSize: 52 },
  doneTitle: { fontSize: 23, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  doneSub: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  doneStrong: { fontWeight: '800', color: InkColors.ink },
  codeCard: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.xl,
    alignItems: 'center',
    gap: 4,
    marginTop: Space.sm,
    ...Elevation.e1,
  },
  codeLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  codeText: { fontSize: 32, fontWeight: '900', letterSpacing: 7, color: InkColors.ink },
  codeHint: { fontSize: 12, color: InkColors.ink3, textAlign: 'center' },
  primary: {
    marginTop: Space.md,
    backgroundColor: InkColors.ink,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
});
