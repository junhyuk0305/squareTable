import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { PhoneVerifyBlock } from '@/components/PhoneVerifyBlock';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SPACE_SCREEN } from '@/lib/place/words';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Radius } from '@/lib/theme/elevation';
import { Space, Gap } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/** 첫 5분 화면. 다음 에이전트가 `src/app/space/first.tsx` 로 만든다(그 전까지 타입 경로 목록에 없어 Href 로 둔다). */
const FIRST: Href = '/space/first' as Href;

/** 공간 이름 상한 — 서버 create_space 와 같은 값(0375 ② · 40자 넘으면 invalid_argument). */
const NAME_MAX = 40;

/**
 * S02 공간 만들기 — 앞 단계(이름 → create_space → enter_space → 첫 5분 `/space/first`).
 * 첫 5분(노하우 3개 써 보기 · 직접 물어보기 · 링크 보내기)은 `/space/first` 가 맡는다(다음 에이전트).
 * 전화 미인증이면 서버가 PHONE_NOT_VERIFIED 로 막는다 → 그 자리에서 인증 단계를 연다(매장 만들기와 같은 부품).
 */
export default function SpaceStart() {
  const router = useRouter();
  const createSpace = useSessionStore((s) => s.createSpace);
  const enterSpace = useSessionStore((s) => s.enterSpace);
  const sessionPhone = useSessionStore((s) => s.phone);
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needPhone, setNeedPhone] = useState(false);
  const [phoneReady, setPhoneReady] = useState(false);
  // 만들기는 됐는데 들어가기가 실패하면, 다시 누를 때 새로 만들지 않고 들어가기만 한다(두 번째 공간은 서버가 거절한다).
  const [madeId, setMadeId] = useState<string | null>(null);

  const valid = name.trim().length > 0 && (!needPhone || phoneReady);

  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setErr(null);
    let id = madeId;
    if (!id) {
      const made = await createSpace(name);
      if (made.code === 'PHONE_NOT_VERIFIED') setNeedPhone(true);
      if (made.error || !made.spaceId) {
        setBusy(false);
        setErr(made.error);
        return;
      }
      id = made.spaceId;
      setMadeId(id);
    }
    const entered = await enterSpace(id);
    setBusy(false);
    if (entered.error) {
      setErr(entered.error);
      return;
    }
    router.replace(FIRST);
  };

  return (
    <Screen header={<ScreenTitleHeader title={SPACE_SCREEN.startTitle} backFallback="/stores" />}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.lead}>{SPACE_SCREEN.startLead}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>{SPACE_SCREEN.startNameLabel}</Text>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setErr(null);
            setName(v);
          }}
          editable={!madeId}
          maxLength={NAME_MAX}
          placeholder={SPACE_SCREEN.startNamePlaceholder}
          placeholderTextColor={TextColor.placeholder}
          returnKeyType="done"
          onSubmitEditing={submit}
          style={styles.input}
          accessibilityLabel={SPACE_SCREEN.startNameLabel}
        />
        {needPhone && (
          <PhoneVerifyBlock
            guide={SPACE_SCREEN.startPhoneGuide}
            okText={SPACE_SCREEN.startPhoneOk}
            initialPhone={sessionPhone}
            updateProfile={updateProfile}
            onVerifiedChange={setPhoneReady}
          />
        )}
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <Pressable
          disabled={busy || !valid}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={SPACE_SCREEN.startSubmit}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed, (busy || !valid) && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={InkColors.bubbleText} accessibilityLabel={SPACE_SCREEN.startBusy} />
          ) : (
            <Text style={styles.primaryText}>{SPACE_SCREEN.startSubmit}</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { ...Type.body, color: TextColor.secondary },
  card: { ...CardStyles.list, gap: Space.sm },
  label: { ...Type.desc, fontWeight: '700' },
  input: {
    ...Type.body,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    backgroundColor: Surface.input,
  },
  err: { ...Type.desc, color: BrandColors.accentText },
  primary: { ...ButtonStyles.primary, backgroundColor: InkColors.ink, marginTop: Gap.inline },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
