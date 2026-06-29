import { useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import type { PlaybookSuggestion } from '@/types';

/**
 * 노하우 제안함(사장) — 알바가 올린 ① 개선 제안 / ② 신규 등록 신청을 검토.
 *  - 승인: 신규 → 대화형 입력(coach)에 본문을 실어 노하우로 다듬어 발행 / 개선 → 대상 노하우 수정 화면.
 *  - 반려: 사유 없이 닫기(추후 메모 가능).
 * 라우트는 파일 기반 자동 등록 — _layout 수정 없이 동작(헤더는 아래 Stack.Screen이 설정).
 */
export default function OwnerSuggestionsScreen() {
  const router = useRouter();
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const hydrate = useSuggestionStore((s) => s.hydrate);
  const subscribe = useSuggestionStore((s) => s.subscribe);
  const approve = useSuggestionStore((s) => s.approve);
  const reject = useSuggestionStore((s) => s.reject);

  useEffect(() => {
    hydrate();
    return subscribe();
  }, [hydrate, subscribe]);

  const pending = useMemo(() => suggestions.filter((s) => s.status === 'pending'), [suggestions]);
  const handled = useMemo(
    () => suggestions.filter((s) => s.status !== 'pending').slice(0, 20),
    [suggestions],
  );

  // 승인 → 반영 화면으로.
  //  - 개선: 대상 노하우를 직접 수정하는 것 자체가 반영 → 즉시 승인 후 수정 화면.
  //  - 신규: coach에서 '실제 발행'됐을 때만 승인되도록 sugId를 넘긴다(이탈 시 상태 괴리 방지).
  function reflect(s: PlaybookSuggestion) {
    if (s.kind === 'improve' && s.target_entry_id) {
      approve(s.id);
      showToast('승인했어요 · 노하우를 수정해 주세요', 'good');
      router.push({ pathname: '/owner/edit/[id]', params: { id: s.target_entry_id } });
    } else {
      showToast('노하우로 정리해 발행하면 반영돼요', 'info');
      router.push({ pathname: '/owner/coach', params: { seed: s.text, sugId: s.id } });
    }
  }

  function decline(s: PlaybookSuggestion) {
    reject(s.id);
    showToast('제안을 반려했어요', 'info');
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <Stack.Screen options={{ title: '노하우 제안함' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subline}>알바가 올린 노하우 제안을 확인하고 반영하세요</Text>

        {pending.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🤝</Text>
            <Text style={styles.emptyTitle}>대기 중인 제안이 없어요</Text>
            <Text style={styles.emptySub}>알바가 노하우 개선·등록을 신청하면 여기로 와요.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {pending.map((s, i) => (
              <Appear key={s.id} delay={i * 40}>
                <SuggestionCard s={s} onApprove={() => reflect(s)} onReject={() => decline(s)} />
              </Appear>
            ))}
          </View>
        )}

        {handled.length > 0 && (
          <View style={styles.handledWrap}>
            <Text style={styles.handledHeader}>처리됨</Text>
            {handled.map((s) => (
              <View key={s.id} style={styles.handledRow}>
                <View
                  style={[
                    styles.statusChip,
                    { backgroundColor: s.status === 'approved' ? BrandColors.accentSoft : InkColors.bgSoft },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      { color: s.status === 'approved' ? BrandColors.good : InkColors.ink3 },
                    ]}
                  >
                    {s.status === 'approved' ? '반영' : '반려'}
                  </Text>
                </View>
                <Text style={styles.handledText} numberOfLines={1}>
                  {s.proposer_name} · {s.kind === 'improve' ? '개선' : '신규'} · {s.text}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function SuggestionCard({
  s,
  onApprove,
  onReject,
}: {
  s: PlaybookSuggestion;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isImprove = s.kind === 'improve';
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindChip, isImprove ? styles.kindImprove : styles.kindNew]}>
          <Ionicons
            name={isImprove ? 'sparkles-outline' : 'add-circle-outline'}
            size={13}
            color={isImprove ? '#8A5A12' : InkColors.ink}
          />
          <Text style={[styles.kindText, { color: isImprove ? '#8A5A12' : InkColors.ink }]}>
            {isImprove ? '개선 제안' : '신규 등록 신청'}
          </Text>
        </View>
        <Text style={styles.proposer}>{s.proposer_name}</Text>
      </View>

      {isImprove && s.target_title && (
        <View style={styles.targetRow}>
          <Ionicons name="link-outline" size={13} color={InkColors.ink3} />
          <Text style={styles.targetText} numberOfLines={1}>
            대상: {s.target_title}
          </Text>
        </View>
      )}

      <Text style={styles.body}>{s.text}</Text>

      <View style={styles.actions}>
        <Pressable onPress={onReject} style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}>
          <Text style={styles.btnGhostText}>반려</Text>
        </Pressable>
        <Pressable onPress={onApprove} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.85 }]}>
          <Ionicons name="checkmark" size={15} color="#FFFFFF" />
          <Text style={styles.btnPrimaryText}>{isImprove ? '승인 · 수정하기' : '승인 · 노하우로'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 14 },
  subline: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  empty: { backgroundColor: InkColors.bg, borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, padding: 28, gap: 6, alignItems: 'center' },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  emptySub: { fontSize: 13, color: InkColors.ink3, textAlign: 'center' },

  list: { gap: 12 },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 10, ...Elevation.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.pill },
  kindImprove: { backgroundColor: '#FBF3E3' },
  kindNew: { backgroundColor: BrandColors.yellowSoft },
  kindText: { fontSize: 12, fontWeight: '800' },
  proposer: { marginLeft: 'auto', fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bgSoft, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  targetText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  body: { fontSize: 14.5, color: InkColors.ink, lineHeight: 21 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderRadius: 12 },
  btnGhost: { paddingHorizontal: 18, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  btnGhostText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },
  btnPrimary: { flex: 1, backgroundColor: InkColors.ink },
  btnPrimaryText: { fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' },

  handledWrap: { marginTop: 6, gap: 8 },
  handledHeader: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  handledRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  statusChipText: { fontSize: 11, fontWeight: '800' },
  handledText: { flex: 1, fontSize: 12.5, color: InkColors.ink3, fontWeight: '600' },
});
