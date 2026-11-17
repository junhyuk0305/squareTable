import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { KnowhowRows, type KnowhowRow } from '@/components/blocks/KnowhowRows';
import { formatRelative } from '@/components/coach/coachUtils';
import { getSectionMeta } from '@/lib/utils/category';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { archiveEntry, connectStoreOpen, fetchEntries } from '@/lib/db';
import { CONNECT, SPACE_KNOWHOW } from '@/lib/place/words';
import { BrandColors } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry } from '@/types';

const LIST = '/space/knowhow';

/**
 * S08 공간 노하우 상세(주인) — 읽기 · [고치기] → 쓰기(S07 ?edit=) · 헤더 휴지통 = 지우기.
 * 지우기 = confirmAction 한 번 → archive_knowhow(0376 · 공간 행은 auth_can(공간, 'write_knowhow')). 되살리기 없음.
 * 읽기는 목록과 같은 fetchEntries(공간 번호)에서 찾는다(이 공간 것이 아니면 "찾을 수 없어요").
 * [매장에 보내기] → S12(이 노하우를 골라 둔 채 · ?entry=). my_connect_store_open 이 참이고 발행본일 때만 그린다(night-1111 g5).
 *   주 버튼은 [고치기] 하나 그대로 · 보내기는 보조 버튼이다.
 */
export default function SpaceKnowhowDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const spaceId = useSessionStore((s) => s.spaceId);
  const [entry, setEntry] = useState<PlaybookEntry | null | undefined>(undefined); // undefined = 읽는 중 · null = 없음
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void connectStoreOpen().then((r) => {
      if (alive) setConnectOpen(r.data === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!spaceId || !id) return;
    setFailed(false);
    const { data, error } = await fetchEntries(spaceId);
    if (error) setFailed(true);
    else setEntry(data.find((e) => e.id === id) ?? null);
  }, [spaceId, id]);

  // 고치기(S07)에서 돌아오면 고친 내용이 보이게 포커스마다 다시 읽는다.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const remove = useCallback(async () => {
    if (!entry || busy) return;
    const ok = await confirmAction(SPACE_KNOWHOW.removeTitle, SPACE_KNOWHOW.removeBody, SPACE_KNOWHOW.remove, {
      destructive: true,
      icon: 'trash-outline',
    });
    if (!ok) return;
    setBusy(true);
    const done = await archiveEntry(entry.id);
    setBusy(false);
    if (!done) {
      showToast(SPACE_KNOWHOW.removeFail, 'warn');
      return;
    }
    showToast(SPACE_KNOWHOW.removed, 'good');
    if (router.canGoBack()) router.back();
    else router.replace(LIST);
  }, [entry, busy, router]);

  const trash = entry ? (
    <Pressable
      onPress={() => void remove()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={SPACE_KNOWHOW.removeTitle}
      style={({ pressed }) => [styles.trashHit, pressed && styles.pressed]}
    >
      <Ionicons name="trash-outline" size={Type.title.fontSize} color={BrandColors.bad} />
    </Pressable>
  ) : undefined;

  // 본문 = 한 카드(10절 3번 · KnowhowRows · 교육 링크·멤버 화면과 같은 부품). 할 일에 번호를 붙이지 않는다(부품 규칙).
  const steps = entry?.square?.action?.steps ?? [];
  const situation = entry?.square?.situation?.trim() ?? '';
  const dont = entry?.square?.extract?.dont?.trim() ?? '';
  const rows: KnowhowRow[] = [
    ...(situation ? [{ kind: 'situation' as const, text: situation }] : []),
    ...(steps.length > 0 ? [{ kind: 'todo' as const, items: steps }] : []),
    ...(dont ? [{ kind: 'dont' as const, text: dont }] : []),
  ];

  return (
    <Screen header={<ScreenTitleHeader title={SPACE_KNOWHOW.detailTitle} backFallback={LIST} right={trash} />}>
      <Stack.Screen options={{ headerShown: false }} />
      {failed && entry === undefined ? (
        <LoadErrorState title={SPACE_KNOWHOW.loadFail} onRetry={() => void load()} />
      ) : entry === undefined ? (
        <ScreenLoading label={SPACE_KNOWHOW.loading} />
      ) : entry === null ? (
        <EmptyState
          title={SPACE_KNOWHOW.notFoundTitle}
          body={SPACE_KNOWHOW.notFoundBody}
          cta={{ label: SPACE_KNOWHOW.backToList, onPress: () => router.replace(LIST) }}
        />
      ) : (
        <>
          {/* 제목 아래 한 줄 = 카테고리 · 고친 때(1차 추천대로 · 목록 줄이 읽는 값). */}
          <View style={styles.head}>
            <Text style={styles.title}>{entry.title}</Text>
            <Text style={styles.meta}>{[getSectionMeta(entry.section).label, formatRelative(entry.updated_at)].filter(Boolean).join(' · ')}</Text>
          </View>
          {rows.length > 0 ? (
            <View style={styles.rowsCard}>
              <KnowhowRows rows={rows} />
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={() => router.push({ pathname: '/space/write', params: { edit: entry.id } })}
              accessibilityRole="button"
              accessibilityLabel={SPACE_KNOWHOW.edit}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>{SPACE_KNOWHOW.edit}</Text>
            </Pressable>
            {connectOpen && entry.status === 'published' ? (
              <Pressable
                onPress={() => router.push({ pathname: '/space/connect', params: { entry: entry.id } })}
                accessibilityRole="button"
                accessibilityLabel={CONNECT.sendToStore}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryText}>{CONNECT.sendToStore}</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  trashHit: { minWidth: TouchSize.inline, minHeight: TouchSize.inline, alignItems: 'flex-end', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  head: { gap: Gap.inline },
  title: { ...Type.title },
  meta: { ...Type.desc },
  rowsCard: { ...CardStyles.rows },
  // 고치기·매장으로 보내기 = 흰 카드 하나(R-14). 본문 카드는 있을 때만 그려져 그 안에 넣지 않는다.
  actions: { ...CardStyles.list, gap: Space.sm },
  // 주 버튼 = 노랑(10절 7번) · 보조 = 알약(1차 추천대로 · 주 버튼이 둘로 보이지 않게).
  primary: ButtonStyles.primaryYellow,
  primaryText: ButtonTextStyles.primaryOnYellow,
  secondary: { ...ButtonStyles.secondary, alignSelf: 'stretch' },
  secondaryText: ButtonTextStyles.secondary,
});
