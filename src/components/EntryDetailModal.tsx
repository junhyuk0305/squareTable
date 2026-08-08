import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { StoredImage } from '@/components/StoredImage';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { VerifyBadge } from '@/components/VerifyBadge';
import { KnowhowRows, type KnowhowRow } from '@/components/blocks/KnowhowRows';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { knowhowSourceLabel } from '@/lib/utils/knowhowSource';
import type { PlaybookEntry } from '@/types';

/**
 * EntryDetailModal — '물어보기' 답변의 [출처]를 누르면 원본 노하우 전체를 읽기 전용으로 본다.
 * 답변 카드는 요약(상황/할 일/금지 3핵심)만 보여주므로, 여기선 단계·기준·사진·검증까지 전부 노출.
 * 프레임 v2 준수 — 카테고리·SQUARE 라벨은 노출하지 않는다.
 *
 * ★ 본문 형태는 `KnowhowRows`(D10) 하나다(2026-08-08 통일) — 노하우 추가·상세·답변 카드와 같은 모습이어야
 *   사장이 "같은 것"이라고 읽는다. 옛 좌측 컬러바 블록·숫자 배지는 여기서 폐기됐다.
 */

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
  const ratePct = typeof entry.stats?.resolution_rate === 'number' ? Math.round(entry.stats.resolution_rate * 100) : null;
  const std = sq.standard;
  const stdMax = std?.max && std.max > 0 ? std.max : 100;
  const stdPct = std ? Math.max(0, Math.min(100, Math.round((std.value / stdMax) * 100))) : null;

  // 빈 칸은 행을 만들지 않는다 — 읽기 전용이라 '눌러서 적어요' 자리가 없다.
  const rows: KnowhowRow[] = [];
  if (sq.situation?.trim()) rows.push({ kind: 'situation', text: sq.situation });
  if (sq.action.steps.length > 0) rows.push({ kind: 'todo', items: sq.action.steps });
  if (sq.extract.dont?.trim()) rows.push({ kind: 'dont', text: sq.extract.dont });

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
              {/* 검증 배지 — 목록·답변카드와 같은 모양(파란 원 + 흰 체크). 판정·색은 verifyMeta SSOT. */}
              {entry.verification ? <VerifyBadge state={entry.verification.state} size="detail" /> : null}
              {ratePct !== null && (
                <View style={[s.badge, { backgroundColor: InkColors.bgSoft }]}>
                  <Text style={[s.badgeText, { color: InkColors.ink2 }]}>해결률 {ratePct}%</Text>
                </View>
              )}
            </View>

            {/* 본문 — 상황 · 할 일 · 금지 */}
            <KnowhowRows rows={rows} />

            {/* 정도 기준 게이지 — 표로 못 담는 도형이라 행 밖에 따로 그린다. */}
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
                  <StoredImage key={i} stored={p} style={s.photo} viewOnPress />
                ))}
              </ScrollView>
            ) : null}

            {/* 출처 — 본문과 같은 행 형태. 게이지·사진 뒤라 위 구분선을 래퍼가 낸다. */}
            <View style={s.sourceGroup}>
              <KnowhowRows
                rows={[{
                  kind: 'source',
                  text: `${knowhowSourceLabel(entry)} 가이드`,
                  sub: `v${entry.version} · ${String(entry.updated_at).slice(0, 10)} 갱신`,
                }]}
              />
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

  gaugeBox: { gap: 6, paddingVertical: 2 },
  gaugeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  gaugeLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  gaugeVal: { fontSize: 13, fontWeight: '900', color: InkColors.ink },
  gaugeTrack: { height: 10, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  gaugeFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },

  photoRow: { gap: 8, paddingVertical: 2 },
  photo: { width: 120, height: 120, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bgSoft },

  // 본문 행들과 같은 구분선을 잇는다(KnowhowRows 는 첫 행에 선을 안 그린다).
  sourceGroup: { borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: -Space.md },
});
