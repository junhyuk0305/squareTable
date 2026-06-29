import { WorkBoard } from '@/components/WorkBoard';

/**
 * 사장 '업무' 탭 — WorkBoard가 단일 스트림 채팅 + 우상단 nav(공지/할일)를 소유한다.
 * 자체 SafeArea/헤더/탭바까지 가지는 풀 화면이라 단순 위임.
 */
export default function OwnerWorkScreen() {
  return <WorkBoard role="owner" />;
}
