import { useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { BottomSheet } from '@/components/BottomSheet';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { isPendingSuggestionToReview } from '@/lib/utils/notifications';
import { SUGGESTION_STATUS_CHIP, SUGGESTION_STATUS_LABEL } from '@/lib/suggestion/labels';
import { showToast } from '@/lib/store/useToastStore';
import { CONNECT } from '@/lib/place/words';
import { placeErrorMessage } from '@/lib/place/errors';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { CardStyles } from '@/lib/theme/card';
import { EmptyStyles } from '@/lib/theme/empty';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
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
  const reject = useSuggestionStore((s) => s.reject);
  const approveFromSpace = useSuggestionStore((s) => s.approveFromSpace);
  /** 승인 중인 공간 제안(두 번 눌러 두 번 부르지 않게). */
  const [approving, setApproving] = useState('');
  // ★loaded 를 안 봐서 "🤝 대기 중인 제안이 없어요"가 먼저 떴다 — 알림 배지를 보고 들어오는 자리라
  //   "없어요"가 스치면 사장이 그대로 나가버린다.
  const ready = useSuggestionStore((s) => s.loaded);
  const loadError = useSuggestionStore((s) => s.loadError);
  const retry = useSuggestionStore((s) => s.retry);

  useEffect(() => {
    hydrate();
    return subscribe();
  }, [hydrate, subscribe]);

  // 검토 대기 = 내가 올린 게 아닌 것만(isPendingSuggestionToReview SSOT — 알림·탭 배지와 같은 술어).
  // 직원이 매니저로 승격되면 승격 전 제안이 자기 결재함으로 넘어와, 자기 제안을 자기가 승인할 수 있었다.
  const me = useSessionStore((s) => s.userId);
  const pending = useMemo(() => suggestions.filter((s) => isPendingSuggestionToReview(s, me)), [suggestions, me]);
  const handled = useMemo(
    () => suggestions.filter((s) => s.status !== 'pending').slice(0, 20),
    [suggestions],
  );

  // 승인 → 반영 화면으로.
  //  - 개선: 대상 노하우 수정 화면으로. 고쳐서 **저장했을 때만** 승인된다(D12 · 신규 분기와 같은 규칙).
  //    그냥 나가면 제안은 검토 대기로 남는다.
  //  - 신규: '제안 검토' 모드(coach) — 제안 원문이 자동 구조화된 초안으로 먼저 뜨고, 사장은 고칠 부분만
  //    말하거나(생략 가능) 바로 추가/이탈(=미반영)을 결정한다. '실제 발행'됐을 때만 승인되도록 sugId를 넘긴다.
  function reflect(s: PlaybookSuggestion) {
    // 공간에서 온 노하우(0490): 코치로 보내지 않는다. 스냅샷 그대로 매장 사본을 만들고 사진을 옮긴다.
    if (s.kind === 'from_space') {
      void approveSpace(s);
      return;
    }
    if (s.kind === 'improve' && s.target_entry_id) {
      showToast('노하우를 고쳐 저장하면 반영돼요', 'info');
      // ★제안 본문을 들고 간다(2026-08-25 감사 #20). 본문을 안 넘기면 사장은 **뭘 고치라는 건지 다시 볼 수 없다.**
      router.push({ pathname: '/owner/edit/[id]', params: { id: s.target_entry_id, seed: s.text, sugId: s.id } });
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

  async function approveSpace(s: PlaybookSuggestion) {
    if (approving) return;
    setApproving(s.id);
    const r = await approveFromSpace(s.id);
    setApproving('');
    if (r.error) {
      showToast(placeErrorMessage(r.error), 'warn');
      return;
    }
    if (r.photoFailed) showToast(placeErrorMessage('photo_copy_failed'), 'warn');
    else if (r.skipped > 0) showToast(CONNECT.photosSkipped(r.skipped), 'info');
    else showToast(CONNECT.approved, 'good');
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
    // 바탕·헤더·탭바 = Screen. 로딩 게이트가 스크롤 자리를 바꿔 스크롤은 직접 둔다(scroll={false}).
    // 반려 시트는 Screen 밖 형제.
    <>
    <Screen header={<ScreenTitleHeader title="노하우 제안함" backFallback />} tabBar="owner" scroll={false}>
      <Stack.Screen options={{ title: '노하우 제안함' }} />
      {!ready ? (
        <ScreenLoading label="직원 제안을 불러오고 있어요…" />
      ) : loadError ? (
        // 읽기 실패를 "대기 중인 제안이 없어요 🤝"로 위장하지 않는다(#19) — 사장이 제안을 놓친다.
        <LoadErrorState title="직원 제안을 불러오지 못했어요" onRetry={() => void retry()} />
      ) : (
      <KeyboardShift>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Appear delay={stagger(0)}>
          <Text style={styles.subline}>직원이 올린 제안이에요. 승인하면 노하우에 반영돼요</Text>
        </Appear>

        {pending.length === 0 ? (
          <Appear delay={stagger(1)}>
          <View style={EmptyStyles.box}>
            <Text style={EmptyStyles.text}>대기 중인 제안이 없어요.{'\n'}직원이 노하우 개선·신규를 제안하면 여기로 와요.</Text>
          </View>
          </Appear>
        ) : (
          <View style={styles.list}>
            {pending.map((s, i) => (
              <Appear key={s.id} delay={stagger(i + 1)}>
                {s.kind === 'from_space' ? (
                  <SpaceProposalCard s={s} busy={approving === s.id} onApprove={() => reflect(s)} onReject={() => setDeclineFor(s)} />
                ) : (
                  <SuggestionCard s={s} onApprove={() => reflect(s)} onReject={() => setDeclineFor(s)} />
                )}
              </Appear>
            ))}
          </View>
        )}

        {handled.length > 0 && (
          <Appear delay={stagger(2)}>
          <View style={styles.handledWrap}>
            <Text style={styles.handledHeader}>처리됨</Text>
            {handled.map((s) => (
              <View key={s.id} style={styles.handledRow}>
                <View style={[styles.statusChip, { backgroundColor: SUGGESTION_STATUS_CHIP[s.status].bg }]}>
                  <Text style={[styles.statusChipText, { color: SUGGESTION_STATUS_CHIP[s.status].fg }]}>
                    {SUGGESTION_STATUS_LABEL[s.status]}
                  </Text>
                </View>
                <Text style={styles.handledText} numberOfLines={1}>
                  {s.proposer_name} · {s.kind === 'improve' ? '개선' : s.kind === 'from_space' ? CONNECT.handledKind : '신규'} · {s.kind === 'from_space' ? snapshotTitle(s) : s.text}
                </Text>
              </View>
            ))}
          </View>
          </Appear>
        )}
      </ScrollView>
      </KeyboardShift>
      )}
    </Screen>

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
    </>
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
            name={isImprove ? 'create-outline' : 'add-circle-outline'}
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

/** 공간 제안의 보낼 때 제목(스냅샷). 없으면 본문 첫 줄(옛 행 · 서버 머리말이 제목으로 시작한다). */
function snapshotTitle(s: PlaybookSuggestion): string {
  const t = s.source_snapshot?.title;
  return typeof t === 'string' && t.trim() ? t.trim() : s.text.split('\n')[0];
}

/** 공간 제안의 미리보기 = 보낼 때 상황 → 없으면 첫 순서. 사장이 본 글 = 승인으로 남는 글(스냅샷 · 0490 가드가 못 바꾸게 한다). */
function snapshotPreview(s: PlaybookSuggestion): string {
  const sq = s.source_snapshot?.square as { situation?: unknown; action?: { steps?: unknown } } | undefined;
  if (typeof sq?.situation === 'string' && sq.situation.trim()) return sq.situation.trim();
  const steps = Array.isArray(sq?.action?.steps) ? sq.action.steps.filter((x): x is string => typeof x === 'string') : [];
  return steps.join('\n');
}

/**
 * M04 공간에서 온 노하우 카드(night-1111 g5) — 꼬리표 · 보낸 사람 · 제목 · 미리보기 · [반려] [승인].
 * 승인은 코치를 거치지 않는다(스냅샷으로 사본을 만든다). 반려는 직원 제안과 같은 사유 시트다.
 */
function SpaceProposalCard({
  s,
  busy,
  onApprove,
  onReject,
}: {
  s: PlaybookSuggestion;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const preview = snapshotPreview(s);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindChip, styles.kindSpace]}>
          <Ionicons name="library-outline" size={Type.tag.fontSize} color={InkColors.ink} />
          <Text style={[styles.kindText, { color: InkColors.ink }]}>{CONNECT.fromSpaceTag}</Text>
        </View>
      </View>
      <Text style={styles.sentBy}>{CONNECT.sentBy(s.proposer_name ?? '')}</Text>
      <Text style={styles.spaceTitle}>{snapshotTitle(s)}</Text>
      {preview ? (
        <Text style={styles.body} numberOfLines={4}>
          {preview}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onReject}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={CONNECT.reject}
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.btnGhostText}>{CONNECT.reject}</Text>
        </Pressable>
        <Pressable
          onPress={onApprove}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={CONNECT.approve}
          accessibilityState={{ busy, disabled: busy }}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, busy && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="checkmark" size={Type.body.fontSize} color={InkColors.bubbleText} />
          <Text style={styles.btnPrimaryText}>{CONNECT.approve}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 첫 여백 16 · 좌우 20 · 블록 사이 20 = Screen 스크롤과 같은 값(2026-11-02).
  scroll: screenScrollStyle,
  // 화면 부제 = 설명(Type.desc · 13/19 secondary).
  subline: { ...Type.desc, fontWeight: '600' },


  list: { gap: 12 },
  card: { ...CardStyles.list, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.pill },
  kindImprove: { backgroundColor: '#FBF3E3' },
  kindNew: { backgroundColor: BrandColors.yellowSoft },
  kindText: { ...Type.tag, fontWeight: '800' },
  kindSpace: { backgroundColor: InkColors.bgSoft },
  sentBy: { ...Type.desc, fontWeight: '700' },
  spaceTitle: { ...Type.body, fontWeight: '800' },
  proposer: { marginLeft: 'auto', fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 7 },
  targetText: { ...Type.tag, flex: 1, fontWeight: '700', color: InkColors.ink2 },

  body: { ...Type.body, lineHeight: 22 },

  // 버튼 = 주 버튼 모양(52 · 모서리 16 · 16/800 · 2026-11-02). 둘이 한 줄에 서서 반려는 내용 폭, 승인은 나머지 폭.
  actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  btn: { ...ButtonStyles.primary, flexDirection: 'row', gap: 5 },
  btnGhost: { borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  btnGhostText: { ...ButtonTextStyles.primary, color: InkColors.ink2 },
  btnPrimary: { flex: 1, backgroundColor: InkColors.ink },
  btnPrimaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },

  // 반려 사유 시트
  // 시트 좌우 여백 16 — 화면 거터(20)가 아니라 시트 표준을 따른다(kit 의 qst.body).
  declineSheet: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },
  declineTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  declineSub: { ...Type.desc, fontWeight: '600' },
  declineInput: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.cream, minHeight: 72, textAlignVertical: 'top' },
  declineBtns: { flexDirection: 'row', gap: 8, marginTop: 2 },

  handledWrap: { marginTop: 6, gap: 8 },
  handledHeader: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  handledRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  statusChipText: { ...Type.micro, fontWeight: '800' },
  handledText: { ...Type.tag, flex: 1, color: TextColor.secondary, fontWeight: '600' },
});
