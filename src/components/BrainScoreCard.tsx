import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { InfoDot } from '@/components/InfoDot';
import { ALL_CATEGORIES, getCategoryMeta } from '@/lib/utils/category';
import { TARGET_PER_CATEGORY, type BrainScore } from '@/lib/utils/brainScore';
import type { Category } from '@/types';

/**
 * 매장 두뇌 완성도 게이지 (혼자 모드 후킹 F3).
 * "내 매장 매뉴얼 NN% 완성 · 다음 빈칸 추천" — 채우고 싶게 만드는 가시적 진척.
 * 입력을 강요하지 않고, 가장 빈 카테고리를 한 번의 탭으로 채우러 가게 한다.
 */
export function BrainScoreCard({
  score,
  onFill,
}: {
  score: BrainScore;
  onFill: (category: Category | null) => void;
}) {
  const { pct, weakest, nextHint } = score;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="library-outline" size={15} color={InkColors.ink2} />
        <Text style={styles.title}>매장 두뇌 완성도</Text>
        <InfoDot
          title="매장 두뇌 완성도란?"
          body={
            '직원이 자주 묻는 질문을 미리 채워두면 점수가 올라가요.\n100%에 가까울수록 웬만한 질문은 AI가 사장님 대신 알아서 답해줘요.'
          }
        />
        <Text style={styles.pct}>{pct}%</Text>
      </View>

      {/* 진척 바 */}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(pct, 3)}%` }]} />
      </View>

      {/* 카테고리별 채움 현황 */}
      <View style={styles.cats}>
        {ALL_CATEGORIES.map((c) => {
          const meta = getCategoryMeta(c);
          const n = score.perCategory[c];
          const full = n >= TARGET_PER_CATEGORY;
          return (
            <View key={c} style={styles.cat}>
              <View style={[styles.catDot, { backgroundColor: full ? meta.color : InkColors.line }]} />
              <Text style={styles.catText}>
                {meta.label} {Math.min(n, TARGET_PER_CATEGORY)}/{TARGET_PER_CATEGORY}
              </Text>
            </View>
          );
        })}
      </View>

      {/* 다음 빈칸 추천 */}
      <Pressable
        onPress={() => onFill(weakest)}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.ctaHint} numberOfLines={1}>
          {nextHint}
        </Text>
        {weakest && (
          <View style={styles.ctaBtn}>
            <Text style={styles.ctaBtnText}>채우기</Text>
            <Ionicons name="arrow-forward" size={13} color="#FFFFFF" />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    gap: 12,
    ...Elevation.e2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  pct: { marginLeft: 'auto', fontSize: 18, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },

  track: { height: 9, borderRadius: 999, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  // 게이지 = 노랑 바 (디자인시스템: 검정바+노랑끝 미채택)
  fill: { height: '100%', borderRadius: 999, backgroundColor: BrandColors.yellow },

  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: '44%' },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catText: { fontSize: 12, color: InkColors.ink2, fontWeight: '600' },

  cta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaHint: { flex: 1, fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BrandColors.brand,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  ctaBtnText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
});
