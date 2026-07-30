// StarterChecklist — 사장 허브 '현황' 탭 상단 시작 체크리스트(콜드스타트 슬라이스 A).
//
// 신규 매장 첫날의 현황 탭은 0뿐이라 죽은 화면이다. 이 카드가 "빈 → 씨앗 → 채워짐"의
// 안내자다: 4단계가 실데이터(owner_overview 0086)에 즉시 반응하고, 전부 채워지면 영구 소멸.
// 판정은 starterProgress(SSOT)만 쓴다 — 여기서 재판정 금지.
// 콜드스타트 원칙: 0을 위험으로 표시하지 않는다(경고색 없음) · 책망 톤 금지("곧 채워질 자리").
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { starterSteps } from '@/lib/utils/starterProgress';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { SectionLabel } from '@/components/SectionLabel';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { OwnerOverviewRow } from '@/lib/db';
import type { StarterStepId } from '@/lib/utils/starterProgress';
import type { Href } from 'expo-router';

// 각 단계의 이동 목적지 — 허브 원칙(읽기·이동까지)대로 실행은 매장 화면이 담당.
const STEP_PATH: Record<StarterStepId, Href> = {
  knowhow: '/owner/templates',
  ask: { pathname: '/owner/onboarding', params: { step: 'ask' } },
  invite: '/owner/staff',
  task: '/owner/work',
};

export function StarterChecklist({ row }: { row: OwnerOverviewRow }) {
  const { goStore, switching } = useStoreNav();
  const steps = starterSteps(row);
  const doneCount = steps.filter((s) => s.done).length;
  const nextId = steps.find((s) => !s.done)?.id;

  return (
    <View>
      <SectionLabel title="시작하기" />
      <View style={styles.card}>
        <View style={styles.headRow}>
          <Text style={styles.headText}>매장이 채워지는 중이에요</Text>
          <Text style={styles.headCount}>{doneCount}/{steps.length}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${(doneCount / steps.length) * 100}%` }]} />
        </View>

        {steps.map((s) => {
          const isNext = s.id === nextId;
          return (
            <Pressable
              key={s.id}
              onPress={() => goStore(row.unit_id, STEP_PATH[s.id])}
              disabled={s.done || !!switching}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: s.done }}
              accessibilityLabel={s.done ? `${s.title} 완료` : s.title}
            >
              <View style={[styles.check, s.done && styles.checkOn]}>
                {s.done && <Ionicons name="checkmark" size={13} color={InkColors.ink} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, s.done && styles.rowTitleDone]} numberOfLines={1}>
                  {s.title}
                </Text>
                {/* 힌트는 다음 할 단계 하나에만 — 4줄 전부 설명을 달면 카드가 안내문이 된다. */}
                {isNext && <Text style={styles.rowHint}>{s.hint}</Text>}
              </View>
              {!s.done && <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    marginTop: Space.sm,
    ...Elevation.e2,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Space.xs },
  headText: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  headCount: { fontSize: 13, fontWeight: '800', color: InkColors.ink3 },
  barTrack: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft,
    overflow: 'hidden',
    marginBottom: Space.xs,
  },
  barFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink },
  rowTitleDone: { color: InkColors.ink3 },
  rowHint: { fontSize: 12, color: InkColors.ink3, marginTop: 1, lineHeight: 17 },
});
