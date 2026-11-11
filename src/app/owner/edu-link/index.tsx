/**
 * 매장 교육 링크 목록(M06 · 사장·매니저) — 들어오는 길 = 노하우 탭 위 "교육 링크" 줄.
 * [새 교육 링크] → 만들기 · 줄 → 상세. 퀴즈 링크와 합치지 않는다(사용자 결정 7).
 * 스위치가 꺼진 계정이 주소로 바로 들어오면 만들기 버튼 없이 feature_off 문구만 보인다(서버도 만들기를 막는다 · 0555).
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { EmptyState } from '@/components/EmptyState';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsKit';
import { isOpenLink, useStoreEduLinksOn } from '@/components/edu/LinkFormStore';
import { fetchEduLinks, type EduLinkRow } from '@/lib/db';
import { daysLeft } from '@/lib/edu/link';
import { placeErrorMessage } from '@/lib/place/errors';
import { SPACE_WORDS, STORE_LINK, STORE_LINK_LIST } from '@/lib/place/words';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

const statusOf = (l: EduLinkRow) =>
  l.closedAt
    ? STORE_LINK_LIST.closed
    : daysLeft(l.expiresAt) > 0
      ? `${STORE_LINK_LIST.open} · ${STORE_LINK_LIST.daysLeft(daysLeft(l.expiresAt))}`
      : STORE_LINK_LIST.expired;

export default function StoreEduLinkListScreen() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId) ?? '';
  const on = useStoreEduLinksOn();

  const [links, setLinks] = useState<EduLinkRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!unitId) return;
      let alive = true;
      void fetchEduLinks(unitId).then((r) => {
        if (!alive) return;
        setLinks(r.data ?? []);
        setFailed(!!r.error);
      });
      return () => { alive = false; };
      // retry 는 다시 읽기 단추용이다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unitId, retry]),
  );

  const header = <ScreenTitleHeader title={STORE_LINK.rowTitle} backFallback />;

  if (failed) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadErrorState title={STORE_LINK_LIST.loadFail} onRetry={() => setRetry((n) => n + 1)} />
      </Screen>
    );
  }
  if (on === null || links === null) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenLoading label={STORE_LINK_LIST.loading} />
      </Screen>
    );
  }

  // 열린 링크를 위로. 같은 칸 안에서는 서버 순서(최근 만든 것 먼저)를 지킨다.
  const sorted = [...links].sort((a, b) => Number(isOpenLink(b)) - Number(isOpenLink(a)));

  return (
    <Screen header={header}>
      <Stack.Screen options={{ headerShown: false }} />
      {on ? (
        <Pressable
          onPress={() => router.push('/owner/edu-link/new')}
          accessibilityRole="button"
          accessibilityLabel={STORE_LINK_LIST.newLink}
          style={({ pressed }) => [st.cta, pressed && st.pressed]}
        >
          <Text style={st.ctaText}>{STORE_LINK_LIST.newLink}</Text>
        </Pressable>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState
          title={on ? STORE_LINK_LIST.emptyTitle : placeErrorMessage({ message: 'feature_off' })}
          body={on ? STORE_LINK_LIST.emptyBody : undefined}
        />
      ) : (
        <SettingsSection>
          {sorted.map((l, i) => (
            <SettingsRow
              key={l.id}
              first={i === 0}
              label={l.title.trim() || SPACE_WORDS.link}
              hint={statusOf(l)}
              onPress={() => router.push({ pathname: '/owner/edu-link/[id]', params: { id: l.id } })}
            />
          ))}
        </SettingsSection>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  cta: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  pressed: { opacity: 0.85 },
});
