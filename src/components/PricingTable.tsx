import { View, Text, StyleSheet } from 'react-native';

import { PLANS, PLAN_ORDER, VAT_NOTE_SENTENCE, type PlanId } from '@/lib/config/tiers';
import { formatKrw } from '@/lib/config/billing';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 요금제 표(3티어) — 표시 전용. 가격·티어·정가는 전부 tiers.ts(SSOT)에서만 읽는다(2곳 복제 금지).
// 파일럿 할인가(monthlyKrw) 옆에 정가(regularKrw)를 취소선으로 병기하고, 상단에 '파일럿 만원 할인' 배지를 띄운다.
// 같은 위젯을 가입 화면·설정·완료화면이 재사용한다(currentPlan 으로 '현재' 강조).

// 파일럿 할인폭(원) — 정가 있는 유료 티어의 (정가 - 할인가) 최댓값. 전 티어 동일(10,000)이지만
// SSOT 값에서 계산해 하드코딩을 피한다(정가/할인가가 바뀌면 배지 문구도 자동으로 따라간다).
const pilotDiscount = Math.max(
  0,
  ...PLAN_ORDER.map((id) => {
    const d = PLANS[id];
    return d.regularKrw && d.regularKrw > d.monthlyKrw ? d.regularKrw - d.monthlyKrw : 0;
  }),
);

function priceLabel(plan: PlanId): string {
  const def = PLANS[plan];
  if (def.monthlyKrw === 0) return '0원';
  return `${def.perStore ? '매장당 ' : ''}월 ${formatKrw(def.monthlyKrw)}`;
}

export function PricingTable({
  currentPlan,
  footNote = '가입은 무료로 시작해요. 요금제는 나중에 언제든 바꿀 수 있어요.',
}: {
  currentPlan?: PlanId;
  footNote?: string | null;
}) {
  return (
    <View style={styles.card}>
      {pilotDiscount > 0 && (
        <View style={styles.pilotBanner}>
          <Text style={styles.pilotBadge}>파일럿</Text>
          <Text style={styles.pilotText}>
            지금은 파일럿 기간이라 정가보다 매달 <Text style={styles.pilotStrong}>{formatKrw(pilotDiscount)} 할인</Text> 중이에요
          </Text>
        </View>
      )}

      <View style={styles.rows}>
        {PLAN_ORDER.map((pid, i) => {
          const def = PLANS[pid];
          const current = pid === currentPlan;
          return (
            <View key={pid} style={[styles.row, i > 0 && styles.rowDivider, current && styles.rowCurrent]}>
              <View style={styles.rowLeft}>
                <View style={styles.nameLine}>
                  <Text style={styles.name}>{def.name}</Text>
                  {current && (
                    <View style={styles.currentBadge}>
                      <Text style={styles.currentBadgeText}>현재</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.tagline}>{def.tagline}</Text>
              </View>
              <View style={styles.rowRight}>
                {def.regularKrw ? <Text style={styles.regular}>{formatKrw(def.regularKrw)}</Text> : null}
                <Text style={styles.price}>{priceLabel(pid)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.vat}>{VAT_NOTE_SENTENCE}</Text>

      {footNote ? <Text style={styles.foot}>{footNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },

  // 파일럿 할인 배너 — 앰버 톤(확인필요와 구분되는 골드 크림). 노랑 CTA 오인 방지 위해 채도 낮춤.
  pilotBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.sourceBg,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: BrandColors.gold,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
  },
  pilotBadge: {
    fontSize: 11,
    fontWeight: '900',
    color: InkColors.ink,
    backgroundColor: BrandColors.yellow,
    borderRadius: Radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  pilotText: { flex: 1, fontSize: 12.5, color: InkColors.ink2, lineHeight: 18, fontWeight: '600' },
  pilotStrong: { fontWeight: '900', color: InkColors.ink },

  rows: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowCurrent: { marginHorizontal: -Space.sm, paddingHorizontal: Space.sm, backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm },
  rowLeft: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  name: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  currentBadge: {
    backgroundColor: InkColors.ink,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  currentBadgeText: { fontSize: 10.5, fontWeight: '800', color: InkColors.bubbleText },
  tagline: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', lineHeight: 17 },

  rowRight: { alignItems: 'flex-end' },
  regular: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', textDecorationLine: 'line-through' },
  price: { fontSize: 14.5, fontWeight: '900', color: InkColors.ink },

  vat: { fontSize: 12, color: InkColors.ink3, lineHeight: 18, fontWeight: '600' },
  foot: { fontSize: 12, color: InkColors.ink3, lineHeight: 18, fontWeight: '600' },
});
