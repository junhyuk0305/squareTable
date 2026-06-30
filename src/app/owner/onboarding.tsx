import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { templatesForIndustry, forkTemplate, type PlaybookTemplate } from '@/data/knowhowPacks';
import { getCategoryMeta } from '@/lib/utils/category';
import { Appear } from '@/components/Appear';
import { PressableScale } from '@/components/PressableScale';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Space, SCREEN_GUTTER, CONTENT_MAX_WIDTH, frameCapStyle } from '@/lib/theme/layout';
import { Radius, Elevation } from '@/lib/theme/elevation';

// 사장 온보딩 — 업종 표준 노하우 팩에서 '선택 → 자동등록'. 빈 매장(노하우 0건) 죽음의 나선 차단.
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
  const rest = useMemo(() => templates.filter((t) => !t.recommended), [templates]);

  // 추천은 미리 체크 — 기본값만으로 목표(≥5)를 충족시킨다.
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(templates.map((t) => [t.id, Boolean(t.recommended)])),
  );
  const [step, setStep] = useState<'pick' | 'done'>('pick');
  const [registeredCount, setRegisteredCount] = useState(0);
  // 더블탭으로 onRegister가 두 번 돌아 중복 적재되는 걸 막는다(setStep 반영 전 재호출 가드).
  const committed = useRef(false);

  const selectedCount = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);
  const toggle = (id: string) => setChecked((p) => ({ ...p, [id]: !p[id] }));

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
            {industry ? `${industry} ` : ''}매장에서 자주 생기는 일을 모아뒀어요.{'\n'}
            우리 가게에 해당하는 것만 골라 <Text style={styles.introStrong}>탭</Text>하세요. 나머지는 나중에 추가해도 돼요.
          </Text>
        </Appear>

        {recommended.length > 0 && (
          <Appear delay={60} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>먼저 이 {recommended.length}가지부터</Text>
              <Text style={styles.groupHint}>도입 1일차에 가장 많이 묻는 것 · 미리 선택됨</Text>
            </View>
            {recommended.map((t) => (
              <TemplateRow key={t.id} tpl={t} on={!!checked[t.id]} onToggle={() => toggle(t.id)} />
            ))}
          </Appear>
        )}

        {rest.length > 0 && (
          <Appear delay={120} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>더 많은 노하우</Text>
              <Text style={styles.groupHint}>필요한 것만 추가로 골라보세요</Text>
            </View>
            {rest.map((t) => (
              <TemplateRow key={t.id} tpl={t} on={!!checked[t.id]} onToggle={() => toggle(t.id)} />
            ))}
          </Appear>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* 하단 고정 액션 바 */}
      <View style={styles.barWrap}>
        <View style={[styles.bar, frameCapStyle]}>
          {selectedCount < MIN_RECOMMENDED && (
            <Text style={styles.barNudge}>최소 {MIN_RECOMMENDED}개는 등록하길 권해요 (지금 {selectedCount}개)</Text>
          )}
          <View style={styles.barRow}>
            <Pressable onPress={onSkip} hitSlop={8} style={styles.skip}>
              <Text style={styles.skipText}>건너뛰기</Text>
            </Pressable>
            <PressableScale
              onPress={onRegister}
              scaleTo={0.97}
              disabled={selectedCount === 0}
              style={[styles.cta, selectedCount === 0 && styles.ctaOff]}
            >
              <Text style={styles.ctaText}>
                {selectedCount > 0 ? `${selectedCount}개 우리 매장에 등록하기` : '노하우를 골라주세요'}
              </Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function TemplateRow({ tpl, on, onToggle }: { tpl: PlaybookTemplate; on: boolean; onToggle: () => void }) {
  const cm = getCategoryMeta(tpl.category);
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.9 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={tpl.title}
    >
      <View style={[styles.check, on && styles.checkOn]}>
        {on && <Ionicons name="checkmark" size={15} color={InkColors.bubbleText} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {tpl.title}
        </Text>
        <Text style={styles.rowSit} numberOfLines={2}>
          {tpl.square.situation}
        </Text>
        <View style={styles.rowMeta}>
          <View style={[styles.catDot, { backgroundColor: cm.color }]} />
          <Text style={styles.rowMetaText}>{cm.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bgSoft },
  scroll: { padding: SCREEN_GUTTER, paddingTop: Space.lg, gap: Space.lg, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%' },

  intro: { gap: Space.sm, paddingTop: Space.sm },
  introEmoji: { fontSize: 34 },
  introTitle: { fontSize: 24, fontWeight: '900', color: InkColors.ink, lineHeight: 32 },
  introBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  introStrong: { fontWeight: '800', color: InkColors.ink },

  group: { gap: Space.sm },
  groupHead: { gap: 2, marginBottom: Space.xs },
  groupTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  groupHint: { fontSize: 12, color: InkColors.ink3 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    padding: Space.md,
    ...Elevation.e1,
  },
  rowOn: { borderColor: InkColors.ink },
  check: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  rowTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  rowSit: { fontSize: 13, color: InkColors.ink2, lineHeight: 18, marginTop: 2 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  rowMetaText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },

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
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  skip: { paddingVertical: Space.sm, paddingHorizontal: Space.xs },
  skipText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  cta: { flex: 1, backgroundColor: InkColors.ink, paddingVertical: Space.lg, borderRadius: Radius.md, alignItems: 'center' },
  ctaOff: { backgroundColor: InkColors.line },
  ctaText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },

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
  primary: { marginTop: Space.md, backgroundColor: InkColors.ink, paddingVertical: Space.lg, paddingHorizontal: Space.xl, borderRadius: Radius.md, alignItems: 'center', alignSelf: 'stretch' },
  primaryText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
});
