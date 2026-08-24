import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import type { LayoutRectangle } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t4 줄 잇기 — 왼쪽 하나를 누르고 오른쪽 하나를 누르면 **두 항목 사이에 실제로 선이 그어진다**
 * (08-24 UI 카탈로그 ⑩). 드래그는 쓰지 않는다(07-29 §04 규칙 3 — 한 손 · 이동 동작 금지).
 *
 * ★ 목업(기획/ux/퀴즈_문항유형_고도화_2026-08-24.html)과 다른 점 둘, 둘 다 의도한 것이다.
 *   ① 목업은 **맞을 때만** 선을 긋고 틀리면 흔든다. 응시 화면은 정답을 모른다(서버가 채점한다) →
 *      이은 순간에는 잉크색 선을 긋고, 서버 판정이 온 뒤에 초록·빨강으로 바꾼다.
 *      "선을 긋는다"는 동작 자체는 그대로다 — 색만 강조하는 것으로 대신하지 않는다.
 *   ② 되돌릴 수 있어야 한다. 이어 둔 항목을 다시 누르면 그 줄이 사라진다(목업은 확정이면 끝).
 *
 * ★ 선은 react-native-svg 가 아니라 **회전시킨 View** 다. 이 프로젝트에 svg 의존성이 없고,
 *   네이티브 모듈을 새로 넣으면 EAS 재빌드가 강제된다(배포 정본 08-24). 보이는 결과는 같다 —
 *   길이 0에서 전체 길이까지 자라는 애니메이션.
 */

/** 선 굵기(dp). 좌우 칸 사이 여백(Space.xl)에 놓이므로 항목을 가리지 않는다. */
const STROKE = 3;
const DRAW_MS = 350;

type Side = 'L' | 'R';

