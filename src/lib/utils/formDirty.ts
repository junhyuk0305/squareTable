/**
 * 저장하지 않은 값 판정(화면조립표 2026-11-17 K-3 결함 · 매장 기본 정보 · 내 정보 고치기).
 * 화면에 흩지 않고 여기 한 곳에 둔다. 순수 함수다. 검사 = scripts/qa-form-dirty.mjs.
 */

export type FieldValue = string | number | boolean | null | undefined | readonly (string | number)[];

/**
 * 두 칸 값이 같은가.
 * - 글자는 앞뒤 빈칸을 빼고 본다(저장할 때 trim 한다).
 * - null·undefined·빈 글자는 같다.
 * - 목록은 순서와 상관없이 같은 것이 들었는지 본다(정기 휴무 요일).
 */
export function sameField(a: FieldValue, b: FieldValue): boolean {
  const norm = (v: FieldValue) => (typeof v === 'string' ? v.trim() : v ?? '');
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const x = [...a].map(String).sort();
    const y = [...b].map(String).sort();
    return x.every((v, i) => v === y[i]);
  }
  return norm(a) === norm(b);
}

/** 저장된 값과 고치는 값에서 다른 칸 이름. */
export function changedFields<T extends Record<string, FieldValue>>(saved: T, draft: T): (keyof T & string)[] {
  return (Object.keys(draft) as (keyof T & string)[]).filter((k) => !sameField(saved[k], draft[k]));
}

/** 화면을 나가기 전에 물을까. 바뀐 칸이 있고 저장 중이 아닐 때만 묻는다. 저장 중이면 저장이 끝나고 화면이 스스로 나간다. */
export function askBeforeLeave(changed: readonly string[], saving: boolean): boolean {
  return changed.length > 0 && !saving;
}
