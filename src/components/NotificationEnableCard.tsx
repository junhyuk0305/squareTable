// 알림 켜기 카드 — 알림 화면 상단에 얹어, 아직 웹푸시 권한이 없을 때만 노출.
//
// 상태별:
//   - granted / 미지원(iOS 설치 불필요 케이스 제외): 아무것도 안 그린다(클린).
//   - default: "알림 켜기" 버튼 → 권한 요청 + 구독.
//   - denied: 브라우저 설정에서 허용하라는 안내(앱에서 다시 못 띄움).
//   - iOS 미설치: '홈 화면에 추가' 안내(설치해야 iOS가 푸시를 준다).
//
// 웹 전용 — 네이티브에서는 pushSupported()=false & needsIosInstall()=false 라 null 반환.

import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  pushSupported,
  needsIosInstall,
  permissionState,
  enablePush,
  type PushPermission,
} from '@/lib/push/webpush';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export function NotificationEnableCard() {
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const [perm, setPerm] = useState<PushPermission>(() => permissionState());
  const [busy, setBusy] = useState(false);

  const iosInstall = needsIosInstall();

  // 이미 켜짐 → 숨김. 지원 안 하고 iOS 설치 안내도 아니면 숨김.
  if (perm === 'granted') return null;
  if (!pushSupported() && !iosInstall) return null;

  // iOS 사파리 미설치 — 설치해야 알림을 받는다.
  if (iosInstall) {
    return (
      <View style={[styles.card, styles.info]}>
        <Ionicons name="phone-portrait-outline" size={20} color={InkColors.ink} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>아이폰은 홈 화면에 추가하면 알림을 받아요</Text>
          <Text style={styles.sub}>
            사파리 하단 공유 버튼 → &lsquo;홈 화면에 추가&rsquo; 후, 추가된 매장의 정석 아이콘으로 열면 알림을 켤 수 있어요.
          </Text>
        </View>
      </View>
    );
  }

  if (perm === 'denied') {
    return (
      <View style={[styles.card, styles.info]}>
        <Ionicons name="notifications-off-outline" size={20} color={InkColors.ink} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>알림이 꺼져 있어요</Text>
          <Text style={styles.sub}>
            브라우저 주소창의 자물쇠(사이트 설정) → 알림을 &lsquo;허용&rsquo;으로 바꾸면 받을 수 있어요.
          </Text>
        </View>
      </View>
    );
  }

  // perm === 'default' — 켜기 유도.
  const onEnable = async () => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const next = await enablePush(userId, unitId || null);
      setPerm(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onEnable}
      disabled={busy}
      accessibilityRole="button"
      style={[styles.card, styles.cta, busy && { opacity: 0.6 }]}
    >
      <Ionicons name="notifications" size={20} color={InkColors.ink} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>알림 켜기</Text>
        <Text style={styles.sub}>합류·질문·공지·교대 소식을 앱을 안 켜도 바로 받아요.</Text>
      </View>
      <Text style={styles.ctaBtn}>{busy ? '켜는 중…' : '켜기'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...Elevation.e1,
  },
  cta: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellow },
  info: { backgroundColor: InkColors.bg, borderColor: InkColors.line },
  title: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  sub: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3, marginTop: 3, lineHeight: 18 },
  ctaBtn: {
    fontSize: 14,
    fontWeight: '900',
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
});
