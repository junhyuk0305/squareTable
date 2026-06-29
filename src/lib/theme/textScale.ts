// 전역 글자 크기 — 설정의 '작게/보통/크게'를 앱 전체 텍스트에 실제로 반영한다.
//
// RN(Web 포함)에는 "앱 전역 폰트 배율" 개념이 없어, Text/TextInput의 render를
// 한 번 감싸(monkey-patch) 모든 텍스트의 fontSize·lineHeight에 배율을 곱한다.
// 배율은 모듈 변수로 두고, 값이 바뀌면 _layout이 트리를 다시 렌더해 즉시 반영된다.
//
// 주의: @expo/vector-icons 아이콘도 내부적으로 Text라 함께 살짝 커지는데(0.92~1.12),
// 이는 의도된 동작(아이콘·글자가 같은 비율로 움직여 레이아웃이 깨지지 않음).
import { Text, TextInput, StyleSheet } from 'react-native';

let factor = 1;

/** 현재 배율을 설정한다. _layout이 textScale 변화에 맞춰 호출. */
export function setTextScaleFactor(f: number) {
  factor = f;
}

let patched = false;

/**
 * 앱 부팅 시 1회 호출. Text/TextInput의 fontSize·lineHeight에 전역 배율을 곱한다.
 *
 * 핵심: render 결과(이미 DOM/네이티브로 변환된 엘리먼트)를 건드리면 안 된다.
 * RN-Web은 render 진입 시 style 배열을 평탄화하므로, render의 입력 props.style에
 * 덮어쓰는 스타일을 끼워 넣어야 배율이 실제로 반영된다.
 */
export function patchTextScaling() {
  if (patched) return;
  patched = true;

  for (const Comp of [Text, TextInput] as any[]) {
    const original = Comp?.render;
    if (typeof original !== 'function') continue;

    Comp.render = function patchedRender(props: any, ref: any) {
      if (factor === 1 || !props) return original.call(this, props, ref);

      const flat = (StyleSheet.flatten(props.style) || {}) as any;
      const base = typeof flat.fontSize === 'number' ? flat.fontSize : 14;
      const scaled: any = { fontSize: Math.round(base * factor * 100) / 100 };
      if (typeof flat.lineHeight === 'number') {
        scaled.lineHeight = Math.round(flat.lineHeight * factor * 100) / 100;
      }

      return original.call(this, { ...props, style: [props.style, scaled] }, ref);
    };
  }
}
