// lib/voice/text.ts
// 받아쓰기 결과를 입력창에 반영하는 규칙 — 두 화면(코치·업무채팅)이 같은 규칙을 쓰도록 한 곳에.

/**
 * 기존 입력값 뒤에 받아쓴 문장을 이어붙인다.
 * · 덮어쓰지 않는다 — 타이핑하던 내용을 음성 한 번에 날리면 복구가 안 된다.
 * · 앞뒤 공백을 정리하고 필요할 때만 공백 하나를 끼운다.
 * · maxLen(입력창 상한)에서 자른다 — 넘치면 TextInput이 조용히 버려 "말했는데 일부만 들어감"이 된다.
 */
export function appendDictation(prev: string, text: string, maxLen: number): string {
  const add = text.trim();
  if (!add) return prev;
  const base = prev.replace(/\s+$/, '');
  const joined = base ? `${base} ${add}` : add;
  return joined.slice(0, maxLen);
}

/**
 * 매장 고유명사 힌트 목록 — 중복·빈값 제거 후 상한까지. 엣지도 자체 상한(30)을 걸지만,
 * 페이로드를 키우지 않도록 클라에서 먼저 줄인다.
 */
export function buildHints(words: (string | undefined | null)[], limit = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = String(w ?? '').trim();
    if (!t || t.length > 40 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
