import { useEffect, useMemo } from 'react';
import { useForegroundRefresh } from '@/lib/app/useForegroundRefresh';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect, useRouter, type Href } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { showToast } from '@/lib/store/useToastStore';
import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { MAX_NOTIFS } from '@/lib/utils/notifications';
import { HAS_SUPABASE } from '@/lib/supabase';
import { useStoreDisplay } from '@/components/StoreHeaderTitle';
import { NotificationList, ALL_KIND_UI, type NotifRow } from '@/components/NotificationList';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Surface } from '@/lib/theme/colors';
import { screenScrollStyle } from '@/lib/theme/layout';

/**
 * 통합 알림(허브 레이어) — 내 매장 허브 우상단 벨에서 진입. 소속 전 매장 알림을 시간 역순으로
 * 한 리스트에(매장 점·이름 칩). 데이터·판정·탭 동작(전환 후 이동·읽음처리)은 useCrossNotifRows SSOT.
 * 매장 안 벨(/junior·/owner notifications)은 그 매장 알림 — 여기는 전 매장 병합이라는 점만 다르다.
 */
/** 공간 줄 아이콘 — 같은 대상의 매장 줄과 같은 모양을 쓴다(질문 · 답 온 질문 · 구성원에서 빠짐). */
const KIND_UI = {
  ...ALL_KIND_UI,
  space_question: ALL_KIND_UI.question,
  space_q_answered: ALL_KIND_UI.q_answered,
  link_q_answered: ALL_KIND_UI.q_answered,
  space_deleted: ALL_KIND_UI.member_removed,
};

export default function HubNotificationsScreen() {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  // 매장 닉네임·색(unit_member_prefs)도 이 화면이 그리는 원격 소스다 — 딥링크로 여기 직진입하면
  // 아무도 안 당겨서 원본명·자동색으로 한 번 그렸다가 바뀐다. 훅이 hydrate 까지 맡는다(판정 SSOT).
  const { prefsLoaded } = useStoreDisplay();
  useEffect(() => {
    void hydrateCross();
  }, [hydrateCross]);
  // G2: 매장 _layout 밖이라 복귀 새로고침이 없다. 30초 넘게 뒤에 있다 돌아오면 다시 읽는다.
  useForegroundRefresh(status === 'signed_in', () => {
    void useSessionStore.getState().refreshMembership({ soft: true, source: 'foreground' });
    void hydrateCross();
  });
  // '모두 읽기' = 내 매장 전부 ack(결정 3 · 훅이 매장 벨과 같은 ackNotifs 를 매장마다 부른다).
  const { listRows, spaceRows, openRow, hasUnread: storeUnread, markAll } = useCrossNotifRows();
  // ★야간 g4a 공간 줄(my_space_notif_data) — 매장 줄과 같은 목록에 시간순으로 섞는다. 읽음 기준은 계정 단위 축(accountAckAt).
  //   누르면 매장 전환 없이 그 주소로 간다(공간 _layout 이 그 공간에 먼저 들어간다 · /link 는 앱 안 링크).
  //   행은 훅이 만든다(허브 벨 숫자와 같은 배열 · 1112 fix 16).
  const ackNotifs = useMemberPrefsStore((s) => s.ackNotifs);
  const sessionStores = useSessionStore((s) => s.stores);
  const rows = useMemo(
    () => [...listRows, ...spaceRows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTIFS),
    [listRows, spaceRows],
  );
  const spaceIds = useMemo(() => new Set(spaceRows.map((r) => r.id)), [spaceRows]);
  const hasUnread = storeUnread || spaceRows.some((r) => r.unread);
  const onPress = (r: NotifRow) => {
    if (spaceIds.has(r.id)) {
      if (r.route) router.push(r.route as Href);
      return;
    }
    void openRow(r);
  };
  // 매장 줄이 안 읽음이면 지금 '모두 읽기' 그대로. 공간 줄만 남았으면 같은 ack(내 매장 전부)로 지운다(계정 단위 축 = 최대 ack).
  const onMarkAll = () => {
    if (storeUnread) return markAll();
    for (const s of sessionStores) void ackNotifs(s.unit_id);
    showToast('모두 읽음 처리했어요', 'good');
  };
  // ⛔`&&` 안에서 훅을 부르지 않는다 — 훅을 각각 받은 뒤 AND 한다.
  const ready = crossLoaded && prefsLoaded;

  // 게이트(stores.tsx 와 동일 규칙): 루트 레벨 라우트라 그룹 게이트 밖 — 미로그인 직진입 차단.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{ headerShown: false, title: '알림' }}
      />
      {/* 전체 읽음 버튼 = 매장 벨과 같은 부품(MarkAllReadButton) · 같은 자리(제목 상단바 오른쪽 끝). */}
      <ScreenTitleHeader title="알림" backFallback right={ready && hasUnread ? <MarkAllReadButton onPress={onMarkAll} /> : undefined} />
      {!ready ? (
        <ScreenLoading label="알림을 불러오고 있어요…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Appear delay={stagger(0)}>
            <NotificationList
              rows={rows}
              kindUI={KIND_UI}
              onPress={onPress}
              // 게이트가 로드 전을 대신 막는다 — 여기는 **진짜 빈 상태**만 말한다
              // (로드 중을 빈 상태로 위장하지 않는다. 로드 실패는 db.ts readFail 배너가 표면화).
              empty={{
                icon: 'notifications-off-outline',
                text: '새 알림이 없어요.',
                sub: '내 모든 매장의 공지·질문·교대 알림을 여기에 모아서 보여드려요.',
              }}
            />
          </Appear>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 탭바 없는 하위 화면 — 아래 안전 영역은 SafeAreaView(bottom)가 든다. 바탕·스크롤 여백만 화면 틀 값을 쓴다.
  safe: { flex: 1, backgroundColor: Surface.screen },
  scroll: screenScrollStyle,
});