export function LinkMatch({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  // 응시 payload 는 lefts/rights(오른쪽은 서버가 섞은 것), 사장 미리보기는 저장 payload(pairs)다.
  // ★ 미리보기의 오른쪽은 섞이지 않은 원본이다 — 정답 좌표계를 서버와 맞추기 위해서고(preview.ts),
  //   사장은 자기가 만든 짝을 이미 안다.
  const lefts: string[] = useMemo(() => (
    Array.isArray(payload.lefts)
      ? payload.lefts.map((v: any) => String(v ?? ''))
      : (Array.isArray(payload.pairs) ? payload.pairs.map((p: any) => String(p?.left ?? '')) : [])
  ), [payload.lefts, payload.pairs]);

  const rights: string[] = useMemo(() => (
    Array.isArray(payload.rights)
      ? payload.rights.map((v: any) => String(v ?? ''))
      : (Array.isArray(payload.pairs) ? payload.pairs.map((p: any) => String(p?.right ?? '')) : [])
  ), [payload.rights, payload.pairs]);

  /** 고른 한쪽. 다음에 반대쪽을 누르면 한 쌍이 된다. */
  const [sel, setSel] = useState<{ side: Side; i: number } | null>(null);
  /** 왼쪽 index → 오른쪽 index. 그대로 응답이 된다. */
  const [links, setLinks] = useState<Record<string, number>>({});

  // 선을 그으려면 좌표가 필요하다 — 칸 자체와 그 안의 항목 위치를 둘 다 잰다.
  const [colL, setColL] = useState<LayoutRectangle | null>(null);
  const [colR, setColR] = useState<LayoutRectangle | null>(null);
  const [posL, setPosL] = useState<Record<number, LayoutRectangle>>({});
  const [posR, setPosR] = useState<Record<number, LayoutRectangle>>({});

  const rightToLeft = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [l, r] of Object.entries(links)) out[r] = Number(l);
    return out;
  }, [links]);

  // 서버는 맞았을 때 answer 를 주지 않는다 → 그때는 내가 그은 줄이 곧 정답이다.
  const answer: Record<string, number> | null =
    result && !result.correct && result.answer && typeof result.answer === 'object' && !Array.isArray(result.answer)
      ? (result.answer as Record<string, number>)
      : null;

  const colorOf = (l: number, r: number) => {
    if (!result) return InkColors.ink;
    if (result.correct) return BrandColors.good;
    return answer && Number(answer[String(l)]) === r ? BrandColors.good : BrandColors.bad;
  };

  const unlink = (leftIndex: number) => {
    const next = { ...links };
    delete next[String(leftIndex)];
    setLinks(next);
    setSel(null);
  };

  const tap = (side: Side, i: number) => {
    if (disabled) return;

    // 이미 이어 둔 항목을 누르면 그 줄을 지운다 — 정답을 모르니 고칠 길이 반드시 있어야 한다.
    if (side === 'L' && links[String(i)] !== undefined) { unlink(i); return; }
    if (side === 'R' && rightToLeft[i] !== undefined) { unlink(rightToLeft[i]); return; }

    if (!sel) { setSel({ side, i }); return; }
    if (sel.side === side) { setSel(sel.i === i ? null : { side, i }); return; }

    const l = side === 'L' ? i : sel.i;
    const r = side === 'L' ? sel.i : i;
    const next = { ...links, [String(l)]: r };
    setSel(null);
    setLinks(next);
    if (Object.keys(next).length === lefts.length) onAnswer(next);
  };

  /** 왼쪽 항목의 오른쪽 끝 · 오른쪽 항목의 왼쪽 끝을 잇는다(칸 기준 좌표로 환산). */
  const lineOf = (l: number, r: number) => {
    const a = posL[l];
    const b = posR[r];
    if (!a || !b || !colL || !colR) return null;
    return {
      x1: colL.x + a.x + a.width,
      y1: colL.y + a.y + a.height / 2,
      x2: colR.x + b.x,
      y2: colR.y + b.y + b.height / 2,
    };
  };

  const done = Object.keys(links).length;

  return (
    <View style={qs.wrap}>
      <View style={qs.progressRow}>
        <Text style={qs.progressText}>짝을 이어 주세요</Text>
        <Text style={qs.progressText}>{done} / {lefts.length}</Text>
      </View>

      <View style={st.board}>
        {/* 선 층은 항목 아래에 둔다. 선은 두 칸 사이 여백에 놓여 글자를 가리지 않는다. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Object.entries(links).map(([lk, r]) => {
            const l = Number(lk);
            const pts = lineOf(l, r);
            return pts ? <LinkLine key={`${l}-${r}`} {...pts} color={colorOf(l, r)} /> : null;
          })}
        </View>

        <View style={st.col} onLayout={(e) => setColL(e.nativeEvent.layout)}>
          {lefts.map((textValue, i) => (
            <LinkItem
              key={i}
              label={textValue}
              linked={links[String(i)] !== undefined}
              selected={sel?.side === 'L' && sel.i === i}
              disabled={disabled}
              onPress={() => tap('L', i)}
              onLayout={(rect) => setPosL((prev) => ({ ...prev, [i]: rect }))}
            />
          ))}
        </View>

        <View style={st.col} onLayout={(e) => setColR(e.nativeEvent.layout)}>
          {rights.map((textValue, i) => (
            <LinkItem
              key={i}
              label={textValue}
              linked={rightToLeft[i] !== undefined}
              selected={sel?.side === 'R' && sel.i === i}
              disabled={disabled}
              onPress={() => tap('R', i)}
              onLayout={(rect) => setPosR((prev) => ({ ...prev, [i]: rect }))}
            />
          ))}
        </View>
      </View>

      {answer ? (
        <Text style={st.answerLine}>
          맞는 짝: {lefts.map((t, i) => `${t} – ${rights[Number(answer[String(i)])] ?? ''}`).join(' · ')}
        </Text>
      ) : null}

      {!result && done < lefts.length ? (
        <Text style={qs.hint}>왼쪽을 누르고 오른쪽을 누르면 선이 그어져요</Text>
      ) : null}
    </View>
  );
}

/**
 * 선 하나. 왼쪽 끝을 (x1,y1)에 고정한 채 회전시키고, 안쪽 막대가 0 → 전체 길이로 자란다.
 * ★ 회전은 View 의 **중심** 기준이라 그냥 rotate 하면 시작점이 움직인다.
 *   translateX(-len/2) → rotate → translateX(len/2) 로 회전축을 왼쪽 끝으로 옮긴다.
 */
function LinkLine({ x1, y1, x2, y2, color }: { x1: number; y1: number; x2: number; y2: number; color: string }) {
  // Animated.Value 는 ref 가 아니라 useMemo 안정 객체로 — 렌더 중 ref.current 접근(react-hooks/refs) 회피.
  const grow = useMemo(() => new Animated.Value(0), []);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

  useEffect(() => {
    // 폭을 바꾸는 애니메이션이라 네이티브 드라이버를 쓸 수 없다(선 몇 개뿐이라 비용은 무시할 만하다).
    Animated.timing(grow, { toValue: 1, duration: DRAW_MS, useNativeDriver: false }).start();
  }, [grow]);

  return (
    <View
      pointerEvents="none"
      style={[
        st.lineWrap,
        {
          left: x1,
          top: y1 - STROKE / 2,
          width: len,
          transform: [{ translateX: -len / 2 }, { rotate: `${deg}deg` }, { translateX: len / 2 }],
        },
      ]}
    >
      <Animated.View
        style={[
          st.lineFill,
          { backgroundColor: color, width: grow.interpolate({ inputRange: [0, 1], outputRange: [0, len] }) },
        ]}
      />
    </View>
  );
}

function LinkItem({
  label, linked, selected, disabled, onPress, onLayout,
}: {
  label: string;
  linked: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  onLayout: (rect: LayoutRectangle) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onLayout={(e) => onLayout(e.nativeEvent.layout)}
      style={({ pressed }) => [st.item, selected && st.itemOn, linked && st.itemLinked, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={linked ? `${label} · 이어져 있어요` : label}
      accessibilityState={{ selected: selected || linked, disabled }}
    >
      <Text style={st.itemText}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  board: { flexDirection: 'row', gap: Space.xl },
  col: { flex: 1, gap: Space.sm },
  item: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  itemOn: { borderColor: InkColors.ink, backgroundColor: InkColors.bgSoft },
  itemLinked: { borderColor: InkColors.ink },
  itemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22, textAlign: 'center' },
  lineWrap: { position: 'absolute', height: STROKE },
  lineFill: { height: STROKE, borderRadius: Radius.pill },
  answerLine: { fontSize: 15, fontWeight: '700', color: BrandColors.badText, lineHeight: 22 },
});
