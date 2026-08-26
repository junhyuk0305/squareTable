import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 우측 담기 원 32px — 도형 치수. ★RN-web 은 hitSlop 을 무시하므로(2026-08-26 실측) 터치 영역은
 * 원이 아니라 **행 전체**가 Pressable 이고, 원은 그 안의 표시일 뿐이다. 원을 담는 상자는 48dp.
 */
const DISC = 32;
const DISC_BOX = 48;

export type PickChipTone = 'neutral' | 'warn' | 'good' | 'mention';

export type PickChip = {
  text: string;
  /** neutral=카테고리 · warn="3명이 물어봤음" 같은 우선 근거 · good/mention=상태. */
  tone?: PickChipTone;
};

export type PickRowItem = {
  key: string;
  title: string;
  /** 메타 칩 — "왜 이걸 먼저"를 담당한다(좌측 아이콘을 없앤 대신). */
  chips?: PickChip[];
  picked: boolean;
  onToggle: () => void;
};

/**
 * L6 · 고르기 행(블록어휘 §7-2) — 목록 행 + 우측 원형 담기. **좌측 아이콘 없음**(확정, 데모 §2-5).
 *
 * 아이콘 32px 를 지워 제목이 그만큼 길게 보이고, 칩이 "왜 이걸 먼저"를 말한다.
 * 쓸 곳: 퀴즈 홈 A1(재료 있음·퀴즈 0) "먼저 물어볼 만한 것" → "고른 n개로 만들기".
 * `more` 는 "n개 더 보기 ›" 바닥 행 — 형제 Pressable 이다(행 안에 넣지 않는다).
 * 표시 전용: 고른 상태·칩 문구는 호출부가 정한다.
 */
export function PickRow({
  rows,
  more,
}: {
  rows: PickRowItem[];
  more?: { label: string; onPress: () => void };
}) {
  if (rows.length === 0) return null;

  return (
    <View style={styles.card}>
      {rows.map((r, i) => (
        <Pressable
          key={r.key}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: r.picked }}
          accessibilityLabel={r.title}
          onPress={r.onToggle}
          style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
        >
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
            {r.chips && r.chips.length > 0 ? (
              <View style={styles.chips}>
                {r.chips.map((c, j) => (
                  <View key={j} style={[styles.chip, CHIP_BG[c.tone ?? 'neutral']]}>
                    <Text style={[styles.chipText, CHIP_TEXT[c.tone ?? 'neutral']]} numberOfLines={1}>{c.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.discBox}>
            <View style={[styles.disc, r.picked ? styles.discDone : styles.discAdd]}>
              <Ionicons
                name={r.picked ? 'checkmark' : 'add'}
                size={r.picked ? 16 : 20}
                color={r.picked ? BrandColors.goodText : InkColors.ink}
              />
            </View>
          </View>
        </Pressable>
      ))}
      {more ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={more.label}
          onPress={more.onPress}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>{more.label} ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const CHIP_BG = StyleSheet.create({
  neutral: { backgroundColor: InkColors.bgSoft },
  warn: { backgroundColor: BrandColors.warnSoft },
  good: { backgroundColor: BrandColors.goodSoft },
  mention: { backgroundColor: BrandColors.mentionSoft },
});
// 글자는 800 역할만(50 틴트 위 AA). 500 을 글자에 쓰지 않는다.
const CHIP_TEXT = StyleSheet.create({
  neutral: { color: InkColors.ink2 },
  warn: { color: BrandColors.warnText },
  good: { color: BrandColors.goodText },
  mention: { color: BrandColors.mentionText },
});

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    overflow: 'hidden',
    ...Elevation.e1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingLeft: Space.lg,
    paddingRight: Space.sm,
    paddingVertical: Space.sm,
    minHeight: DISC_BOX + Space.sm,
  },
  divider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  pressed: { opacity: 0.7 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, marginTop: Space.xs },
  chip: { paddingHorizontal: Space.sm - 2, paddingVertical: 1, borderRadius: Radius.pill },
  // 칩은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  chipText: { fontSize: 10.5, lineHeight: 15, fontWeight: '800' },
  discBox: { width: DISC_BOX, height: DISC_BOX, alignItems: 'center', justifyContent: 'center' },
  disc: { width: DISC, height: DISC, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  discAdd: { backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep },
  discDone: { backgroundColor: BrandColors.goodSoft },
  more: {
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    minHeight: DISC_BOX,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  moreText: { fontSize: 13, lineHeight: 18, fontWeight: '800', color: InkColors.ink2 },
});
