import { StyleSheet } from 'react-native';
import { Surface } from '@/lib/theme/colors';

/** 노하우 탭(주니어) 라우트 셸 공용 스타일. JuniorChatScreen이 소유. */
export const styles = StyleSheet.create({
  // 화면 바탕(Surface.screen · 채팅도 예외 없음 · 2026-11-02).
  safe: { flex: 1, backgroundColor: Surface.screen },
});
