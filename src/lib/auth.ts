// lib/auth.ts — 공용 로그아웃. "나가기"가 세션을 실제로 끊도록 단일화.
// 기존엔 router.replace('/')만 해서 세션이 살아있어 다시 들어가지던 문제를 해결.
import { router } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';

export async function logout() {
  await useSessionStore.getState().signOut();
  router.replace('/');
}
