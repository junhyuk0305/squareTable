// 네이티브(iOS·안드) 전용 TextInput 감싸개 — 앱 '글자 크기' 배율을 곱한다.
// 연결 방식·원본 직접 호출 이유는 nativeText.ts 와 같다(metro.config.js 가 이 파일로 돌린다).
import { getTextScaleFactor, nativeScaledStyle, nativeOsCap } from '@/lib/theme/textScale';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- 원본 모듈을 직접 잡는다(metro 가 감싸개로 다시 돌리지 않는 경로)
const TextInputImpl = require('react-native/Libraries/Components/TextInput/TextInput').default;

export default function TextInput(props: any) {
  'use no memo'; // React Compiler 제외 — 원본 함수(훅 포함)를 직접 부른다.
  if (getTextScaleFactor() === 1) return TextInputImpl(props);
  // 입력칸은 Text 안에 중첩되지 않으므로 fontSize 를 안 주면 기본 14 를 곱한다(웹 패치와 같은 규칙).
  // maxFontSizeMultiplier 가 있으면 앱 배율까지 합친 전체 상한으로 지킨다(시급·근무 시각 칸 — textScale.ts nativeAppFactor).
  const max = props.maxFontSizeMultiplier;
  return TextInputImpl({ ...props, style: [props.style, nativeScaledStyle(props.style, false, max)], maxFontSizeMultiplier: nativeOsCap(max) });
}

// TextInput.State(포커스 유틸) 같은 정적 속성을 원본과 같게 노출한다.
TextInput.State = TextInputImpl.State;
