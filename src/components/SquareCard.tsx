import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SourceFooter } from './SourceFooter';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { verifyMeta, type VerifyState } from '@/lib/utils/verification';
import type { Category } from '@/types';

type Props = {
  summary: string;
  actions: string[];
  donts: string[];
  source: {
    entryId: string;
    creatorName: string;
    title: string;
    version: number;
    updatedAt: string;
    /** 출처 라벨(받은질문 답변/매뉴얼 등). 없으면 creatorName 사용. */
    label?: string;
  };
  category: Category;
  confidence?: number;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  feedback?: 'up' | 'down' | null;
  // ── 노하우 세그먼트용 보강 메타(모두 선택; 없으면 미노출 → 기존 사용처 무영향) ──
  /** 검증 배지 상태. */
  verification?: VerifyState;
  /** 해결률(0~1). 정의되면 NN%로 표시. */
  resolutionRate?: number;
  /** 핵심 DO 한 줄(긍정색). actions와 별개의 요약용. */
  doText?: string;
  /** 핵심 DON'T 한 줄(경고색). donts와 별개의 요약용. */
  dontText?: string;
  /** 주관적 정도 기준(있을 때만) — 노란 게이지로 "기준 80/100" 표시. max 없으면 0~100. */
  standard?: { kind?: 'spectrum' | 'count'; label: string; value: number; max?: number; ends?: [string, string]; unit?: string };
  /** 출처 푸터 탭 → 원본 노하우 상세 열기(있을 때만 누를 수 있게). */
  onSourcePress?: () => void;
};

