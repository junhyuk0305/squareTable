import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

/**
 * 알바 노하우 제안 — ① 새 노하우 등록 신청 / ② 기존 노하우 개선 제안.
 *  · ?entryId=&title= → 개선 모드(대상 노하우 프리셋)
 *  · 없으면 신규/개선 토글 (기본 신규)
 * 제출하면 사장 제안함으로 가고, 사장이 확인 후 반영/반려한다.
 */
export default function JuniorSuggestScreen() {
  const router = useRouter();
  const { entryId, title } = useLocalSearchParams<{ entryId?: string; title?: string }>();
  const presetImprove = typeof entryId === 'string' && entryId.length > 0;

  const submit = useSuggestionStore((s) => s.submit);
  const hydrate = useSuggestionStore((s) => s.hydrate);
  const subscribe = useSuggestionStore((s) => s.subscribe);
  const mineFor = useSuggestionStore((s) => s.mineFor);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const userId = useSessionStore((s) => s.userId);

  const [kind, setKind] = useState<'new' | 'improve'>(presetImprove ? 'improve' : 'new');
  const [text, setText] = useState('');

  useEffect(() => {
    hydrate();
    return subscribe();
  }, [hydrate, subscribe]);

  const mine = useMemo(() => mineFor(userId), [suggestions, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const canSubmit = text.trim().length >= 5;

  function send() {
    if (!canSubmit) return;
    submit({
      kind,
      text,
      ...(kind === 'improve' && presetImprove ? { targetEntryId: entryId, targetTitle: typeof title === 'string' ? title : undefined } : null),
    });
    showToast('제안을 보냈어요 · 사장님이 확인할게요', 'good');
    setText('');
    if (router.canGoBack()) router.back();
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <Stack.Screen options={{ title: '노하우 제안' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>
            더 나은 방법을 알게 됐나요? 사장님께 제안하면, 확인 후 매장 노하우에 반영돼요.
          </Text>

          {/* 종류 선택 — 개선 프리셋이면 잠금(대상 고정) */}
          {!presetImprove && (
            <View style={styles.seg}>
              <Pressable onPress={() => setKind('new')} style={[styles.segO, kind === 'new' && styles.segOn]}>
                <Text style={[styles.segText, kind === 'new' && styles.segTextOn]}>새 노하우 등록</Text>
              </Pressable>
              <Pressable onPress={() => setKind('improve')} style={[styles.segO, kind === 'improve' && styles.segOn]}>
                <Text style={[styles.segText, kind === 'improve' && styles.segTextOn]}>기존 노하우 개선</Text>
              </Pressable>
            </View>
          )}

          {presetImprove && title && (
            <View style={styles.targetCard}>
              <Ionicons name="sparkles-outline" size={15} color={'#8A5A12'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.targetLabel}>이 노하우를 개선해요</Text>
                <Text style={styles.targetTitle} numberOfLines={2}>{title}</Text>
              </View>
            </View>
          )}

          <Text style={styles.fieldLabel}>
            {kind === 'improve' ? '어떻게 바꾸면 더 좋을까요?' : '어떤 노하우인가요?'}
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={
              kind === 'improve'
                ? '예) 이 단계에서 ~하면 더 빨라요 / 실제로는 ~가 맞아요'
                : '예) 아이스 음료 픽업대는 30분마다 닦으면 컴플레인이 줄어요'
            }
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <Text style={styles.hint}>구체적으로 적을수록 사장님이 반영하기 쉬워요. (최소 5자)</Text>

          <Pressable onPress={send} disabled={!canSubmit} style={({ pressed }) => [styles.cta, !canSubmit && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Ionicons name="paper-plane-outline" size={16} color="#FFFFFF" />
            <Text style={styles.ctaText}>사장님께 제안 보내기</Text>
          </Pressable>

          {/* 내 제안 — 데드엔드 방지(보낸 제안의 상태를 본인이 추적) */}
          {mine.length > 0 && (
            <View style={styles.mineWrap}>
              <Text style={styles.mineHeader}>내가 보낸 제안</Text>
              {mine.slice(0, 10).map((s) => (
                <View key={s.id} style={styles.mineRow}>
                  <View
                    style={[
                      styles.mineChip,
                      {
                        backgroundColor:
                          s.status === 'approved' ? BrandColors.accentSoft : s.status === 'rejected' ? InkColors.bgSoft : BrandColors.yellowSoft,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.mineChipText,
                        { color: s.status === 'approved' ? BrandColors.good : s.status === 'rejected' ? InkColors.ink3 : '#8A5A12' },
                      ]}
                    >
                      {s.status === 'approved' ? '반영됨' : s.status === 'rejected' ? '반려' : '검토 중'}
                    </Text>
                  </View>
                  <Text style={styles.mineText} numberOfLines={1}>{s.text}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 16 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 14 },
  lead: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },

  seg: { flexDirection: 'row', gap: 8 },
  segO: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  segOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
  segTextOn: { color: '#FFFFFF' },

  targetCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FBF3E3', borderWidth: 1, borderColor: '#EAD9B5', borderRadius: 12, padding: 13 },
  targetLabel: { fontSize: 11.5, fontWeight: '800', color: '#8A5A12' },
  targetTitle: { fontSize: 14, fontWeight: '700', color: InkColors.ink, marginTop: 2 },

  fieldLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginTop: 2 },
  input: { minHeight: 130, borderWidth: 1, borderColor: InkColors.line, borderRadius: 13, padding: 14, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.bg, lineHeight: 22 },
  hint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: InkColors.ink, borderRadius: 14, paddingVertical: 15, marginTop: 4, ...Elevation.e1 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  mineWrap: { marginTop: 10, gap: 8 },
  mineHeader: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  mineChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.pill },
  mineChipText: { fontSize: 11, fontWeight: '800' },
  mineText: { flex: 1, fontSize: 13, color: InkColors.ink2, fontWeight: '500' },
});
