// BrandCopyPanel.tsx — 노하우 수정 화면의 본사 사본 줄(정본 §4-E ③): 배지 · 새 버전 교체/유지 · 숨기기/되살리기.
//
// ★미연결 diff 0: 사본이 아니면 `null` — 매장 자체 노하우에서는 이 줄이 존재하지 않는다(brand-boundary).
// ★판정은 `lib/brand/copy.ts`, 쓰기는 `lib/brand/brandDb.ts` 정의자 RPC. 이 부품은 화면만 그린다.
//
// 왜 수정 화면에 두나: 점주가 사본을 만나는 자리가 여기다(목록에서 눌러 들어온다). 별도 '본사 노하우'
// 탭을 만들면 탭이 늘고(정본 §4-E "신규 탭 0"), 점주가 자기 노하우와 받은 노하우를 두 곳에서 관리하게 된다.
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { BrandCopyBadges } from '@/components/owner/BrandCopyBadges';
import { isBrandCopy, isBrandHidden, hasBrandPending, isBrandModified } from '@/lib/brand/copy';
import { hideBrandCopy, applyBrandPending } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

export function BrandCopyPanel({ entry }: { entry: PlaybookEntry }) {
  const hydrate = usePlaybookStore((s) => s.hydrate);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isBrandCopy(entry)) return null;

  const hidden = isBrandHidden(entry);
  const pending = hasBrandPending(entry);

  const run = async (fn: () => ReturnType<typeof hideBrandCopy>) => {
    setBusy(true);
    setErr(null);
    const e = await fn();
    setBusy(false);
    // 무음 실패 금지 — 숨겼다고 믿는데 직원에게 계속 보이면 그게 제일 나쁘다.
    if (e) { setErr(brandErrorMessage(e)); return false; }
    await hydrate();
    return true;
  };

  const toggleHidden = async () => {
    if (!hidden) {
      const ok = await confirmAction(
        '이 매장에서 숨기기',
        '직원 검색·AI 답변·퀴즈에서 빠져요. 본사에는 "숨김"으로 보이고, 내용은 계속 갱신돼요. 언제든 되살릴 수 있어요.',
        '숨기기',
        { icon: 'eye-off-outline' },
      );
      if (!ok) return;
    }
    await run(() => hideBrandCopy(entry.id, !hidden));
  };

  const answerPending = async (replace: boolean) => {
    const ok = await run(() => applyBrandPending(entry.id, replace));
    if (ok) setSheet(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <BrandCopyBadges entry={entry} size="card" />
      </View>
      <Text style={styles.body}>
        {hidden
          ? '이 매장에서 숨긴 본사 노하우예요. 직원에게 보이지 않아요.'
          : isBrandModified(entry)
            ? '본사가 보낸 노하우를 이 매장에 맞게 고쳤어요. 본사가 다시 보내도 내 수정은 덮이지 않아요.'
            : '본사가 보낸 노하우예요. 이 매장에 맞게 고치거나 숨길 수 있어요.'}
      </Text>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <View style={styles.btns}>
        {pending ? (
          <Btn
            label="새 버전 확인"
            icon="sparkles-outline"
            tone="pri"
            disabled={busy}
            onPress={() => setSheet(true)}
            testID="brand-pending-open"
          />
        ) : null}
        <Btn
          label={hidden ? '되살리기' : '이 매장에서 숨기기'}
          icon={hidden ? 'eye-outline' : 'eye-off-outline'}
          disabled={busy}
          onPress={() => void toggleHidden()}
          testID="brand-hide-toggle"
        />
      </View>

      {sheet && (
        <BottomSheet visible onClose={() => setSheet(false)}>
          <Text style={styles.sheetTitle}>본사에서 새 버전이 왔어요</Text>
          <Text style={styles.sheetHint}>
            이 노하우는 이 매장에 맞게 고쳐 둔 것이라 자동으로 바뀌지 않았어요. 어느 쪽으로 할지 골라 주세요.
          </Text>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <View style={styles.sheetBtns}>
            <Btn
              label="새 버전으로 바꾸기"
              icon="swap-vertical"
              tone="pri"
              disabled={busy}
              onPress={() => void answerPending(true)}
              testID="brand-pending-replace"
            />
            <Text style={styles.sheetNote}>내가 고친 내용은 사라져요.</Text>
            <Btn
              label="내 수정 유지하기"
              icon="lock-closed-outline"
              disabled={busy}
              onPress={() => void answerPending(false)}
              testID="brand-pending-keep"
            />
            <Text style={styles.sheetNote}>지금 내용이 그대로 남아요. 다음에 또 새 버전이 오면 다시 물어봐요.</Text>
          </View>
        </BottomSheet>
      )}
    </View>
  );
}

function Btn({
  label,
  icon,
  tone,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'pri';
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.btn, tone === 'pri' && styles.btnPri, pressed && { opacity: 0.8 }, disabled && { opacity: 0.45 }]}
    >
      <Ionicons name={icon} size={15} color={InkColors.ink} />
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Space.md,
    marginBottom: Space.sm,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.mentionSoft,
    backgroundColor: BrandColors.mentionSoft,
    gap: 9,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  // 고정 높이를 주지 않는다 — 문장이 길어지면 늘어난다(메모리 feedback_fixed_height_text_overflow).
  body: { fontSize: 13.5, lineHeight: 20, color: InkColors.ink2 },
  err: { fontSize: 13, lineHeight: 19, color: BrandColors.badText, fontWeight: '600' },
  btns: { flexDirection: 'row', gap: Space.xs, flexWrap: 'wrap' },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  btnPri: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  btnText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink },

  sheetTitle: { fontSize: 18, fontWeight: '900', color: InkColors.ink, marginBottom: 5 },
  sheetHint: { fontSize: 13.5, lineHeight: 20, color: InkColors.ink2, marginBottom: 16 },
  sheetBtns: { gap: 7 },
  sheetNote: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3, marginBottom: 9, marginLeft: 4 },
});
