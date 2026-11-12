import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { PickRow } from '@/components/blocks/PickRow';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { fetchEntries, proposeToStore } from '@/lib/db';
import { placeErrorMessage } from '@/lib/place/errors';
import { CONNECT, SPACE_KNOWHOW, SPACE_WORDS } from '@/lib/place/words';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry } from '@/types';

const LIST = '/space/knowhow';
/** 서버 propose_to_store 의 한 번 상한(too_many_entries). 화면도 같은 수에서 멈춘다. */
const MAX_PICK = 50;

/**
 * S12 매장과 연결하기(공간 주인 · 결정 128·130·143·192~194 · night-1111 g5).
 *  ① 어느 매장에 보낼까요? = 내가 직원·매니저인 매장(세션 매장 목록 · 사장 매장은 서버가 거절한다). 하나면 골라 둔다.
 *     없으면 안내 + [초대코드 넣기] → 직원 허브 코드 칸.
 *  ② 보낼 노하우 = 발행된 공간 노하우 체크(50개까지 · ?entry= 로 오면 그 노하우를 골라 둔다).
 *  [사장님께 보내기] → propose_to_store(0580 판정 · 사장 알림은 서버가 보낸다) → 토스트 → S04.
 * 들어오는 길(S04 줄 · S08 버튼)은 my_connect_store_open 이 참일 때만 그린다. 주소로 바로 와도 서버가 feature_off 로 막는다.
 */
export default function SpaceConnect() {
  const router = useRouter();
  const { entry } = useLocalSearchParams<{ entry?: string }>();
  const spaceId = useSessionStore((s) => s.spaceId);
  const allStores = useSessionStore((s) => s.stores);
  const stores = useMemo(() => allStores.filter((s) => s.role === 'junior' || s.role === 'manager'), [allStores]);

  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [store, setStore] = useState('');
  const [picked, setPicked] = useState<string[]>(() => (typeof entry === 'string' && entry ? [entry] : []));
  const [busy, setBusy] = useState(false);
  // 이미 승인 대기인 노하우(묶음이 already_proposed 로 거절됐을 때 서버가 짚어 준 것 · 1112 fix 9). 다음 보내기 결과로 바뀐다.
  const [already, setAlready] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!spaceId) return;
    setFailed(false);
    const { data, error } = await fetchEntries(spaceId);
    if (error) return setFailed(true);
    const live = data.filter((e) => e.status === 'published');
    setEntries(live);
    // 골라 둔 것 중 지금 보낼 수 없는 것(지움·초안)은 뺀다.
    setPicked((prev) => prev.filter((id) => live.some((e) => e.id === id)));
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const chosenStore = store || (stores.length === 1 ? stores[0].unit_id : '');
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = (id: string) =>
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_PICK) {
        showToast(CONNECT.pickMax, 'info');
        return prev;
      }
      return [...prev, id];
    });

  const send = async () => {
    if (busy || !spaceId || !chosenStore || picked.length === 0) return;
    setBusy(true);
    const r = await proposeToStore(spaceId, chosenStore, picked);
    setBusy(false);
    setAlready(new Set(r.alreadyIds));
    if (r.error) {
      // 짚을 줄이 있으면 그 줄에 칩을 달고 빼라고 말한다. 옛 서버(번호 없음)는 지금 문구 그대로.
      showToast(r.alreadyIds.length > 0 ? CONNECT.alreadyToast : placeErrorMessage(r.error), 'warn');
      return;
    }
    showToast(CONNECT.sent(r.data.length || picked.length), 'good');
    router.replace(LIST);
  };

  const header = <ScreenTitleHeader title={SPACE_WORDS.connectStore} backFallback={LIST} />;

  if (stores.length === 0) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          title={CONNECT.noStoreTitle}
          body={CONNECT.connectNoStore}
          cta={{ label: SPACE_WORDS.enterCode, onPress: () => router.push('/junior/hub') }}
        />
      </Screen>
    );
  }

  const canSend = !!chosenStore && picked.length > 0 && !busy;

  return (
    <Screen header={header}>
      <Stack.Screen options={{ headerShown: false }} />
      <Section title={CONNECT.pickStore}>
        <View style={styles.card} accessibilityRole="radiogroup">
          {stores.map((s, i) => {
            const on = s.unit_id === chosenStore;
            return (
              <Pressable
                key={s.unit_id}
                onPress={() => setStore(s.unit_id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                // RN-web 은 radio 의 accessibilityState.checked 를 aria-checked 로 옮기지 않는다(11-12 실측) → 웹 읽기 프로그램용으로 직접 단다.
                aria-checked={on}
                accessibilityLabel={s.store_name}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {s.store_name}
                </Text>
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={Type.title.fontSize}
                  color={on ? BrandColors.goodText : TextColor.iconMuted}
                />
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title={CONNECT.pickEntries} hint={picked.length > 0 ? CONNECT.pickedCount(picked.length) : undefined}>
        {failed && !entries ? (
          <LoadErrorState title={CONNECT.loadFail} onRetry={() => void load()} />
        ) : !entries ? (
          <ScreenLoading label={CONNECT.loading} />
        ) : entries.length === 0 ? (
          <EmptyState
            title={CONNECT.noEntriesTitle}
            body={CONNECT.noEntriesBody}
            cta={{ label: SPACE_KNOWHOW.add, onPress: () => router.push('/space/write') }}
          />
        ) : (
          <PickRow
            rows={entries.map((e) => ({
              key: e.id,
              title: e.title,
              picked: pickedSet.has(e.id),
              chips: already.has(e.id) ? [{ text: CONNECT.alreadyChip, tone: 'warn' as const }] : undefined,
              onToggle: () => toggle(e.id),
            }))}
          />
        )}
      </Section>

      {entries && entries.length > 0 ? (
        <Pressable
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={CONNECT.send}
          accessibilityState={{ disabled: !canSend, busy }}
          style={({ pressed }) => [styles.primary, !canSend && styles.off, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>{busy ? CONNECT.sending : CONNECT.send}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...CardStyles.rows },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowTitle: { ...Type.body, fontWeight: '700', flex: 1 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  primary: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
});
