import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { SettingsSection, SettingsRow } from '@/components/settings/SettingsKit';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { fetchEntries, leaveSpace as rpcLeaveSpace } from '@/lib/db';
import { placeErrorMessage } from '@/lib/place/errors';
import { SPACE_KNOWHOW, SPACE_MEMBERS, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { TouchSize } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry } from '@/types';

/**
 * S17 참여 중인 공간(멤버) — 그 공간 노하우 읽기 · 공간 나가기. 착지 = 매장 탭 [공간] 줄 · N8 알림(/space/joined/<번호>).
 * 공간에 들어가는 일은 공간 _layout 이 경로의 번호로 먼저 한다(여기 오면 spaceId = 그 공간 · 역할 = 멤버).
 * 묻기는 아직 없다(멤버 묻기 = 다음 덩이). 숨기지 않고 한 줄로 알린다(SPACE_WORDS.askSoon).
 * 나가기: confirmAction 한 번 · 되돌리기 없음. 나간 뒤 앱의 공간 상태를 비운다(목록 다시 읽기).
 */
export default function SpaceJoined() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setFailed(false);
    const { data, error } = await fetchEntries(spaceId);
    // 못 읽었으면 빈 목록으로 위장하지 않는다.
    if (error) setFailed(true);
    else setEntries(data);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const leave = async () => {
    if (busy || !spaceId) return;
    const ok = await confirmAction(SPACE_MEMBERS.leaveTitle, SPACE_MEMBERS.leaveBody, SPACE_MEMBERS.leave, {
      destructive: true,
      icon: 'exit-outline',
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await rpcLeaveSpace(spaceId);
    setBusy(false);
    if (error) {
      showToast(placeErrorMessage(error), 'warn');
      return;
    }
    showToast(SPACE_MEMBERS.left, 'good');
    // 먼저 공간 밖으로 옮긴 뒤 상태를 비운다. 거꾸로면 문지기가 이 경로의 공간에 다시 들어가려 한다.
    router.replace('/stores');
    const s = useSessionStore.getState();
    s.leaveSpace();
    void s.loadSpaces();
  };

  return (
    <Screen header={<ScreenTitleHeader title={spaceName || SPACE_WORDS.place} backFallback="/stores" />}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.note}>{SPACE_WORDS.askSoon}</Text>
      {failed && !entries ? (
        <LoadErrorState title={SPACE_KNOWHOW.loadFail} onRetry={() => void load()} />
      ) : !entries ? (
        <ScreenLoading label={SPACE_KNOWHOW.loading} />
      ) : entries.length === 0 ? (
        <EmptyState title={SPACE_MEMBERS.joinedEmptyTitle} body={SPACE_MEMBERS.joinedEmptyBody} />
      ) : (
        <Section title={SPACE_MEMBERS.joinedKnowhow(entries.length)}>
          <View style={styles.card}>
            {entries.map((e, i) => {
              const isOpen = open === e.id;
              const steps = e.square?.action?.steps ?? [];
              const situation = e.square?.situation?.trim() ?? '';
              return (
                <View key={e.id} style={i > 0 ? styles.rowLine : undefined}>
                  <Pressable
                    onPress={() => setOpen(isOpen ? '' : e.id)}
                    accessibilityRole="button"
                    accessibilityLabel={e.title}
                    accessibilityState={{ expanded: isOpen }}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Text style={styles.rowTitle} numberOfLines={isOpen ? undefined : 1}>
                      {e.title}
                    </Text>
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={Type.body.fontSize} color={TextColor.iconMuted} />
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.body}>
                      {situation ? <Text style={styles.desc}>{situation}</Text> : null}
                      {steps.map((s, n) => (
                        <Text key={`${n}-${s}`} style={styles.step}>
                          {`${n + 1}. ${s}`}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Section>
      )}
      <SettingsSection>
        <SettingsRow first danger icon="exit-outline" label={SPACE_MEMBERS.leave} hint={SPACE_MEMBERS.leaveHint} onPress={() => void leave()} />
      </SettingsSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { ...Type.desc, color: TextColor.secondary },
  card: { ...CardStyles.rows },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowTitle: { ...Type.body, fontWeight: '700', flex: 1 },
  body: { gap: Space.xs, paddingBottom: Space.md },
  desc: { ...Type.desc },
  step: { ...Type.body },
});
