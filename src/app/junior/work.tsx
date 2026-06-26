import { WorkBoard } from '@/components/WorkBoard';

/**
 * 직원 '업무' 탭 — [채팅 | 공지 | 할일] 세그먼트(WorkSegment).
 * 출퇴근은 별도 탭(/junior/attendance)으로 분리됐다(이전 [업무|출퇴근] 세그먼트 폐기).
 *
 * WorkBoard가 비-embedded일 때 SafeArea·로그아웃 헤더·RoleTabBar를 직접 소유하므로
 * 화면은 단순 위임만 한다.
 */
export default function JuniorWorkScreen() {
  return <WorkBoard role="junior" />;
}
