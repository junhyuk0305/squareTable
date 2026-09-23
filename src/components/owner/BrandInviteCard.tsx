// BrandInviteCard.tsx — 사장 홈(허브 현황) 맨 위 "○○본사가 연결을 요청했어요" 카드(정본 §4-E ①).
//
// 재료 = useOwnerBrandStore(my_brand_invites: 내 번호로 온, 아직 유효한 요청). 0건이면 아무것도 그리지 않는다
// — 미연결 매장 diff 0. 탭하면 동의 화면(관측 경계표가 첫 화면).
import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useOwnerBrandStore } from '@/lib/store/useOwnerBrandStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export function BrandInviteCard() {
  const router = useRouter();
  const invites = useOwnerBrandStore((s) => s.invites);
  const hydrate = useOwnerBrandStore((s) => s.hydrate);
  useEffect(() => { void hydrate(); }, [hydrate]);

  if (invites.length === 0) return null;
  const first = invites[0];
  const more = invites.length - 1;
  return (
    <Pressable
      testID="brand-invite-card"
      accessibilityRole="button"
      accessibilityLabel={`${first.brand_name}에서 연결을 요청했어요`}
      onPress={() => router.push({ pathname: '/owner/brand-consent', params: { invite: first.invite_id } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.icon}>
        <Ionicons name="business" size={18} color={InkColors.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1}>{first.brand_name}에서 연결을 요청했어요</Text>
        <Text style={styles.sub} numberOfLines={2}>
          본사가 보게 되는 범위를 확인하고, 연결할 매장과 공개 수준을 직접 골라요.{more > 0 ? ` 요청 ${more}건 더` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    ...Elevation.e1,
  },
  icon: { width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: BrandColors.yellow, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 12.5, lineHeight: 17, color: InkColors.ink2, marginTop: 2 },
});
