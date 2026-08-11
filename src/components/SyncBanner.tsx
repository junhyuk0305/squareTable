// 전역 통신 실패 배너 — 화면 상단에 떠서, 서버와의 실패를 사용자가 알게 한다.
// _layout 최상단(프레임 안)에 1회 마운트. 평소엔 아무것도 그리지 않는다.
//
// 축이 둘이고 **사라지는 규칙이 다르다**(useSyncStore 주석 참조).
//   쓰기 실패  = 사건 → 3초 뒤 페이드아웃(기존 동작)
//   읽기 실패  = 상태 → **자동으로 안 사라진다.** 연결 실패(offline)는 연결이 돌아오면,
//                서버 응답 실패(server)는 사용자가 닫을 때만 사라진다.
// ★2026-08-11: 예전엔 읽기 실패도 3초 배너라, 백엔드가 죽었는데 화면이 "아직 없어요"를
//   말하는 상태가 아무 표시 없이 유지됐다([P2-#3]·[P5-#5]·기존-14).
// 둘이 동시에 있으면 **읽기(상태)를 우선**한다 — 저장 실패는 방금 누른 것이라 사용자가 알지만,
// "보이는 게 전부가 아니다"는 말해주지 않으면 영영 모른다.
import { useEffect, useMemo } from 'react';
import { Animated, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { CONTENT_MAX_WIDTH, SCREEN_GUTTER, Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

const AUTO_DISMISS_MS = 3000;

export function SyncBanner() {
  const error = useSyncStore((s) => s.error);
  const seq = useSyncStore((s) => s.seq);
  const readError = useSyncStore((s) => s.readError);
  const clear = useSyncStore((s) => s.clear);
  const clearRead = useSyncStore((s) => s.clearRead);
  const clearOffline = useSyncStore((s) => s.clearOffline);
  const opacity = useMemo(() => new Animated.Value(1), []); // RoleTabBar와 동일 패턴(렌더 중 ref 접근 금지)

  // 연결이 돌아오면 연결 실패 배너는 저절로 사라진다 — 사용자가 닫아 없애야 하는 물건이 아니다.
  // 웹에만 있는 신호이나(네이티브는 NetInfo 미설치), 네이티브도 다음 성공 왕복에서 supabase.ts 래퍼가 해제한다.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onOnline = () => clearOffline();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [clearOffline]);

  // 새 쓰기 오류(seq 증가)마다 완전 불투명으로 리셋 → 3초 뒤 페이드아웃 후 제거.
  // ★읽기 실패가 떠 있는 동안엔 타이머를 걸지 않는다 — 읽기는 자동 소거 대상이 아니다.
  useEffect(() => {
    if (!error || readError) return;
    opacity.setValue(1);
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: USE_NATIVE_DRIVER }).start(() => clear());
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [error, readError, seq, opacity, clear]);

  // 읽기(상태)가 쓰기(사건)를 이긴다. 읽기가 떠 있는 동안은 항상 불투명이다.
  const isRead = !!readError;
  const message = readError?.msg ?? error;
  if (!message) return null;
  // 아이콘도 문구와 같은 것을 말해야 한다 — 연결이 멀쩡한데 '오프라인' 구름을 띄우면 원인을 잘못 짚게 만든다.
  const icon = readError?.kind === 'server' ? 'alert-circle-outline' : 'cloud-offline-outline';
  return (
    <Animated.View style={[styles.wrap, isRead ? undefined : { opacity }]} pointerEvents="box-none">
      <Animated.View style={styles.banner}>
        <Ionicons name={icon} size={17} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={3}>
          {message}
        </Text>
        <Pressable
          onPress={isRead ? clearRead : clear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="안내 닫기"
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 8 : 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    paddingHorizontal: SCREEN_GUTTER,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: CONTENT_MAX_WIDTH,
    width: '100%',
    backgroundColor: BrandColors.accentSolid,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    shadowColor: InkColors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '700', lineHeight: 22 },
});
