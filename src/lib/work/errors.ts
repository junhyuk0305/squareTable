// errors.ts — 업무·근무·직원 서버 raise 코드 → 사람 말. 모양은 src/lib/quiz/errors.ts · src/lib/suggestion/errors.ts 와 같다.
// 새 raise 코드를 만들면 같은 커밋에서 여기에 문구를 넣는다(AGENTS ⑨). 모르는 코드는 fallback 으로 떨어진다.
// ⚠️ 하니스(qa-race-client)가 이 파일을 단독으로 읽는다. 경로 별칭(@/) import 를 넣지 않는다.
type WorkErr = { message?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  // 직원(remove_staff · set_member_role · leave_store)
  staff_not_found: '이미 매장을 나간 직원이에요. 목록을 새로 불러올게요.',
  owner_cannot_leave: '사장님은 매장을 나갈 수 없어요.',
  not_member: '이 매장의 멤버가 아니에요. 매장을 다시 골라 주세요.',
  // 근무표(0242 · 0246 · 0279 · 0604 · 0636)
  shift_closed: '이미 끝난 근무라 바꿀 수 없어요. 근무표를 새로 불러올게요.',
  shift_not_active: '그 날짜에는 이 근무가 없어요. 근무표를 새로 불러올게요.',
  day_not_scheduled: '그날은 이 근무가 없는 날이에요. 근무표를 새로 불러올게요.',
  not_own_shift: '내 근무만 시간 변경을 요청할 수 있어요.',
  date_out_of_range: '지난 35일부터 앞으로 60일 안의 근무만 요청할 수 있어요.',
  staff_not_member: '이 매장 직원이 아니라 근무를 넣을 수 없어요.',
  // 관리자 전용 쓰기(save_essential_sections · broadcast_notice)
  manager_only: '사장님이나 매니저만 바꿀 수 있어요.',
  no_targets: '공지를 받을 직원이 아직 없어요.',
  // 노하우 사진(set_knowhow_photos)
  too_many_photos: '사진은 더 넣을 수 없어요. 몇 장을 뺀 뒤 다시 시도해 주세요.',
  // 할 일 완료(0630) · 피드(0635)
  task_not_found: '이 할 일을 찾을 수 없어요. 화면을 새로고침해 주세요.',
  feed_parent_gone: '글이 지워져 댓글을 달 수 없어요.',
};

/** 서버 오류 원문의 첫 낱말(raise 코드). 없으면 null. */
export function workErrorCode(err: WorkErr | string): string | null {
  const raw = typeof err === 'string' ? err : err?.message ?? '';
  const code = raw.split(/[\s:]/)[0];
  return code || null;
}

export function workErrorMessage(err: WorkErr | string, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const code = workErrorCode(err);
  return (code && MESSAGES[code]) || fallback;
}
