// PackDraftCard — 업종 노하우팩에서 찾은 답 초안 한 장(8번 · 결정 115·117).
// 사장 답하기(owner/coach ?uqId=)와 사장 첫 5분(질문 던져보기)이 같은 부품을 쓴다.
// [맞아요](Primary) = 팩 원문 그대로 매장 노하우로 남긴다. [고치기] = 코치 입력칸에 팩 원문을 채워 고쳐 쓴다.
// 찾기는 src/lib/knowhow/packDraft.ts(AI 0회). 이 부품은 그리기만 한다.
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { PACK_DRAFT } from '@/lib/place/words';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Space, Gap } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { forkTemplate, type PlaybookTemplate } from '@/data/knowhowPacks';
import type { PlaybookEntry } from '@/types';

/** 할 일 줄 앞의 "1) " 번호는 팩 원문 표기다. 카드는 줄마다 번호를 다시 붙이지 않고 그대로 보인다. */
export function PackDraftCard({
  item,
  busy = false,
  onConfirm,
  onEdit,
}: {
  item: Pick<PlaybookEntry, 'title' | 'square'>;
  busy?: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const steps = item.square?.action?.steps ?? [];
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Ionicons name="sparkles-outline" size={15} color={InkColors.ink} />
        <Text style={s.label}>{PACK_DRAFT.label}</Text>
      </View>
      <Text style={s.title}>{item.title}</Text>
      {!!item.square?.situation && (
        <View style={s.block}>
          <Text style={s.blockLabel}>{PACK_DRAFT.situation}</Text>
          <Text style={s.body}>{item.square.situation}</Text>
        </View>
      )}
      {steps.length > 0 && (
        <View style={s.block}>
          <Text style={s.blockLabel}>{PACK_DRAFT.steps}</Text>
          {steps.map((st, i) => (
            <Text key={i} style={s.body}>{st}</Text>
          ))}
        </View>
      )}
      <View style={s.actions}>
        <PressableScale
          onPress={onEdit}
          disabled={busy}
          scaleTo={0.97}
          style={[s.ghost, busy && s.dim]}
          accessibilityRole="button"
          accessibilityLabel={PACK_DRAFT.edit}
        >
          <Text style={s.ghostText}>{PACK_DRAFT.edit}</Text>
        </PressableScale>
        <PressableScale
          onPress={onConfirm}
          disabled={busy}
          scaleTo={0.97}
          style={[s.primary, busy && s.dim]}
          accessibilityRole="button"
          accessibilityLabel={PACK_DRAFT.confirm}
        >
          {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={s.primaryText}>{PACK_DRAFT.confirm}</Text>}
        </PressableScale>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { ...CardStyles.list, gap: Gap.item },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  label: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  title: { ...Type.section },
  block: { gap: Gap.inline },
  blockLabel: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
  body: { ...Type.body },
  actions: { flexDirection: 'row', gap: Space.sm },
  ghost: { ...ButtonStyles.primary, flex: 1, alignSelf: 'auto', backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { ...ButtonTextStyles.primary, color: InkColors.ink },
  primary: { ...ButtonStyles.primary, flex: 1, alignSelf: 'auto', backgroundColor: BrandColors.brand },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  dim: { opacity: 0.5 },
});

/**
 * [맞아요] 로 남길 노하우 = 팩 원문을 매장 노하우로 fork(템플릿 담기와 같은 칸 · pack_id 가 출처 표시).
 * 사장이 "맞다"고 확인했으니 '점검 필요'를 떼고, 사장이면 사장님 검증을 단다(coach withPart 와 같은 규칙).
 * 매니저가 확인한 것은 검증 표시 없이 남긴다(사장 검증은 사장만).
 */
export function confirmedPackEntry(
  tpl: PlaybookTemplate,
  ctx: { unitId: string; userId: string; userName: string; role: string },
): PlaybookEntry {
  const base = forkTemplate(tpl, {
    unitId: ctx.unitId,
    creatorId: ctx.userId,
    creatorName: ctx.userName,
    creatorRole: ctx.role === 'manager' ? 'manager' : 'owner',
  });
  return {
    ...base,
    needs_review: false,
    ...(ctx.role === 'owner'
      ? { verification: { state: 'owner_verified' as const, verified_by: ctx.userName, verified_at: new Date().toISOString() } }
      : null),
  };
}
