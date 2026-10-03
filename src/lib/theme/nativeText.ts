// 네이티브(iOS·안드) 전용 Text 감싸개 — 앱 '글자 크기' 배율을 곱한다.
//
// metro.config.js 가 react-native/Libraries/Text/Text.js 로 가는 모든 요청(앱 코드·RN 내부의
// '../Text/Text'·아이콘·Animated.Text)을 이 파일로 돌린다. 이 파일이 원본을 부를 때만 원본으로 간다.
// 웹은 react-native-web 이라 이 파일을 쓰지 않는다(textScale.ts 의 render 패치가 맡는다).
//
// RN 0.85 의 Text 는 ref 를 prop 으로 받는 평범한 함수 컴포넌트다. 그래서 엘리먼트로 한 겹 더
// 감싸지 않고 원본 함수를 직접 부른다. 원본의 훅이 이 컴포넌트의 훅이 되어 순서가 늘 같고,
// 배율 1(보통)에서는 props 를 그대로 넘겨 지금과 똑같은 트리·같은 비용이다.
import { use } from 'react';

import { getTextScaleFactor, nativeScaledStyle, nativeOsCap } from '@/lib/theme/textScale';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- 원본 모듈을 직접 잡는다(metro 가 감싸개로 다시 돌리지 않는 경로)
const TextImpl = require('react-native/Libraries/Text/Text').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- RN 내부 모듈이라 타입 선언이 없다
const TextAncestorContext = require('react-native/Libraries/Text/TextAncestorContext').default;

export default function Text(props: any) {
  'use no memo'; // React Compiler 제외 — 원본 함수(훅 포함)를 직접 부르므로 메모로 건너뛰면 훅 순서가 깨진다.
  if (getTextScaleFactor() === 1) return TextImpl(props);
  // 중첩 Text 가 자기 fontSize 를 안 주면 부모(이미 곱한 크기)를 물려받는다 → 다시 곱하지 않는다.
  // use(context) 는 조건부로 불러도 되는 API 라 배율 1 경로와 훅 순서가 어긋나지 않는다.
  // maxFontSizeMultiplier 가 있으면 앱 배율까지 합친 전체 상한으로 지킨다(textScale.ts nativeAppFactor).
  const max = props.maxFontSizeMultiplier;
  const extra = nativeScaledStyle(props.style, use(TextAncestorContext) as boolean, max);
  if (!extra && max === nativeOsCap(max)) return TextImpl(props);
  return TextImpl({ ...props, ...(extra ? { style: [props.style, extra] } : null), maxFontSizeMultiplier: nativeOsCap(max) });
}
