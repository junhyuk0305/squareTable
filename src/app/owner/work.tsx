import { WorkBoard } from '@/components/WorkBoard';

/**
 * 사장 '업무' 탭 — WorkBoard가 [채팅 | 공지 | 할일] 세그먼트 컨테이너(WorkSegment)를
 * 소유한다. 자체 SafeArea/헤더/탭바까지 가지는 풀 화면이라 단순 위임.
 */
export default function OwnerWorkScreen() {
  return <WorkBoard role="owner" />;
}
