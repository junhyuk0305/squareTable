/**
 * 교육 링크 만들기(S10 · 공간 주인) — 노하우 고르기 · 기간 · 제목(선택) → 만들기 → 주소 복사.
 *
 * ★아직 들어오는 길이 없다(공간 입구가 꺼져 있다 · 의도). 들어올 때 공간 번호를 `?unit=` 으로 받는다.
 *   공간 노하우는 RLS(0371)가 "지금 들어가 있는 공간"(auth_space_id)일 때만 내준다.
 * ★고르기는 처음에 아무것도 골라 두지 않는다. "전부 고르기"도 두지 않는다(무엇을 보낼지는 주인이 하나씩 정한다).
 * ★비워도 만들 수 있다. 빈 링크는 받는 사람에게 "궁금한 걸 물어보세요"로 보인다(S14 빈 링크).
 * 공유는 주소 복사다. 퀴즈 링크·초대 링크와 같은 shareText(웹·네이티브 모두 클립보드)를 쓴다.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Appear } from '@/components/Appear';
import { PickRow } from '@/components/blocks/PickRow';
import { DayChips } from '@/components/edu/DayChips';
import { createEduLink, fetchEduLinkPickEntries, type EduLinkPickEntry } from '@/lib/db';
import { eduErrorMessage } from '@/lib/edu/errors';
import { EDU_LINK_DAY_OPTIONS, EDU_LINK_DEFAULT_DAYS, eduLinkUrl } from '@/lib/edu/link';
import { EDU_WORDS } from '@/lib/edu/words';
import { copyLinkToast, COPY_LINK_LABEL } from '@/lib/quiz/link';
import { shareText } from '@/lib/utils/shareText';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { EmptyStyles } from '@/lib/theme/empty';
import { Radius } from '@/lib/theme/elevation';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

export default function EduLinkNewScreen() {
  const router = useRouter();
  const { unit } = useLocalSearchParams<{ unit?: string }>();
  const unitId = typeof unit === 'string' ? unit : '';

  const [list, setList] = useState<EduLinkPickEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const loadKey = `${unitId}:${retry}`;
  const ready = !unitId || loadedFor === loadKey;

  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<number>(EDU_LINK_DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; token: string } | null>(null);

  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void fetchEduLinkPickEntries(unitId).then((r) => {
      if (!alive) return;
      setList(r.data ?? []);
      setFailed(!!r.error);
      setLoadedFor(loadKey);
    });
    return () => { alive = false; };
  }, [unitId, loadKey]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = async () => {
    if (busy || !unitId) return;
    setBusy(true);
    const r = await createEduLink(unitId, { title: title.trim(), entryIds: picked, days });
    setBusy(false);
    if (r.error || !r.data) { showToast(eduErrorMessage(r.error)); return; }
    setMade({ id: r.data.id, token: r.data.token });
  };

  const copy = async () => {
    if (!made) return;
    const t = copyLinkToast(await shareText(eduLinkUrl(made.token)));
    if (t) showToast(t.text, t.tone);
  };

  const header = <ScreenTitleHeader title="교육 링크 만들기" backFallback />;

  if (!unitId || (ready && failed)) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadErrorState title="노하우를 불러오지 못했어요" onRetry={() => setRetry((n) => n + 1)} />
      </Screen>
    );
  }

  if (!ready) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenLoading label="노하우를 불러오고 있어요…" />
      </Screen>
    );
  }

  // 만든 뒤 — 주소와 복사 하나. 상세(S11)로 가면 넣기·빼기·기간·닫기를 한다.
  if (made) {
    return (
      <Screen header={header}>
        <Stack.Screen options={{ headerShown: false }} />
        <Appear style={st.doneCard}>
          <Text style={st.doneTitle}>링크를 만들었어요</Text>
          <Text style={st.url} selectable>{eduLinkUrl(made.token)}</Text>
          <Text style={st.desc}>주소를 복사해 카톡으로 보내 주세요.</Text>
        </Appear>
        <Pressable
          onPress={() => void copy()}
          accessibilityRole="button"
          accessibilityLabel={COPY_LINK_LABEL}
          style={({ pressed }) => [st.cta, pressed && st.pressed]}
        >
          <Text style={st.ctaText}>{COPY_LINK_LABEL}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace({ pathname: '/space/link/[id]', params: { id: made.id, unit: unitId } })}
          accessibilityRole="button"
          accessibilityLabel="링크 상세 보기"
          style={({ pressed }) => [st.textBtn, pressed && st.pressed]}
        >
          <Text style={st.textBtnText}>링크 상세 보기</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <Stack.Screen options={{ headerShown: false }} />

      <Section title="담을 노하우" hint={picked.length > 0 ? `${picked.length}개 고름` : undefined}>
        {list.length === 0 ? (
          <View style={EmptyStyles.box}>
            <Text style={EmptyStyles.text}>아직 노하우가 없어요.{'\n'}비워 둬도 링크를 만들 수 있어요.</Text>
          </View>
        ) : (
          <PickRow
            rows={list.map((e) => ({
              key: e.id,
              title: e.title,
              // 초안은 발행해야 받는 사람에게 보인다(서버 edu_link_entries 가 발행본만 준다).
              chips: e.status === 'draft' ? [{ text: '초안' }] : undefined,
              picked: pickedSet.has(e.id),
              onToggle: () => toggle(e.id),
            }))}
          />
        )}
      </Section>

      <Section title="기간">
        <DayChips options={EDU_LINK_DAY_OPTIONS} value={days} onChange={setDays} />
      </Section>

      <Section title="제목" hint="선택">
        <TextInput
          style={st.input}
          value={title}
          onChangeText={setTitle}
          placeholder="예) 첫 출근 전에 읽어 주세요"
          placeholderTextColor={TextColor.placeholder}
          maxLength={40}
          returnKeyType="done"
          accessibilityLabel="링크 제목"
        />
        <Text style={st.desc}>비우면 &apos;{EDU_WORDS.link}&apos;로 보여요.</Text>
      </Section>

      <Pressable
        onPress={() => void create()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="링크 만들기"
        style={({ pressed }) => [st.cta, busy && st.busy, pressed && st.pressed]}
      >
        <Text style={st.ctaText}>링크 만들기</Text>
      </Pressable>
    </Screen>
  );
}

const st = StyleSheet.create({
  input: {
    minHeight: 52, paddingHorizontal: Space.md,
    borderWidth: 1, borderColor: InkColors.lineStrong, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    ...Type.body,
  },
  desc: { ...Type.desc, fontWeight: '600' },
  cta: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  busy: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  doneCard: { ...CardStyles.list, gap: Gap.inline },
  doneTitle: { ...Type.section },
  // 띄어쓰기 없는 주소는 RN-web Text 기본 word-wrap 이 끊는다(ui.md 줄바꿈).
  url: { ...Type.body, color: InkColors.ink, marginTop: Space.sm },
  textBtn: { ...ButtonStyles.inlineHit, alignSelf: 'center', paddingHorizontal: Space.lg },
  textBtnText: { ...Type.body, fontWeight: '700', color: InkColors.ink2, textDecorationLine: 'underline' },
});
