import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Section } from '@/components/Screen';
import { EmptyState } from '@/components/EmptyState';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useOpenSpace } from '@/lib/hooks/useOpenSpace';
import { SPACE_MEMBERS, SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { Space, Gap } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * S18 매장 탭의 [공간] 칸(4번 덩이 · 2번 덩이 임시 입구 SpaceEntryRow 를 대신한다).
 *  · 내 공간(주인) → 들어가기(enter_space) → /space/home · 대기 중인 합류 신청 수를 줄에 붙인다(벨과 같은 파생 행).
 *  · 내 공간이 없고 만들 수 있는 계정 → 빈 상태 "아직 공간이 없어요" + 노란 [공간 만들기] → /space/start(사장 계정은 서버가 거절 → 카드 없음).
 *  · 참여 중인 공간(멤버) → /space/joined/<번호>(S17 · 공간 _layout 이 그 번호로 들어간다).
 *  · 초대코드 넣기(S19) → 직원 허브의 코드 칸(/junior/hub · 공간 코드와 매장 코드를 같이 받는다).
 * 보이는 조건(입구가 열린 계정)은 부르는 화면(stores.tsx)이 정한다.
 */
export function SpaceTabPanel() {
  const router = useRouter();
  const spaces = useSessionStore((s) => s.spaces);
  const isOwnerAccount = useSessionStore((s) => s.isOwnerAccount);
  const signupRole = useSessionStore((s) => s.signupRole);
  const joinNotices = useCrossNotifStore((s) => s.joinNotices);
  // 공간으로 가는 길 = useOpenSpace 한 곳(상단 전환 칩과 같은 규칙 · 2026-11-16).
  const { open: openSpace, busy } = useOpenSpace();

  const mine = spaces.find((s) => s.role === 'space_owner');
  const joined = spaces.filter((s) => s.role === 'space_member');
  const canCreate = !isOwnerAccount && signupRole !== 'owner';
  const requestsOf = (id: string) => joinNotices.filter((n) => n.kind === 'space_join_request' && n.unit_id === id).length;

  return (
    <View style={styles.stack}>
      {mine ? (
        <Section title={SPACE_MEMBERS.mineTitle}>
          <Row
            icon="library-outline"
            title={mine.name}
            hint={busy === mine.id ? SPACE_SCREEN.entryOpening : SPACE_SCREEN.entryEnterHint}
            badge={requestsOf(mine.id) > 0 ? SPACE_MEMBERS.requestBadge(requestsOf(mine.id)) : undefined}
            onPress={() => void openSpace(mine)}
          />
        </Section>
      ) : canCreate ? (
        // 공간이 없으면 빈 상태 카드 + 노란 [공간 만들기] 하나(1차 추천대로 · 매장 칸 "아직 매장이 없어요"와 같은 부품).
        <EmptyState
          title={SPACE_SCREEN.entryEmptyTitle}
          body={SPACE_SCREEN.startLead}
          cta={{ label: SPACE_SCREEN.entryCreate, onPress: () => router.push('/space/start') }}
          ctaTone="yellow"
        />
      ) : null}
      {joined.length > 0 ? (
        <Section title={SPACE_MEMBERS.joinedTitle}>
          <View style={styles.list}>
            {joined.map((s) => (
              <Row
                key={s.id}
                icon="people-outline"
                title={s.name}
                hint={SPACE_MEMBERS.joinedRowHint}
                onPress={() => void openSpace(s)}
              />
            ))}
          </View>
        </Section>
      ) : null}
      {/* 사장 계정은 직원 허브에 못 간다(junior _layout 이 돌려보낸다) → 코드 줄은 사장 계정이 아닐 때만. 정본 가정 = 사장은 [매장]만. */}
      {!isOwnerAccount ? (
        <Section title={SPACE_MEMBERS.codeSectionTitle}>
          <Row icon="enter-outline" title={SPACE_WORDS.enterCode} hint={SPACE_MEMBERS.codeHint} onPress={() => router.push('/junior/hub')} />
          {!mine && joined.length === 0 ? <Text style={styles.note}>{SPACE_MEMBERS.emptySpaceBody}</Text> : null}
        </Section>
      ) : null}
    </View>
  );
}

function Row({ icon, title, hint, badge, onPress }: { icon: IconName; title: string; hint: string; badge?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={Type.title.fontSize} color={InkColors.ink} />
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Ionicons name="chevron-forward" size={Type.title.fontSize} color={InkColors.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Space.lg },
  list: { gap: Space.sm },
  card: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  pressed: { opacity: 0.7 },
  texts: { flex: 1, minWidth: 0, gap: Gap.inline },
  title: { ...Type.body, fontWeight: '800' },
  hint: { ...Type.desc, color: TextColor.secondary },
  badge: { ...Type.desc, fontWeight: '800', color: InkColors.ink },
  note: { ...Type.desc, color: TextColor.secondary },
});
