// lib/storage/authStorage.ts
// Supabase 세션 저장소 — 네이티브 구현(AsyncStorage). 웹은 authStorage.web.ts(localStorage).
// W1: 지금까지 네이티브는 이 자리가 없어 세션이 메모리에만 있었다 — 앱을 껐다 켜면 매번 로그아웃됐다.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const authStorage = AsyncStorage;
