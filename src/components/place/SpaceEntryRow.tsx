import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Section } from '@/components/Screen';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { SPACE_SCREEN } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { Space, Gap } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/**
 * 계정 층(stores) "내 공간" 줄 하나 — 2번 덩이 임시 입구. 정식 [공간|매장] 칸은 4번 덩이(S18)다.
 * 보이는 사람 = 공간을 쓸 수 있는 계정(my_kind_features 의 space/enter · 허용 목록)만. 그 밖에는 아무것도 안 그린다.
 *  · 내가 주인인 공간이 있으면 → 들어가기(enter_space) → /space/home
 *  · 없고 공간을 만들 수 있는 계정이면 → "공간 만들기" → /space/start
 *  · 사장 계정은 새 공간을 못 만든다(서버 owner_cannot_create_space) → 공간이 없으면 줄도 없다.
 * 참여 중인 공간(멤버 · S17)은 4번 덩이에서 줄을 더한다.
 */
export function SpaceEntryRow() {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const spaceOpen = useSessionStore((s) => s.spaceOpen);
  const spaces = useSessionStore((s) => s.spaces);
  const isOwnerAccount = useSessionStore((s) => s.isOwnerAccount);
  const signupRole = useSessionStore((s) => s.signupRole);
  const loadSpaces = useSessionStore((s) => s.loadSpaces);
  const enterSpace = useSessionStore((s) => s.enterSpace);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (userId) void loadSpaces();
  }, [userId, loadSpaces]);

  if (spaceOpen !== true) return null;
  const mine = spaces.find((s) => s.role === 'space_owner');
  const canCreate = !isOwnerAccount && signupRole !== 'owner';
  if (!mine && !canCreate) return null;

  const onPress = async () => {
    if (busy) return;
    if (!mine) return router.push('/space/start');
    setBusy(true);
    const { error } = await enterSpace(mine.id);
    setBusy(false);
    if (error) return showToast(error);
    router.replace('/space/home');
  };

  const title = mine ? mine.name : SPACE_SCREEN.entryCreate;
  const hint = busy ? SPACE_SCREEN.entryOpening : mine ? SPACE_SCREEN.entryEnterHint : SPACE_SCREEN.entryCreateHint;
  return (
    <Section title={SPACE_SCREEN.entryTitle}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <Ionicons name={mine ? 'library-outline' : 'add'} size={Type.title.fontSize} color={InkColors.ink} />
        <View style={styles.texts}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={Type.title.fontSize} color={InkColors.ink3} />
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  card: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  pressed: { opacity: 0.7 },
  texts: { flex: 1, minWidth: 0, gap: Gap.inline },
  title: { ...Type.body, fontWeight: '800' },
  hint: { ...Type.desc, color: TextColor.secondary },
});
