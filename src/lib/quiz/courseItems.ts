// 어느 퀴즈의 문항인가 — 판정 한 곳(0307 · 0330).
//
// 문항은 정확히 한 퀴즈(course_id)에 속한다. 공유 문항(course_id 없음)은 0328 이 지웠고 0330 이 막는다.
// 서버 짝 = quiz_course_servable 의 `q.course_id = p_course` 술어.
// ★사장 상세·목록·만들기(이어서)·본사 작업실이 전부 이 함수를 쓴다 — 화면마다 다시 거르면 '문항 6개 / 4개'가 갈린다.
import type { QuizItem } from './types';

export function belongsToCourse(item: QuizItem, courseId: string, _courseEntryIds?: readonly string[]): boolean {
  return item.course_id === courseId;
}

export function itemsOfCourse(items: readonly QuizItem[], courseId: string, courseEntryIds?: readonly string[]): QuizItem[] {
  return items.filter((q) => belongsToCourse(q, courseId, courseEntryIds));
}
