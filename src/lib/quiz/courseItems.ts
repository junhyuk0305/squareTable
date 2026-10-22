// 이 퀴즈에 나가는 문항인가 — 판정 한 곳(0307 · 0330 · 0332 · 계획서 P3 I1 · N06).
//
// 서버 짝 = quiz_course_servable 의 문항 조건. 서버가 정답이다. 조건을 바꾸면 둘을 같이 바꾼다.
//   ① 활성(status='active') ② 알려진 형태(FORMATS = quiz_known_formats)
//   ③ course_id 가 그 퀴즈 ④ 근거 노하우 중 하나가 그 퀴즈의 course_entries 에 있다
//   ⑤ 근거 노하우가 전부 살아 있다(보관 아님 · 본사 숨김 아님 · 이 매장 노하우 목록에 있음)
// 퀴즈 자체가 살아 있나(보관·숨김 퀴즈, quiz_course_live)는 여기서 보지 않는다. 사장 화면은 보관한 퀴즈의 문항도 보여 준다.
// ★사장 상세·목록·만들기(이어서)·본사 작업실이 전부 이 함수를 쓴다. 호출자가 active 를 따로 거르지 않는다.
//   화면마다 다시 거르면 '문항 6개 / 4개'가 갈린다.
import { FORMATS } from './formats';
import type { QuizItem } from './types';

/** 근거 노하우 판정에 쓰는 최소 모양. 노하우 스토어 행을 그대로 넘긴다(보관 행은 스토어에 안 들어온다). */
export type LiveEntry = { id: string; archived_at?: string | null; brand_hidden_at?: string | null };

function liveIds(entries: readonly LiveEntry[]): Set<string> {
  return new Set(entries.filter((e) => !e.archived_at && !e.brand_hidden_at).map((e) => e.id));
}

export function belongsToCourse(
  item: QuizItem,
  courseId: string,
  courseEntryIds: readonly string[],
  live: ReadonlySet<string>,
): boolean {
  const ids = item.entry_ids ?? [];
  return item.status === 'active'
    && !!FORMATS[item.format]
    && item.course_id === courseId
    && ids.some((id) => courseEntryIds.includes(id))
    && ids.every((id) => live.has(id));
}

/** 그 퀴즈에 나가는 문항. entries = 이 매장(작업실) 노하우 목록. */
export function itemsOfCourse(
  items: readonly QuizItem[],
  courseId: string,
  courseEntryIds: readonly string[],
  entries: readonly LiveEntry[],
): QuizItem[] {
  const live = liveIds(entries);
  return items.filter((q) => belongsToCourse(q, courseId, courseEntryIds, live));
}
