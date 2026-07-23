import { useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { HAS_SUPABASE } from '@/lib/supabase';
import { NotificationList, ALL_KIND_UI } from '@/components/NotificationList';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { Appear } from '@/components/Appear';
import { InkColors } from '@/lib/theme/colors';

/**
 * 통합 알림(허브 레이어) — 내 매장 허브 우상단 벨에서 진입. 소속 전 매장 알림을 시간 역순으로
 * 한 리스트에(매장 점·이름 칩). 데이터·판정·탭 동작(전환 후 이동·읽음처리)은 useCrossNotifRows SSOT.
 * 매장 안 벨(/junior·/owner notifications)은 그 매장 알림 — 여기는 전 매장 병합이라는 점만 다르다.
 */
export default function HubNotificationsScreen() {
  const status = useSessionStore((s) => s.status);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  useEffect(() => {
    void hydrateCross();
  }, [hydrateCross]);
  const { listRows, openRow } = useCrossNotifRows();

  // 게이트(stores.tsx 와 동일 규칙): 루트 레벨 라우트라 그룹 게이트 밖 — 미로그인 직진입 차단.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{ headerShown: true, title: '알림', headerLeft: () => <HeaderBackButton fallback="/stores" /> }}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Appear delay={0}>
          <NotificationList
            rows={listRows}
            kindUI={ALL_KIND_UI}
            onPress={(r) => void openRow(r)}
            // 로드 전엔 "없음"으로 위장하지 않는다(로드 실패는 db.ts readFail 배너가 표면화).
            empty={
              crossLoaded
                ? {
                    icon: 'notifications-off-outline',
                    text: '새 알림이 없어요.',
                    sub: '내 모든 매장의 공지·질문·교대 알림을 여기에 모아서 보여드려요.',
                  }
                : { icon: 'notifications-outline', text: '알림을 불러오는 중이에요.' }
            }
          />
        </Appear>
        <View style={{ height: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },
});
