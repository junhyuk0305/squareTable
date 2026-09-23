// BrandCopyBadges.tsx — 노하우 카드의 본사 사본 배지(정본 §4-E ③): 본사 · 원본에서 수정됨 · 새 버전 있음 · 숨김.
//
// ★미연결 매장 diff 0: 사본이 아니면 `null` 을 돌려주므로 한 줄도 그려지지 않는다(brand-boundary).
//   그래서 이 부품을 노하우가 나오는 자리에 그냥 끼워 둘 수 있다 — 연결 여부를 화면이 묻지 않는다.
// ★판정은 `lib/brand/copy.ts` 한 곳(AGENTS ②) — 여기서 `brand_entry_id` 를 직접 보지 않는다.
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  isBrandCopy,
  isBrandHidden,
  isBrandModified,
  hasBrandPending,
  BRAND_BADGE,
  BRAND_MODIFIED_BADGE,
  BRAND_PENDING_BADGE,
  BRAND_HIDDEN_BADGE,
  type BrandCopyFields,
} from '@/lib/brand/copy';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

export function BrandCopyBadges({ entry, size = 'list' }: { entry: BrandCopyFields; size?: 'list' | 'card' }) {
  if (!isBrandCopy(entry)) return null;
  const big = size === 'card';
  return (
    <>
      <View style={[styles.badge, styles.brand, big && styles.big]}>
        <Ionicons name="business" size={big ? 11 : 9} color={BrandColors.mentionText} />
        <Text style={[styles.text, { color: BrandColors.mentionText }, big && styles.textBig]}>{BRAND_BADGE}</Text>
      </View>
      {/* 숨김이 먼저다 — 숨긴 노하우는 지금 직원에게 안 보이는 상태이고, 그게 가장 중요한 사실이다. */}
      {isBrandHidden(entry) ? (
        <View style={[styles.badge, styles.hidden, big && styles.big]}>
          <Text style={[styles.text, { color: InkColors.ink2 }, big && styles.textBig]}>{BRAND_HIDDEN_BADGE}</Text>
        </View>
      ) : null}
      {hasBrandPending(entry) ? (
        <View style={[styles.badge, styles.pending, big && styles.big]}>
          <Text style={[styles.text, { color: BrandColors.warnText }, big && styles.textBig]}>{BRAND_PENDING_BADGE}</Text>
        </View>
      ) : null}
      {isBrandModified(entry) ? (
        <View style={[styles.badge, styles.modified, big && styles.big]}>
          <Text style={[styles.text, { color: InkColors.ink2 }, big && styles.textBig]}>{BRAND_MODIFIED_BADGE}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 1, paddingHorizontal: 6, borderRadius: Radius.pill },
  big: { paddingVertical: 3, paddingHorizontal: 9, gap: 4 },
  text: { fontSize: 10, fontWeight: '800' },
  textBig: { fontSize: 12.5 },
  brand: { backgroundColor: BrandColors.mentionSoft },
  pending: { backgroundColor: BrandColors.warnSoft },
  modified: { backgroundColor: InkColors.paper },
  hidden: { backgroundColor: InkColors.paper, borderWidth: 1, borderColor: InkColors.line },
});
