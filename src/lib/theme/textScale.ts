// 전역 글자 크기 — 설정의 '작게/보통/크게'를 앱 전체 텍스트에 실제로 반영한다.
//
// RN에는 "앱 전역 폰트 배율" 개념이 없어, 모든 텍스트의 fontSize·lineHeight에 배율을 직접 곱한다.
//  · 웹: RN-Web Text/TextInput은 forwardRef라 render를 한 번 감싼다(monkey-patch, patchTextScaling).
//  · 네이티브: RN 0.85 Text/TextInput은 render가 없는 함수 컴포넌트라 위 패치가 건너뛴다.
//    metro.config.js가 두 모듈 요청을 nativeText.ts·nativeTextInput.ts로 돌리고,
//    그 감싸개가 nativeScaledStyle로 곱한다(RN 내부 컴포넌트가 쓰는 Text까지 덮는다).
// 배율은 모듈 변수로 두고, 값이 바뀌면 _layout이 트리를 다시 렌더해 즉시 반영된다.
//
// 주의: @expo/vector-icons 아이콘도 내부적으로 Text라 함께 살짝 커지는데(0.9~1.18),
// 이는 의도된 동작(아이콘·글자가 같은 비율로 움직여 레이아웃이 깨지지 않음). 네이티브도 같다.
import { Text, TextInput, StyleSheet, Platform } from 'react-native';

let factor = 1;

/** 현재 배율을 설정한다. _layout이 textScale 변화에 맞춰 호출. */
export function setTextScaleFactor(f: number) {
  factor = f;
}

/** 현재 배율. 네이티브 감싸개가 렌더마다 읽고, 1이면 아무것도 하지 않는다. */
export function getTextScaleFactor() {
  return factor;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 네이티브 감싸개용. style에 덧씌울 {fontSize, lineHeight}를 돌려주고, 손댈 게 없으면 null.
 * 웹 패치와 같은 규칙: 지정한 fontSize·lineHeight에 배율을 곱하고, fontSize가 없으면 기본 14로 본다.
 * 웹과 다른 점 2가지:
 *  · 중첩 Text가 fontSize를 안 주면(inheritsFontSize) 부모가 이미 곱한 크기를 물려받게 둔다(두 번 곱하지 않음).
 *  · 줄높이를 안 준 텍스트에 1.4 줄높이를 넣지 않는다. 네이티브 기본 줄높이는 글자 크기를 따라 커진다.
 */
export function nativeScaledStyle(style: unknown, inheritsFontSize: boolean, maxMultiplier?: number) {
  const f = nativeAppFactor(maxMultiplier);
  if (f === 1) return null;
  const flat = (StyleSheet.flatten(style as any) || {}) as any;
  const out: { fontSize?: number; lineHeight?: number } = {};
  if (typeof flat.fontSize === 'number') out.fontSize = round2(flat.fontSize * f);
  else if (!inheritsFontSize) out.fontSize = round2(14 * f);
  if (typeof flat.lineHeight === 'number') out.lineHeight = round2(flat.lineHeight * f);
  return out.fontSize === undefined && out.lineHeight === undefined ? null : out;
}

/**
 * 네이티브 감싸개용. `maxFontSizeMultiplier` 를 **전체 확대 상한**으로 읽는다(10-04 리뷰).
 * RN 의 그 prop 은 OS 글꼴 배율만 자른다. 앱 배율(크게 1.18)이 그 위에 또 곱해지면 고정 폭 칸(시급·근무 시각·
 * 숫자 배지)이 상한을 둬도 잘린다. 그래서 앱 배율을 먼저 상한 안으로 자르고(nativeAppFactor),
 * 남은 몫만 OS 배율에 준다(nativeOsCap). 상한이 없으면(undefined·0) 둘 다 지금과 같다.
 */
export function nativeAppFactor(maxMultiplier?: number) {
  return typeof maxMultiplier === 'number' && maxMultiplier >= 1 ? Math.min(factor, maxMultiplier) : factor;
}
export function nativeOsCap(maxMultiplier?: number) {
  if (typeof maxMultiplier !== 'number' || maxMultiplier < 1) return maxMultiplier;
  return round2(maxMultiplier / nativeAppFactor(maxMultiplier));
}

let patched = false;

/**
 * 앱 부팅 시 1회 호출. Text/TextInput의 fontSize·lineHeight에 전역 배율을 곱하고,
 * 줄높이를 안 준 본문 텍스트엔 fontSize 비례 줄높이를 보장해 한글 윗부분 잘림을 막는다
 * (잘림 보정은 배율 1에서도 동작 — 기본 크기에서도 잘리던 라벨을 함께 고친다).
 *
 * 핵심: render 결과(이미 DOM/네이티브로 변환된 엘리먼트)를 건드리면 안 된다.
 * RN-Web은 render 진입 시 style 배열을 평탄화하므로, render의 입력 props.style에
 * 덮어쓰는 스타일을 끼워 넣어야 배율이 실제로 반영된다.
 */
export function patchTextScaling() {
  // 네이티브는 metro 감싸개가 맡는다. RN이 나중에 render를 되살려도 두 번 곱하지 않게 웹에서만 건다.
  if (Platform.OS !== 'web') return;
  if (patched) return;
  patched = true;

  for (const Comp of [Text, TextInput] as any[]) {
    const original = Comp?.render;
    if (typeof original !== 'function') continue;
    const isText = Comp === Text;

    Comp.render = function patchedRender(props: any, ref: any) {
      if (!props) return original.call(this, props, ref);

      const flat = (StyleSheet.flatten(props.style) || {}) as any;
      const base = typeof flat.fontSize === 'number' ? flat.fontSize : 14;
      const hasLineHeight = typeof flat.lineHeight === 'number';

      // 줄높이를 안 준 '본문' 텍스트는 줄높이가 글자에 비해 빡빡해 한글(높은 받침/모음)
      // 윗부분이 잘린다(굵을수록 심함). 기본 배율에서도 fontSize 비례(1.4)로 줄높이를
      // 보장해 잘림을 원천 차단한다.
      //  · 아이콘 폰트(@expo/vector-icons)는 fontFamily가 인라인으로 박혀 있어 제외 — 세로 정렬 보존.
      //  · TextInput은 줄높이를 강제하면 입력 커서·세로 정렬이 틀어져 제외.
      const needsDefaultLineHeight = isText && !hasLineHeight && flat.fontFamily == null;

      // 손댈 게 없으면(배율 1 + 줄높이 보정 불필요) 원본 그대로.
      if (factor === 1 && !needsDefaultLineHeight) return original.call(this, props, ref);

      const scaled: any = {};
      if (factor !== 1) scaled.fontSize = Math.round(base * factor * 100) / 100;
      if (hasLineHeight) {
        if (factor !== 1) scaled.lineHeight = Math.round(flat.lineHeight * factor * 100) / 100;
      } else if (needsDefaultLineHeight) {
        scaled.lineHeight = Math.round(base * factor * 1.4 * 100) / 100;
      }

      return original.call(this, { ...props, style: [props.style, scaled] }, ref);
    };
  }
}
