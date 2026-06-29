// metro.config.js
// @supabase/supabase-js(v2.108+)는 진입점을 package "exports" 필드로만 노출한다.
// Metro 기본값은 exports를 무시하고 main/module로 폴백 → dist/index.mjs 해석 실패.
// 아래로 exports 해석을 켜면 react-native 조건의 dist/index.cjs로 정확히 잡힌다.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs', 'mjs'];

module.exports = config;
