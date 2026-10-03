// metro.config.js
// @supabase/supabase-js(v2.108+)는 진입점을 package "exports" 필드로만 노출한다.
// Metro 기본값은 exports를 무시하고 main/module로 폴백 → dist/index.mjs 해석 실패.
// 아래로 exports 해석을 켜면 react-native 조건의 dist/index.cjs로 정확히 잡힌다.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs', 'mjs'];

// 앱 '글자 크기'(작게/보통/크게)를 네이티브에서도 적용한다(src/lib/theme/textScale.ts 참고).
// RN 0.85 Text/TextInput 은 render 가 없는 함수 컴포넌트라 런타임 패치가 안 걸린다.
// 그래서 해석 결과가 RN 의 Text.js·TextInput.js 이면 감싸개로 돌린다. 요청 문자열이 아니라
// 해석된 파일 경로로 보므로 'react-native' 의 Text, RN 내부의 '../Text/Text' 상대 경로가 모두 덮인다.
// 감싸개 자신이 원본을 부를 때는 그대로 둔다(순환 방지). 웹은 react-native-web 이라 제외.
const path = require('path');
const TEXT_WRAPPERS = [
  ['/react-native/Libraries/Text/Text.js', path.resolve(__dirname, 'src/lib/theme/nativeText.ts')],
  ['/react-native/Libraries/Components/TextInput/TextInput.js', path.resolve(__dirname, 'src/lib/theme/nativeTextInput.ts')],
];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const res = context.resolveRequest(context, moduleName, platform);
  if (platform === 'web' || res.type !== 'sourceFile') return res;
  const file = res.filePath.replace(/\\/g, '/');
  for (const [target, wrapper] of TEXT_WRAPPERS) {
    if (file.endsWith(target) && path.resolve(context.originModulePath) !== wrapper) return { type: 'sourceFile', filePath: wrapper };
  }
  return res;
};

module.exports = config;
