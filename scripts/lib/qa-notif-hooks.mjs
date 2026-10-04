// qa-notif-hooks.mjs — 알림 SSOT(src/lib/utils/notifications.ts)를 노드에서 그대로 import 하기 위한 동기 훅.
//
// notifications.ts 는 순수 함수인데 값 import 두 개가 스토어에서 온다(occursOn · answerableQuestions).
// 스토어 파일은 zustand·supabase·react-native 를 끌고 와서 노드가 못 읽는다. 그래서:
//   ① 두 스토어 파일은 **그 함수 본문만 잘라** 타입을 벗겨 돌려준다(로직 복제 없음 · 원문 그대로).
//   ② react-native 는 Platform 만 있는 빈 모듈로 바꾼다(store-policy 가 Platform.OS 만 읽는다).
//   ③ '@/...' 별칭과 확장자 없는 상대 경로를 메운다(qa-alias-loader.mjs 와 같은 규칙).
// 스크립트 전용이다. 앱 번들·타입 체크와 무관하다.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];
const withExt = (base) => EXTS.map((e) => base + e).find(existsSync);

/** 파일 끝 경로 → 잘라 낼 최상위 export function 이름들. */
const CUT = {
  'lib/store/useWorkStore.ts': ['occursOn'],
  'lib/store/useUnknownQueueStore.ts': ['answerableQuestions'],
};

function cutFunctions(file, names) {
  const text = readFileSync(file, 'utf8');
  return names
    .map((n) => {
      const start = text.indexOf(`export function ${n}(`);
      const m = start < 0 ? null : /\r?\n\}\r?\n/.exec(text.slice(start));
      if (!m) throw new Error(`${n} 를 ${file} 에서 찾지 못했다`);
      return text.slice(start, start + m.index + m[0].length);
    })
    .join('\n');
}

export function installNotifHooks(os = 'ios') {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'react-native') {
        return { url: `data:text/javascript,export const Platform={OS:${JSON.stringify(os)}};`, shortCircuit: true };
      }
      if (specifier.startsWith('@/')) {
        const base = join(SRC, specifier.slice(2));
        return next(pathToFileURL(withExt(base) ?? base).href, context);
      }
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const hit = withExt(join(dirname(fileURLToPath(context.parentURL)), specifier));
        if (hit) return next(pathToFileURL(hit).href, context);
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith('file:')) {
        const file = fileURLToPath(url).split('\\').join('/');
        const key = Object.keys(CUT).find((k) => file.endsWith(`/src/${k}`));
        if (key) {
          return { format: 'module', source: stripTypeScriptTypes(cutFunctions(file, CUT[key])), shortCircuit: true };
        }
      }
      return next(url, context);
    },
  });
}
