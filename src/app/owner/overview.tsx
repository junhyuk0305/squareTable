import { Redirect } from 'expo-router';

/**
 * '전체 매장 보기'(구 다점포 통합뷰) — 허브 '현황' 탭에 흡수됐다(대시보드 기획 v2, 2026-07-24).
 * 기존 진입(매장 전환 시트 '전체 매장 한눈에 보기'·딥링크)을 보존하기 위해 라우트만 남겨 리다이렉트.
 * 합계·매장별 지표·multi 게이팅은 전부 /hub(OwnerStatusView)가 담당 — 화면 중복 유지하지 않는다.
 */
export default function OwnerOverviewScreen() {
  return <Redirect href="/hub" />;
}
