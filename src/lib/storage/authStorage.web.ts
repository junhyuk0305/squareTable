// lib/storage/authStorage.web.ts
// Supabase 세션 저장소 — 웹 구현. 네이티브는 authStorage.ts(AsyncStorage).
// localStorage 접근 불가 환경(시크릿 모드 등)에서도 앱이 죽지 않도록 안전하게 감싼다.
const memory = new Map<string, string>();
const hasLocalStorage = typeof window !== 'undefined' && !!window.localStorage;

export const authStorage = {
  getItem(key: string) {
    if (!hasLocalStorage) return memory.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string) {
    if (!hasLocalStorage) return void memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  removeItem(key: string) {
    if (!hasLocalStorage) return void memory.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};
