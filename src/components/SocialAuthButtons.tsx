import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { SHOW_SOCIAL_LOGIN } from '@/lib/config/store-policy';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 소셜 로그인 버튼 묶음(로그인·가입 공용 SSOT).
 * 웹: signInWithGoogle 이 전체 페이지를 구글로 리다이렉트하고, 돌아오면 세션이 복원된 뒤
 *     프로필이 결손이면 /complete-profile 로 유도된다(needsProfileSetup 게이트).
 * 데모 빌드(HAS_SUPABASE=false)나 미지원 플랫폼에선 렌더하지 않는다.
 * ⚠️ 실제 동작은 Supabase 대시보드에서 Google provider 를 켜고 Redirect URLs 를 등록해야 한다.
 */
export function SocialAuthButtons() {
  const signInWithGoogle = useSessionStore((s) => s.signInWithGoogle);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!HAS_SUPABASE) return null;
  // iOS 네이티브: Guideline 4.8 — 제3자 소셜 로그인으로 주계정을 만들면 동등한 다른 로그인 서비스
  // (사실상 Sign in with Apple)를 함께 제공해야 한다. 여기서 감추면 "앱이 오로지 자사 계정 시스템만
  // 사용" 예외에 해당해 면제된다. Sign in with Apple 추가는 9월 1.1 과제.
  if (!SHOW_SOCIAL_LOGIN) return null;

  const onGoogle = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await signInWithGoogle();
    // 성공이면 페이지가 구글로 이동해 여기로 안 돌아온다. 에러(미설정·차단)면 busy 해제 후 표시.
    if (error) {
      setBusy(false);
      setErr(error);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>또는</Text>
        <View style={styles.line} />
      </View>
      <Pressable
        onPress={onGoogle}
        disabled={busy}
        style={({ pressed }) => [styles.btn, pressed && !busy && { opacity: 0.85 }, busy && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Google로 계속하기"
      >
        {busy ? (
          <ActivityIndicator color={InkColors.ink} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color="#EA4335" />
            <Text style={styles.btnText}>Google로 계속하기</Text>
          </>
        )}
      </Pressable>
      {err && <Text style={styles.err}>{err}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginVertical: Space.xs },
  line: { flex: 1, height: 1, backgroundColor: InkColors.line },
  dividerText: { fontSize: 12, lineHeight: 17, color: InkColors.ink3, fontWeight: '700' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  btnText: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  err: { fontSize: 15, lineHeight: 22, color: '#D14343', fontWeight: '700', textAlign: 'center' },
});
