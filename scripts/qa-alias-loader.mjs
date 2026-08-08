// Node 로더 — QA 하니스가 앱 코드(.ts)를 **그대로** import 하기 위한 최소 해석기.
// 앱은 번들러 관례로 ① `@/...` 별칭 ② 확장자 없는 상대경로 ③ 속성 없는 .json import 를 쓰는데
// 노드는 셋 다 모른다. 여기서만 메꾼다 — 앱 번들·타입 체크와 무관한 **스크립트 전용**이다.
// 사용: register(pathToFileURL('scripts/qa-alias-loader.mjs')) 후 대상 .ts 를 동적 import.
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];
const withExt = (base) => EXTS.map((e) => base + e).find(existsSync);

/** 해석된 URL 이 .json 이면 노드가 요구하는 import attribute 를 대신 붙여준다. */
const tagJson = (r) =>
  r?.url?.endsWith('.json') ? { ...r, importAttributes: { ...(r.importAttributes ?? {}), type: 'json' } } : r;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = join(SRC, specifier.slice(2));
    return tagJson(await next(pathToFileURL(withExt(base) ?? base).href, context));
  }
  try {
    return tagJson(await next(specifier, context));
  } catch (e) {
    if (specifier.startsWith('.') && context.parentURL) {
      const hit = withExt(join(dirname(fileURLToPath(context.parentURL)), specifier));
      if (hit) return tagJson(await next(pathToFileURL(hit).href, context));
    }
    throw e;
  }
}
