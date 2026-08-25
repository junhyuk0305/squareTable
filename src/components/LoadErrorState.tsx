import { EmptyState } from '@/components/EmptyState';

/**
 * 읽기 실패 전용 상태 — "없어요"(0건)와 **다른 화면**이다.
 *
 * ★왜 컴포넌트로 따로 두나(2026-08-25 조용한 오류 감사):
 *   `loaded` 두 값으로는 세 가지 상태를 표현할 수 없다. 게이트가 (아직 안 불러옴 / 0건 / **실패**)
 *   중 세 번째를 첫째나 둘째로 흡수하면, 백엔드 장애가 "할 일이 없어요"·"방이 없어요"·
 *   "아직 출근 전이에요" 같은 **정상 문구**로 위장된다. 위장 대상만 다를 뿐 전부 조용한 오류다.
 *
 * 화면 3분기 규약(이 저장소 공통):
 *   `!loaded` → ScreenLoading / `loadError` → 이 컴포넌트 / 0건 → EmptyState + 다음 행동 CTA
 *
 * 재시도 버튼은 **필수**다 — 게이트가 붙는 화면 상당수가 마운트 1회 fetch라, 재시도 경로가 없으면
 * 화면을 나갔다 와도 TTL 때문에 실패 상태 그대로다. onRetry 는 TTL 을 무시하는 경로여야 한다.
 */
/** title 은 호출부가 통째로 준다 — 조사('을/를')를 코드가 지어내면 어색해진다. 예: "매장 현황을 불러오지 못했어요". */
export function LoadErrorState({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <EmptyState
      title={title}
      body="연결을 확인하고 다시 시도해 주세요."
      cta={{ label: '다시 시도', onPress: onRetry }}
    />
  );
}
