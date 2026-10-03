// 노하우 상태 판정 SSOT — "직원/AI 답변에 써도 되는가"는 여기 한 곳에서만 정의한다.
// (같은 판정이 2곳 이상 복제되는 순간 드리프트 — 아키텍처 규칙 ②)
//
// 3중 방어의 2선: 1선=RLS(0064, 직원은 published만 수신) · 2선=이 필터(답변 corpus)
// · 3선=색인(embedEntry가 published만 색인). 사장 화면은 draft를 봐야 하므로(검토 대기함)
// RLS만으론 부족하고, 답변/검색 corpus는 역할 무관하게 이 필터를 거쳐야 한다
// (사장이 테스트로 질문해도 draft가 답으로 새면 안 됨).
//
// ★본사 사본 숨김(0216 brand_hidden_at)도 여기서 뺀다. 직원은 RLS(0231)가 숨긴 행을 안 내려 주지만
//  사장은 되살리려고 숨긴 행을 받는다. 사장이 물어봐도 숨긴 사본이 답으로 나가면 안 된다(match_playbook 0217 과 같은 뜻).
import { isBrandHidden } from '@/lib/brand/copy';
import type { PlaybookEntry } from '@/types';

/** AI 답변·검색 corpus에 넣어도 되는 노하우인가 — 발행 상태이고 이 매장에서 숨기지 않은 것. */
export function isServable(e: PlaybookEntry): boolean {
  return e.status === 'published' && !isBrandHidden(e);
}

/** 검토 대기(인수인계서 파이프라인이 증분 저장한 초안)인가. */
export function isDraft(e: PlaybookEntry): boolean {
  return e.status === 'draft';
}
