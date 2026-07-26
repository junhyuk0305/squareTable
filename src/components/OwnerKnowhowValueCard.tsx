import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { goToTab } from '@/components/RoleTabBar';
import { SectionLabel } from '@/components/SectionLabel';
import { InfoDot } from '@/components/InfoDot';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canUseMultistore } from '@/lib/config/tiers';
import { SHOW_BILLING } from '@/lib/config/store-policy';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space, frameCapStyle } from '@/lib/theme/layout';
import { capCount } from '@/lib/utils/format';

/**
 * 홈 '우리 매장 노하우' 가치 카드 — 노하우가 사장 대신 답하고 있음을 값으로 보여준다.
 * 3칸 요약(최근30일 대신 답함 · 답 기다리는 질문 · 정리된 노하우) + 추가 CTA.
 * 지표는 전부 실데이터(props). "매장 두뇌 완성도" 같은 자기계발형 게이지는 쓰지 않는다.
 * 표시전용 — 데이터는 useOwnerDashboardData에서 파생해 주입.
 */
export interface OwnerKnowhowValueCardProps {
  answeredHits30d: number;
  pending: number;
  entriesCount: number;
}

export function OwnerKnowhowValueCard({ answeredHits30d, pending, entriesCount }: OwnerKnowhowValueCardProps) {
  const router = useRouter();
  // 다점포(매장 2+개) 사장에게만 '다른 매장에서 가져오기' 입구를 노출한다.
  const multiStore = useSessionStore((s) => s.stores.length > 1);
  // 다점포 요금제 게이트(0062) — 잠기면 입구는 남기되 요금제 화면으로 유도(FREE_MODE 땐 열림).
  const plan = useSessionStore((s) => s.plan);
  const multiUnlocked = canUseMultistore(plan);

  return (
    <View style={[styles.section, frameCapStyle]}>
      <SectionLabel
        icon="bulb-outline"
        title="우리 매장 노하우"
        trailing={
          <View style={styles.headActions}>
            <InfoDot
              title="이 숫자들은 무엇인가요?"
              body={
                '• 대신 답함 — 최근 30일 동안 직원이 물어봤을 때, 등록된 노하우가 답을 찾아준 횟수예요. 직원이 ‘노하우 물어보기’에서 질문하면 표현이 조금 달라도 관련 노하우를 자동으로 찾아드려요(똑같이 입력할 필요 없어요). 답을 못 찾으면 이 숫자에 안 들어가고 ‘답 기다리는 질문’으로 넘어가요.\n\n• 답 기다리는 질문 — 노하우에 없어서 사장님 답을 기다리는 질문 수예요.\n\n• 정리된 노하우 — 지금까지 쌓인 노하우 개수예요.'
              }
              accessibilityLabel="노하우 지표 설명 보기"
            />
            <PressableScale
              // 탭 루트로의 이동은 push가 아니라 탭 전환(goToTab) — 뒤로가기 없이 하단 '노하우' 탭이 활성된다.
              onPress={() => goToTab('/owner/categories')}
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel="노하우 전체 보기"
            >
              <Text style={styles.headLink}>전체 ›</Text>
            </PressableScale>
          </View>
        }
      />

      <View style={styles.card}>
        <View style={styles.valRow}>
          <View style={styles.valCell}>
            <Text style={styles.valNum}>{capCount(answeredHits30d)}</Text>
            <Text style={styles.valLabel}>최근 30일{'\n'}대신 답함</Text>
          </View>
          <View style={styles.valCell}>
            {pending > 0 && <View style={styles.rdot} />}
            <Text style={[styles.valNum, pending > 0 && styles.valNumAlert]}>{capCount(pending)}</Text>
            <Text style={styles.valLabel}>답 기다리는{'\n'}질문</Text>
          </View>
          <View style={styles.valCell}>
            <Text style={styles.valNum}>{capCount(entriesCount)}</Text>
            <Text style={styles.valLabel}>정리된{'\n'}노하우</Text>
          </View>
        </View>

        {/* 노하우 주 입구 — 인수인계서를 통째로 올리면 AI가 항목별로 정리(coach 파이프라인 재사용). */}
        <PressableScale
          onPress={() => router.push('/owner/handover' as never)}
          scaleTo={0.98}
          style={styles.ctaRow}
          accessibilityRole="button"
          accessibilityLabel="인수인계서로 노하우 채우기"
        >
          <Ionicons name="cloud-upload-outline" size={16} color={BrandColors.warn} />
          <Text style={styles.ctaText}>
            <Text style={styles.ctaStrong}>인수인계서를 올리면</Text> AI가 노하우로 정리해요
          </Text>
          <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
        </PressableScale>

        {/* 다점포 전용 — 다른 내 매장의 노하우를 현재 매장으로 가져오기(복제). 요금제 잠금 시 업그레이드 유도.
            iOS 네이티브에서 잠긴 상태는 요금제 유도가 되므로 행 자체를 렌더하지 않는다(3.1.3(f)). */}
        {multiStore && (multiUnlocked || SHOW_BILLING) ? (
          <PressableScale
            onPress={() => router.push((multiUnlocked ? '/owner/import-knowhow' : '/billing') as never)}
            scaleTo={0.98}
            style={styles.ctaRow}
            accessibilityRole="button"
            accessibilityLabel={multiUnlocked ? '다른 매장에서 노하우 가져오기' : '다른 매장 노하우 가져오기 — 다점포 요금제에서 열려요'}
          >
            <Ionicons name={multiUnlocked ? 'git-branch-outline' : 'lock-closed-outline'} size={16} color={InkColors.ink2} />
            <Text style={styles.ctaText}>
              {multiUnlocked ? (
                <>
                  <Text style={styles.ctaStrong}>다른 매장</Text>의 노하우를 여기로 가져와요
                </>
              ) : (
                <>
                  <Text style={styles.ctaStrong}>다점포 요금제</Text>에서 다른 매장 노하우를 가져와요
                </>
              )}
            </Text>
            <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Space.sm },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  headLink: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink },
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e2,
  },
  valRow: { flexDirection: 'row', gap: Space.sm },
  valCell: {
    flex: 1,
    backgroundColor: InkColors.paper,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 11,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  valNum: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4, color: InkColors.ink, lineHeight: 22 },
  valNumAlert: { color: BrandColors.bad },
  valLabel: { fontSize: 11, fontWeight: '600', color: InkColors.ink2, marginTop: 5, textAlign: 'center', lineHeight: 14 },
  rdot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.bad,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: InkColors.paper,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  ctaText: { flex: 1, fontSize: 12, fontWeight: '600', color: InkColors.ink2, lineHeight: 16 },
  ctaStrong: { color: InkColors.ink, fontWeight: '900' },
});
