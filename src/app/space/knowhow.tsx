import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { connectStoreOpen, fetchEntries, subscribePlaybook } from '@/lib/db';
import { subscribeDebounced } from '@/lib/store/realtimeSync';
import { CONNECT, SPACE_KNOWHOW, SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, TouchSize } from '@/lib/theme/button';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry } from '@/types';

/** 쓰기 화면(S07). 고치기는 ?edit=노하우 번호 · 질문으로 남기기는 ?uqId= · 입력 미리 채우기는 ?seed=. */
const WRITE = '/space/write';

/**
 * S04 공간 노하우 탭(주인) — 내 공간 노하우 목록. 헤더 + → 쓰기(S07) · 행 → 상세(S08) · 비면 "노하우 쓰기" 버튼.
 * 읽기는 fetchEntries(공간 번호) 한 번(매장 스토어 usePlaybookStore 를 안 쓴다 · 공간 화면은 공간 번호를 넘긴다).
 * 탭에 돌아올 때마다 다시 읽는다(쓰기·고치기·지우기 뒤 바로 맞게).
 * ★night-1111 g5: 다른 기기에서 쓰거나 지운 노하우도 실시간으로 맞춘다(subscribePlaybook(공간 번호) · 300ms 묶음).
 *   "매장과 연결하기" 줄(S12 입구)은 my_connect_store_open 이 참일 때만 그린다(꺼진 계정 = 지금 화면 그대로).
 */
export default function SpaceKnowhow() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setFailed(false);
    const { data, error } = await fetchEntries(spaceId);
    // 못 읽었으면 빈 목록으로 위장하지 않는다(빈 화면 = "노하우 없음"이라는 사실 주장이 된다).
    if (error) setFailed(true);
    else setEntries(data);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!spaceId) return;
    return subscribeDebounced((cb) => subscribePlaybook(cb, spaceId), () => void load(), 300, 'space_knowhow');
  }, [spaceId, load]);

  useEffect(() => {
    let alive = true;
    void connectStoreOpen().then((r) => {
      if (alive) setConnectOpen(r.data === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const write = () => router.push(WRITE);

  const add = (
    <Pressable
      onPress={write}
      accessibilityRole="button"
      accessibilityLabel={SPACE_KNOWHOW.add}
      style={({ pressed }) => [styles.addHit, pressed && styles.pressed]}
    >
      <View style={styles.addFace}>
        <Ionicons name="add" size={Type.title.fontSize} color={InkColors.ink} />
      </View>
    </Pressable>
  );

  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabKnowhow} line={spaceName} right={add} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      {failed && !entries ? (
        <LoadErrorState title={SPACE_KNOWHOW.loadFail} onRetry={() => void load()} />
      ) : !entries ? (
        <ScreenLoading label={SPACE_KNOWHOW.loading} />
      ) : entries.length === 0 ? (
        <EmptyState title={SPACE_KNOWHOW.emptyTitle} body={SPACE_KNOWHOW.emptyBody} cta={{ label: SPACE_KNOWHOW.add, onPress: write }} />
      ) : (
        <>
        {connectOpen ? (
          <Pressable
            onPress={() => router.push('/space/connect')}
            accessibilityRole="button"
            accessibilityLabel={SPACE_WORDS.connectStore}
            style={({ pressed }) => [styles.connect, pressed && styles.pressed]}
          >
            <Ionicons name="storefront-outline" size={Type.title.fontSize} color={InkColors.ink} />
            <View style={styles.connectText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{SPACE_WORDS.connectStore}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{CONNECT.rowHint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={Type.body.fontSize} color={TextColor.iconMuted} />
          </Pressable>
        ) : null}
        <Section title={SPACE_KNOWHOW.count(entries.length)}>
          <View style={styles.card}>
            {entries.map((e, i) => (
              <Pressable
                key={e.id}
                onPress={() => router.push({ pathname: '/space/knowhow/[id]', params: { id: e.id } })}
                accessibilityRole="button"
                accessibilityLabel={e.title}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
                  {e.square?.situation ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{e.square.situation}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={Type.body.fontSize} color={TextColor.iconMuted} />
              </Pressable>
            ))}
          </View>
        </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addHit: { minWidth: TouchSize.inline, minHeight: TouchSize.inline, alignItems: 'center', justifyContent: 'center' },
  addFace: { ...ButtonStyles.iconCircle },
  pressed: { opacity: 0.7 },
  card: { ...CardStyles.rows },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowText: { flex: 1, gap: Space.xs },
  rowTitle: { ...Type.body, fontWeight: '700' },
  rowSub: { ...Type.desc },
  connect: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: TouchSize.inline },
  connectText: { flex: 1, minWidth: 0, gap: Gap.inline },
});
