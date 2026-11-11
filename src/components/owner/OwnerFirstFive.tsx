// OwnerFirstFive — 사장 첫 5분 새 순서(8번 · 결정 116). ① 직원 초대 → ② 질문 던져보기 → [끝내기].
// 스위치 ('store','ask_first') 가 켜진 계정만 이 부품을 본다(owner/onboarding 이 고른다). 꺼진 계정은 옛 순서 그대로.
// 템플릿 고르기는 여기서 뺐다. 노하우 탭 템플릿 보관함(/owner/templates)은 그대로다.
// 질문 던져보기는 AI 를 부르지 않는다. 업종 노하우팩에서 초안을 찾는다(src/lib/knowhow/packDraft.ts).
import { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { KeyboardShift } from '@/components/KeyboardShift';
import { InviteBlock } from '@/components/owner/InviteBlock';
import { PackDraftCard, confirmedPackEntry } from '@/components/owner/PackDraftCard';
import { PressableScale } from '@/components/PressableScale';
import { Appear, stagger } from '@/components/Appear';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { packDraftFrom, packDraftSeed } from '@/lib/knowhow/packDraft';
import { templatesForIndustry } from '@/data/knowhowPacks';
import { OWNER_FIRST, PACK_DRAFT } from '@/lib/place/words';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { Space, Gap, screenScrollStyle, frameCapStyle } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

const INPUT_MAX = 200;

export function OwnerFirstFive({
  inviteCode,
  industry,
  startAtAsk,
  onFinish,
}: {
  inviteCode: string;
  industry: string;
  /** 허브 재진입(?step=ask) = ② 로 바로. 끝내면 원래 화면으로 돌아간다. */
  startAtAsk: boolean;
  onFinish: () => void;
}) {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId);
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const role = useSessionStore((s) => s.role);
  const addEntry = usePlaybookStore((s) => s.add);

  const [step, setStep] = useState<'invite' | 'ask'>(startAtAsk ? 'ask' : 'invite');
  const [input, setInput] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const templates = useMemo(() => templatesForIndustry(industry), [industry]);
  const hit = useMemo(() => (asked ? packDraftFrom(asked, templates) : null), [asked, templates]);

  const ask = () => {
    const q = input.trim();
    if (!q) return;
    setSaved(false);
    setAsked(q);
  };

  const confirm = async () => {
    if (!hit || busy || !unitId) return;
    setBusy(true);
    const ok = await addEntry(confirmedPackEntry(hit.item, { unitId, userId, userName, role }));
    setBusy(false);
    if (!ok) { showToast(PACK_DRAFT.saveFail, 'warn'); return; }
    showToast(OWNER_FIRST.firstSaved, 'good');
    setSaved(true);
    setAsked(null);
    setInput('');
  };

  const openCoach = (seed: string) => router.push({ pathname: '/owner/coach', params: { seed } } as never);

  if (step === 'invite') {
    return (
      <ScrollView contentContainerStyle={[screenScrollStyle, frameCapStyle]} showsVerticalScrollIndicator={false}>
        <Appear delay={stagger(0)} style={s.intro}>
          <Text style={s.title}>{OWNER_FIRST.inviteTitle}</Text>
          <Text style={s.desc}>{OWNER_FIRST.inviteBody}</Text>
        </Appear>
        <Appear delay={stagger(1)}>
          <InviteBlock code={inviteCode} from="onboarding" />
        </Appear>
        <Appear delay={stagger(2)}>
          <PressableScale onPress={() => setStep('ask')} scaleTo={0.97} style={s.ghost} accessibilityRole="button" accessibilityLabel={OWNER_FIRST.next}>
            <Text style={s.ghostText}>{OWNER_FIRST.next}</Text>
          </PressableScale>
        </Appear>
      </ScrollView>
    );
  }

  const canAsk = !!input.trim();
  return (
    <KeyboardShift>
      <ScrollView contentContainerStyle={[screenScrollStyle, frameCapStyle]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Appear delay={stagger(0)} style={s.intro}>
          <Text style={s.title}>{OWNER_FIRST.askTitle}</Text>
          <Text style={s.desc}>{OWNER_FIRST.askBody}</Text>
        </Appear>

        <View style={s.askRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={OWNER_FIRST.askPlaceholder}
            placeholderTextColor={TextColor.placeholder}
            style={s.input}
            maxLength={INPUT_MAX}
            returnKeyType="search"
            onSubmitEditing={ask}
            accessibilityLabel={OWNER_FIRST.askTitle}
          />
          <PressableScale onPress={ask} disabled={!canAsk} scaleTo={0.97} style={[s.askBtn, !canAsk && s.dim]} accessibilityRole="button" accessibilityLabel={OWNER_FIRST.askButton}>
            <Text style={s.askBtnText}>{OWNER_FIRST.askButton}</Text>
          </PressableScale>
        </View>

        {saved && (
          <View style={s.savedRow}>
            <Ionicons name="checkmark-circle" size={18} color={BrandColors.good} />
            <Text style={s.savedText}>{OWNER_FIRST.firstSaved}</Text>
          </View>
        )}

        {asked && hit && (
          <PackDraftCard item={hit.item} busy={busy} onConfirm={() => void confirm()} onEdit={() => openCoach(packDraftSeed(hit.item))} />
        )}

        {asked && !hit && (
          <View style={s.noDraft}>
            <Text style={s.noDraftTitle}>{OWNER_FIRST.noDraftTitle}</Text>
            <Text style={s.desc}>{OWNER_FIRST.noDraftBody}</Text>
            <PressableScale onPress={() => openCoach(asked)} scaleTo={0.97} style={s.ghost} accessibilityRole="button" accessibilityLabel={OWNER_FIRST.writeOwn}>
              <Text style={s.ghostText}>{OWNER_FIRST.writeOwn}</Text>
            </PressableScale>
          </View>
        )}

        {/* 끝내기 — 초안 카드가 떠 있으면 Primary 는 [맞아요] 하나다. 카드가 없을 때만 끝내기가 Primary 다. */}
        <PressableScale
          onPress={onFinish}
          scaleTo={0.97}
          style={asked && hit ? s.ghost : s.primary}
          accessibilityRole="button"
          accessibilityLabel={startAtAsk ? OWNER_FIRST.backToHub : OWNER_FIRST.finish}
        >
          <Text style={asked && hit ? s.ghostText : s.primaryText}>{startAtAsk ? OWNER_FIRST.backToHub : OWNER_FIRST.finish}</Text>
        </PressableScale>
      </ScrollView>
    </KeyboardShift>
  );
}

const s = StyleSheet.create({
  intro: { gap: Gap.inline },
  title: { ...Type.title },
  desc: { ...Type.desc },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  input: {
    ...Type.body,
    flex: 1,
    minHeight: ButtonStyles.primary.minHeight,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: Surface.input,
  },
  askBtn: { ...ButtonStyles.primary, alignSelf: 'auto', backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.lineStrong },
  askBtnText: { ...ButtonTextStyles.small, color: InkColors.ink },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  savedText: { ...Type.body, fontWeight: '700' },
  noDraft: { ...CardStyles.list, gap: Gap.item },
  noDraftTitle: { ...Type.section },
  ghost: { ...ButtonStyles.primary, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { ...ButtonTextStyles.primary, color: InkColors.ink },
  primary: { ...ButtonStyles.primary, backgroundColor: BrandColors.brand },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  dim: { opacity: 0.5 },
});
