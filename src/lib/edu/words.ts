/**
 * 교육 링크 화면 단어 — 자리 종류(공간 'space' / 매장 'store')별로 꺼낸다.
 *
 * ⚠️ 임시 자리다. 정본 위치는 `src/lib/place/words.ts`(화면지도_단어사전_2026-11-10 3절)이고,
 *   그 파일이 생기면 여기 키를 그쪽으로 합치고 이 파일은 지운다. 같은 문구를 두 곳에 두지 않는다.
 * ⚠️ 이 파일은 경로 별칭(@/) import 를 넣지 않는다. errors.ts 가 상대 경로로 읽는다.
 * "손님"은 화면에 쓰지 않는다. 문구 출처 = 단어 사전 3-2·3-5.
 */
export type EduPlace = 'space' | 'store';

/** 자리 종류와 상관없이 같은 말. */
export const EDU_WORDS = {
  link: '교육 링크',
  firstRead: '먼저 읽어 보세요',
  askPlaceholder: '궁금한 걸 물어보세요',
  askSoon: '묻기는 곧 열려요. 지금은 아래 노하우를 읽어 주세요.',
  linkClose: '링크 닫기',
  linkClosed: '이 링크는 닫혔어요. 보낸 분께 새 링크를 받아 주세요.',
} as const;

/**
 * 빈 링크 문구. 공간은 주인 이름 + 님({owner})이 들어간다.
 * 서버(edu_link_open)가 주인 이름을 안 주면 이름 없는 문장으로 떨어진다.
 */
export function emptyLinkText(place: EduPlace | null, ownerName?: string): string {
  if (place === 'store') return '사장님이 아직 담은 노하우가 없어요. 궁금한 걸 물어보세요.';
  const owner = ownerName?.trim();
  if (owner) return `${owner}님이 아직 담은 노하우가 없어요. 궁금한 걸 물어보세요.`;
  return '아직 담긴 노하우가 없어요. 궁금한 걸 물어보세요.';
}
