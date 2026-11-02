// /email-changed — 이메일 변경 확인 링크가 돌아오는 곳(2026-10-05). 앱·웹 같은 화면.
// Supabase verify 가 바꾼 뒤 이리로 보낸다(updateUser 의 emailRedirectTo). 문구는 emailChangedNotice 가 고른다.
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { emailChangedNotice } from '@/lib/account/findEmail';
import { InkColors, BrandColors, Surface } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Type } from '@/lib/theme/type';
import { CONTENT_MAX_WIDTH, Space } from '@/lib/theme/layout';

export default function EmailChangedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string; error_description?: string; message?: string }>();
  const n = emailChangedNotice(params);
  const ok = n.title === '이메일이 바뀌었어요';
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.card} testID="email-changed">
        <Ionicons name={ok ? 'checkmark-circle-outline' : 'mail-outline'} size={28} color={InkColors.ink} />
        <Text style={styles.title}>{n.title}</Text>
        <Text style={styles.body}>{n.body}</Text>
        <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.88 }]}>
          <Text style={styles.btnText}>처음 화면으로</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Surface.screen, alignItems: 'center', justifyContent: 'center', padding: Space.xl },
  card: { ...CardStyles.list, alignItems: 'center', gap: Space.md, maxWidth: CONTENT_MAX_WIDTH },
  title: { ...Type.title, textAlign: 'center' },
  body: { ...Type.desc, textAlign: 'center' },
  btn: { ...ButtonStyles.primary, backgroundColor: BrandColors.brand },
  btnText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
});
