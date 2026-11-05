// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions 는 Deno 코드다(URL·npm: import). Node 용 eslint 가 모듈을 못 풀어 커밋 훅이 막힌다(2026-11-04).
    ignores: ["dist/*", "supabase/functions/**"],
  }
]);
