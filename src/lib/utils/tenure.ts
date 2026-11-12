/**
 * 재직 기간(member_tenures · 0246) 화면 판정. 사장만 읽는다(RLS = 같은 매장 사장).
 * 들어올 때 기간이 열리고 나갈 때 닫힌다. 다시 들어오면 새 기간이 열리고 예전 기록은 표시돼 앱에서 안 보인다.
 * ★퇴사자 정산 줄·재입사 경고는 2026-11-02 급여 기능과 함께 뺐다. 입사일 판정만 남는다.
 */
export type MemberTenure = {
  id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  name_snapshot: string | null;
};

/** 입사일 = 열린 기간의 joined_at. 열린 기간이 없으면 null 이고 호출부가 기존 값으로 폴백한다. */
export function openJoinedAt(tenures: MemberTenure[], userId: string): string | null {
  return tenures.find((t) => t.user_id === userId && !t.left_at)?.joined_at ?? null;
}
