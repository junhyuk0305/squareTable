// 파일럿 기능 플래그 (단일 진실).
// 전략업데이트_2026-06-22 §7: 급여(payroll)는 파일럿에서 숨김.
//   - 유지: 출퇴근 집계·직원 관리·업무보드 (피치덱 기본 기능)
//   - 숨김: 급여 설정(payroll) 진입점 — 아직 stub이라 파일럿 혼선 방지
// 결제 도입/정식 출시 시 payrollSettings 를 true 로 되돌리면 즉시 복구된다.
export const FEATURES = {
  payrollSettings: false,
} as const;
