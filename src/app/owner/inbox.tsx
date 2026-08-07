import { Redirect } from 'expo-router';

/**
 * 받은질문 → 노하우 탭 '할 일' 칸으로 흡수(2026-08-07). 탭 5개 → 4개.
 *
 * ★라우트를 지우지 않는 이유: 이 경로를 물고 있는 곳이 여럿이다 —
 *   웹푸시 클릭 url(`lib/push/notify.ts`), 알림 라우팅(`lib/utils/notifications.ts`),
 *   답변 완료 후 복귀(`owner/coach.tsx`), 허브 진입(`OwnerStatusView`·`OwnerKnowhowHubView`), 기능 소개 카드.
 *   지우면 저 링크들이 전부 죽는다. 화면만 걷어내고 착지점만 바꾼다.
 * 착지 후 노하우 탭이 활성으로 보이는 것은 RoleTabBar 의 alsoActiveFor 가 맡는다.
 */
export default function OwnerInboxRedirect() {
  return <Redirect href="/owner/categories?seg=todo" />;
}
