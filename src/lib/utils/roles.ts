// 역할 판정 SSOT(0093 매니저 도입) — "매장 안 운영" 권한 판정은 이 헬퍼 하나만 쓴다.
// 매니저 = 사장 화면 표면을 공유하는 매장별 승격 역할(unit_members.role 정본).
// ⚠️ 사장 전용 영역(결제·매장 존재·임명·내보내기)은 이 헬퍼를 쓰지 말고 role === 'owner' 를 그대로 쓴다.
export const canManage = (role: string): boolean => role === 'owner' || role === 'manager';

/**
 * 매니저가 열 수 있는 사장 화면(2026-08-27 절충안 ②: 직원 세트 + '매장 관리' 진입 1곳 + 허용 목록).
 * 매니저는 직원 탭바를 쓰고, 여기 있는 `/owner/*` 만 연다 — 급여·시급·초대코드·요금제·매장 설정·직원 관리·
 * 노하우 편집·퀴즈는 제외. 판정은 `managerMayOpen`(owner/_layout 가드) 하나만 쓴다.
 */
/**
 * ★서버와의 경계 어긋남은 **닫혔다**(0201, 2026-09-14). 이 목록이 매니저 경계의 정본이다.
 *
 * 2026-07-30(0093)부터 서버는 매니저에게 시급 저장·급여 설정 RPC·합류 승인·반려를 열어 뒀는데,
 * 그 일을 하는 화면(`/owner/staff`·`/owner/payroll`)이 이 목록에 없어 가드가 매니저를
 * `/junior/home` 으로 되돌리고 있었다(서버는 허용, 앱은 차단). 사장 판정 2026-09-14:
 * **앱에서 되는 것이 기준** → 0201 이 서버 쪽 세 표면을 사장 전용으로 좁혔다.
 *
 * ⛔ 여기에 `/owner/staff`·`/owner/payroll` 을 추가하지 않는다 — 추가하면 앱만 열리고 서버가
 *    막아 "눌렀는데 아무 일도 안 일어나는" 반대 방향의 어긋남이 된다. 매니저에게 급여·합류 승인을
 *    다시 열기로 정하면 **0201 을 되돌리고 나서** 이 목록을 연다. 두 곳을 같이 바꾸지 않는다.
 */
export const MANAGER_OWNER_ROUTES = [
  '/owner/schedule', // 근무표
  '/owner/work', // 업무 채팅·할일 배정
  '/owner/rooms', // 방 → /owner/work 로 replace
  '/owner/timesheet', // /owner/timesheet/[staffId] 출근기록
  '/owner/notifications', // 공지·알림
] as const;
export const managerMayOpen = (pathname: string): boolean =>
  MANAGER_OWNER_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * 역할 호칭 SSOT — 사람 이름 뒤에 붙는 말. "○○ 사장님 / ○○ 매니저 / ○○님".
 *
 * ★왜 필요한가: 매니저는 사장 화면 세트를 그대로 쓰기 때문에, 화면에 "사장님"을 하드코딩하면
 *   매니저가 자기 자신을 사장으로 부르는 표기가 된다(2026-08-08 알림 화면에서 실제 발생).
 *   호칭이 필요한 자리는 전부 여기를 거친다 — 저자 표기(knowhowSource)·정체성 카드·명부 배지.
 * 직원은 역할명을 붙이지 않는다("이수민 직원"은 우리가 쓰는 말이 아니다) → "○○님".
 */
export function honorific(name: string, role: string): string {
  const n = name?.trim() || '나';
  if (role === 'owner') return `${n} 사장님`;
  if (role === 'manager') return `${n} 매니저`;
  return `${n}님`;
}

/** 역할 이름만(배지·목록 힌트용). 호칭이 아니라 명사다. */
export const roleNoun = (role: string): string =>
  role === 'owner' ? '사장' : role === 'manager' ? '매니저' : '직원';

export type MemberRole = 'owner' | 'manager' | 'junior';
/** DB에서 온 역할 문자열을 3종으로 좁힌다. 모르는 값은 **직원**으로 — 권한이 새는 방향이 아니라
 *  잠기는 방향(fail-closed). 세션 역할 파생(useSessionStore)과 같은 원칙. */
export const asMemberRole = (role: string | null | undefined): MemberRole =>
  role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : 'junior';
