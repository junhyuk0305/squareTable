import { View, Text, Pressable, ScrollView, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import type { PlaybookEntry } from '@/types';

/**
 * EntryDetailModal — '물어보기' 답변의 [출처]를 누르면 원본 노하우 전체를 읽기 전용으로 본다.
 * 답변 카드는 요약(상황/할 일/금지 3핵심)만 보여주므로, 여기선 단계·멘트·기준·사진·검증까지 전부 노출.
 * 프레임 v2 준수 — 카테고리·SQUARE 라벨은 노출하지 않는다.
 */
function verifyLabel(state?: PlaybookEntry['verification']): { label: string; fg: string; bg: string } | null {
  switch (state?.state) {
    case 'owner_verified':
      return { label: '✓ 사장님 검증', fg: InkColors.ink, bg: BrandColors.yellowSoft };
    case 'field_tested':
      return { label: '✓ 현장 검증', fg: BrandColors.good, bg: '#E6F1EA' };
    default:
      return null;
  }
}

export function EntryDetailModal({
  entry,
  visible,
  onClose,
}: {
  entry: PlaybookEntry | null | undefined;
  visible: boolean;
  onClose: () => void;
}) {
  if (!entry) return null;
  const sq = entry.square;
  const v = verifyLabel(entry.verification);
  const ratePct = typeof entry.stats?.resolution_rate === 'number' ? Math.round(entry.stats.resolution_rate * 100) : null;
  const std = sq.standard;
  const stdMax = std?.max && std.max > 0 ? std.max : 100;
  const stdPct = std ? Math.max(0, Math.min(100, Math.round((std.value / stdMax) * 100))) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={{ maxHeight: '88%' }}>
          <View style={s.head}>
            <Text style={s.kicker}>노하우 원문</Text>
            <Pressable onPress={onClose} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>

          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={s.title}>{entry.title}</Text>

            {/* 메타 배지 */}
            <View style={s.badges}>
              {v && (
                <View style={[s.badge, { backgroundColor: v.bg }]}>
                  <Text style={[s.badgeText, { color: v.fg }]}>{v.label}</Text>
                </View>
              )}
              {ratePct !== null && (
                <View style={[s.badge, { backgroundColor: InkColors.bgSoft }]}>
                  <Text style={[s.badgeText, { color: InkColors.ink2 }]}>해결률 {ratePct}%</Text>
                </View>
              )}
            </View>

            {/* 상황 */}
            {sq.situation?.trim() ? (
              <View style={[s.block, { borderLeftColor: BrandColors.brand }]}>
                <Text style={s.blockLabel}>상황</Text>
                <Text style={s.body}>{sq.situation}</Text>
              </View>
            ) : null}

            {/* 할 일 — 단계 + 멘트 */}
            {(sq.action.steps.length > 0 || sq.action.scripts.length > 0) && (
              <View style={[s.block, { borderLeftColor: BrandColors.good }]}>
                <Text style={[s.blockLabel, { color: BrandColors.good }]}>할 일</Text>
                {sq.action.steps.map((st, i) => (
                  <View key={`st-${i}`} style={s.stepRow}>
                    <Text style={s.stepNum}>{i + 1}</Text>
                    <Text style={s.stepText}>{st}</Text>
                  </View>
                ))}
                {sq.action.scripts.map((sc, i) => (
                  <View key={`sc-${i}`} style={s.scriptBox}>
                    <Text style={s.scriptMark}>💬</Text>
                    <Text style={s.scriptText}>“{sc}”</Text>
                  </View>
                ))}
              </View>
            )}

            {/* 금지 */}
            {sq.extract.dont?.trim() ? (
              <View style={[s.block, { borderLeftColor: BrandColors.bad }]}>
                <Text style={[s.blockLabel, { color: BrandColors.bad }]}>금지</Text>
                <Text style={s.body}>{sq.extract.dont}</Text>
              </View>
            ) : null}

            {/* 정도 기준 게이지 */}
            {std && stdPct !== null ? (
              <View style={s.gaugeBox}>
                <View style={s.gaugeHead}>
                  <Text style={s.gaugeLabel}>{std.label} 기준</Text>
                  <Text style={s.gaugeVal}>{std.value}/{stdMax}</Text>
                </View>
                <View style={s.gaugeTrack}>
                  <View style={[s.gaugeFill, { width: `${stdPct}%` }]} />
                </View>
              </View>
            ) : null}

            {/* 사진 */}
            {entry.photos && entry.photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoRow}>
                {entry.photos.map((p, i) => (
                  <Image key={i} source={{ uri: p }} style={s.photo} />
                ))}
              </ScrollView>
            ) : null}

            {/* 출처 */}
            <View style={s.sourceBox}>
              <Text style={s.sourceLabel}>출처</Text>
              <Text style={s.sourceCreator}>{entry.creator_name} 사장님 가이드</Text>
              <Text style={s.sourceMeta}>v{entry.version} · {entry.updated_at} 갱신</Text>
            </View>

            <View style={{ height: 8 }} />
          </ScrollView>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: InkColors.ink3 },

  scroll: { paddingHorizontal: 16 },
  scrollContent: { paddingBottom: 12, gap: 12 },
  title: { fontSize: 19, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: Radius.pill },
  badgeText: { fontSize: 11, fontWeight: '800' },

  block: { borderLeftWidth: 3, paddingLeft: 12, gap: 6 },
  blockLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: BrandColors.brand, textTransform: 'uppercase' },
  body: { fontSize: 15, color: InkColors.ink, lineHeight: 22 },

  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: BrandColors.good, color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center', lineHeight: 22 },
  stepText: { flex: 1, fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  scriptBox: { flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: BrandColors.good, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 2, backgroundColor: '#FFFFFF' },
  scriptMark: { fontSize: 14 },
  scriptText: { flex: 1, fontSize: 14, color: InkColors.ink, fontStyle: 'italic', lineHeight: 20 },

  gaugeBox: { gap: 6, paddingVertical: 2 },
  gaugeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  gaugeLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  gaugeVal: { fontSize: 13, fontWeight: '900', color: InkColors.ink },
  gaugeTrack: { height: 10, borderRadius: 999, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  gaugeFill: { height: '100%', borderRadius: 999, backgroundColor: BrandColors.yellow },

  photoRow: { gap: 8, paddingVertical: 2 },
  photo: { width: 120, height: 120, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bgSoft },

  sourceBox: { backgroundColor: '#FEF9EC', borderLeftWidth: 4, borderLeftColor: BrandColors.gold, padding: 14, borderRadius: 8, gap: 2 },
  sourceLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: InkColors.ink2 },
  sourceCreator: { fontSize: 13, fontWeight: '700', color: InkColors.ink, marginTop: 4 },
  sourceMeta: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
});
