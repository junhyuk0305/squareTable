// 어느 퀴즈의 문항인가 — 판정 한 곳(0307).
//
// 문항은 퀴즈(course_id)에 묶인다. 옛 문항(course_id 없음)은 예전 규칙대로 담긴 노하우와 겹치면 그 퀴즈 것이다.
// 서버 짝 = quiz_items_for · quiz_link_items 의 `(q.course_id is null or q.course_id = …)` 술어.
// ★사장 상세·목록·만들기(이어서)·본사 작업실이 전부 이 함수를 쓴다 — 화면마다 다시 거르면 '문항 6개 / 4개'가 갈린다.
import type { QuizItem } from './types';

export function belongsToCourse(item: QuizItem, courseId: string, courseEntryIds: readonly string[]): boolean {
  if (item.course_id) return item.course_id === courseId;
  return (item.entry_ids ?? []).some((id) => courseEntryIds.includes(id));
}

export function itemsOfCourse(items: readonly QuizItem[], courseId: string, courseEntryIds: readonly string[]): QuizItem[] {
  return items.filter((q) => belongsToCourse(q, courseId, courseEntryIds));
}