export function SquareCard({
  summary,
  actions,
  donts,
  source,
  category,
  confidence,
  onThumbsUp,
  onThumbsDown,
  feedback,
  verification,
  resolutionRate,
  doText,
  dontText,
  standard,
  onSourcePress,
}: Props) {
  const stdMax = standard?.max && standard.max > 0 ? standard.max : 100;
  const stdPct = standard
    ? Math.max(0, Math.min(100, Math.round((standard.value / stdMax) * 100)))
    : null;
  const hasVerification = typeof verification !== 'undefined';
  const hasRate = typeof resolutionRate === 'number';
  const v = hasVerification ? verifyMeta(verification) : null;
  const ratePct = hasRate ? Math.round((resolutionRate as number) * 100) : null;
  const doLine = doText?.trim();
  const dontLine = dontText?.trim();

  return (
    <View style={styles.card}>
      {/* Header — 카테고리 칩 비노출(내부 비계). 신뢰 배지/매칭률만 우측에. */}
      <View style={styles.header}>
        <View style={{ flex: 1 }} />
        <View style={styles.headerMeta}>
          {hasRate ? (
            <View style={styles.rateBadge}>
              <Text style={styles.rateText}>해결률 {ratePct}%</Text>
            </View>
          ) : null}
          {v ? (
            <View style={[styles.verifyBadge, { backgroundColor: v.bg }]}>
              <Text style={[styles.verifyText, { color: v.fg }]}>
                {v.icon} {v.label}
              </Text>
            </View>
          ) : typeof confidence === 'number' ? (
            <View style={styles.confBadge}>
              <Text style={styles.confText}>매칭 {Math.round(confidence * 100)}%</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Summary — 내용 있을 때만 (날조 제거로 빈 값 가능) */}
      {summary?.trim() ? (
        <View style={[styles.block, { borderLeftColor: BrandColors.brand }]}>
          <Text style={styles.blockLabel}>상황</Text>
          <Text style={styles.body}>{summary}</Text>
        </View>
      ) : null}

      {/* Actions — 항목 있을 때만 (빈 '지금 할 일' 헤더 방지) */}
      {actions.length > 0 ? (
        <View style={[styles.block, { borderLeftColor: BrandColors.good }]}>
          <Text style={[styles.blockLabel, { color: BrandColors.good }]}>할 일</Text>
          {actions.map((a, i) => (
            <View key={i} style={styles.actionRow}>
              <Text style={styles.actionNum}>{i + 1}</Text>
              <Text style={styles.actionText}>{a}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 셋 다 비면 빈 카드 대신 정직한 안내 */}
      {!summary?.trim() && actions.length === 0 && donts.length === 0 ? (
        <Text style={styles.sparse}>
          등록된 가이드에 이 질문에 대한 구체적 내용이 부족해요. 사장님께 확인해 볼게요.
        </Text>
      ) : null}

      {/* Don'ts */}
      {donts.length > 0 && (
        <View style={[styles.block, { borderLeftColor: BrandColors.warn }]}>
          <Text style={[styles.blockLabel, { color: BrandColors.warn }]}>금지</Text>
          {donts.map((d, i) => (
            <Text key={i} style={styles.dontText}>· {d}</Text>
          ))}
        </View>
      )}

      {/* 기준(보강 메타) — count=개수칩 / spectrum=양끝 사이 위치 / 구형=게이지 */}
      {standard && standard.kind === 'count' ? (
        <View style={styles.gaugeBox}>
          <View style={styles.gaugeHead}>
            <Text style={styles.gaugeLabel}>{standard.label}</Text>
            <Text style={styles.gaugeVal}>{standard.value}{standard.unit ?? ''}</Text>
          </View>
        </View>
      ) : standard && stdPct !== null ? (
        <View style={styles.gaugeBox}>
          <Text style={styles.gaugeLabel}>{standard.label}</Text>
          <View style={styles.gaugeTrack}>
            <View style={[styles.gaugeFill, { width: `${stdPct}%` }]} />
            {standard.ends ? <View style={[styles.gaugeKnob, { left: `${stdPct}%` }]} /> : null}
          </View>
          {standard.ends ? (
            <View style={styles.gaugeEnds}>
              <Text style={styles.gaugeEndTxt}>{standard.ends[0]}</Text>
              <Text style={styles.gaugeEndTxt}>{standard.ends[1]}</Text>
            </View>
          ) : (
            <Text style={styles.gaugeVal}>{standard.value}/{stdMax}</Text>
          )}
        </View>
      ) : null}

      {/* DO / DON'T 2색 한 줄 요약(보강 메타) — 있을 때만 */}
      {doLine ? (
        <View style={[styles.tagRow, { borderLeftColor: BrandColors.good }]}>
          <Text style={[styles.tagLabel, { color: BrandColors.good }]}>DO</Text>
          <Text style={styles.tagText}>{doLine}</Text>
        </View>
      ) : null}
      {dontLine ? (
        <View style={[styles.tagRow, { borderLeftColor: BrandColors.bad }]}>
          <Text style={[styles.tagLabel, { color: BrandColors.bad }]}>DON&apos;T</Text>
          <Text style={styles.tagText}>{dontLine}</Text>
        </View>
      ) : null}

      {/* Source — 누르면 원본 노하우 상세(EntryDetailModal)로. */}
      <View style={{ marginTop: 12 }}>
        <SourceFooter
          creatorName={source.label ?? source.creatorName}
          title={source.title}
          version={source.version}
          updatedAt={source.updatedAt}
          onPress={onSourcePress}
        />
      </View>

      {/* Feedback */}
      {(onThumbsUp || onThumbsDown) && (
        <View style={styles.feedback}>
          <Pressable
            onPress={onThumbsUp}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="도움 됐어요"
            accessibilityState={{ selected: feedback === 'up' }}
            style={[styles.fbBtn, feedback === 'up' && styles.fbBtnActive]}
          >
            <Text style={[styles.fbEmoji, feedback === 'up' && { color: InkColors.bubbleText }]}>👍</Text>
            <Text style={[styles.fbLabel, feedback === 'up' && { color: InkColors.bubbleText }]}>도움됐어요</Text>
          </Pressable>
          <Pressable
            onPress={onThumbsDown}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="도움 안 됐어요"
            accessibilityState={{ selected: feedback === 'down' }}
            style={[styles.fbBtn, feedback === 'down' && styles.fbBtnActive]}
          >
            <Text style={[styles.fbEmoji, feedback === 'down' && { color: InkColors.bubbleText }]}>👎</Text>
            <Text style={[styles.fbLabel, feedback === 'down' && { color: InkColors.bubbleText }]}>아쉬워요</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: InkColors.line,
    gap: 12,
    ...Elevation.e2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  confBadge: {
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  confText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  rateBadge: {
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  rateText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  verifyBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
  },
  verifyText: { fontSize: 11, fontWeight: '800' },
  block: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    gap: 6,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: BrandColors.brand,
    textTransform: 'uppercase',
  },
  body: { fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  sparse: { fontSize: 14, color: InkColors.ink3, lineHeight: 21, paddingVertical: 4 },
  actionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  actionNum: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.good,
    color: InkColors.bubbleText,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 22,
  },
  actionText: { flex: 1, fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  dontText: { fontSize: 14, color: InkColors.ink2, lineHeight: 20 },
  // DO/DON'T 2색 한 줄 태그
  tagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderLeftWidth: 3,
    paddingLeft: 10,
  },
  tagLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, width: 40, lineHeight: 19 },
  tagText: { flex: 1, fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
  // 정도 기준 게이지 (노란 바)
  gaugeBox: { gap: 6, paddingVertical: 2 },
  gaugeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  gaugeLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  gaugeVal: { fontSize: 13, fontWeight: '900', color: InkColors.ink },
  gaugeTrack: { height: 10, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, position: 'relative', justifyContent: 'center' },
  gaugeFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  gaugeKnob: { position: 'absolute', top: -4, width: 18, height: 18, borderRadius: Radius.sm, backgroundColor: InkColors.ink, borderWidth: 3, borderColor: BrandColors.yellow, marginLeft: -9 },
  gaugeEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  gaugeEndTxt: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  feedback: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  fbBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft,
  },
  fbBtnActive: { backgroundColor: BrandColors.good },
  fbEmoji: { fontSize: 14 },
  fbLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
});
