import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';
import { BottomSheet } from '@/components/BottomSheet';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import type { PlaybookSuggestion } from '@/types';

/**
 * 노하우 제안함(사장) — 알바가 올린 ① 개선 제안 / ② 신규 등록 신청을 검토.
 *  - 승인: 신규 → 제안 원문을 자동 구조화한 초안을 보고 수정(생략 가능) 후 추가 여부 결정(coach 제안검토 모드)
 *          / 개선 → 대상 노하우 수정 화면.
 *  - 반려: 사유 입력 시트(건너뛰기 가능) — 사유는 직원 제안 카드·알림에 표시된다.
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
  //  - 신규: '제안 검토' 모드(coach) — 제안 원문이 자동 구조화된 초안으로 먼저 뜨고, 사장은 고칠 부분만
  //    말하거나(생략 가능) 바로 추가/이탈(=미반영)을 결정한다. '실제 발행'됐을 때만 승인되도록 sugId를 넘긴다.
  function reflect(s: PlaybookSuggestion) {
    if (s.kind === 'improve' && s.target_entry_id) {
      approve(s.id);
      showToast('승인했어요 · 노하우를 수정해 주세요', 'good');
      router.push({ pathname: '/owner/edit/[id]', params: { id: s.target_entry_id } });
    } else {
      showToast('제안을 초안으로 정리해 드려요 · 확인 후 추가하세요', 'info');
      // source_template_id(②)=발행 시 업무 자동 첨부 · source_uq_id(③/D4)=uqId로 넘겨 발행 시 그 질문 자동 resolve.
      router.push({
        pathname: '/owner/coach',
        params: {
          seed: s.text,
          sugId: s.id,
          ...(s.source_template_id ? { srcTemplate: s.source_template_id } : {}),
          ...(s.source_uq_id ? { uqId: s.source_uq_id } : {}),
        },
      });
    }
  }

  // 반려 — 사유 입력 시트(건너뛰기 가능). 사유는 직원 '내가 보낸 제안' 카드·알림에 표시된다.
  const [declineFor, setDeclineFor] = useState<PlaybookSuggestion | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  function closeDecline() {
    setDeclineFor(null);
    setDeclineNote('');
  }
  function confirmDecline(withNote: boolean) {
    if (!declineFor) return;
    const note = withNote ? declineNote.trim() : '';
    reject(declineFor.id, note || undefined);
    closeDecline();
    showToast('제안을 반려했어요', 'info');
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <Stack.Screen options={{ title: '노하우 제안함' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Appear delay={0}>
          <Text style={styles.subline}>직원이 올린 노하우 제안을 확인하고 반영하세요</Text>
        </Appear>

        {pending.length === 0 ? (
          <Appear delay={60}>
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🤝</Text>
            <Text style={styles.emptyTitle}>대기 중인 제안이 없어요</Text>
            <Text style={styles.emptySub}>직원이 노하우 개선·신규를 제안하면 여기로 와요.</Text>
          </View>
          </Appear>
        ) : (
          <Appear delay={60}>
          <View style={styles.list}>
            {pending.map((s) => (
              <SuggestionCard key={s.id} s={s} onApprove={() => reflect(s)} onReject={() => setDeclineFor(s)} />
            ))}
          </View>
          </Appear>
        )}

        {handled.length > 0 && (
          <Appear delay={120}>
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
          </Appear>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>
      <RoleTabBar role="owner" />

      {/* 반려 사유 시트 — 건너뛰기 가능. 사유는 직원 제안 카드·알림에 표시된다. */}
      {declineFor && (
        <BottomSheet visible={true} onClose={closeDecline}>
          <View style={styles.declineSheet}>
            <Text style={styles.declineTitle}>제안 반려</Text>
            <Text style={styles.declineSub}>사유를 남기면 {declineFor.proposer_name}님의 제안 내역과 알림에 표시돼요</Text>
            <TextInput
              value={declineNote}
              onChangeText={setDeclineNote}
              placeholder="예) 이미 비슷한 노하우가 있어요"
              placeholderTextColor={InkColors.ink3}
              style={styles.declineInput}
              multiline
              maxLength={200}
              autoFocus
            />
            <View style={styles.declineBtns}>
              <Pressable onPress={() => confirmDecline(false)} style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}>
                <Text style={styles.btnGhostText}>건너뛰고 반려</Text>
              </Pressable>
              <Pressable
                onPress={() => confirmDecline(true)}
                disabled={declineNote.trim().length === 0}
                style={({ pressed }) => [styles.btn, styles.btnPrimary, declineNote.trim().length === 0 && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.btnPrimaryText}>사유와 함께 반려</Text>
              </Pressable>
            </View>
          </View>
        </BottomSheet>
      )}
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
            {isImprove ? '개선 제안' : '신규 제안'}
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
  subline: { fontSize: 15, color: InkColors.ink3, fontWeight: '600' },

  empty: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 28, gap: 6, alignItems: 'center' },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  emptySub: { fontSize: 15, color: InkColors.ink3, textAlign: 'center' },

  list: { gap: 12 },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 10, ...Elevation.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.pill },
  kindImprove: { backgroundColor: '#FBF3E3' },
  kindNew: { backgroundColor: BrandColors.yellowSoft },
  kindText: { fontSize: 12, fontWeight: '800' },
  proposer: { marginLeft: 'auto', fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 7 },
  targetText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  body: { fontSize: 15, color: InkColors.ink, lineHeight: 22 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderRadius: Radius.md },
  btnGhost: { paddingHorizontal: 18, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  btnGhostText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },
  btnPrimary: { flex: 1, backgroundColor: InkColors.ink },
  btnPrimaryText: { fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' },

  // 반려 사유 시트
  declineSheet: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  declineTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  declineSub: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600' },
  declineInput: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.cream, minHeight: 72, textAlignVertical: 'top' },
  declineBtns: { flexDirection: 'row', gap: 8, marginTop: 2 },

  handledWrap: { marginTop: 6, gap: 8 },
  handledHeader: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  handledRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  statusChipText: { fontSize: 11, fontWeight: '800' },
  handledText: { flex: 1, fontSize: 12.5, color: InkColors.ink3, fontWeight: '600' },
});
