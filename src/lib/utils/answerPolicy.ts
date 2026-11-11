// answerPolicy.ts — 질문에 단 답이 바로 노하우가 되는가(결정 145). 판정은 여기 한 곳이다.
// 사장·매니저 = 바로 노하우(어느 화면에서 답했든 같다). 직원 = 사장 승인을 기다리는 제안.
// 쓰는 곳 = JuniorMySpace(매장 질문 답하기 시트) · WorkBoard(완료 캡처). 사장 코치 화면(owner/coach)은 사장·매니저만 연다.
import { canManage } from '@/lib/utils/roles';

export const answerGoesLive = (role: string): boolean => canManage(role);
