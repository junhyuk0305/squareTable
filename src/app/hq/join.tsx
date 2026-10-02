// /hq/join?token= — 담당자 초대 링크 착지(정본 §3-5 A · 지시서 P3 §3-3). **크롬 0**(AppShell.web AUTH_PATHS).
//
// 가입 흐름은 기존 그대로다(가입 RPC 재정의 금지). 이 화면은 토큰을 브라우저에 맡기고,
//   · 로그인돼 있으면 → 바로 수락 → 세션 갱신 → /hq
//   · 아니면 → [가입하기]/[로그인] 로 보낸다. 로그인이 서면 `usePendingBrandJoin`(AppShell.web)이 수락한다.
// 가입은 직원 갈래(role=junior)로 보낸다 — 사장 갈래는 매장을 만들게 하는데 담당자는 매장이 없다.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { SHOW_HQ_CONSOLE } from '@/lib/config/store-policy';
import { acceptPendingBrandJoin, savePendingBrandJoin } from '@/lib/brand/usePendingBrandJoin';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export default function HqJoinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token.trim() : '';
  const status = useSessionStore((s) => s.status);
  const brandId = useSessionStore((s) => s.brandId);
  const [failed, setFailed] = useState(false);
  // 수락은 한 번만 — 상태가 아니라 ref 로 막는다(effect 안에서 setState 를 동기로 부르지 않는다).
  const started = useRef(false);

  useEffect(() => {
    if (!token) return;
    savePendingBrandJoin(token);
  }, [token]);

  useEffect(() => {
    if (!token || status !== 'signed_in' || started.current) return;
    if (brandId) {
      router.replace('/hq');
      return;
    }
    started.current = true;
    void acceptPendingBrandJoin(token).then((ok) => {
      if (ok) router.replace('/hq');
      else setFailed(true);
    });
  }, [token, status, brandId, router]);

  if (!SHOW_HQ_CONSOLE) {
    return <Card icon="desktop-outline" title="본사 기능은 웹에서 써요" body="컴퓨터 브라우저로 이 링크를 열어 주세요." />;
  }
  if (!token) {
    return <Card icon="link-outline" title="초대 링크가 올바르지 않아요" body="본사 담당자에게 받은 링크를 그대로 열어 주세요." />;
  }
  if (status === 'loading') return null;
  if (status === 'signed_in') {
    return failed ? (
      <Card icon="alert-circle-outline" title="초대를 수락하지 못했어요" body="링크가 만료됐거나 이미 쓰였을 수 있어요. 본사 담당자에게 새 링크를 받아 주세요." action={{ label: '처음으로', onPress: () => router.replace('/') }} />
    ) : (
      <Card icon="business-outline" title="본사 담당자로 등록하는 중…" body="잠시만요." />
    );
  }
  return (
    <Card
      icon="business-outline"
      title="본사 담당자 초대예요"
      body="가입하거나 로그인하면 이 브랜드의 담당자로 등록되고 본사 대시보드가 열려요."
      action={{ label: '가입하기', onPress: () => router.push({ pathname: '/signup', params: { role: 'junior' } }) }}
      secondary={{ label: '이미 계정이 있어요 · 로그인', onPress: () => router.push('/login') }}
    />
  );
}

function Card({
  icon,
  title,
  body,
  action,
  secondary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.wrap} testID="hq-join">
      <Stack.Screen options={{ headerShown: false }} />
      {/* key = 제목 — 상태가 바뀌어(가입 안내 → 등록 중 → 실패) 카드 내용이 갈리면 새 카드로 다시 나타난다. */}
      <Appear key={title} style={styles.card}>
        <Ionicons name={icon} size={28} color={InkColors.ink} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" testID="hq-join-primary" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.btnText}>{action.label}</Text>
          </Pressable>
        ) : null}
        {secondary ? (
          <Pressable onPress={secondary.onPress} accessibilityRole="button" style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
            <Text style={styles.link}>{secondary.label}</Text>
          </Pressable>
        ) : null}
      </Appear>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, backgroundColor: InkColors.cream },
  card: { alignItems: 'center', gap: Space.md, maxWidth: 420, paddingVertical: Space.xl, paddingHorizontal: Space.xl, borderRadius: Radius.md, backgroundColor: InkColors.bg, ...Elevation.e1 },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  body: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  btn: { marginTop: Space.xs, paddingVertical: 10, paddingHorizontal: Space.xl, borderRadius: Radius.pill, backgroundColor: BrandColors.brand },
  btnText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
  link: { fontSize: 13, fontWeight: '600', color: InkColors.ink2, textDecorationLine: 'underline' },
});
