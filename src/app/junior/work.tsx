import { WorkBoard } from '@/components/WorkBoard';

/**
 * 직원 '업무' 탭 — 단일 스트림 채팅 + 우상단 nav(공지/할일). WorkBoard가 전부 소유.
 * 출퇴근은 별도 탭(/junior/attendance)으로 분리됐다(이전 [업무|출퇴근] 세그먼트 폐기).
 *
 * WorkBoard가 SafeArea·헤더·RoleTabBar를 직접 소유하므로 화면은 단순 위임만 한다.
 */
export default function JuniorWorkScreen() {
  return <WorkBoard role="junior" />;
}
