import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { SectionLabel } from '@/components/SectionLabel';
import { goToTab } from '@/components/RoleTabBar';
import { Avatar } from '@/components/Avatar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space, frameCapStyle } from '@/lib/theme/layout';
import type { AssignSummary } from '@/lib/hooks/useOwnerDashboardData';

/**
 * 홈 '오늘 일 배분' 가치 카드 — "누가 무슨 일"을 담당자별로 요약한다.
 * 채팅에 묻혀 있던 업무 배정을 홈에서 위임 상태로 보여줘, 채팅 되짚기 없이 남은 일이 보이게.
 * 표시전용 — 배정 데이터(assign)는 useOwnerDashboardData에서 파생해 주입(occursOn+가시성 SSOT 재사용).
 */
export interface OwnerWorkValueCardProps {
  assign: AssignSummary;
}

export function OwnerWorkValueCard({ assign }: OwnerWorkValueCardProps) {
  const { total, done, groups } = assign;
  const remain = total - done;

  return (
    <View style={[styles.section, frameCapStyle]}>
      <SectionLabel
        icon="checkbox-outline"
        title="오늘 일 배분"
        trailing={
          <PressableScale
            onPress={() => goToTab({ pathname: '/owner/work', params: { view: 'assign' } })}
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityLabel="업무 배정하러 가기"
          >
            <Text style={styles.headLink}>＋ 일 맡기기</Text>
          </PressableScale>
        }
      />

      <PressableScale
        onPress={() => goToTab('/owner/work')}
        scaleTo={0.98}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={
          total === 0 ? '오늘 배정된 일 없음' : `오늘 배정 ${total}건, 미완료 ${remain}건`
        }
      >
        {total === 0 ? (
          <Text style={styles.empty}>오늘 배정된 일이 없어요. ‘일 맡기기’로 담당을 정해보세요.</Text>
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                오늘 배정 {total}건
                {remain > 0 ? (
                  <Text style={styles.summaryRest}> · 미완료 {remain}건</Text>
                ) : (
                  <Text style={styles.summaryDone}> · 모두 완료</Text>
                )}
              </Text>
            </View>
            {groups.slice(0, 3).map((g) => {
              const shared = g.key === 'shared';
              const pct = g.total > 0 ? Math.round((g.done / g.total) * 100) : 0;
              return (
                <View key={g.key} style={styles.row}>
                  {shared ? (
                    <View style={styles.sharedAvatar}>
                      <Ionicons name="people" size={14} color={InkColors.bubbleText} />
                    </View>
                  ) : (
                    <Avatar name={g.name} size={26} />
                  )}
                  <Text style={styles.who} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.cnt}>
                    {g.done}/{g.total}
                  </Text>
                </View>
              );
            })}
          </>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Space.sm },
  headLink: { fontSize: 12.5, fontWeight: '900', color: InkColors.ink },
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 13,
    ...Elevation.e2,
  },
  empty: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3, lineHeight: 18, paddingVertical: 4 },
  summary: { marginBottom: 4 },
  summaryText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },
  summaryRest: { color: BrandColors.bad },
  summaryDone: { color: BrandColors.good },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  sharedAvatar: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink, minWidth: 60, maxWidth: 100 },
  bar: {
    flex: 1,
    height: 7,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.paper,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: InkColors.ink, borderRadius: Radius.pill },
  cnt: { fontSize: 11, fontWeight: '800', color: InkColors.ink3, width: 30, textAlign: 'right' },
});
