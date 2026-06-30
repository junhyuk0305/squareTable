import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { RoleTabBar } from '@/components/RoleTabBar';
import { KnowhowSegment } from '@/components/KnowhowSegment';
import { OwnerKnowhowBrowse } from '@/components/owner/OwnerKnowhowBrowse';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

/**
 * 노하우 탭(사장님) — KnowhowSegment 컨테이너(2칸).
 *  · 둘러보기: 매장 노하우 대시보드(OwnerKnowhowBrowse) = 검색·필터·가로 캐러셀·미검증 검증.
 *             (옛 '둘러보기' 단순 리스트 + 별도 '내 노하우' 화면을 여기로 통합)
 *  · 물어보기: 사장님용 안내(알바 질문은 받은질문 탭에서 답변)
 *
 * 크롬(헤더·탭바) 소유권은 이 컨테이너. 슬롯은 자체 탭바를 갖지 않는다.
 */
export default function OwnerCategoriesScreen() {
  const router = useRouter();

  // 사장님이 카드를 탭하면 해당 노하우 수정으로 (검토/보강 흐름).
  const openEntry = (id: string) => router.push({ pathname: '/owner/edit/[id]', params: { id } });

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          // 탭 루트(뒤로가기 없음) — 네이티브 타이틀 앵커(~17px)를 콘텐츠 거터(20)로 맞춰
          // 우측 로그아웃(20)과 좌우 대칭. paddingLeft 3 = 20-17.
          headerTitleAlign: 'left',
          headerTitle: () => <Text style={styles.headerTitle}>노하우</Text>,
          headerRight: () => (
            <View style={{ paddingRight: HEADER_EDGE_GUTTER }}>
              <Pressable
                onPress={() => void logout()}
                style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="로그아웃"
              >
                <Text style={styles.switchText}>로그아웃</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <KnowhowSegment role="owner" initial="browse" browse={<OwnerKnowhowBrowse onSelect={openEntry} />} ask={<OwnerAsk />} />
      <RoleTabBar role="owner" />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────
 * OwnerAsk — '물어보기' 슬롯(사장님). 알바 질문은 받은질문에서 답변.
 * ───────────────────────────────────────────────────────── */
function OwnerAsk() {
  const router = useRouter();
  // queue를 직접 구독해야 질문 추가/답변 시 카운트가 갱신된다(getPending 함수참조는 불변 → 미반응).
  const pendingCount = useUnknownQueueStore(
    (s) => s.queue.filter((u) => u.status === 'pending_owner_answer').length,
  );

  return (
    <ScrollView contentContainerStyle={styles.askScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.askCard}>
        <Text style={styles.askEmoji}>💬</Text>
        <Text style={styles.askTitle}>알바가 물어보면 여기로 와요</Text>
        <Text style={styles.askBody}>
          알바가 매장 가이드에 없는 걸 물으면 받은 질문함에 쌓여요. 한 번 답하면 노하우가 되고,
          다음부터는 알바가 바로 답을 받아요.
        </Text>
        <Pressable
          onPress={() => router.push('/owner/inbox' as never)}
          accessibilityRole="button"
          accessibilityLabel={`받은 질문 보기, ${pendingCount}건 대기`}
          style={({ pressed }) => [styles.askBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.askBtnText}>
            받은 질문 보기{pendingCount > 0 ? ` · ${pendingCount}건 대기` : ''}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: InkColors.cream },
  headerTitle: { paddingLeft: 3, fontSize: 16, fontWeight: '800', color: InkColors.ink },
  switchBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.sm },
  switchBtnPressed: { opacity: 0.6 },
  switchText: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },

  // OwnerAsk 슬롯
  askScroll: { padding: 20 },
  askCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 20,
    gap: 10,
    alignItems: 'flex-start',
  },
  askEmoji: { fontSize: 30 },
  askTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  askBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  askBtn: {
    marginTop: 6,
    backgroundColor: BrandColors.brand,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.sm,
  },
  askBtnText: { color: InkColors.bubbleText, fontSize: 14, fontWeight: '800' },
});
