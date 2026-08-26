import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 블록 X2 — 인라인 경고행. 터치 타깃(48dp 하한)보다 한 단계 큰 행 높이. */
const ROW_MIN_HEIGHT = 52;
const ICON_SIZE = 22;
/** 미리보기 줄 수 상한 — 갈래별 1건씩(낡음 1 · 오답 1). 셋부터는 목록이지 경고행이 아니다. */
const PREVIEW_MAX = 2;

/**
 * X2 · 인라인 경고행 — "확인이 필요한 노하우 3건 ›"
 *
 * 색은 레드로 확정(2026-08-05). 흰 배경 + 점 방식은 묻혀서 기각했고,
 * 좌측 세로 바는 둥근 모서리에서 잘려 폐기했다. 배경을 badSoft로 채운다.
 *
 * **2단계 규칙(블록어휘 §7-3 · 2026-08-27):** 기본은 한줄형. `preview` 를 주면 미리보기형(X2′) —
 * 라벨 아래 대표 항목 최대 2줄 + "n건 더". 미리보기형은 **둘 다 만족할 때만** 쓴다:
 * ① 묶음 안에 종류가 2개 이상 섞여 있다 ② 항목마다 다음 행동이 다르다. 화면당 1개까지.
 * 목적지가 그 목록 하나뿐이면(안 쓰인 노하우 24개) 한줄형이다 — 여기서 아는 것과 눌러서 보는 것이 같다.
 *
 * ★ count가 0이면 아무것도 렌더하지 않는다 — 상시 노출 금지.
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function AlertRow({
  label,
  count,
  unit = '개',
  onPress,
  icon = 'alert-circle',
  preview,
}: {
  label: string;
  count: number;
  /** 개수 단위 — 물건·항목은 '개', 요청·질문·신청은 '건', 사람은 '명'(워딩 §5). */
  unit?: '개' | '건' | '명';
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** 미리보기 줄("아메리카노 레시피 — 옛 정답이 나가는 중"). 앞 2줄만 쓰고 나머지는 "n건 더"로 접는다. */
  preview?: string[];
}) {
  if (count <= 0) return null;
  const lines = (preview ?? []).slice(0, PREVIEW_MAX);
  const rest = count - lines.length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${count}${unit}${lines.length ? `. ${lines.join('. ')}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.box, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <View style={styles.dot}>
          <Ionicons name={icon} size={14} color={InkColors.bubbleText} />
        </View>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{count}{unit}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={BrandColors.badText} />
      </View>
      {lines.length > 0 ? (
        <View style={styles.preview}>
          {lines.map((t, i) => (
            <Text key={i} style={styles.previewText} numberOfLines={1}>· {t}</Text>
          ))}
          {rest > 0 ? <Text style={styles.previewText}>· {rest}{unit} 더</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.badSoft,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  pressed: { opacity: 0.75 },
  dot: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: BrandColors.bad,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: BrandColors.badText,
  },
  pill: {
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bubbleText,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '800',
    color: BrandColors.badText,
  },
  // 미리보기는 아이콘 열을 비워 라벨과 같은 x 에서 시작한다.
  preview: { marginTop: Space.sm, marginLeft: ICON_SIZE + Space.md, gap: Space.xs },
  // 대표 항목은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  previewText: { fontSize: 12.5, lineHeight: 17, color: BrandColors.badText, opacity: 0.82 },
});
