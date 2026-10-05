import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { callbackCode } from './googleRedirect';

// 앱 구글 로그인(Supabase 공식 Expo 방식 · 2026-10-05).
// 구글 창을 인앱 브라우저로 열고, squaretable://auth/callback 으로 돌아오면 code 를 세션으로 바꾼다.
// ⚠️ Supabase 대시보드 Redirect URLs 에 squaretable:// 로 시작하는 주소가 있어야 돌아온다.
WebBrowser.maybeCompleteAuthSession();

export function nativeRedirectUrl(): string {
  return Linking.createURL('auth/callback');
}

/** 결과: ok = 세션이 생겼다, cancelled = 사용자가 창을 닫았다, error = 그 밖의 실패. */
export async function googleNativeSignIn(
  redirectTo: string,
): Promise<{ ok: true; userId: string; email: string } | { ok: false; cancelled: boolean; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { ok: false, cancelled: false, error: error?.message ?? 'no_url' };
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  // 창을 닫음(cancel·dismiss)은 오류가 아니다.
  if (res.type === 'cancel' || res.type === 'dismiss') return { ok: false, cancelled: true, error: null };
  const code = res.type === 'success' ? callbackCode(res.url) : null;
  if (!code) return { ok: false, cancelled: false, error: 'no_code' };
  const { data: s, error: xErr } = await supabase.auth.exchangeCodeForSession(code);
  if (xErr || !s?.user) return { ok: false, cancelled: false, error: xErr?.message ?? 'no_user' };
  return { ok: true, userId: s.user.id, email: s.user.email ?? '' };
}
